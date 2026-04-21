'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '@/providers/auth-provider';
import { createClient } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { IMUS_ONLY } from '@/lib/feature-flags';

// ─── Types ──────────────────────────────────────────────────

interface InventoryItem {
  id: string;
  product_id: string;
  branch_id: string;
  branch_name: string;
  product_name: string;
  product_sku: string | null;
  product_unit: string;
  product_category: string | null;
  quantity: number;
  low_stock_threshold: number;
  updated_at: string;
}

interface AdjustFormData {
  adjustment_type: 'manual_add' | 'manual_remove';
  quantity: string;
  reason: string;
  low_stock_threshold: string;
}

interface BulkRow {
  product_name: string;
  quantity: string;
  reason: string;
  status: 'pending' | 'success' | 'error' | 'not_found';
  errorMsg?: string;
  matched_product_id?: string;
}

// ─── Component ──────────────────────────────────────────────

export default function InventoryPage() {
  const { isOwner, isManager, selectedBranch, branches } = useAuth();
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [filterBranch, setFilterBranch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'low' | 'ok'>('all');
  const [filterCategory, setFilterCategory] = useState('');

  // Adjust modal
  const [adjustTarget, setAdjustTarget] = useState<InventoryItem | null>(null);
  const [adjustForm, setAdjustForm] = useState<AdjustFormData>({
    adjustment_type: 'manual_add',
    quantity: '',
    reason: '',
    low_stock_threshold: '',
  });
  const [adjustError, setAdjustError] = useState('');
  const [adjustSuccess, setAdjustSuccess] = useState('');
  const [isAdjusting, setIsAdjusting] = useState(false);

  // Bulk upload modal
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [bulkBranchId, setBulkBranchId] = useState('');
  const [bulkText, setBulkText] = useState('');
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([]);
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);
  const [bulkStep, setBulkStep] = useState<'input' | 'preview' | 'done'>('input');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const supabase = createClient();

  // ─── Fetch ──────────────────────────────────────────────

  const fetchInventory = useCallback(async () => {
    setIsLoading(true);
    try {
      let query = supabase
        .from('inventory')
        .select('*, products:product_id(name, sku, unit, category), branches:branch_id(name)')
        .order('updated_at', { ascending: false });

      if (!isOwner && selectedBranch?.id) {
        query = query.eq('branch_id', selectedBranch.id);
      } else if (filterBranch) {
        query = query.eq('branch_id', filterBranch);
      }

      const { data, error } = await query;
      if (error) { console.error('Inventory fetch error:', error); return; }

      setInventory((data || []).map((inv: Record<string, unknown>) => {
        const prod = inv.products as Record<string, unknown>;
        const branch = inv.branches as Record<string, unknown>;
        return {
          id: inv.id as string,
          product_id: inv.product_id as string,
          branch_id: inv.branch_id as string,
          branch_name: branch?.name as string || '',
          product_name: prod?.name as string || '',
          product_sku: prod?.sku as string | null,
          product_unit: prod?.unit as string || 'pcs',
          product_category: prod?.category as string | null,
          quantity: inv.quantity as number,
          low_stock_threshold: inv.low_stock_threshold as number,
          updated_at: inv.updated_at as string,
        };
      }));
    } catch (err) {
      console.error('Inventory page error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [supabase, isOwner, selectedBranch?.id, filterBranch]);

  useEffect(() => { fetchInventory(); }, [fetchInventory]);

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel('inventory-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, () => fetchInventory())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [supabase, fetchInventory]);

  // ─── Filtering ──────────────────────────────────────────

  const categories = [...new Set(inventory.map(i => i.product_category).filter(Boolean))] as string[];

  const filteredInventory = inventory.filter(item => {
    const isLow = item.quantity <= item.low_stock_threshold;
    if (filterStatus === 'low' && !isLow) return false;
    if (filterStatus === 'ok' && isLow) return false;
    if (filterCategory && item.product_category !== filterCategory) return false;
    if (searchText &&
      !item.product_name.toLowerCase().includes(searchText.toLowerCase()) &&
      !(item.product_sku || '').toLowerCase().includes(searchText.toLowerCase()) &&
      !item.branch_name.toLowerCase().includes(searchText.toLowerCase())) return false;
    return true;
  });

  const lowStockCount = inventory.filter(i => i.quantity <= i.low_stock_threshold).length;
  const outOfStockCount = inventory.filter(i => i.quantity === 0).length;
  const totalUnits = inventory.reduce((sum, i) => sum + i.quantity, 0);

  // ─── Adjust Stock ────────────────────────────────────────

  const openAdjust = (item: InventoryItem) => {
    setAdjustTarget(item);
    setAdjustForm({
      adjustment_type: 'manual_add',
      quantity: '',
      reason: '',
      low_stock_threshold: String(item.low_stock_threshold),
    });
    setAdjustError(''); setAdjustSuccess('');
  };

  const handleAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustTarget) return;
    setAdjustError(''); setAdjustSuccess(''); setIsAdjusting(true);

    try {
      const qty = parseInt(adjustForm.quantity);
      if (isNaN(qty) || qty <= 0) { setAdjustError('Enter a valid quantity (must be > 0)'); return; }
      if (!adjustForm.reason.trim()) { setAdjustError('Reason is required'); return; }

      const quantityChange = adjustForm.adjustment_type === 'manual_add' ? qty : -qty;

      const res = await fetch('/api/inventory/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: adjustTarget.product_id,
          branch_id: adjustTarget.branch_id,
          quantity_change: quantityChange,
          adjustment_type: adjustForm.adjustment_type,
          reason: adjustForm.reason.trim(),
          low_stock_threshold: adjustForm.low_stock_threshold
            ? parseInt(adjustForm.low_stock_threshold) : undefined,
        }),
      });

      const result = await res.json();
      if (!res.ok) { setAdjustError(result.error || 'Failed to adjust stock'); return; }

      setAdjustSuccess(`Stock updated. New quantity: ${result.new_quantity} ${adjustTarget.product_unit}`);
      await fetchInventory();
      setTimeout(() => { setAdjustTarget(null); setAdjustSuccess(''); }, 1800);
    } catch (err) {
      console.error('Adjust error:', err);
      setAdjustError('An unexpected error occurred');
    } finally {
      setIsAdjusting(false);
    }
  };

  // ─── Bulk Upload ─────────────────────────────────────────

  const parseBulkText = (text: string): BulkRow[] => {
    return text.trim().split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))
      .map(line => {
        const parts = line.split(',').map(p => p.trim());
        return {
          product_name: parts[0] || '',
          quantity: parts[1] || '',
          reason: parts[2] || 'Bulk upload',
          status: 'pending' as const,
        };
      })
      .filter(r => r.product_name);
  };

  const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { setBulkText(ev.target?.result as string || ''); };
    reader.readAsText(file);
  };

  const handleBulkPreview = async () => {
    if (!bulkBranchId) { alert('Please select a branch'); return; }
    const rows = parseBulkText(bulkText);
    if (rows.length === 0) { alert('No valid rows found. Format: Product Name, Quantity, Reason'); return; }

    // Match products in this branch
    const { data: products } = await supabase
      .from('products')
      .select('id, name')
      .eq('branch_id', bulkBranchId)
      .eq('is_active', true);

    const productMap = new Map<string, string>();
    (products || []).forEach((p: Record<string, unknown>) => {
      productMap.set((p.name as string).toLowerCase().trim(), p.id as string);
    });

    const matched = rows.map(row => {
      const matchedId = productMap.get(row.product_name.toLowerCase().trim());
      const qty = parseInt(row.quantity);
      if (!matchedId) return { ...row, status: 'not_found' as const, errorMsg: 'Product not found in branch' };
      if (isNaN(qty) || qty <= 0) return { ...row, matched_product_id: matchedId, status: 'not_found' as const, errorMsg: 'Invalid quantity' };
      return { ...row, matched_product_id: matchedId, status: 'pending' as const };
    });

    setBulkRows(matched);
    setBulkStep('preview');
  };

  const handleBulkConfirm = async () => {
    setIsBulkProcessing(true);
    const validRows = bulkRows.filter(r => r.status === 'pending' && r.matched_product_id);
    const results = [...bulkRows];

    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i];
      try {
        const res = await fetch('/api/inventory/adjust', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            product_id: row.matched_product_id,
            branch_id: bulkBranchId,
            quantity_change: parseInt(row.quantity),
            adjustment_type: 'bulk_upload',
            reason: row.reason || 'Bulk upload',
          }),
        });
        const result = await res.json();
        const idx = results.findIndex(r => r.product_name === row.product_name);
        if (res.ok) {
          results[idx] = { ...results[idx], status: 'success' };
        } else {
          results[idx] = { ...results[idx], status: 'error', errorMsg: result.error };
        }
      } catch {
        const idx = results.findIndex(r => r.product_name === row.product_name);
        results[idx] = { ...results[idx], status: 'error', errorMsg: 'Network error' };
      }
    }

    setBulkRows(results);
    setBulkStep('done');
    setIsBulkProcessing(false);
    await fetchInventory();
  };

  const closeBulkModal = () => {
    setIsBulkModalOpen(false);
    setBulkText('');
    setBulkRows([]);
    setBulkStep('input');
    setBulkBranchId('');
  };

  const formatTime = (dateStr: string) =>
    new Date(dateStr).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  const canManage = isOwner || isManager;

  const getStockStatus = (item: InventoryItem) => {
    if (item.quantity === 0) return { label: 'Out of Stock', variant: 'danger' as const };
    if (item.quantity <= item.low_stock_threshold) return { label: 'Low Stock', variant: 'warning' as const };
    return { label: 'In Stock', variant: 'success' as const };
  };

  // ─── Render ─────────────────────────────────────────────

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-semibold text-brand-900">Inventory</h1>
          <p className="text-sm text-brand-500 mt-1">
            {isOwner ? 'Monitor and manage stock across all branches' : 'Monitor and manage your branch inventory'}
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => { setBulkBranchId(isManager ? (selectedBranch?.id || '') : ''); setIsBulkModalOpen(true); }}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-brand-600 to-brand-700 text-white text-sm font-medium
                       hover:from-brand-700 hover:to-brand-800 active:scale-[0.98] transition-all duration-200 shadow-sm hover:shadow-md"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            Bulk Upload
          </button>
        )}
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card px-5 py-4">
          <p className="text-xs font-medium text-brand-400 uppercase tracking-wide">Total Products</p>
          <p className="text-2xl font-semibold text-brand-900 mt-1">{inventory.length}</p>
        </div>
        <div className={`rounded-2xl border shadow-card px-5 py-4 ${outOfStockCount > 0 ? 'bg-rose-50/50 border-rose-200' : 'bg-white border-brand-100/50'}`}>
          <p className="text-xs font-medium text-brand-400 uppercase tracking-wide">Out of Stock</p>
          <p className={`text-2xl font-semibold mt-1 ${outOfStockCount > 0 ? 'text-rose-700' : 'text-brand-900'}`}>{outOfStockCount}</p>
        </div>
        <div className={`rounded-2xl border shadow-card px-5 py-4 ${lowStockCount > 0 ? 'bg-amber-50/50 border-amber-200' : 'bg-white border-brand-100/50'}`}>
          <p className="text-xs font-medium text-brand-400 uppercase tracking-wide">Low Stock</p>
          <p className={`text-2xl font-semibold mt-1 ${lowStockCount > 0 ? 'text-amber-700' : 'text-brand-900'}`}>{lowStockCount}</p>
        </div>
        <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card px-5 py-4">
          <p className="text-xs font-medium text-brand-400 uppercase tracking-wide">Total Units</p>
          <p className="text-2xl font-semibold text-brand-900 mt-1">{totalUnits.toLocaleString()}</p>
        </div>
      </div>

      {/* Low Stock Alert Banner */}
      {(lowStockCount > 0 || outOfStockCount > 0) && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
          <div className="w-2 h-2 bg-amber-500 rounded-full mt-1.5 flex-shrink-0 animate-pulse" />
          <div>
            <p className="text-sm font-medium text-amber-800">Stock Alert</p>
            <p className="text-xs text-amber-700 mt-0.5">
              {outOfStockCount > 0 && `${outOfStockCount} product${outOfStockCount > 1 ? 's' : ''} out of stock. `}
              {lowStockCount > 0 && `${lowStockCount} product${lowStockCount > 1 ? 's' : ''} below threshold.`}
            </p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="lg:col-span-2">
            <label className="block text-xs font-medium text-brand-500 mb-1">Search</label>
            <input
              type="text" value={searchText} onChange={e => setSearchText(e.target.value)}
              placeholder="Product name, SKU, or branch..."
              className="w-full px-3 py-2 rounded-xl border border-brand-200 bg-surface-50 text-sm text-brand-800
                         placeholder:text-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all"
            />
          </div>
          {isOwner && !IMUS_ONLY && (
            <div>
              <label className="block text-xs font-medium text-brand-500 mb-1">Branch</label>
              <select
                value={filterBranch} onChange={e => setFilterBranch(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-brand-200 bg-surface-50 text-sm text-brand-800
                           focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all"
              >
                <option value="">All branches</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-brand-500 mb-1">Category</label>
            <select
              value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-brand-200 bg-surface-50 text-sm text-brand-800
                         focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all"
            >
              <option value="">All categories</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-brand-500 mb-1">Stock Status</label>
            <select
              value={filterStatus} onChange={e => setFilterStatus(e.target.value as 'all' | 'low' | 'ok')}
              className="w-full px-3 py-2 rounded-xl border border-brand-200 bg-surface-50 text-sm text-brand-800
                         focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all"
            >
              <option value="all">All stock levels</option>
              <option value="low">Low / Out of stock</option>
              <option value="ok">In stock only</option>
            </select>
          </div>
        </div>
      </div>

      {/* Inventory Table */}
      <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-brand-100/60 bg-surface-50">
                <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Product</th>
                {isOwner && !IMUS_ONLY && <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Branch</th>}
                <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Category</th>
                <th className="text-center text-xs font-medium text-brand-400 px-5 py-3">Qty</th>
                <th className="text-center text-xs font-medium text-brand-400 px-5 py-3">Threshold</th>
                <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Status</th>
                <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Last Updated</th>
                {canManage && <th className="text-right text-xs font-medium text-brand-400 px-5 py-3">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-brand-100/30">
                    <td className="px-5 py-4"><div><Skeleton className="h-4 w-40 mb-1" /><Skeleton className="h-3 w-16" /></div></td>
                    {isOwner && !IMUS_ONLY && <td className="px-5 py-4"><Skeleton className="h-4 w-20" /></td>}
                    <td className="px-5 py-4"><Skeleton className="h-5 w-20 rounded-full" /></td>
                    <td className="px-5 py-4 text-center"><Skeleton className="h-6 w-12 rounded-full mx-auto" /></td>
                    <td className="px-5 py-4 text-center"><Skeleton className="h-4 w-8 mx-auto" /></td>
                    <td className="px-5 py-4"><Skeleton className="h-5 w-20 rounded-full" /></td>
                    <td className="px-5 py-4"><Skeleton className="h-4 w-28" /></td>
                    {canManage && <td className="px-5 py-4"><Skeleton className="h-4 w-16 ml-auto" /></td>}
                  </tr>
                ))
              ) : filteredInventory.length === 0 ? (
                <tr>
                  <td
                    colSpan={canManage ? (isOwner && !IMUS_ONLY ? 8 : 7) : (isOwner && !IMUS_ONLY ? 7 : 6)}
                    className="text-center py-16 text-sm text-brand-400"
                  >
                    <svg className="w-12 h-12 text-brand-200 mx-auto mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
                    </svg>
                    {searchText || filterCategory || filterStatus !== 'all'
                      ? 'No inventory matches your filters'
                      : 'No inventory records found. Create products first.'}
                  </td>
                </tr>
              ) : (
                filteredInventory.map(item => {
                  const stockStatus = getStockStatus(item);
                  const isOutOfStock = item.quantity === 0;
                  const isLow = item.quantity <= item.low_stock_threshold;
                  return (
                    <tr
                      key={item.id}
                      className={`border-b border-brand-100/30 hover:bg-brand-50/30 transition-colors ${
                        isOutOfStock ? 'bg-rose-50/20' : isLow ? 'bg-amber-50/20' : ''
                      }`}
                    >
                      <td className="px-5 py-4">
                        <p className="text-sm font-medium text-brand-800">{item.product_name}</p>
                        {item.product_sku && (
                          <p className="text-xs font-mono text-brand-400 mt-0.5">{item.product_sku}</p>
                        )}
                      </td>
                      {isOwner && !IMUS_ONLY && (
                        <td className="px-5 py-4">
                          <span className="text-sm text-brand-500">{item.branch_name}</span>
                        </td>
                      )}
                      <td className="px-5 py-4">
                        {item.product_category ? (
                          <Badge variant="brand" size="sm">{item.product_category}</Badge>
                        ) : (
                          <span className="text-xs text-brand-300">—</span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-center">
                        <span className={`inline-flex items-center gap-1 font-semibold text-sm px-2 py-0.5 rounded-full ${
                          isOutOfStock
                            ? 'bg-rose-100 text-rose-700'
                            : isLow
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-emerald-50 text-emerald-700'
                        }`}>
                          {isLow && !isOutOfStock && (
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                            </svg>
                          )}
                          {item.quantity} {item.product_unit}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-center">
                        <span className="text-xs text-brand-400">{item.low_stock_threshold}</span>
                      </td>
                      <td className="px-5 py-4">
                        <Badge variant={stockStatus.variant} size="sm">{stockStatus.label}</Badge>
                      </td>
                      <td className="px-5 py-4">
                        <span className="text-xs text-brand-400">{formatTime(item.updated_at)}</span>
                      </td>
                      {canManage && (
                        <td className="px-5 py-4">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => openAdjust(item)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-brand-600 bg-brand-50 hover:bg-brand-100 transition-colors"
                              title="Adjust stock"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                              </svg>
                              Adjust
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {!isLoading && filteredInventory.length > 0 && (
          <div className="px-5 py-3 border-t border-brand-100/40 text-xs text-brand-400 flex items-center justify-between">
            <span>Showing {filteredInventory.length} of {inventory.length} inventory records</span>
            {lowStockCount > 0 && (
              <span className="text-amber-600 font-medium">⚠ {lowStockCount} need attention</span>
            )}
          </div>
        )}
      </div>

      {/* ─── Adjust Stock Modal ───────────────────────────── */}
      <Modal
        isOpen={!!adjustTarget} onClose={() => setAdjustTarget(null)}
        title="Adjust Stock"
        subtitle={adjustTarget ? `${adjustTarget.product_name} · ${adjustTarget.branch_name}` : ''}
        size="sm"
      >
        {adjustTarget && (
          <form onSubmit={handleAdjust} className="space-y-4">
            {adjustError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{adjustError}</div>
            )}
            {adjustSuccess && (
              <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
                <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {adjustSuccess}
              </div>
            )}

            {/* Current Stock Info */}
            <div className="bg-surface-50 rounded-xl p-4 grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-xs text-brand-400">Current</p>
                <p className="text-lg font-semibold text-brand-800 mt-0.5">{adjustTarget.quantity}</p>
                <p className="text-xs text-brand-400">{adjustTarget.product_unit}</p>
              </div>
              <div>
                <p className="text-xs text-brand-400">Threshold</p>
                <p className="text-lg font-semibold text-brand-800 mt-0.5">{adjustTarget.low_stock_threshold}</p>
                <p className="text-xs text-brand-400">min stock</p>
              </div>
              <div>
                <p className="text-xs text-brand-400">Status</p>
                <p className={`text-sm font-semibold mt-1 ${
                  adjustTarget.quantity === 0 ? 'text-rose-600' :
                  adjustTarget.quantity <= adjustTarget.low_stock_threshold ? 'text-amber-600' : 'text-emerald-600'
                }`}>
                  {adjustTarget.quantity === 0 ? 'Empty' : adjustTarget.quantity <= adjustTarget.low_stock_threshold ? 'Low' : 'OK'}
                </p>
              </div>
            </div>

            {/* Type toggle */}
            <div>
              <label className="block text-sm font-medium text-brand-800 mb-2">Adjustment Type</label>
              <div className="grid grid-cols-2 gap-2">
                {(['manual_add', 'manual_remove'] as const).map(type => (
                  <button
                    key={type} type="button"
                    onClick={() => setAdjustForm({ ...adjustForm, adjustment_type: type })}
                    className={`py-2.5 px-4 rounded-xl text-sm font-medium border transition-all ${
                      adjustForm.adjustment_type === type
                        ? type === 'manual_add'
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : 'bg-rose-600 text-white border-rose-600'
                        : 'bg-white text-brand-600 border-brand-200 hover:bg-brand-50'
                    }`}
                  >
                    {type === 'manual_add' ? '+ Add Stock' : '− Remove Stock'}
                  </button>
                ))}
              </div>
            </div>

            {/* Quantity */}
            <div>
              <label className="block text-sm font-medium text-brand-800 mb-1.5">
                Quantity {adjustForm.adjustment_type === 'manual_add' ? 'to Add' : 'to Remove'}
              </label>
              <input
                type="number" value={adjustForm.quantity} min="1"
                onChange={e => setAdjustForm({ ...adjustForm, quantity: e.target.value })}
                placeholder="Enter amount..." required
                className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900 placeholder:text-brand-300
                           focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all"
              />
              {adjustForm.quantity && !isNaN(parseInt(adjustForm.quantity)) && (
                <p className="text-xs text-brand-400 mt-1">
                  New quantity will be:{' '}
                  <span className="font-semibold text-brand-700">
                    {Math.max(0, adjustTarget.quantity + (adjustForm.adjustment_type === 'manual_add' ? 1 : -1) * parseInt(adjustForm.quantity))} {adjustTarget.product_unit}
                  </span>
                </p>
              )}
            </div>

            {/* Reason */}
            <div>
              <label className="block text-sm font-medium text-brand-800 mb-1.5">Reason <span className="text-rose-500">*</span></label>
              <input
                type="text" value={adjustForm.reason}
                onChange={e => setAdjustForm({ ...adjustForm, reason: e.target.value })}
                placeholder="e.g. Monthly restock, Damaged goods, Physical count..."
                required
                className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900 placeholder:text-brand-300
                           focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all"
              />
            </div>

            {/* Low stock threshold (optional) */}
            <div>
              <label className="block text-sm font-medium text-brand-800 mb-1.5">
                Low Stock Threshold <span className="text-brand-300 font-normal">(optional — updates minimum)</span>
              </label>
              <input
                type="number" value={adjustForm.low_stock_threshold} min="0"
                onChange={e => setAdjustForm({ ...adjustForm, low_stock_threshold: e.target.value })}
                placeholder={String(adjustTarget.low_stock_threshold)}
                className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900 placeholder:text-brand-300
                           focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all"
              />
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="submit" disabled={isAdjusting}
                className={`flex-1 py-2.5 px-4 rounded-xl text-white font-medium text-sm active:scale-[0.98]
                           disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200 ${
                  adjustForm.adjustment_type === 'manual_add'
                    ? 'bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800'
                    : 'bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-700 hover:to-rose-800'
                }`}
              >
                {isAdjusting ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Updating...
                  </span>
                ) : (
                  adjustForm.adjustment_type === 'manual_add' ? 'Add Stock' : 'Remove Stock'
                )}
              </button>
              <button type="button" onClick={() => setAdjustTarget(null)}
                className="px-4 py-2.5 rounded-xl border border-brand-200 text-brand-600 text-sm font-medium hover:bg-brand-50 transition-colors">
                Cancel
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* ─── Bulk Upload Modal ────────────────────────────── */}
      <Modal
        isOpen={isBulkModalOpen} onClose={closeBulkModal}
        title="Bulk Stock Upload"
        subtitle="Upload stock quantities for multiple products at once"
        size="lg"
      >
        <div className="space-y-4">
          {bulkStep === 'input' && (
            <>
              {/* Branch selection */}
              <div>
                <label className="block text-sm font-medium text-brand-800 mb-1.5">Branch</label>
                {isManager ? (
                  <input
                    type="text" value={selectedBranch?.name || ''} disabled
                    className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-100 text-brand-500 cursor-not-allowed"
                  />
                ) : (
                  <select
                    value={bulkBranchId} onChange={e => setBulkBranchId(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900
                               focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all"
                  >
                    <option value="">Select branch...</option>
                    {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                )}
              </div>

              {/* Format guide */}
              <div className="bg-brand-50 border border-brand-100 rounded-xl p-4">
                <p className="text-xs font-semibold text-brand-700 mb-2">CSV Format (one product per line):</p>
                <pre className="text-xs font-mono text-brand-600">
{`Product Name, Quantity, Reason
Glutathione 600mg, 50, Monthly restock
Vitamin C 1000mg, 30, Delivery received
# Lines starting with # are ignored`}
                </pre>
              </div>

              {/* File upload */}
              <div>
                <label className="block text-sm font-medium text-brand-800 mb-1.5">Upload CSV File</label>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full border-2 border-dashed border-brand-200 rounded-xl p-4 text-center cursor-pointer hover:border-brand-400 hover:bg-brand-50/30 transition-all"
                >
                  <svg className="w-6 h-6 text-brand-300 mx-auto mb-1" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                  </svg>
                  <p className="text-xs text-brand-400">Click to upload .csv file</p>
                  <input ref={fileInputRef} type="file" accept=".csv,.txt" onChange={handleCSVUpload} className="hidden" />
                </div>
              </div>

              {/* Or paste */}
              <div>
                <label className="block text-sm font-medium text-brand-800 mb-1.5">Or Paste CSV Data</label>
                <textarea
                  value={bulkText} onChange={e => setBulkText(e.target.value)}
                  placeholder="Product Name, Quantity, Reason&#10;Glutathione 600mg, 50, Monthly restock"
                  rows={6}
                  className="w-full px-4 py-3 rounded-xl border border-brand-200 bg-surface-50 text-sm text-brand-800 font-mono placeholder:text-brand-300
                             focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all resize-none"
                />
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleBulkPreview}
                  disabled={!bulkText.trim()}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-brand-600 to-brand-700 text-white font-medium text-sm
                             hover:from-brand-700 hover:to-brand-800 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed transition-all"
                >
                  Preview Import
                </button>
                <button onClick={closeBulkModal}
                  className="px-4 py-2.5 rounded-xl border border-brand-200 text-brand-600 text-sm font-medium hover:bg-brand-50 transition-colors">
                  Cancel
                </button>
              </div>
            </>
          )}

          {bulkStep === 'preview' && (
            <>
              <div className="bg-surface-50 rounded-xl overflow-hidden border border-brand-100">
                <div className="overflow-y-auto max-h-64">
                  <table className="w-full text-sm">
                    <thead className="bg-brand-50 sticky top-0">
                      <tr>
                        <th className="text-left text-xs font-medium text-brand-400 px-4 py-2.5">Product</th>
                        <th className="text-center text-xs font-medium text-brand-400 px-4 py-2.5">Qty</th>
                        <th className="text-left text-xs font-medium text-brand-400 px-4 py-2.5">Reason</th>
                        <th className="text-center text-xs font-medium text-brand-400 px-4 py-2.5">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bulkRows.map((row, i) => (
                        <tr key={i} className="border-t border-brand-100/50">
                          <td className="px-4 py-2.5">{row.product_name}</td>
                          <td className="px-4 py-2.5 text-center font-mono">{row.quantity}</td>
                          <td className="px-4 py-2.5 text-brand-500 text-xs">{row.reason}</td>
                          <td className="px-4 py-2.5 text-center">
                            {row.status === 'pending' && <Badge variant="info" size="sm">Ready</Badge>}
                            {row.status === 'not_found' && (
                              <span title={row.errorMsg}>
                                <Badge variant="danger" size="sm">Error</Badge>
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex items-center gap-3 text-xs text-brand-500 bg-surface-50 rounded-xl p-3">
                <span className="text-emerald-600 font-medium">{bulkRows.filter(r => r.status === 'pending').length} ready</span>
                <span>·</span>
                <span className="text-rose-600 font-medium">{bulkRows.filter(r => r.status === 'not_found').length} errors</span>
                <span>·</span>
                <span>Only ready rows will be imported</span>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleBulkConfirm}
                  disabled={isBulkProcessing || bulkRows.filter(r => r.status === 'pending').length === 0}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 text-white font-medium text-sm
                             hover:from-emerald-700 hover:to-emerald-800 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed transition-all"
                >
                  {isBulkProcessing ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Processing...
                    </span>
                  ) : (
                    `Confirm Import (${bulkRows.filter(r => r.status === 'pending').length} rows)`
                  )}
                </button>
                <button onClick={() => setBulkStep('input')}
                  className="px-4 py-2.5 rounded-xl border border-brand-200 text-brand-600 text-sm font-medium hover:bg-brand-50 transition-colors">
                  Back
                </button>
              </div>
            </>
          )}

          {bulkStep === 'done' && (
            <>
              <div className="text-center py-4">
                <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <p className="text-base font-semibold text-brand-800">Import Complete</p>
                <p className="text-sm text-brand-500 mt-1">
                  {bulkRows.filter(r => r.status === 'success').length} rows imported successfully
                  {bulkRows.filter(r => r.status === 'error').length > 0 && `, ${bulkRows.filter(r => r.status === 'error').length} failed`}
                </p>
              </div>
              {bulkRows.some(r => r.status === 'error') && (
                <div className="bg-rose-50 border border-rose-200 rounded-xl p-3">
                  <p className="text-xs font-medium text-rose-700 mb-2">Failed rows:</p>
                  {bulkRows.filter(r => r.status === 'error').map((r, i) => (
                    <p key={i} className="text-xs text-rose-600">{r.product_name}: {r.errorMsg}</p>
                  ))}
                </div>
              )}
              <button onClick={closeBulkModal}
                className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-brand-600 to-brand-700 text-white font-medium text-sm
                           hover:from-brand-700 hover:to-brand-800 transition-all">
                Done
              </button>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
