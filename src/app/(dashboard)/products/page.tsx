'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/providers/auth-provider';
import { createClient } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { IMUS_ONLY } from '@/lib/feature-flags';

// ─── Types ──────────────────────────────────────────────────

interface Product {
  id: string;
  branch_id: string;
  branch_name?: string;
  name: string;
  description: string | null;
  sku: string | null;
  price: number;
  category: string | null;
  unit: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // From inventory join
  quantity?: number;
  low_stock_threshold?: number;
}

interface ProductFormData {
  branch_id: string;
  name: string;
  description: string;
  sku: string;
  price: string;
  category: string;
  unit: string;
}

const PRODUCT_CATEGORIES = [
  'Glutathione',
  'Vitamin C',
  'Collagen',
  'Whitening',
  'Moisturizer',
  'Serum',
  'Sunscreen',
  'Supplement',
  'Device',
  'Consumable',
  'Other',
];

const PRODUCT_UNITS = ['pcs', 'vials', 'ampules', 'bottles', 'boxes', 'sachets', 'ml', 'g', 'sets'];

// ─── Component ──────────────────────────────────────────────

export default function ProductsPage() {
  const { isOwner, isManager, selectedBranch, branches } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterStatus, setFilterStatus] = useState<'active' | 'inactive' | 'all'>('active');

  // Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [formData, setFormData] = useState<ProductFormData>({
    branch_id: '', name: '', description: '', sku: '', price: '', category: '', unit: 'pcs',
  });
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Delete
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const supabase = createClient();

  // ─── Fetch ──────────────────────────────────────────────

  const fetchProducts = useCallback(async () => {
    setIsLoading(true);
    try {
      let query = supabase
        .from('products')
        .select('*, branches:branch_id(name), inventory!inner(quantity, low_stock_threshold)')
        .order('name');

      if (!isOwner && selectedBranch?.id) {
        query = query.eq('branch_id', selectedBranch.id);
      }

      const { data, error } = await query;

      if (error) {
        // Fallback: fetch without inventory join if no inventory records exist
        let fallbackQuery = supabase.from('products').select('*, branches:branch_id(name)').order('name');
        if (!isOwner && selectedBranch?.id) fallbackQuery = fallbackQuery.eq('branch_id', selectedBranch.id);
        const { data: fallbackData } = await fallbackQuery;
        setProducts((fallbackData || []).map((p: Record<string, unknown>) => mapProduct(p, null)));
        return;
      }

      setProducts((data || []).map((p: Record<string, unknown>) => {
        const inv = Array.isArray(p.inventory) ? (p.inventory as Record<string, unknown>[])[0] : (p.inventory as Record<string, unknown>);
        return mapProduct(p, inv || null);
      }));
    } catch (err) {
      console.error('Products page error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [supabase, isOwner, selectedBranch?.id]);

  function mapProduct(p: Record<string, unknown>, inv: Record<string, unknown> | null): Product {
    return {
      id: p.id as string,
      branch_id: p.branch_id as string,
      branch_name: (p.branches as Record<string, unknown>)?.name as string || '',
      name: p.name as string,
      description: p.description as string | null,
      sku: p.sku as string | null,
      price: Number(p.price),
      category: p.category as string | null,
      unit: p.unit as string,
      is_active: p.is_active as boolean,
      created_at: p.created_at as string,
      updated_at: p.updated_at as string,
      quantity: inv ? (inv.quantity as number) : 0,
      low_stock_threshold: inv ? (inv.low_stock_threshold as number) : 10,
    };
  }

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel('products-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => fetchProducts())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, () => fetchProducts())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [supabase, fetchProducts]);

  // ─── Filtering ──────────────────────────────────────────

  const filteredProducts = products.filter(p => {
    if (filterStatus === 'active' && !p.is_active) return false;
    if (filterStatus === 'inactive' && p.is_active) return false;
    if (filterCategory && p.category !== filterCategory) return false;
    if (searchText && !p.name.toLowerCase().includes(searchText.toLowerCase()) &&
      !(p.sku || '').toLowerCase().includes(searchText.toLowerCase()) &&
      !(p.category || '').toLowerCase().includes(searchText.toLowerCase())) return false;
    return true;
  });

  const lowStockCount = products.filter(p => p.is_active && (p.quantity ?? 0) <= (p.low_stock_threshold ?? 10)).length;

  // ─── Modal Handlers ─────────────────────────────────────

  const openCreate = () => {
    setFormMode('create');
    setEditingProduct(null);
    setFormData({
      branch_id: isManager ? (selectedBranch?.id || '') : (branches[0]?.id || ''),
      name: '', description: '', sku: '', price: '', category: '', unit: 'pcs',
    });
    setFormError(''); setFormSuccess('');
    setIsModalOpen(true);
  };

  const openEdit = (p: Product) => {
    setFormMode('edit');
    setEditingProduct(p);
    setFormData({
      branch_id: p.branch_id,
      name: p.name,
      description: p.description || '',
      sku: p.sku || '',
      price: String(p.price),
      category: p.category || '',
      unit: p.unit,
    });
    setFormError(''); setFormSuccess('');
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(''); setFormSuccess(''); setIsSubmitting(true);
    try {
      const price = parseFloat(formData.price);
      if (!formData.name.trim()) { setFormError('Product name is required'); return; }
      if (isNaN(price) || price < 0) { setFormError('Invalid price'); return; }

      if (formMode === 'create') {
        if (!formData.branch_id) { setFormError('Please select a branch'); return; }
        const res = await fetch('/api/products', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            branch_id: formData.branch_id,
            name: formData.name.trim(),
            description: formData.description.trim() || null,
            sku: formData.sku.trim() || null,
            price,
            category: formData.category || null,
            unit: formData.unit,
          }),
        });
        const result = await res.json();
        if (!res.ok) { setFormError(result.error || 'Failed to create product'); return; }
        setFormSuccess(`"${formData.name}" created successfully`);
      } else if (editingProduct) {
        const changes: Record<string, unknown> = {};
        if (formData.name !== editingProduct.name) changes.name = formData.name.trim();
        if (formData.description !== (editingProduct.description || '')) changes.description = formData.description.trim() || null;
        if (formData.sku !== (editingProduct.sku || '')) changes.sku = formData.sku.trim() || null;
        if (price !== editingProduct.price) changes.price = price;
        if (formData.category !== (editingProduct.category || '')) changes.category = formData.category || null;
        if (formData.unit !== editingProduct.unit) changes.unit = formData.unit;

        if (Object.keys(changes).length === 0) { setFormError('No changes detected'); return; }

        const res = await fetch(`/api/products/${editingProduct.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(changes),
        });
        const result = await res.json();
        if (!res.ok) { setFormError(result.error || 'Failed to update product'); return; }
        setFormSuccess(`"${formData.name}" updated successfully`);
      }
      await fetchProducts();
      setTimeout(() => { setIsModalOpen(false); setFormSuccess(''); }, 1500);
    } catch (err) {
      console.error('Product form error:', err);
      setFormError('An unexpected error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/products/${deleteTarget.id}`, { method: 'DELETE' });
      const result = await res.json();
      if (!res.ok) { alert(result.error || 'Failed to delete product'); return; }
      await fetchProducts();
      setDeleteTarget(null);
    } catch (err) {
      console.error('Delete error:', err);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleToggleActive = async (p: Product) => {
    try {
      const res = await fetch(`/api/products/${p.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !p.is_active }),
      });
      if (!res.ok) { const r = await res.json(); alert(r.error || 'Failed to update'); return; }
      await fetchProducts();
    } catch (err) { console.error('Toggle error:', err); }
  };

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(n);

  const canManage = isOwner || isManager;

  const isLowStock = (p: Product) =>
    p.is_active && (p.quantity ?? 0) <= (p.low_stock_threshold ?? 10);

  // ─── Render ─────────────────────────────────────────────

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-semibold text-brand-900">Products</h1>
          <p className="text-sm text-brand-500 mt-1">
            {isOwner ? 'Manage product catalog across all branches' : 'Manage products for your branch'}
          </p>
        </div>
        {canManage && (
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-brand-600 to-brand-700 text-white text-sm font-medium
                       hover:from-brand-700 hover:to-brand-800 active:scale-[0.98] transition-all duration-200 shadow-sm hover:shadow-md"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add Product
          </button>
        )}
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Products', value: products.length, color: 'text-brand-900' },
          { label: 'Active', value: products.filter(p => p.is_active).length, color: 'text-emerald-600' },
          { label: 'Low Stock', value: lowStockCount, color: lowStockCount > 0 ? 'text-rose-600' : 'text-brand-400' },
          { label: 'Inactive', value: products.filter(p => !p.is_active).length, color: 'text-brand-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className={`bg-white rounded-2xl border shadow-card px-5 py-4 ${
            label === 'Low Stock' && lowStockCount > 0 ? 'border-rose-200 bg-rose-50/30' : 'border-brand-100/50'
          }`}>
            <p className="text-xs font-medium text-brand-400 uppercase tracking-wide">{label}</p>
            <p className={`text-2xl font-semibold mt-1 ${color}`}>{value}</p>
            {label === 'Low Stock' && lowStockCount > 0 && (
              <p className="text-xs text-rose-500 mt-0.5">Needs restock</p>
            )}
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-brand-500 mb-1">Search</label>
            <input
              type="text" value={searchText} onChange={e => setSearchText(e.target.value)}
              placeholder="Name, SKU, or category..."
              className="w-full px-3 py-2 rounded-xl border border-brand-200 bg-surface-50 text-sm text-brand-800
                         placeholder:text-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-brand-500 mb-1">Category</label>
            <select
              value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-brand-200 bg-surface-50 text-sm text-brand-800
                         focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all"
            >
              <option value="">All categories</option>
              {PRODUCT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-brand-500 mb-1">Status</label>
            <select
              value={filterStatus} onChange={e => setFilterStatus(e.target.value as 'active' | 'inactive' | 'all')}
              className="w-full px-3 py-2 rounded-xl border border-brand-200 bg-surface-50 text-sm text-brand-800
                         focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all"
            >
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
              <option value="all">All</option>
            </select>
          </div>
          {(searchText || filterCategory) && (
            <div className="flex items-end">
              <button
                onClick={() => { setSearchText(''); setFilterCategory(''); }}
                className="text-sm text-brand-500 hover:text-brand-700 px-3 py-2 rounded-xl hover:bg-brand-50 transition-colors"
              >
                Clear filters
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Products Table */}
      <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-brand-100/60 bg-surface-50">
                <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Product</th>
                {isOwner && !IMUS_ONLY && <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Branch</th>}
                <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">SKU</th>
                <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Category</th>
                <th className="text-right text-xs font-medium text-brand-400 px-5 py-3">Price</th>
                <th className="text-center text-xs font-medium text-brand-400 px-5 py-3">Stock</th>
                <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Status</th>
                {canManage && <th className="text-right text-xs font-medium text-brand-400 px-5 py-3">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b border-brand-100/30">
                    <td className="px-5 py-4"><div><Skeleton className="h-4 w-36 mb-1" /><Skeleton className="h-3 w-20" /></div></td>
                    {isOwner && !IMUS_ONLY && <td className="px-5 py-4"><Skeleton className="h-4 w-20" /></td>}
                    <td className="px-5 py-4"><Skeleton className="h-4 w-16" /></td>
                    <td className="px-5 py-4"><Skeleton className="h-5 w-20 rounded-full" /></td>
                    <td className="px-5 py-4 text-right"><Skeleton className="h-4 w-16 ml-auto" /></td>
                    <td className="px-5 py-4"><Skeleton className="h-5 w-12 mx-auto rounded-full" /></td>
                    <td className="px-5 py-4"><Skeleton className="h-5 w-14 rounded-full" /></td>
                    {canManage && <td className="px-5 py-4"><Skeleton className="h-4 w-16 ml-auto" /></td>}
                  </tr>
                ))
              ) : filteredProducts.length === 0 ? (
                <tr>
                  <td
                    colSpan={canManage ? (isOwner && !IMUS_ONLY ? 8 : 7) : (isOwner && !IMUS_ONLY ? 7 : 6)}
                    className="text-center py-16 text-sm text-brand-400"
                  >
                    <svg className="w-12 h-12 text-brand-200 mx-auto mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
                    </svg>
                    {searchText || filterCategory ? 'No products match your filters' : 'No products added yet'}
                  </td>
                </tr>
              ) : (
                filteredProducts.map(p => (
                  <tr key={p.id} className={`border-b border-brand-100/30 hover:bg-brand-50/30 transition-colors ${!p.is_active ? 'opacity-60' : ''}`}>
                    <td className="px-5 py-4">
                      <p className="text-sm font-medium text-brand-800">{p.name}</p>
                      <p className="text-xs text-brand-400 mt-0.5">{p.unit}</p>
                    </td>
                    {isOwner && !IMUS_ONLY && <td className="px-5 py-4"><span className="text-sm text-brand-500">{p.branch_name}</span></td>}
                    <td className="px-5 py-4">
                      <span className="text-xs font-mono text-brand-500">{p.sku || '—'}</span>
                    </td>
                    <td className="px-5 py-4">
                      {p.category ? (
                        <Badge variant="brand" size="sm">{p.category}</Badge>
                      ) : (
                        <span className="text-xs text-brand-300">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <span className="text-sm font-semibold text-brand-800">{formatCurrency(p.price)}</span>
                    </td>
                    <td className="px-5 py-4 text-center">
                      <span className={`inline-flex items-center justify-center min-w-[3rem] px-2 py-0.5 rounded-full text-xs font-semibold ${
                        isLowStock(p)
                          ? 'bg-rose-100 text-rose-700'
                          : 'bg-emerald-50 text-emerald-700'
                      }`}>
                        {p.quantity ?? 0}
                        {isLowStock(p) && (
                          <svg className="w-3 h-3 ml-1" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                          </svg>
                        )}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <Badge variant={p.is_active ? 'success' : 'default'} size="sm">
                        {p.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    {canManage && (
                      <td className="px-5 py-4">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => openEdit(p)} title="Edit product"
                            className="p-2 rounded-lg text-brand-400 hover:text-brand-700 hover:bg-brand-50 transition-colors">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                            </svg>
                          </button>
                          <button onClick={() => handleToggleActive(p)} title={p.is_active ? 'Deactivate' : 'Activate'}
                            className={`p-2 rounded-lg transition-colors ${p.is_active ? 'text-amber-400 hover:text-amber-700 hover:bg-amber-50' : 'text-emerald-400 hover:text-emerald-700 hover:bg-emerald-50'}`}>
                            {p.is_active ? (
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                              </svg>
                            ) : (
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            )}
                          </button>
                          {isOwner && (
                            <button onClick={() => setDeleteTarget(p)} title="Delete product"
                              className="p-2 rounded-lg text-rose-300 hover:text-rose-600 hover:bg-rose-50 transition-colors">
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {!isLoading && filteredProducts.length > 0 && (
          <div className="px-5 py-3 border-t border-brand-100/40 text-xs text-brand-400">
            Showing {filteredProducts.length} of {products.length} products
            {lowStockCount > 0 && (
              <span className="ml-2 text-rose-500 font-medium">· {lowStockCount} low stock</span>
            )}
          </div>
        )}
      </div>

      {/* ─── Create / Edit Modal ─────────────────────────────── */}
      <Modal
        isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}
        title={formMode === 'create' ? 'Add New Product' : 'Edit Product'}
        subtitle={formMode === 'create' ? 'Add a product to your catalog' : `Editing: ${editingProduct?.name}`}
        size="md"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && (
            <div className="animate-slide-up bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{formError}</div>
          )}
          {formSuccess && (
            <div className="animate-slide-up bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {formSuccess}
            </div>
          )}

          {/* Branch (Owner only, create) */}
          {isOwner && !IMUS_ONLY && formMode === 'create' && (
            <div>
              <label className="block text-sm font-medium text-brand-800 mb-1.5">Branch</label>
              <select
                value={formData.branch_id} onChange={e => setFormData({ ...formData, branch_id: e.target.value })}
                required
                className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900
                           focus:outline-none focus:ring-2 focus:ring-brand-400/50 focus:border-brand-400 transition-all"
              >
                <option value="">Select branch...</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          )}

          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-brand-800 mb-1.5">Product Name</label>
            <input
              type="text" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g. Glutathione 600mg Ampule" required
              className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900 placeholder:text-brand-300
                         focus:outline-none focus:ring-2 focus:ring-brand-400/50 focus:border-brand-400 transition-all"
            />
          </div>

          {/* SKU + Unit */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-brand-800 mb-1.5">SKU <span className="text-brand-300 font-normal">(optional)</span></label>
              <input
                type="text" value={formData.sku} onChange={e => setFormData({ ...formData, sku: e.target.value })}
                placeholder="e.g. GLU-600-AMP"
                className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900 placeholder:text-brand-300
                           focus:outline-none focus:ring-2 focus:ring-brand-400/50 focus:border-brand-400 transition-all font-mono text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-brand-800 mb-1.5">Unit</label>
              <select
                value={formData.unit} onChange={e => setFormData({ ...formData, unit: e.target.value })}
                className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900
                           focus:outline-none focus:ring-2 focus:ring-brand-400/50 focus:border-brand-400 transition-all"
              >
                {PRODUCT_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>

          {/* Price + Category */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-brand-800 mb-1.5">Price (PHP)</label>
              <input
                type="number" value={formData.price} min="0" step="0.01"
                onChange={e => setFormData({ ...formData, price: e.target.value })}
                placeholder="0.00" required
                className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900 placeholder:text-brand-300
                           focus:outline-none focus:ring-2 focus:ring-brand-400/50 focus:border-brand-400 transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-brand-800 mb-1.5">Category</label>
              <select
                value={formData.category} onChange={e => setFormData({ ...formData, category: e.target.value })}
                className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900
                           focus:outline-none focus:ring-2 focus:ring-brand-400/50 focus:border-brand-400 transition-all"
              >
                <option value="">Select category...</option>
                {PRODUCT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-brand-800 mb-1.5">Description <span className="text-brand-300 font-normal">(optional)</span></label>
            <textarea
              value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })}
              placeholder="Brief product description..." rows={2}
              className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900 placeholder:text-brand-300
                         focus:outline-none focus:ring-2 focus:ring-brand-400/50 focus:border-brand-400 transition-all resize-none"
            />
          </div>

          {/* Submit */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit" disabled={isSubmitting}
              className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-brand-600 to-brand-700 text-white font-medium
                         hover:from-brand-700 hover:to-brand-800 active:scale-[0.98]
                         disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200 shadow-sm hover:shadow-md text-sm"
            >
              {isSubmitting ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  {formMode === 'create' ? 'Creating...' : 'Saving...'}
                </span>
              ) : (
                formMode === 'create' ? 'Create Product' : 'Save Changes'
              )}
            </button>
            <button
              type="button" onClick={() => setIsModalOpen(false)}
              className="px-4 py-2.5 rounded-xl border border-brand-200 text-brand-600 text-sm font-medium hover:bg-brand-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </Modal>

      {/* ─── Delete Modal ─────────────────────────────────────── */}
      <Modal
        isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)}
        title="Delete Product" subtitle="This may soft-delete if the product has sale history"
        size="sm"
      >
        <div className="space-y-4">
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-4">
            <p className="text-sm font-medium text-rose-800">Delete &quot;{deleteTarget?.name}&quot;?</p>
            <p className="text-xs text-rose-600 mt-1">
              If this product has been sold, it will be deactivated instead of permanently deleted. Its inventory record will also be removed.
            </p>
          </div>
          {deleteTarget && (
            <div className="bg-surface-50 rounded-xl p-4 space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-brand-400">SKU</span><span className="font-mono text-brand-700">{deleteTarget.sku || '—'}</span></div>
              <div className="flex justify-between"><span className="text-brand-400">Price</span><span className="text-brand-700">{formatCurrency(deleteTarget.price)}</span></div>
              <div className="flex justify-between"><span className="text-brand-400">Stock</span><span className="text-brand-700">{deleteTarget.quantity ?? 0} {deleteTarget.unit}</span></div>
            </div>
          )}
          <div className="flex items-center gap-3">
            <button
              onClick={handleDelete} disabled={isDeleting}
              className="flex-1 py-2.5 px-4 rounded-xl bg-rose-600 text-white font-medium text-sm
                         hover:bg-rose-700 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed transition-all"
            >
              {isDeleting ? 'Deleting...' : 'Delete Product'}
            </button>
            <button onClick={() => setDeleteTarget(null)}
              className="px-4 py-2.5 rounded-xl border border-brand-200 text-brand-600 text-sm font-medium hover:bg-brand-50 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
