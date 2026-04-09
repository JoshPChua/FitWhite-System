'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/providers/auth-provider';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';

// ─── Types ──────────────────────────────────────────────────

interface Branch {
  id: string;
  name: string;
  code: string;
  type: 'owned' | 'managed';
  address: string | null;
  phone: string | null;
  email: string | null;
  is_active: boolean;
  reporting_restricted: boolean;
  created_at: string;
}

interface BranchFormData {
  name: string;
  code: string;
  type: 'owned' | 'managed';
  address: string;
  phone: string;
  email: string;
  reporting_restricted: boolean;
}

// ─── Component ──────────────────────────────────────────────

/**
 * DEV FLAG — set to `true` to re-enable the "Add Branch" button for the owner.
 * The API route (/api/branches POST) and all modal/form logic remain fully intact;
 * only the button is hidden. Flip this to true when the client needs to add branches.
 */
const ALLOW_UI_ADD_BRANCH = false;

export default function BranchesPage() {
  const { isOwner } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(false);
  const [searchText, setSearchText] = useState('');

  // Form modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [formData, setFormData] = useState<BranchFormData>({
    name: '', code: '', type: 'owned', address: '', phone: '', email: '', reporting_restricted: false,
  });
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Deactivate confirm
  const [deactivateTarget, setDeactivateTarget] = useState<Branch | null>(null);
  const [isDeactivating, setIsDeactivating] = useState(false);

  // ─── Fetch ────────────────────────────────────────────────

  const fetchBranches = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/branches?includeInactive=${showInactive}`);
      const data = await res.json();
      if (res.ok) setBranches(data.branches || []);
    } catch (err) {
      console.error('Branches fetch error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [showInactive]);

  useEffect(() => { fetchBranches(); }, [fetchBranches]);

  // ─── Guard: Owner only ────────────────────────────────────

  if (!isOwner) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <svg className="w-12 h-12 text-brand-200 mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
        <p className="text-sm text-brand-600 font-medium">Owner Access Required</p>
        <p className="text-xs text-brand-400 mt-1">Branch management is restricted to owners only</p>
      </div>
    );
  }

  // ─── Handlers ─────────────────────────────────────────────

  const openCreate = () => {
    setFormMode('create');
    setEditingBranch(null);
    setFormData({ name: '', code: '', type: 'owned', address: '', phone: '', email: '', reporting_restricted: false });
    setFormError(''); setFormSuccess('');
    setIsModalOpen(true);
  };

  const openEdit = (b: Branch) => {
    setFormMode('edit');
    setEditingBranch(b);
    setFormData({
      name: b.name, code: b.code, type: b.type,
      address: b.address || '', phone: b.phone || '', email: b.email || '',
      reporting_restricted: b.reporting_restricted,
    });
    setFormError(''); setFormSuccess('');
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(''); setFormSuccess(''); setIsSubmitting(true);
    try {
      const url = formMode === 'create' ? '/api/branches' : `/api/branches/${editingBranch?.id}`;
      const method = formMode === 'create' ? 'POST' : 'PATCH';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          code: formData.code,
          type: formData.type,
          address: formData.address || null,
          phone: formData.phone || null,
          email: formData.email || null,
          reporting_restricted: formData.reporting_restricted,
        }),
      });

      const data = await res.json();
      if (!res.ok) { setFormError(data.error); return; }

      setFormSuccess(formMode === 'create' ? `"${formData.name}" branch created` : 'Branch updated');
      await fetchBranches();
      setTimeout(() => { setIsModalOpen(false); setFormSuccess(''); }, 1500);
    } catch {
      setFormError('Network error — please try again');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeactivate = async () => {
    if (!deactivateTarget) return;
    setIsDeactivating(true);
    try {
      const res = await fetch(`/api/branches/${deactivateTarget.id}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchBranches();
        setDeactivateTarget(null);
      }
    } catch (err) {
      console.error('Deactivate error:', err);
    } finally {
      setIsDeactivating(false);
    }
  };

  const handleReactivate = async (b: Branch) => {
    await fetch(`/api/branches/${b.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: true }),
    });
    await fetchBranches();
  };

  // ─── Filtering ────────────────────────────────────────────

  const filtered = branches.filter(b => {
    if (!searchText) return true;
    return b.name.toLowerCase().includes(searchText.toLowerCase()) ||
      b.code.toLowerCase().includes(searchText.toLowerCase());
  });

  const activeBranches = filtered.filter(b => b.is_active);
  const inactiveBranches = filtered.filter(b => !b.is_active);

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });

  // ─── Render ──────────────────────────────────────────────

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-semibold text-brand-900">Branch Management</h1>
          <p className="text-sm text-brand-500 mt-1">Manage your clinic locations and settings</p>
        </div>
        {ALLOW_UI_ADD_BRANCH && (
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-brand-600 to-brand-700 text-white text-sm font-medium
                       hover:from-brand-700 hover:to-brand-800 active:scale-[0.98] transition-all duration-200 shadow-sm hover:shadow-md"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add Branch
          </button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card px-5 py-4">
          <p className="text-xs font-medium text-brand-400 uppercase tracking-wide">Total Branches</p>
          <p className="text-2xl font-semibold text-brand-900 mt-1">{branches.length}</p>
        </div>
        <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card px-5 py-4">
          <p className="text-xs font-medium text-brand-400 uppercase tracking-wide">Active</p>
          <p className="text-2xl font-semibold text-emerald-600 mt-1">{branches.filter(b => b.is_active).length}</p>
        </div>
        <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card px-5 py-4">
          <p className="text-xs font-medium text-brand-400 uppercase tracking-wide">Managed</p>
          <p className="text-2xl font-semibold text-brand-600 mt-1">{branches.filter(b => b.type === 'managed').length}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card p-5">
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
          <div className="flex-1">
            <input type="text" value={searchText} onChange={e => setSearchText(e.target.value)}
              placeholder="Search branches by name or code..."
              className="w-full px-3 py-2 rounded-xl border border-brand-200 bg-surface-50 text-sm text-brand-800
                         placeholder:text-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all" />
          </div>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <div
              onClick={() => setShowInactive(v => !v)}
              className={`w-10 h-5 rounded-full transition-colors relative cursor-pointer ${showInactive ? 'bg-brand-600' : 'bg-brand-200'}`}
            >
              <div className={`w-4 h-4 bg-white rounded-full shadow absolute top-0.5 transition-transform ${showInactive ? 'left-5' : 'left-0.5'}`} />
            </div>
            <span className="text-sm text-brand-600">Show inactive</span>
          </label>
        </div>
      </div>

      {/* Branch Cards Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-brand-100/50 shadow-card p-5">
              <div className="flex justify-between mb-3">
                <Skeleton className="h-5 w-36" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
              <Skeleton className="h-4 w-10 mb-4" />
              <Skeleton className="h-3 w-full mb-2" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card py-20 text-center">
          <svg className="w-12 h-12 text-brand-200 mx-auto mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72m-13.5 8.65h3.75a.75.75 0 00.75-.75V13.5a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v3.75c0 .415.336.75.75.75z" />
          </svg>
          <p className="text-sm text-brand-400">No branches found</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Active Branches */}
          {activeBranches.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-brand-400 uppercase tracking-wider mb-3">Active · {activeBranches.length}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {activeBranches.map(b => <BranchCard key={b.id} branch={b} onEdit={openEdit} onDeactivate={setDeactivateTarget} formatDate={formatDate} />)}
              </div>
            </div>
          )}

          {/* Inactive Branches */}
          {showInactive && inactiveBranches.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-brand-300 uppercase tracking-wider mb-3">Inactive · {inactiveBranches.length}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {inactiveBranches.map(b => (
                  <BranchCard key={b.id} branch={b} onEdit={openEdit} onDeactivate={setDeactivateTarget}
                    onReactivate={handleReactivate} formatDate={formatDate} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Create / Edit Modal ─────────────────────────────── */}
      <Modal
        isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}
        title={formMode === 'create' ? 'Add Branch' : 'Edit Branch'}
        subtitle={formMode === 'create' ? 'Add a new clinic location' : `Editing: ${editingBranch?.name}`}
        size="md"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{formError}</div>}
          {formSuccess && (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {formSuccess}
            </div>
          )}

          {/* Name + Code */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-brand-800 mb-1.5">Branch Name</label>
              <input type="text" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g. Makati Branch" required
                className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900 placeholder:text-brand-300
                           focus:outline-none focus:ring-2 focus:ring-brand-400/50 focus:border-brand-400 transition-all" />
            </div>
            <div>
              <label className="block text-sm font-medium text-brand-800 mb-1.5">Branch Code</label>
              <input type="text" value={formData.code}
                onChange={e => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                placeholder="e.g. MKT" required maxLength={10}
                className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900 placeholder:text-brand-300 font-mono uppercase
                           focus:outline-none focus:ring-2 focus:ring-brand-400/50 focus:border-brand-400 transition-all" />
            </div>
          </div>

          {/* Type */}
          <div>
            <label className="block text-sm font-medium text-brand-800 mb-1.5">Branch Type</label>
            <div className="flex gap-3">
              {(['owned', 'managed'] as const).map(t => (
                <label key={t} className={`flex-1 flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                  formData.type === t ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-brand-200 hover:border-brand-300'
                }`}>
                  <input type="radio" name="branch_type" value={t}
                    checked={formData.type === t} onChange={() => setFormData({ ...formData, type: t })}
                    className="accent-brand-600" />
                  <div>
                    <p className="text-sm font-medium capitalize">{t}</p>
                    <p className="text-xs text-brand-400">{t === 'owned' ? 'Direct company branch' : 'Franchise/partner'}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Contact */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-brand-800 mb-1.5">Phone</label>
              <input type="tel" value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })}
                placeholder="e.g. +63 2 8888 0000"
                className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900 placeholder:text-brand-300
                           focus:outline-none focus:ring-2 focus:ring-brand-400/50 focus:border-brand-400 transition-all" />
            </div>
            <div>
              <label className="block text-sm font-medium text-brand-800 mb-1.5">Email</label>
              <input type="email" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })}
                placeholder="branch@email.com"
                className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900 placeholder:text-brand-300
                           focus:outline-none focus:ring-2 focus:ring-brand-400/50 focus:border-brand-400 transition-all" />
            </div>
          </div>

          {/* Address */}
          <div>
            <label className="block text-sm font-medium text-brand-800 mb-1.5">Address</label>
            <textarea value={formData.address} onChange={e => setFormData({ ...formData, address: e.target.value })}
              placeholder="Full street address..." rows={2} maxLength={500}
              className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900 placeholder:text-brand-300
                         focus:outline-none focus:ring-2 focus:ring-brand-400/50 focus:border-brand-400 transition-all resize-none" />
          </div>

          {/* Reporting restricted */}
          <label className="flex items-center gap-3 cursor-pointer p-3 rounded-xl border border-brand-200 hover:bg-brand-50 transition-colors">
            <input type="checkbox" checked={formData.reporting_restricted}
              onChange={e => setFormData({ ...formData, reporting_restricted: e.target.checked })}
              className="w-4 h-4 accent-brand-600" />
            <div>
              <p className="text-sm font-medium text-brand-800">Restrict Reporting Access</p>
              <p className="text-xs text-brand-400">Managers of this branch cannot view cross-branch analytics</p>
            </div>
          </label>

          <div className="flex items-center gap-3 pt-2">
            <button type="submit" disabled={isSubmitting}
              className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-brand-600 to-brand-700 text-white font-medium text-sm
                         hover:from-brand-700 hover:to-brand-800 active:scale-[0.98]
                         disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200 shadow-sm">
              {isSubmitting ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  {formMode === 'create' ? 'Creating...' : 'Saving...'}
                </span>
              ) : formMode === 'create' ? 'Create Branch' : 'Save Changes'}
            </button>
            <button type="button" onClick={() => setIsModalOpen(false)}
              className="px-4 py-2.5 rounded-xl border border-brand-200 text-brand-600 text-sm font-medium hover:bg-brand-50 transition-colors">
              Cancel
            </button>
          </div>
        </form>
      </Modal>

      {/* ─── Deactivate Confirm Modal ────────────────────────── */}
      <Modal
        isOpen={!!deactivateTarget} onClose={() => setDeactivateTarget(null)}
        title="Deactivate Branch" subtitle="This will disable the branch from the system"
        size="sm"
      >
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <p className="text-sm font-medium text-amber-800">Deactivate &quot;{deactivateTarget?.name}&quot;?</p>
            <p className="text-xs text-amber-700 mt-1">
              Staff assigned to this branch will no longer be able to log in. Existing data (sales, customers, inventory) is preserved.
              You can reactivate it later.
            </p>
          </div>
          <div className="flex gap-3">
            <button onClick={handleDeactivate} disabled={isDeactivating}
              className="flex-1 py-2.5 px-4 rounded-xl bg-amber-600 text-white font-medium text-sm
                         hover:bg-amber-700 active:scale-[0.98] disabled:opacity-60 transition-all">
              {isDeactivating ? 'Deactivating...' : 'Deactivate Branch'}
            </button>
            <button onClick={() => setDeactivateTarget(null)}
              className="px-4 py-2.5 rounded-xl border border-brand-200 text-brand-600 text-sm font-medium hover:bg-brand-50 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ─── Branch Card Component ───────────────────────────────────

function BranchCard({
  branch, onEdit, onDeactivate, onReactivate, formatDate,
}: {
  branch: Branch;
  onEdit: (b: Branch) => void;
  onDeactivate: (b: Branch) => void;
  onReactivate?: (b: Branch) => void;
  formatDate: (d: string) => string;
}) {
  return (
    <div className={`bg-white rounded-2xl border shadow-card p-5 flex flex-col gap-4 transition-all hover:shadow-md ${
      !branch.is_active ? 'border-brand-100/30 opacity-70' : 'border-brand-100/50'
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-mono text-[10px] font-bold text-brand-500 bg-brand-100 px-1.5 py-0.5 rounded-md">{branch.code}</span>
            {branch.reporting_restricted && (
              <span className="text-[9px] font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full">RESTRICTED</span>
            )}
          </div>
          <h3 className="text-sm font-semibold text-brand-800 truncate">{branch.name}</h3>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge variant={branch.is_active ? 'success' : 'default'} size="sm">
            {branch.is_active ? 'Active' : 'Inactive'}
          </Badge>
          <Badge variant={branch.type === 'owned' ? 'brand' : 'info'} size="sm">
            {branch.type}
          </Badge>
        </div>
      </div>

      <div className="space-y-1.5">
        {branch.address && (
          <div className="flex items-start gap-2 text-xs text-brand-500">
            <svg className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-brand-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
            </svg>
            <span className="line-clamp-2">{branch.address}</span>
          </div>
        )}
        {branch.phone && (
          <div className="flex items-center gap-2 text-xs text-brand-500">
            <svg className="w-3.5 h-3.5 flex-shrink-0 text-brand-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
            </svg>
            {branch.phone}
          </div>
        )}
        {branch.email && (
          <div className="flex items-center gap-2 text-xs text-brand-500">
            <svg className="w-3.5 h-3.5 flex-shrink-0 text-brand-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
            </svg>
            {branch.email}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between mt-auto pt-3 border-t border-brand-100/40">
        <span className="text-xs text-brand-400">Since {formatDate(branch.created_at)}</span>
        <div className="flex items-center gap-1">
          <button onClick={() => onEdit(branch)} title="Edit branch"
            className="p-2 rounded-lg text-brand-400 hover:text-brand-700 hover:bg-brand-50 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
            </svg>
          </button>
          {branch.is_active ? (
            <button onClick={() => onDeactivate(branch)} title="Deactivate"
              className="p-2 rounded-lg text-amber-400 hover:text-amber-700 hover:bg-amber-50 transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
            </button>
          ) : (
            onReactivate && (
              <button onClick={() => onReactivate(branch)} title="Reactivate"
                className="p-2 rounded-lg text-emerald-400 hover:text-emerald-700 hover:bg-emerald-50 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
