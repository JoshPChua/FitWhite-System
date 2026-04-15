'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/providers/auth-provider';
import { createClient } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { ENABLE_SERVICE_BOM } from '@/lib/feature-flags';

// ─── Types ──────────────────────────────────────────────────

interface Service {
  id: string;
  branch_id: string;
  branch_name?: string;
  name: string;
  description: string | null;
  price: number;
  duration_minutes: number | null;
  category: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  bom_count?: number;
}

interface BomEntry {
  id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  notes: string | null;
}

interface BranchProduct {
  id: string;
  name: string;
  sku: string | null;
}

interface ServiceFormData {
  branch_id: string;
  name: string;
  description: string;
  price: string;
  duration_minutes: string;
  category: string;
}

const SERVICE_CATEGORIES = [
  'IV Therapy',
  'Injection',
  'Facial Treatment',
  'Skin Treatment',
  'Laser Treatment',
  'Consultation',
  'Package',
  'Other',
];

// ─── Component ──────────────────────────────────────────────

export default function ServicesPage() {
  const { isOwner, isManager, isCashier, selectedBranch, branches } = useAuth();
  const [services, setServices] = useState<Service[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('active');

  // Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [formData, setFormData] = useState<ServiceFormData>({
    branch_id: '',
    name: '',
    description: '',
    price: '',
    duration_minutes: '',
    category: '',
  });
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Delete
  const [deleteTarget, setDeleteTarget] = useState<Service | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // BOM Management
  const [bomService, setBomService] = useState<Service | null>(null);
  const [bomEntries, setBomEntries] = useState<BomEntry[]>([]);
  const [bomLoading, setBomLoading] = useState(false);
  const [branchProducts, setBranchProducts] = useState<BranchProduct[]>([]);
  const [bomAddProduct, setBomAddProduct] = useState('');
  const [bomAddQty, setBomAddQty] = useState('1');
  const [bomSubmitting, setBomSubmitting] = useState(false);
  const [bomCounts, setBomCounts] = useState<Map<string, number>>(new Map());

  const supabase = createClient();

  // ─── Fetch ──────────────────────────────────────────────

  const fetchServices = useCallback(async () => {
    setIsLoading(true);
    try {
      let query = supabase
        .from('services')
        .select('*, branches:branch_id(name)')
        .order('name');

      if (!isOwner && selectedBranch?.id) {
        query = query.eq('branch_id', selectedBranch.id);
      }

      const { data, error } = await query;
      if (error) { console.error('Services fetch error:', error); return; }

      setServices((data || []).map((s: Record<string, unknown>) => ({
        id: s.id as string,
        branch_id: s.branch_id as string,
        branch_name: (s.branches as Record<string, unknown>)?.name as string || '',
        name: s.name as string,
        description: s.description as string | null,
        price: Number(s.price),
        duration_minutes: s.duration_minutes as number | null,
        category: s.category as string | null,
        is_active: s.is_active as boolean,
        created_at: s.created_at as string,
        updated_at: s.updated_at as string,
      })));
    } catch (err) {
      console.error('Services page error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [supabase, isOwner, selectedBranch?.id]);

  useEffect(() => { fetchServices(); }, [fetchServices]);

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel('services-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'services' }, () => fetchServices())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [supabase, fetchServices]);

  // ─── Filtering ──────────────────────────────────────────

  const filteredServices = services.filter(s => {
    if (filterStatus === 'active' && !s.is_active) return false;
    if (filterStatus === 'inactive' && s.is_active) return false;
    if (filterCategory && s.category !== filterCategory) return false;
    if (searchText && !s.name.toLowerCase().includes(searchText.toLowerCase()) &&
      !(s.category || '').toLowerCase().includes(searchText.toLowerCase())) return false;
    return true;
  });

  const categories = [...new Set(services.map(s => s.category).filter(Boolean))] as string[];

  // ─── Modal Handlers ─────────────────────────────────────

  const openCreate = () => {
    setFormMode('create');
    setEditingService(null);
    setFormData({
      branch_id: isManager ? (selectedBranch?.id || '') : (branches[0]?.id || ''),
      name: '', description: '', price: '', duration_minutes: '', category: '',
    });
    setFormError(''); setFormSuccess('');
    setIsModalOpen(true);
  };

  const openEdit = (s: Service) => {
    setFormMode('edit');
    setEditingService(s);
    setFormData({
      branch_id: s.branch_id,
      name: s.name,
      description: s.description || '',
      price: String(s.price),
      duration_minutes: s.duration_minutes ? String(s.duration_minutes) : '',
      category: s.category || '',
    });
    setFormError(''); setFormSuccess('');
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(''); setFormSuccess(''); setIsSubmitting(true);
    try {
      const price = parseFloat(formData.price);
      if (!formData.name.trim()) { setFormError('Service name is required'); return; }
      if (isNaN(price) || price < 0) { setFormError('Invalid price'); return; }

      if (formMode === 'create') {
        const res = await fetch('/api/services', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            branch_id: formData.branch_id,
            name: formData.name.trim(),
            description: formData.description.trim() || null,
            price,
            duration_minutes: formData.duration_minutes ? parseInt(formData.duration_minutes) : null,
            category: formData.category || null,
          }),
        });
        const result = await res.json();
        if (!res.ok) { setFormError(result.error || 'Failed to create service'); return; }
        setFormSuccess(`"${formData.name}" created successfully`);
      } else if (editingService) {
        const changes: Record<string, unknown> = {};
        if (formData.name !== editingService.name) changes.name = formData.name.trim();
        if (formData.description !== (editingService.description || '')) changes.description = formData.description.trim() || null;
        if (price !== editingService.price) changes.price = price;
        const newDuration = formData.duration_minutes ? parseInt(formData.duration_minutes) : null;
        if (newDuration !== editingService.duration_minutes) changes.duration_minutes = newDuration;
        if (formData.category !== (editingService.category || '')) changes.category = formData.category || null;

        if (Object.keys(changes).length === 0) { setFormError('No changes detected'); return; }

        const res = await fetch(`/api/services/${editingService.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(changes),
        });
        const result = await res.json();
        if (!res.ok) { setFormError(result.error || 'Failed to update service'); return; }
        setFormSuccess(`"${formData.name}" updated successfully`);
      }
      await fetchServices();
      setTimeout(() => { setIsModalOpen(false); setFormSuccess(''); }, 1500);
    } catch (err) {
      console.error('Service form error:', err);
      setFormError('An unexpected error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/services/${deleteTarget.id}`, { method: 'DELETE' });
      const result = await res.json();
      if (!res.ok) { alert(result.error || 'Failed to delete service'); return; }
      await fetchServices();
      setDeleteTarget(null);
    } catch (err) {
      console.error('Delete error:', err);
      alert('An unexpected error occurred');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleToggleActive = async (s: Service) => {
    try {
      const res = await fetch(`/api/services/${s.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !s.is_active }),
      });
      if (!res.ok) { const r = await res.json(); alert(r.error || 'Failed to update'); return; }
      await fetchServices();
    } catch (err) {
      console.error('Toggle error:', err);
    }
  };

  // ─── BOM Handlers ──────────────────────────────────────

  const fetchBomEntries = async (serviceId: string) => {
    setBomLoading(true);
    try {
      const res = await fetch(`/api/service-consumables?service_id=${serviceId}`);
      const result = await res.json();
      if (res.ok) {
        setBomEntries((result.data || []).map((e: Record<string, unknown>) => ({
          id: e.id as string,
          product_id: e.product_id as string,
          product_name: e.products ? (e.products as Record<string, unknown>).name as string : 'Unknown',
          quantity: Number(e.quantity),
          notes: e.notes as string | null,
        })));
      }
    } catch (err) { console.error('BOM fetch error:', err); }
    finally { setBomLoading(false); }
  };

  const fetchBomCounts = useCallback(async () => {
    if (!ENABLE_SERVICE_BOM) return;
    const counts = new Map<string, number>();
    for (const svc of services) {
      try {
        const res = await fetch(`/api/service-consumables?service_id=${svc.id}`);
        const result = await res.json();
        if (res.ok) counts.set(svc.id, (result.data || []).length);
      } catch { counts.set(svc.id, 0); }
    }
    setBomCounts(counts);
  }, [services]);

  useEffect(() => { fetchBomCounts(); }, [fetchBomCounts]);

  const openBom = async (s: Service) => {
    setBomService(s);
    setBomAddProduct('');
    setBomAddQty('1');
    await fetchBomEntries(s.id);
    // Fetch branch products for the add dropdown
    const { data: prods } = await supabase
      .from('products')
      .select('id, name, sku')
      .eq('branch_id', s.branch_id)
      .eq('is_active', true)
      .order('name');
    setBranchProducts((prods || []) as BranchProduct[]);
  };

  const handleAddBom = async () => {
    if (!bomService || !bomAddProduct) return;
    setBomSubmitting(true);
    try {
      const res = await fetch('/api/service-consumables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id: bomService.id,
          product_id: bomAddProduct,
          quantity: parseInt(bomAddQty) || 1,
        }),
      });
      if (res.ok) {
        await fetchBomEntries(bomService.id);
        setBomAddProduct('');
        setBomAddQty('1');
        fetchBomCounts();
      } else {
        const r = await res.json();
        alert(r.error || 'Failed to add consumable');
      }
    } catch (err) { console.error(err); }
    finally { setBomSubmitting(false); }
  };

  const handleRemoveBom = async (entryId: string) => {
    try {
      const res = await fetch(`/api/service-consumables/${entryId}`, { method: 'DELETE' });
      if (res.ok && bomService) {
        await fetchBomEntries(bomService.id);
        fetchBomCounts();
      }
    } catch (err) { console.error(err); }
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
          <h1 className="text-2xl font-display font-semibold text-brand-900">Services</h1>
          <p className="text-sm text-brand-500 mt-1">
            {isOwner ? 'Manage clinic services across all branches' : 'Manage services for your branch'}
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
            Add Service
          </button>
        )}
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Services', value: services.length, color: 'text-brand-900' },
          { label: 'Active', value: services.filter(s => s.is_active).length, color: 'text-emerald-600' },
          { label: 'Inactive', value: services.filter(s => !s.is_active).length, color: 'text-brand-400' },
          { label: 'Categories', value: categories.length, color: 'text-brand-700' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-2xl border border-brand-100/50 shadow-card px-5 py-4">
            <p className="text-xs font-medium text-brand-400 uppercase tracking-wide">{label}</p>
            <p className={`text-2xl font-semibold mt-1 ${color}`}>{value}</p>
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
              placeholder="Search by name or category..."
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
              {SERVICE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-brand-500 mb-1">Status</label>
            <select
              value={filterStatus} onChange={e => setFilterStatus(e.target.value as 'all' | 'active' | 'inactive')}
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

      {/* Services Table */}
      <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-brand-100/60 bg-surface-50">
                <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Service</th>
                {isOwner && <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Branch</th>}
                <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Category</th>
                <th className="text-right text-xs font-medium text-brand-400 px-5 py-3">Price</th>
                <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Duration</th>
                <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Status</th>
                {canManage && <th className="text-right text-xs font-medium text-brand-400 px-5 py-3">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b border-brand-100/30">
                    <td className="px-5 py-4"><div><Skeleton className="h-4 w-40 mb-1" /><Skeleton className="h-3 w-24" /></div></td>
                    {isOwner && <td className="px-5 py-4"><Skeleton className="h-4 w-20" /></td>}
                    <td className="px-5 py-4"><Skeleton className="h-5 w-20 rounded-full" /></td>
                    <td className="px-5 py-4 text-right"><Skeleton className="h-4 w-16 ml-auto" /></td>
                    <td className="px-5 py-4"><Skeleton className="h-4 w-12" /></td>
                    <td className="px-5 py-4"><Skeleton className="h-5 w-14 rounded-full" /></td>
                    {canManage && <td className="px-5 py-4"><Skeleton className="h-4 w-16 ml-auto" /></td>}
                  </tr>
                ))
              ) : filteredServices.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? (isOwner ? 7 : 6) : (isOwner ? 6 : 5)} className="text-center py-16 text-sm text-brand-400">
                    <svg className="w-12 h-12 text-brand-200 mx-auto mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {searchText || filterCategory ? 'No services match your filters' : 'No services added yet'}
                  </td>
                </tr>
              ) : (
                filteredServices.map(s => (
                  <tr key={s.id} className={`border-b border-brand-100/30 hover:bg-brand-50/30 transition-colors ${!s.is_active ? 'opacity-60' : ''}`}>
                    <td className="px-5 py-4">
                      <p className="text-sm font-medium text-brand-800">{s.name}</p>
                      {s.description && <p className="text-xs text-brand-400 mt-0.5 truncate max-w-[200px]">{s.description}</p>}
                    </td>
                    {isOwner && <td className="px-5 py-4"><span className="text-sm text-brand-500">{s.branch_name}</span></td>}
                    <td className="px-5 py-4">
                      {s.category ? (
                        <Badge variant="brand" size="sm">{s.category}</Badge>
                      ) : (
                        <span className="text-xs text-brand-300">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <span className="text-sm font-semibold text-brand-800">{formatCurrency(s.price)}</span>
                    </td>
                    <td className="px-5 py-4">
                      <span className="text-sm text-brand-500">
                        {s.duration_minutes ? `${s.duration_minutes} min` : '—'}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <Badge variant={s.is_active ? 'success' : 'default'} size="sm">
                        {s.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    {canManage && (
                      <td className="px-5 py-4">
                        <div className="flex items-center justify-end gap-1">
                          {ENABLE_SERVICE_BOM && (
                            <button
                              onClick={() => openBom(s)}
                              className="p-2 rounded-lg text-brand-400 hover:text-brand-700 hover:bg-brand-50 transition-colors"
                              title="Manage consumables (BOM)"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
                              </svg>
                              {(bomCounts.get(s.id) || 0) > 0 && (
                                <span className="absolute -top-1 -right-1 bg-brand-500 text-white text-[9px] w-4 h-4 rounded-full flex items-center justify-center">
                                  {bomCounts.get(s.id)}
                                </span>
                              )}
                            </button>
                          )}
                          <button
                            onClick={() => openEdit(s)}
                            className="p-2 rounded-lg text-brand-400 hover:text-brand-700 hover:bg-brand-50 transition-colors"
                            title="Edit service"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleToggleActive(s)}
                            className={`p-2 rounded-lg transition-colors ${
                              s.is_active
                                ? 'text-amber-400 hover:text-amber-700 hover:bg-amber-50'
                                : 'text-emerald-400 hover:text-emerald-700 hover:bg-emerald-50'
                            }`}
                            title={s.is_active ? 'Deactivate' : 'Activate'}
                          >
                            {s.is_active ? (
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
                            <button
                              onClick={() => setDeleteTarget(s)}
                              className="p-2 rounded-lg text-rose-300 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                              title="Delete service"
                            >
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
        {!isLoading && filteredServices.length > 0 && (
          <div className="px-5 py-3 border-t border-brand-100/40 text-xs text-brand-400">
            Showing {filteredServices.length} of {services.length} services
          </div>
        )}
      </div>

      {/* ─── Create / Edit Modal ─────────────────────────────── */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={formMode === 'create' ? 'Add New Service' : 'Edit Service'}
        subtitle={formMode === 'create' ? 'Add a clinic service to your menu' : `Editing: ${editingService?.name}`}
        size="md"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && (
            <div className="animate-slide-up bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
              {formError}
            </div>
          )}
          {formSuccess && (
            <div className="animate-slide-up bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {formSuccess}
            </div>
          )}

          {/* Branch (Owner only, create mode) */}
          {isOwner && formMode === 'create' && (
            <div>
              <label className="block text-sm font-medium text-brand-800 mb-1.5">Branch</label>
              <select
                value={formData.branch_id}
                onChange={e => setFormData({ ...formData, branch_id: e.target.value })}
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
            <label className="block text-sm font-medium text-brand-800 mb-1.5">Service Name</label>
            <input
              type="text" value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g. Glutathione IV Drip 1500mg"
              required
              className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900 placeholder:text-brand-300
                         focus:outline-none focus:ring-2 focus:ring-brand-400/50 focus:border-brand-400 transition-all"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-brand-800 mb-1.5">Description <span className="text-brand-300 font-normal">(optional)</span></label>
            <textarea
              value={formData.description}
              onChange={e => setFormData({ ...formData, description: e.target.value })}
              placeholder="Brief description of the service..."
              rows={2}
              className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900 placeholder:text-brand-300
                         focus:outline-none focus:ring-2 focus:ring-brand-400/50 focus:border-brand-400 transition-all resize-none"
            />
          </div>

          {/* Price + Duration */}
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
              <label className="block text-sm font-medium text-brand-800 mb-1.5">Duration <span className="text-brand-300 font-normal">(min)</span></label>
              <input
                type="number" value={formData.duration_minutes} min="1"
                onChange={e => setFormData({ ...formData, duration_minutes: e.target.value })}
                placeholder="e.g. 60"
                className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900 placeholder:text-brand-300
                           focus:outline-none focus:ring-2 focus:ring-brand-400/50 focus:border-brand-400 transition-all"
              />
            </div>
          </div>

          {/* Category */}
          <div>
            <label className="block text-sm font-medium text-brand-800 mb-1.5">Category</label>
            <select
              value={formData.category}
              onChange={e => setFormData({ ...formData, category: e.target.value })}
              className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900
                         focus:outline-none focus:ring-2 focus:ring-brand-400/50 focus:border-brand-400 transition-all"
            >
              <option value="">Select category...</option>
              {SERVICE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Submit */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit" disabled={isSubmitting}
              className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-brand-600 to-brand-700 text-white font-medium
                         hover:from-brand-700 hover:to-brand-800 active:scale-[0.98]
                         disabled:opacity-60 disabled:cursor-not-allowed
                         transition-all duration-200 shadow-sm hover:shadow-md text-sm"
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
                formMode === 'create' ? 'Create Service' : 'Save Changes'
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
        title="Delete Service" subtitle="This may soft-delete if the service has sale history"
        size="sm"
      >
        <div className="space-y-4">
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-4">
            <p className="text-sm font-medium text-rose-800">Delete &quot;{deleteTarget?.name}&quot;?</p>
            <p className="text-xs text-rose-600 mt-1">
              If this service has been sold, it will be deactivated instead of permanently deleted to preserve sale history.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleDelete} disabled={isDeleting}
              className="flex-1 py-2.5 px-4 rounded-xl bg-rose-600 text-white font-medium text-sm
                         hover:bg-rose-700 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed transition-all"
            >
              {isDeleting ? 'Deleting...' : 'Delete Service'}
            </button>
            <button
              onClick={() => setDeleteTarget(null)}
              className="px-4 py-2.5 rounded-xl border border-brand-200 text-brand-600 text-sm font-medium hover:bg-brand-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>

      {/* ─── BOM Management Modal ──────────────────────────────── */}
      <Modal
        isOpen={!!bomService}
        onClose={() => { setBomService(null); setBomEntries([]); }}
        title="Service Consumables (BOM)"
        subtitle={bomService ? `${bomService.name}` : ''}
        size="md"
      >
        {bomService && (
          <div className="space-y-4">
            <p className="text-xs text-brand-400">
              Define which inventory products are consumed each time this service is performed. These items will be auto-deducted from inventory at checkout.
            </p>

            {/* Current BOM entries */}
            {bomLoading ? (
              <div className="space-y-2">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}</div>
            ) : bomEntries.length === 0 ? (
              <div className="bg-surface-50 rounded-xl p-4 text-center text-sm text-brand-400">
                No consumables linked to this service yet
              </div>
            ) : (
              <div className="space-y-2">
                {bomEntries.map(entry => (
                  <div key={entry.id} className="flex items-center justify-between bg-surface-50 rounded-xl px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-brand-800">{entry.product_name}</p>
                      <p className="text-xs text-brand-400">Qty per service: {entry.quantity}</p>
                    </div>
                    <button onClick={() => handleRemoveBom(entry.id)}
                      className="p-1.5 rounded-lg text-rose-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                      title="Remove">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add new BOM entry */}
            {canManage && (
              <div className="border-t border-brand-100 pt-4">
                <p className="text-xs font-semibold text-brand-500 uppercase mb-2">Add Consumable</p>
                <div className="flex gap-2">
                  <select value={bomAddProduct} onChange={e => setBomAddProduct(e.target.value)}
                    className="flex-1 px-3 py-2 rounded-xl border border-brand-200 bg-surface-50 text-sm text-brand-900
                               focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all">
                    <option value="">Select product...</option>
                    {branchProducts
                      .filter(p => !bomEntries.some(e => e.product_id === p.id))
                      .map(p => <option key={p.id} value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ''}</option>)}
                  </select>
                  <input type="number" value={bomAddQty} min="1" onChange={e => setBomAddQty(e.target.value)}
                    className="w-20 px-3 py-2 rounded-xl border border-brand-200 bg-surface-50 text-sm text-brand-900 text-center
                               focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all"
                    placeholder="Qty" />
                  <button onClick={handleAddBom} disabled={!bomAddProduct || bomSubmitting}
                    className="px-4 py-2 rounded-xl bg-brand-600 text-white text-sm font-medium
                               hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
                    {bomSubmitting ? '...' : 'Add'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
