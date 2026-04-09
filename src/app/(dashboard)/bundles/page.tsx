'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/providers/auth-provider';
import { createClient } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import type { InsertTables, UpdateTables } from '@/types/database';

// ─── Types ──────────────────────────────────────────────────

interface BundleItem {
  id?: string;          // undefined = not yet saved
  service_id: string | null;
  product_id: string | null;
  quantity: number;
  item_label: string;   // display name (service or product name)
  item_type: 'service' | 'product';
}

interface Bundle {
  id: string;
  branch_id: string;
  branch_name?: string;
  name: string;
  description: string | null;
  price: number;
  is_active: boolean;
  created_at: string;
  items: BundleItem[];
}

interface ServiceOption { id: string; name: string; price: number; }
interface ProductOption { id: string; name: string; price: number; unit: string; }

// ─── Component ──────────────────────────────────────────────

export default function BundlesPage() {
  const { isOwner, isManager, selectedBranch, branches } = useAuth();
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [filterStatus, setFilterStatus] = useState<'active' | 'inactive' | 'all'>('active');

  // Options for item picker
  const [serviceOptions, setServiceOptions] = useState<ServiceOption[]>([]);
  const [productOptions, setProductOptions] = useState<ProductOption[]>([]);

  // Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [editingBundle, setEditingBundle] = useState<Bundle | null>(null);
  const [formBranchId, setFormBranchId] = useState('');
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formPrice, setFormPrice] = useState('');
  const [formItems, setFormItems] = useState<BundleItem[]>([]);
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Item picker state
  const [newItemType, setNewItemType] = useState<'service' | 'product'>('service');
  const [newItemId, setNewItemId] = useState('');
  const [newItemQty, setNewItemQty] = useState('1');

  // Delete
  const [deleteTarget, setDeleteTarget] = useState<Bundle | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const supabase = createClient();

  // ─── Fetch ──────────────────────────────────────────────

  const fetchBundles = useCallback(async () => {
    setIsLoading(true);
    try {
      let query = supabase
        .from('bundles')
        .select('*, branches:branch_id(name), bundle_items(id, service_id, product_id, quantity, services:service_id(name), products:product_id(name))')
        .order('name');

      if (!isOwner && selectedBranch?.id) {
        query = query.eq('branch_id', selectedBranch.id);
      }

      const { data, error } = await query;
      if (error) { console.error('Bundles fetch error:', error); return; }

      setBundles((data || []).map((b: Record<string, unknown>) => ({
        id: b.id as string,
        branch_id: b.branch_id as string,
        branch_name: (b.branches as Record<string, unknown>)?.name as string || '',
        name: b.name as string,
        description: b.description as string | null,
        price: Number(b.price),
        is_active: b.is_active as boolean,
        created_at: b.created_at as string,
        items: ((b.bundle_items as Record<string, unknown>[]) || []).map(item => ({
          id: item.id as string,
          service_id: item.service_id as string | null,
          product_id: item.product_id as string | null,
          quantity: item.quantity as number,
          item_type: item.service_id ? 'service' : 'product' as 'service' | 'product',
          item_label: item.service_id
            ? ((item.services as Record<string, unknown>)?.name as string || 'Unknown Service')
            : ((item.products as Record<string, unknown>)?.name as string || 'Unknown Product'),
        })),
      })));
    } catch (err) {
      console.error('Bundles page error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [supabase, isOwner, selectedBranch?.id]);

  useEffect(() => { fetchBundles(); }, [fetchBundles]);

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel('bundles-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bundles' }, () => fetchBundles())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bundle_items' }, () => fetchBundles())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [supabase, fetchBundles]);

  // ─── Load service/product options for a branch ──────────

  const loadBranchOptions = useCallback(async (branchId: string) => {
    if (!branchId) return;
    const [{ data: svcs }, { data: prods }] = await Promise.all([
      supabase.from('services').select('id, name, price').eq('branch_id', branchId).eq('is_active', true).order('name'),
      supabase.from('products').select('id, name, price, unit').eq('branch_id', branchId).eq('is_active', true).order('name'),
    ]);
    setServiceOptions((svcs || []).map((s: Record<string, unknown>) => ({
      id: s.id as string, name: s.name as string, price: Number(s.price),
    })));
    setProductOptions((prods || []).map((p: Record<string, unknown>) => ({
      id: p.id as string, name: p.name as string, price: Number(p.price), unit: p.unit as string,
    })));
  }, [supabase]);

  // ─── Filtering ──────────────────────────────────────────

  const filteredBundles = bundles.filter(b => {
    if (filterStatus === 'active' && !b.is_active) return false;
    if (filterStatus === 'inactive' && b.is_active) return false;
    if (searchText && !b.name.toLowerCase().includes(searchText.toLowerCase())) return false;
    return true;
  });

  // ─── Modal Handlers ─────────────────────────────────────

  const openCreate = async () => {
    const branchId = isManager ? (selectedBranch?.id || '') : (branches[0]?.id || '');
    setFormMode('create');
    setEditingBundle(null);
    setFormBranchId(branchId);
    setFormName(''); setFormDescription(''); setFormPrice('');
    setFormItems([]);
    setFormError(''); setFormSuccess('');
    setNewItemType('service'); setNewItemId(''); setNewItemQty('1');
    await loadBranchOptions(branchId);
    setIsModalOpen(true);
  };

  const openEdit = async (bundle: Bundle) => {
    setFormMode('edit');
    setEditingBundle(bundle);
    setFormBranchId(bundle.branch_id);
    setFormName(bundle.name);
    setFormDescription(bundle.description || '');
    setFormPrice(String(bundle.price));
    setFormItems([...bundle.items]);
    setFormError(''); setFormSuccess('');
    setNewItemType('service'); setNewItemId(''); setNewItemQty('1');
    await loadBranchOptions(bundle.branch_id);
    setIsModalOpen(true);
  };

  const handleBranchChange = async (branchId: string) => {
    setFormBranchId(branchId);
    setFormItems([]);
    setNewItemId('');
    await loadBranchOptions(branchId);
  };

  const addItem = () => {
    if (!newItemId) return;
    const qty = parseInt(newItemQty) || 1;
    if (newItemType === 'service') {
      const svc = serviceOptions.find(s => s.id === newItemId);
      if (!svc) return;
      // Check no duplicate
      if (formItems.some(i => i.service_id === newItemId)) {
        setFormError('Service already in bundle'); return;
      }
      setFormItems(prev => [...prev, { service_id: newItemId, product_id: null, quantity: qty, item_type: 'service', item_label: svc.name }]);
    } else {
      const prod = productOptions.find(p => p.id === newItemId);
      if (!prod) return;
      if (formItems.some(i => i.product_id === newItemId)) {
        setFormError('Product already in bundle'); return;
      }
      setFormItems(prev => [...prev, { service_id: null, product_id: newItemId, quantity: qty, item_type: 'product', item_label: prod.name }]);
    }
    setNewItemId('');
    setNewItemQty('1');
    setFormError('');
  };

  const removeItem = (index: number) => {
    setFormItems(prev => prev.filter((_, i) => i !== index));
  };

  const updateItemQty = (index: number, qty: number) => {
    setFormItems(prev => prev.map((item, i) => i === index ? { ...item, quantity: Math.max(1, qty) } : item));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(''); setFormSuccess(''); setIsSubmitting(true);
    try {
      const price = parseFloat(formPrice);
      if (!formName.trim()) { setFormError('Bundle name is required'); return; }
      if (isNaN(price) || price < 0) { setFormError('Invalid price'); return; }
      if (formItems.length === 0) { setFormError('Add at least one service or product to the bundle'); return; }

      if (formMode === 'create') {
        // Insert bundle
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: newBundle, error: bundleError } = await (supabase as any)
          .from('bundles')
          .insert({
            branch_id: formBranchId,
            name: formName.trim(),
            description: formDescription.trim() || null,
            price,
          })
          .select('id')
          .single();

        if (bundleError) { setFormError(bundleError.message); return; }

        // Insert bundle items
        const itemsPayload = formItems.map(item => ({
          bundle_id: (newBundle as { id: string }).id,
          service_id: item.service_id,
          product_id: item.product_id,
          quantity: item.quantity,
        }));

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: itemsError } = await (supabase as any).from('bundle_items').insert(itemsPayload);
        if (itemsError) { setFormError(itemsError.message); return; }

        setFormSuccess(`"${formName}" bundle created`);
      } else if (editingBundle) {
        // Update bundle
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: bundleError } = await (supabase as any)
          .from('bundles')
          .update({
            name: formName.trim(),
            description: formDescription.trim() || null,
            price,
          })
          .eq('id', editingBundle.id);

        if (bundleError) { setFormError(bundleError.message); return; }

        // Replace all bundle items: delete then re-insert
        const { error: deleteError } = await supabase
          .from('bundle_items')
          .delete()
          .eq('bundle_id', editingBundle.id);

        if (deleteError) { setFormError(deleteError.message); return; }

        if (formItems.length > 0) {
          const itemsPayload = formItems.map(item => ({
            bundle_id: editingBundle.id,
            service_id: item.service_id,
            product_id: item.product_id,
            quantity: item.quantity,
          }));
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { error: itemsError } = await (supabase as any).from('bundle_items').insert(itemsPayload);
          if (itemsError) { setFormError(itemsError.message); return; }
        }

        setFormSuccess(`"${formName}" updated`);
      }

      await fetchBundles();
      setTimeout(() => { setIsModalOpen(false); setFormSuccess(''); }, 1500);
    } catch (err) {
      console.error('Bundle form error:', err);
      setFormError('An unexpected error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const { error } = await supabase.from('bundles').delete().eq('id', deleteTarget.id);
      if (error) { alert(error.message); return; }
      await fetchBundles();
      setDeleteTarget(null);
    } catch (err) {
      console.error('Delete error:', err);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleToggleActive = async (b: Bundle) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from('bundles').update({ is_active: !b.is_active }).eq('id', b.id);
    if (error) { alert(error.message); return; }
    await fetchBundles();
  };

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(n);

  const canManage = isOwner || isManager;

  // ─── Render ─────────────────────────────────────────────

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-semibold text-brand-900">Bundles</h1>
          <p className="text-sm text-brand-500 mt-1">
            {isOwner ? 'Manage service & product bundles across branches' : 'Manage bundles for your branch'}
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
            Create Bundle
          </button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card px-5 py-4">
          <p className="text-xs font-medium text-brand-400 uppercase tracking-wide">Total Bundles</p>
          <p className="text-2xl font-semibold text-brand-900 mt-1">{bundles.length}</p>
        </div>
        <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card px-5 py-4">
          <p className="text-xs font-medium text-brand-400 uppercase tracking-wide">Active</p>
          <p className="text-2xl font-semibold text-emerald-600 mt-1">{bundles.filter(b => b.is_active).length}</p>
        </div>
        <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card px-5 py-4">
          <p className="text-xs font-medium text-brand-400 uppercase tracking-wide">Inactive</p>
          <p className="text-2xl font-semibold text-brand-400 mt-1">{bundles.filter(b => !b.is_active).length}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card p-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-brand-500 mb-1">Search</label>
            <input type="text" value={searchText} onChange={e => setSearchText(e.target.value)}
              placeholder="Search bundles..."
              className="w-full px-3 py-2 rounded-xl border border-brand-200 bg-surface-50 text-sm text-brand-800
                         placeholder:text-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all" />
          </div>
          <div>
            <label className="block text-xs font-medium text-brand-500 mb-1">Status</label>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as 'active' | 'inactive' | 'all')}
              className="w-full px-3 py-2 rounded-xl border border-brand-200 bg-surface-50 text-sm text-brand-800
                         focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all">
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
              <option value="all">All</option>
            </select>
          </div>
        </div>
      </div>

      {/* Bundle Cards Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-brand-100/50 shadow-card p-5">
              <Skeleton className="h-5 w-48 mb-2" />
              <Skeleton className="h-4 w-32 mb-4" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            </div>
          ))}
        </div>
      ) : filteredBundles.length === 0 ? (
        <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card py-20 text-center">
          <svg className="w-12 h-12 text-brand-200 mx-auto mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.429 9.75L2.25 12l4.179 2.25m0-4.5l5.571 3 5.571-3m-11.142 0L2.25 7.5 12 2.25l9.75 5.25-4.179 2.25m0 0L21.75 12l-4.179 2.25m0 0l4.179 2.25L12 21.75 2.25 16.5l4.179-2.25m11.142 0l-5.571 3-5.571-3" />
          </svg>
          <p className="text-sm text-brand-400">{searchText ? 'No bundles match your search' : 'No bundles created yet'}</p>
          {canManage && !searchText && (
            <button onClick={openCreate}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-50 text-brand-600 text-sm font-medium hover:bg-brand-100 transition-colors">
              Create your first bundle
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredBundles.map(bundle => (
            <div key={bundle.id} className={`bg-white rounded-2xl border shadow-card p-5 flex flex-col gap-4 transition-all hover:shadow-md ${
              !bundle.is_active ? 'border-brand-100/30 opacity-70' : 'border-brand-100/50'
            }`}>
              {/* Bundle header */}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-brand-800 truncate">{bundle.name}</h3>
                  {isOwner && <p className="text-xs text-brand-400 mt-0.5">{bundle.branch_name}</p>}
                  {bundle.description && <p className="text-xs text-brand-500 mt-1 line-clamp-2">{bundle.description}</p>}
                </div>
                <Badge variant={bundle.is_active ? 'success' : 'default'} size="sm">
                  {bundle.is_active ? 'Active' : 'Inactive'}
                </Badge>
              </div>

              {/* Items */}
              <div className="space-y-1.5">
                {bundle.items.length === 0 ? (
                  <p className="text-xs text-brand-300 italic">No items configured</p>
                ) : (
                  bundle.items.map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${item.item_type === 'service' ? 'bg-brand-400' : 'bg-amber-400'}`} />
                      <span className="text-brand-600 flex-1 truncate">{item.item_label}</span>
                      <span className="text-brand-400 flex-shrink-0">× {item.quantity}</span>
                    </div>
                  ))
                )}
              </div>

              {/* Price + Actions */}
              <div className="flex items-center justify-between mt-auto pt-3 border-t border-brand-100/40">
                <span className="text-lg font-semibold text-brand-800">{formatCurrency(bundle.price)}</span>
                {canManage && (
                  <div className="flex items-center gap-1">
                    <button onClick={() => openEdit(bundle)} title="Edit bundle"
                      className="p-2 rounded-lg text-brand-400 hover:text-brand-700 hover:bg-brand-50 transition-colors">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                      </svg>
                    </button>
                    <button onClick={() => handleToggleActive(bundle)} title={bundle.is_active ? 'Deactivate' : 'Activate'}
                      className={`p-2 rounded-lg transition-colors ${bundle.is_active ? 'text-amber-400 hover:text-amber-700 hover:bg-amber-50' : 'text-emerald-400 hover:text-emerald-700 hover:bg-emerald-50'}`}>
                      {bundle.is_active ? (
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
                      <button onClick={() => setDeleteTarget(bundle)} title="Delete bundle"
                        className="p-2 rounded-lg text-rose-300 hover:text-rose-600 hover:bg-rose-50 transition-colors">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                        </svg>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ─── Create / Edit Modal ─────────────────────────────── */}
      <Modal
        isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}
        title={formMode === 'create' ? 'Create Bundle' : 'Edit Bundle'}
        subtitle={formMode === 'create' ? 'Combine services and products into a bundle' : `Editing: ${editingBundle?.name}`}
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-5">
          {formError && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{formError}</div>}
          {formSuccess && (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {formSuccess}
            </div>
          )}

          {/* Branch (Owner create only) */}
          {isOwner && formMode === 'create' && (
            <div>
              <label className="block text-sm font-medium text-brand-800 mb-1.5">Branch</label>
              <select value={formBranchId} onChange={e => handleBranchChange(e.target.value)} required
                className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900
                           focus:outline-none focus:ring-2 focus:ring-brand-400/50 focus:border-brand-400 transition-all">
                <option value="">Select branch...</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          )}

          {/* Name + Price */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-brand-800 mb-1.5">Bundle Name</label>
              <input type="text" value={formName} onChange={e => setFormName(e.target.value)}
                placeholder="e.g. Glow Package" required
                className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900 placeholder:text-brand-300
                           focus:outline-none focus:ring-2 focus:ring-brand-400/50 focus:border-brand-400 transition-all" />
            </div>
            <div>
              <label className="block text-sm font-medium text-brand-800 mb-1.5">Bundle Price (PHP)</label>
              <input type="number" value={formPrice} min="0" step="0.01"
                onChange={e => setFormPrice(e.target.value)} placeholder="0.00" required
                className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900 placeholder:text-brand-300
                           focus:outline-none focus:ring-2 focus:ring-brand-400/50 focus:border-brand-400 transition-all" />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-brand-800 mb-1.5">Description <span className="text-brand-300 font-normal">(optional)</span></label>
            <textarea value={formDescription} onChange={e => setFormDescription(e.target.value)}
              placeholder="Bundle description..." rows={2}
              className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900 placeholder:text-brand-300
                         focus:outline-none focus:ring-2 focus:ring-brand-400/50 focus:border-brand-400 transition-all resize-none" />
          </div>

          {/* Bundle Items */}
          <div>
            <label className="block text-sm font-medium text-brand-800 mb-2">Bundle Items</label>

            {/* Current items list */}
            {formItems.length > 0 && (
              <div className="space-y-2 mb-3 max-h-40 overflow-y-auto pr-1">
                {formItems.map((item, i) => (
                  <div key={i} className="flex items-center gap-3 bg-surface-50 rounded-xl px-4 py-2.5 border border-brand-100/50">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${item.item_type === 'service' ? 'bg-brand-400' : 'bg-amber-400'}`} />
                    <span className="text-sm text-brand-700 flex-1 truncate">{item.item_label}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-brand-400">Qty:</span>
                      <input
                        type="number" min="1" value={item.quantity}
                        onChange={e => updateItemQty(i, parseInt(e.target.value) || 1)}
                        className="w-12 text-center text-sm border border-brand-200 rounded-lg py-0.5 focus:outline-none focus:ring-1 focus:ring-brand-400"
                      />
                    </div>
                    <button type="button" onClick={() => removeItem(i)}
                      className="p-1 rounded-lg text-rose-300 hover:text-rose-600 hover:bg-rose-50 transition-colors flex-shrink-0">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add item row */}
            {formBranchId && (
              <div className="flex gap-2 items-end bg-brand-50/50 rounded-xl p-3 border border-brand-100/50">
                <div className="w-28">
                  <label className="block text-xs font-medium text-brand-500 mb-1">Type</label>
                  <select value={newItemType} onChange={e => { setNewItemType(e.target.value as 'service' | 'product'); setNewItemId(''); }}
                    className="w-full px-2 py-2 rounded-lg border border-brand-200 bg-white text-xs text-brand-800 focus:outline-none focus:ring-1 focus:ring-brand-400">
                    <option value="service">Service</option>
                    <option value="product">Product</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium text-brand-500 mb-1">{newItemType === 'service' ? 'Service' : 'Product'}</label>
                  <select value={newItemId} onChange={e => setNewItemId(e.target.value)}
                    className="w-full px-2 py-2 rounded-lg border border-brand-200 bg-white text-xs text-brand-800 focus:outline-none focus:ring-1 focus:ring-brand-400">
                    <option value="">Select...</option>
                    {(newItemType === 'service' ? serviceOptions : productOptions).map(opt => (
                      <option key={opt.id} value={opt.id}>{opt.name}</option>
                    ))}
                  </select>
                </div>
                <div className="w-16">
                  <label className="block text-xs font-medium text-brand-500 mb-1">Qty</label>
                  <input type="number" min="1" value={newItemQty}
                    onChange={e => setNewItemQty(e.target.value)}
                    className="w-full px-2 py-2 rounded-lg border border-brand-200 bg-white text-xs text-center focus:outline-none focus:ring-1 focus:ring-brand-400" />
                </div>
                <button type="button" onClick={addItem} disabled={!newItemId}
                  className="px-3 py-2 rounded-lg bg-brand-600 text-white text-xs font-medium hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0">
                  Add
                </button>
              </div>
            )}
            {!formBranchId && (
              <p className="text-xs text-brand-400 text-center py-3">Select a branch first to add items</p>
            )}
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button type="submit" disabled={isSubmitting}
              className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-brand-600 to-brand-700 text-white font-medium
                         hover:from-brand-700 hover:to-brand-800 active:scale-[0.98]
                         disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200 shadow-sm hover:shadow-md text-sm">
              {isSubmitting ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  {formMode === 'create' ? 'Creating...' : 'Saving...'}
                </span>
              ) : formMode === 'create' ? 'Create Bundle' : 'Save Changes'}
            </button>
            <button type="button" onClick={() => setIsModalOpen(false)}
              className="px-4 py-2.5 rounded-xl border border-brand-200 text-brand-600 text-sm font-medium hover:bg-brand-50 transition-colors">
              Cancel
            </button>
          </div>
        </form>
      </Modal>

      {/* ─── Delete Modal ─────────────────────────────────────── */}
      <Modal
        isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)}
        title="Delete Bundle" subtitle="This will remove the bundle and all its items"
        size="sm"
      >
        <div className="space-y-4">
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-4">
            <p className="text-sm font-medium text-rose-800">Delete &quot;{deleteTarget?.name}&quot;?</p>
            <p className="text-xs text-rose-600 mt-1">
              The bundle and all {deleteTarget?.items.length || 0} item{(deleteTarget?.items.length || 0) !== 1 ? 's' : ''} will be permanently deleted.
            </p>
          </div>
          <div className="flex gap-3">
            <button onClick={handleDelete} disabled={isDeleting}
              className="flex-1 py-2.5 px-4 rounded-xl bg-rose-600 text-white font-medium text-sm
                         hover:bg-rose-700 active:scale-[0.98] disabled:opacity-60 transition-all">
              {isDeleting ? 'Deleting...' : 'Delete Bundle'}
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
