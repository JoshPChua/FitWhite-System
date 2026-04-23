'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/providers/auth-provider';
import { createClient } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { IMUS_ONLY, IMUS_BRANCH_CODE, ENABLE_PATIENT_PACKAGES } from '@/lib/feature-flags';

// ─── Types ──────────────────────────────────────────────────

interface Customer {
  id: string;
  branch_id: string;
  branch_name?: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  store_credit: number;
  allergies: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  visit_count?: number;
}

interface CustomerFormData {
  branch_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  allergies: string;
  notes: string;
}

interface VisitHistoryEntry {
  id: string;
  service_name: string;
  dosage: string | null;
  notes: string | null;
  administered_by: string | null;
  created_at: string;
}

// ─── Component ──────────────────────────────────────────────

export default function CustomersPage() {
  const { isOwner, isManager, isCashier, selectedBranch, branches } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [filterBranch, setFilterBranch] = useState('');

  // Create/Edit modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [formData, setFormData] = useState<CustomerFormData>({
    branch_id: '', first_name: '', last_name: '', email: '', phone: '', allergies: '', notes: '',
  });
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Detail / Visit History modal
  const [detailCustomer, setDetailCustomer] = useState<Customer | null>(null);
  const [visitHistory, setVisitHistory] = useState<VisitHistoryEntry[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // Client A/R packages
  const [customerPackages, setCustomerPackages] = useState<Array<{
    id: string; service_name: string; status: string;
    total_price: number; total_paid: number; remaining_balance: number;
    total_sessions: number; sessions_used: number; created_at: string;
  }>>([]);

  // Delete
  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const supabase = createClient();

  // ─── Fetch ──────────────────────────────────────────────

  const fetchCustomers = useCallback(async () => {
    setIsLoading(true);
    try {
      let query = supabase
        .from('customers')
        .select('*, branches:branch_id(name)')
        .order('last_name');

      if (!isOwner && selectedBranch?.id) {
        query = query.eq('branch_id', selectedBranch.id);
      } else if (filterBranch) {
        query = query.eq('branch_id', filterBranch);
      }

      const { data, error } = await query;
      if (error) { console.error('Customers fetch error:', error); return; }

      setCustomers((data || []).map((c: Record<string, unknown>) => ({
        id: c.id as string,
        branch_id: c.branch_id as string,
        branch_name: (c.branches as Record<string, unknown>)?.name as string || '',
        first_name: c.first_name as string,
        last_name: c.last_name as string,
        email: c.email as string | null,
        phone: c.phone as string | null,
        store_credit: Number(c.store_credit),
        allergies: c.allergies as string | null,
        notes: c.notes as string | null,
        created_at: c.created_at as string,
        updated_at: c.updated_at as string,
      })));
    } catch (err) {
      console.error('Customers page error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [supabase, isOwner, selectedBranch?.id, filterBranch]);

  useEffect(() => { fetchCustomers(); }, [fetchCustomers]);

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel('customers-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customers' }, () => fetchCustomers())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [supabase, fetchCustomers]);

  // ─── Visit History ───────────────────────────────────────

  const openDetail = async (customer: Customer) => {
    setDetailCustomer(customer);
    setIsLoadingHistory(true);
    try {
      const { data } = await supabase
        .from('treatment_history')
        .select('*, profiles:administered_by(first_name, last_name)')
        .eq('customer_id', customer.id)
        .order('created_at', { ascending: false });

      setVisitHistory((data || []).map((t: Record<string, unknown>) => ({
        id: t.id as string,
        service_name: t.service_name as string,
        dosage: t.dosage as string | null,
        notes: t.notes as string | null,
        administered_by: t.profiles
          ? `${(t.profiles as Record<string, unknown>).first_name} ${(t.profiles as Record<string, unknown>).last_name}`
          : null,
        created_at: t.created_at as string,
      })));
    } catch (err) {
      console.error('Visit history error:', err);
    } finally {
      setIsLoadingHistory(false);
    }

    // Fetch packages (A/R)
    if (ENABLE_PATIENT_PACKAGES) {
      try {
        const { data: pkgData } = await supabase
          .from('patient_packages')
          .select('id, status, total_price, total_paid, remaining_balance, total_sessions, sessions_used, created_at, services:service_id(name)')
          .eq('customer_id', customer.id)
          .order('created_at', { ascending: false });
        setCustomerPackages((pkgData || []).map((p: Record<string, unknown>) => ({
          id: p.id as string,
          service_name: (p.services as Record<string, unknown>)?.name as string || 'Unknown',
          status: p.status as string,
          total_price: Number(p.total_price),
          total_paid: Number(p.total_paid),
          remaining_balance: Number(p.remaining_balance),
          total_sessions: Number(p.total_sessions),
          sessions_used: Number(p.sessions_used),
          created_at: p.created_at as string,
        })));
      } catch (err) {
        console.error('Customer packages error:', err);
      }
    }
  };

  // ─── Filtering ──────────────────────────────────────────

  const filteredCustomers = customers.filter(c => {
    if (!searchText) return true;
    const fullName = `${c.first_name} ${c.last_name}`.toLowerCase();
    return fullName.includes(searchText.toLowerCase()) ||
      (c.email || '').toLowerCase().includes(searchText.toLowerCase()) ||
      (c.phone || '').includes(searchText);
  });

  // ─── Form Handlers ─────────────────────────────────────

  const openCreate = () => {
    setFormMode('create');
    setEditingCustomer(null);
    setFormData({
      branch_id: selectedBranch?.id || '',
      first_name: '', last_name: '', email: '', phone: '', allergies: '', notes: '',
    });
    setFormError(''); setFormSuccess('');
    setIsModalOpen(true);
  };

  const openEdit = (c: Customer) => {
    setFormMode('edit');
    setEditingCustomer(c);
    setFormData({
      branch_id: c.branch_id,
      first_name: c.first_name,
      last_name: c.last_name,
      email: c.email || '',
      phone: c.phone || '',
      allergies: c.allergies || '',
      notes: c.notes || '',
    });
    setFormError(''); setFormSuccess('');
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(''); setFormSuccess(''); setIsSubmitting(true);
    try {
      if (!formData.first_name.trim() || !formData.last_name.trim()) {
        setFormError('First and last name are required'); return;
      }

      const payload = {
        first_name: formData.first_name.trim(),
        last_name: formData.last_name.trim(),
        email: formData.email.trim() || null,
        phone: formData.phone.trim() || null,
        allergies: formData.allergies.trim() || null,
        notes: formData.notes.trim() || null,
      };

      if (formMode === 'create') {
        const res = await fetch('/api/customers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...payload,
            // In IMUS_ONLY, server ignores this and resolves Imus branch.
            // In multi-branch, server validates this.
            branch_id: formData.branch_id,
          }),
        });
        const result = await res.json();
        if (!res.ok) { setFormError(result.error || 'Failed to register patient'); return; }
        setFormSuccess(`${formData.first_name} ${formData.last_name} registered`);
      } else if (editingCustomer) {
        const res = await fetch(`/api/customers/${editingCustomer.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const result = await res.json();
        if (!res.ok) { setFormError(result.error || 'Failed to update patient'); return; }
        setFormSuccess(`Profile updated`);
      }

      await fetchCustomers();
      setTimeout(() => { setIsModalOpen(false); setFormSuccess(''); }, 1500);
    } catch (err) {
      console.error('Customer form error:', err);
      setFormError('An unexpected error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/customers/${deleteTarget.id}`, { method: 'DELETE' });
      const result = await res.json();
      if (!res.ok) { alert(result.error || 'Failed to delete patient'); return; }
      await fetchCustomers();
      setDeleteTarget(null);
    } catch (err) {
      console.error('Delete error:', err);
    } finally {
      setIsDeleting(false);
    }
  };

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });

  const formatDateTime = (dateStr: string) =>
    new Date(dateStr).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(n);

  const canManage = isOwner || isManager;

  const getInitials = (c: Customer) => `${c.first_name[0] || ''}${c.last_name[0] || ''}`.toUpperCase();

  // ─── Render ─────────────────────────────────────────────

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-semibold text-brand-900">Customers</h1>
          <p className="text-sm text-brand-500 mt-1">
            {isOwner ? 'Patient registry across all branches' : 'Patient registry for your branch'}
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
            Register Patient
          </button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card px-5 py-4">
          <p className="text-xs font-medium text-brand-400 uppercase tracking-wide">Total Patients</p>
          <p className="text-2xl font-semibold text-brand-900 mt-1">{customers.length}</p>
        </div>
        <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card px-5 py-4">
          <p className="text-xs font-medium text-brand-400 uppercase tracking-wide">With Email</p>
          <p className="text-2xl font-semibold text-brand-900 mt-1">{customers.filter(c => c.email).length}</p>
        </div>
        <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card px-5 py-4">
          <p className="text-xs font-medium text-brand-400 uppercase tracking-wide">Store Credits</p>
          <p className="text-2xl font-semibold text-brand-900 mt-1">
            {customers.filter(c => c.store_credit > 0).length}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card p-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-brand-500 mb-1">Search Patients</label>
            <input
              type="text" value={searchText} onChange={e => setSearchText(e.target.value)}
              placeholder="Name, email, or phone..."
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
                {(IMUS_ONLY ? branches.filter(b => b.code === IMUS_BRANCH_CODE) : branches).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Customer Table */}
      <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-brand-100/60 bg-surface-50">
                <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Patient</th>
                {isOwner && !IMUS_ONLY && <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Branch</th>}
                <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Contact</th>
                <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Allergies</th>
                <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Credits</th>
                <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Registered</th>
                <th className="text-right text-xs font-medium text-brand-400 px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b border-brand-100/30">
                    <td className="px-5 py-4"><div className="flex items-center gap-3"><Skeleton className="w-9 h-9 rounded-full" /><div><Skeleton className="h-4 w-28 mb-1" /><Skeleton className="h-3 w-16" /></div></div></td>
                    {isOwner && !IMUS_ONLY && <td className="px-5 py-4"><Skeleton className="h-4 w-20" /></td>}
                    <td className="px-5 py-4"><Skeleton className="h-4 w-32" /></td>
                    <td className="px-5 py-4"><Skeleton className="h-4 w-20" /></td>
                    <td className="px-5 py-4"><Skeleton className="h-4 w-16" /></td>
                    <td className="px-5 py-4"><Skeleton className="h-4 w-24" /></td>
                    <td className="px-5 py-4"><Skeleton className="h-4 w-16 ml-auto" /></td>
                  </tr>
                ))
              ) : filteredCustomers.length === 0 ? (
                <tr>
                  <td colSpan={isOwner && !IMUS_ONLY ? 7 : 6} className="text-center py-16 text-sm text-brand-400">
                    <svg className="w-12 h-12 text-brand-200 mx-auto mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                    </svg>
                    {searchText ? 'No patients match your search' : 'No patients registered yet'}
                  </td>
                </tr>
              ) : (
                filteredCustomers.map(c => (
                  <tr key={c.id} className="border-b border-brand-100/30 hover:bg-brand-50/30 transition-colors">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-semibold text-brand-600">{getInitials(c)}</span>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-brand-800">{c.first_name} {c.last_name}</p>
                        </div>
                      </div>
                    </td>
                    {isOwner && !IMUS_ONLY && <td className="px-5 py-4"><span className="text-sm text-brand-500">{c.branch_name}</span></td>}
                    <td className="px-5 py-4">
                      <div className="space-y-0.5">
                        {c.phone && <p className="text-xs text-brand-600">{c.phone}</p>}
                        {c.email && <p className="text-xs text-brand-400">{c.email}</p>}
                        {!c.phone && !c.email && <span className="text-xs text-brand-300">—</span>}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      {c.allergies ? (
                        <span className="text-xs text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full">{c.allergies}</span>
                      ) : (
                        <span className="text-xs text-brand-300">None</span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      {c.store_credit > 0 ? (
                        <Badge variant="success" size="sm">{formatCurrency(c.store_credit)}</Badge>
                      ) : (
                        <span className="text-xs text-brand-300">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <span className="text-xs text-brand-400">{formatDate(c.created_at)}</span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end gap-1">
                        {/* View history */}
                        <button
                          onClick={() => openDetail(c)}
                          className="p-2 rounded-lg text-brand-400 hover:text-brand-700 hover:bg-brand-50 transition-colors"
                          title="View visit history"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                        </button>
                        {canManage && (
                          <>
                            <button
                              onClick={() => openEdit(c)}
                              className="p-2 rounded-lg text-brand-400 hover:text-brand-700 hover:bg-brand-50 transition-colors"
                              title="Edit patient"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                              </svg>
                            </button>
                            {isOwner && (
                              <button
                                onClick={() => setDeleteTarget(c)}
                                className="p-2 rounded-lg text-rose-300 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                                title="Delete patient"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                                </svg>
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {!isLoading && filteredCustomers.length > 0 && (
          <div className="px-5 py-3 border-t border-brand-100/40 text-xs text-brand-400">
            Showing {filteredCustomers.length} of {customers.length} patients
          </div>
        )}
      </div>

      {/* ─── Create / Edit Modal ─────────────────────────────── */}
      <Modal
        isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}
        title={formMode === 'create' ? 'Register New Patient' : 'Edit Patient Profile'}
        subtitle={formMode === 'create' ? 'Add a new patient to the registry' : `${editingCustomer?.first_name} ${editingCustomer?.last_name}`}
        size="md"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
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
                {(IMUS_ONLY ? branches.filter(b => b.code === IMUS_BRANCH_CODE) : branches).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          )}

          {/* Name */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-brand-800 mb-1.5">First Name</label>
              <input type="text" value={formData.first_name}
                onChange={e => setFormData({ ...formData, first_name: e.target.value })}
                placeholder="Maria" required
                className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900 placeholder:text-brand-300
                           focus:outline-none focus:ring-2 focus:ring-brand-400/50 focus:border-brand-400 transition-all" />
            </div>
            <div>
              <label className="block text-sm font-medium text-brand-800 mb-1.5">Last Name</label>
              <input type="text" value={formData.last_name}
                onChange={e => setFormData({ ...formData, last_name: e.target.value })}
                placeholder="Santos" required
                className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900 placeholder:text-brand-300
                           focus:outline-none focus:ring-2 focus:ring-brand-400/50 focus:border-brand-400 transition-all" />
            </div>
          </div>

          {/* Contact */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-brand-800 mb-1.5">Phone <span className="text-brand-300 font-normal">(optional)</span></label>
              <input type="tel" value={formData.phone}
                onChange={e => setFormData({ ...formData, phone: e.target.value })}
                placeholder="09XX XXX XXXX"
                className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900 placeholder:text-brand-300
                           focus:outline-none focus:ring-2 focus:ring-brand-400/50 focus:border-brand-400 transition-all" />
            </div>
            <div>
              <label className="block text-sm font-medium text-brand-800 mb-1.5">Email <span className="text-brand-300 font-normal">(optional)</span></label>
              <input type="email" value={formData.email}
                onChange={e => setFormData({ ...formData, email: e.target.value })}
                placeholder="patient@email.com"
                className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900 placeholder:text-brand-300
                           focus:outline-none focus:ring-2 focus:ring-brand-400/50 focus:border-brand-400 transition-all" />
            </div>
          </div>

          {/* Allergies */}
          <div>
            <label className="block text-sm font-medium text-brand-800 mb-1.5">
              Allergies / Contraindications <span className="text-brand-300 font-normal">(optional)</span>
            </label>
            <input type="text" value={formData.allergies}
              onChange={e => setFormData({ ...formData, allergies: e.target.value })}
              placeholder="e.g. Penicillin, latex sensitivity..."
              className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900 placeholder:text-brand-300
                         focus:outline-none focus:ring-2 focus:ring-brand-400/50 focus:border-brand-400 transition-all" />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-brand-800 mb-1.5">Notes <span className="text-brand-300 font-normal">(optional)</span></label>
            <textarea value={formData.notes}
              onChange={e => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Additional notes about the patient..." rows={2}
              className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900 placeholder:text-brand-300
                         focus:outline-none focus:ring-2 focus:ring-brand-400/50 focus:border-brand-400 transition-all resize-none" />
          </div>

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
                  {formMode === 'create' ? 'Registering...' : 'Saving...'}
                </span>
              ) : formMode === 'create' ? 'Register Patient' : 'Save Changes'}
            </button>
            <button type="button" onClick={() => setIsModalOpen(false)}
              className="px-4 py-2.5 rounded-xl border border-brand-200 text-brand-600 text-sm font-medium hover:bg-brand-50 transition-colors">
              Cancel
            </button>
          </div>
        </form>
      </Modal>

      {/* ─── Detail / Visit History Modal ────────────────────── */}
      <Modal
        isOpen={!!detailCustomer} onClose={() => { setDetailCustomer(null); setVisitHistory([]); setCustomerPackages([]); }}
        title={detailCustomer ? `${detailCustomer.first_name} ${detailCustomer.last_name}` : ''}
        subtitle="Patient profile & treatment history"
        size="lg"
      >
        {detailCustomer && (
          <div className="space-y-5">
            {/* Profile info */}
            <div className="grid grid-cols-2 gap-4 bg-surface-50 rounded-xl p-4">
              <div><p className="text-xs text-brand-400 mb-0.5">Phone</p><p className="text-sm text-brand-800">{detailCustomer.phone || '—'}</p></div>
              <div><p className="text-xs text-brand-400 mb-0.5">Email</p><p className="text-sm text-brand-800">{detailCustomer.email || '—'}</p></div>
              <div><p className="text-xs text-brand-400 mb-0.5">Branch</p><p className="text-sm text-brand-800">{detailCustomer.branch_name}</p></div>
              <div><p className="text-xs text-brand-400 mb-0.5">Store Credit</p><p className="text-sm font-semibold text-emerald-700">{formatCurrency(detailCustomer.store_credit)}</p></div>
              {detailCustomer.allergies && (
                <div className="col-span-2">
                  <p className="text-xs text-brand-400 mb-0.5">Allergies / Contraindications</p>
                  <p className="text-sm text-rose-700 bg-rose-50 px-3 py-1.5 rounded-lg">{detailCustomer.allergies}</p>
                </div>
              )}
              {detailCustomer.notes && (
                <div className="col-span-2">
                  <p className="text-xs text-brand-400 mb-0.5">Notes</p>
                  <p className="text-sm text-brand-700">{detailCustomer.notes}</p>
                </div>
              )}
            </div>

            {/* ─── A/R: Active Packages & Balances ──────────────── */}
            {ENABLE_PATIENT_PACKAGES && customerPackages.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-brand-800 mb-3">Packages & Accounts Receivable</h3>
                {/* A/R Summary */}
                {(() => {
                  const active = customerPackages.filter(p => p.status === 'active');
                  const totalAR = active.reduce((s, p) => s + p.remaining_balance, 0);
                  const totalPaid = customerPackages.reduce((s, p) => s + p.total_paid, 0);
                  return (
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      <div className="bg-surface-50 rounded-xl px-3 py-2 text-center">
                        <p className="text-[10px] text-brand-400 uppercase">Active Packages</p>
                        <p className="text-lg font-semibold text-brand-800">{active.length}</p>
                      </div>
                      <div className="bg-surface-50 rounded-xl px-3 py-2 text-center">
                        <p className="text-[10px] text-brand-400 uppercase">Total Paid</p>
                        <p className="text-lg font-semibold text-emerald-600">{formatCurrency(totalPaid)}</p>
                      </div>
                      <div className="bg-surface-50 rounded-xl px-3 py-2 text-center">
                        <p className="text-[10px] text-brand-400 uppercase">Outstanding A/R</p>
                        <p className={`text-lg font-semibold ${totalAR > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                          {totalAR > 0 ? formatCurrency(totalAR) : 'Paid'}
                        </p>
                      </div>
                    </div>
                  );
                })()}
                {/* Package list */}
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {customerPackages.map(pkg => (
                    <div key={pkg.id} className="bg-surface-50 rounded-xl p-3 border border-brand-100/50">
                      <div className="flex items-center justify-between gap-3 mb-1.5">
                        <span className="text-sm font-medium text-brand-800 truncate">{pkg.service_name}</span>
                        <Badge variant={pkg.status === 'active' ? 'brand' : pkg.status === 'completed' ? 'success' : 'default'} size="sm">
                          {pkg.status}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-brand-500">Sessions: {pkg.sessions_used}/{pkg.total_sessions}</span>
                        <span className={pkg.remaining_balance > 0 ? 'text-rose-600 font-medium' : 'text-emerald-600'}>
                          {pkg.remaining_balance > 0 ? `Balance: ${formatCurrency(pkg.remaining_balance)}` : 'Fully Paid'}
                        </span>
                      </div>
                      {/* Session progress bar */}
                      <div className="mt-1.5 w-full bg-brand-100 rounded-full h-1.5">
                        <div className="bg-brand-500 h-1.5 rounded-full transition-all" style={{ width: `${(pkg.sessions_used / pkg.total_sessions) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Treatment History */}
            <div>
              <h3 className="text-sm font-semibold text-brand-800 mb-3">Treatment History</h3>
              {isLoadingHistory ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
                </div>
              ) : visitHistory.length === 0 ? (
                <div className="text-center py-8 text-sm text-brand-400">
                  <svg className="w-10 h-10 text-brand-200 mx-auto mb-2" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
                  </svg>
                  No treatment records yet
                </div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {visitHistory.map(visit => (
                    <div key={visit.id} className="bg-surface-50 rounded-xl p-3.5 border border-brand-100/50">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-brand-800">{visit.service_name}</p>
                          {visit.dosage && <p className="text-xs text-brand-500 mt-0.5">Dosage: {visit.dosage}</p>}
                          {visit.notes && <p className="text-xs text-brand-400 mt-0.5">{visit.notes}</p>}
                          {visit.administered_by && (
                            <p className="text-xs text-brand-400 mt-0.5">By: {visit.administered_by}</p>
                          )}
                        </div>
                        <span className="text-xs text-brand-400 whitespace-nowrap flex-shrink-0">{formatDateTime(visit.created_at)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-3">
              {canManage && (
                <button onClick={() => { setDetailCustomer(null); openEdit(detailCustomer); }}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-brand-600 to-brand-700 text-white font-medium text-sm
                             hover:from-brand-700 hover:to-brand-800 transition-all">
                  Edit Profile
                </button>
              )}
              <button onClick={() => { setDetailCustomer(null); setVisitHistory([]); setCustomerPackages([]); }}
                className={`py-2.5 px-4 rounded-xl border border-brand-200 text-brand-600 text-sm font-medium hover:bg-brand-50 transition-colors ${!canManage ? 'flex-1' : ''}`}>
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ─── Delete Modal ─────────────────────────────────────── */}
      <Modal
        isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)}
        title="Delete Patient" subtitle="This will remove all patient data"
        size="sm"
      >
        <div className="space-y-4">
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-4">
            <p className="text-sm font-medium text-rose-800">Delete {deleteTarget?.first_name} {deleteTarget?.last_name}?</p>
            <p className="text-xs text-rose-600 mt-1">All patient data, treatment history, and associated records will be permanently removed.</p>
          </div>
          <div className="flex gap-3">
            <button onClick={handleDelete} disabled={isDeleting}
              className="flex-1 py-2.5 px-4 rounded-xl bg-rose-600 text-white font-medium text-sm
                         hover:bg-rose-700 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed transition-all">
              {isDeleting ? 'Deleting...' : 'Delete Patient'}
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
