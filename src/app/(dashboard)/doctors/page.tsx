'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/providers/auth-provider';
import { Badge } from '@/components/ui/badge';

interface DoctorRow {
  id: string;
  branch_id: string;
  full_name: string;
  specialty: string | null;
  default_commission_type: 'percent' | 'fixed';
  default_commission_value: number;
  is_active: boolean;
  notes: string | null;
  created_at: string;
}

interface FormState {
  full_name: string;
  specialty: string;
  default_commission_type: 'percent' | 'fixed';
  default_commission_value: string;
  notes: string;
}

const emptyForm: FormState = {
  full_name: '',
  specialty: '',
  default_commission_type: 'percent',
  default_commission_value: '',
  notes: '',
};

export default function DoctorsPage() {
  const { isOwner, isManager, selectedBranch } = useAuth();
  const [doctors, setDoctors] = useState<DoctorRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const branchId = selectedBranch?.id;
  const canEdit = isOwner || isManager;

  const fetchDoctors = useCallback(async () => {
    if (!branchId) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/doctors?branch_id=${branchId}`);
      const json = await res.json();
      setDoctors((json.data || []) as DoctorRow[]);
    } catch { /* ignore */ }
    setIsLoading(false);
  }, [branchId]);

  useEffect(() => { fetchDoctors(); }, [fetchDoctors]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setError('');
    setShowModal(true);
  };

  const openEdit = (d: DoctorRow) => {
    setEditingId(d.id);
    setForm({
      full_name: d.full_name,
      specialty: d.specialty || '',
      default_commission_type: d.default_commission_type || 'percent',
      default_commission_value: d.default_commission_type === 'percent'
        ? String(Math.round((d.default_commission_value || 0) * 100))
        : String(d.default_commission_value || 0),
      notes: d.notes || '',
    });
    setError('');
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.full_name.trim()) { setError('Doctor name is required'); return; }
    if (!branchId) return;
    setIsSaving(true);
    setError('');

    try {
      const payload: Record<string, unknown> = {
        full_name: form.full_name.trim(),
        specialty: form.specialty.trim() || null,
        default_commission_type: form.default_commission_type,
        default_commission_value: Number(form.default_commission_value) || 0,
        notes: form.notes.trim() || null,
      };

      if (editingId) {
        const res = await fetch(`/api/doctors/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) { const j = await res.json(); throw new Error(j.error); }
      } else {
        const res = await fetch('/api/doctors', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, branch_id: branchId }),
        });
        if (!res.ok) { const j = await res.json(); throw new Error(j.error); }
      }

      setShowModal(false);
      fetchDoctors();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeactivate = async (id: string) => {
    if (!confirm('Deactivate this doctor?')) return;
    await fetch(`/api/doctors/${id}`, { method: 'DELETE' });
    fetchDoctors();
  };

  const handleReactivate = async (id: string) => {
    await fetch(`/api/doctors/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: true }),
    });
    fetchDoctors();
  };

  const formatCommission = (d: DoctorRow) => {
    if (!d.default_commission_value) return '—';
    return d.default_commission_type === 'percent'
      ? `${(d.default_commission_value * 100).toFixed(0)}%`
      : `₱${d.default_commission_value.toLocaleString()}`;
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-semibold text-brand-900">Doctors</h1>
          <p className="text-sm text-brand-500 mt-1">Manage attending doctors — no login account required</p>
        </div>
        {canEdit && (
          <button onClick={openCreate}
            className="px-4 py-2.5 rounded-xl bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition-colors shadow-card flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add Doctor
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-brand-400">Loading doctors…</div>
        ) : doctors.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-brand-400 text-sm">No doctors added yet</p>
            {canEdit && <p className="text-brand-300 text-xs mt-1">Click &quot;Add Doctor&quot; to get started</p>}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-brand-100/60 bg-surface-50">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-brand-500 uppercase tracking-wide">Name</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-brand-500 uppercase tracking-wide">Specialty</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-brand-500 uppercase tracking-wide">Default Commission</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-brand-500 uppercase tracking-wide">Status</th>
                  {canEdit && <th className="text-right px-5 py-3 text-xs font-semibold text-brand-500 uppercase tracking-wide">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-100/40">
                {doctors.map(d => (
                  <tr key={d.id} className={`hover:bg-brand-50/50 transition-colors ${!d.is_active ? 'opacity-50' : ''}`}>
                    <td className="px-5 py-3.5">
                      <p className="text-sm font-medium text-brand-900">{d.full_name}</p>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-brand-600">{d.specialty || '—'}</td>
                    <td className="px-5 py-3.5 text-sm text-brand-700 font-medium">{formatCommission(d)}</td>
                    <td className="px-5 py-3.5">
                      <Badge variant={d.is_active ? 'success' : 'default'}>{d.is_active ? 'Active' : 'Inactive'}</Badge>
                    </td>
                    {canEdit && (
                      <td className="px-5 py-3.5 text-right space-x-2">
                        <button onClick={() => openEdit(d)} className="text-xs text-brand-600 hover:text-brand-800 font-medium">Edit</button>
                        {d.is_active ? (
                          <button onClick={() => handleDeactivate(d.id)} className="text-xs text-rose-500 hover:text-rose-700 font-medium">Deactivate</button>
                        ) : (
                          <button onClick={() => handleReactivate(d.id)} className="text-xs text-emerald-600 hover:text-emerald-800 font-medium">Reactivate</button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-brand-950/40 backdrop-blur-sm" onClick={() => setShowModal(false)} />
          <div className="relative w-full max-w-md bg-white rounded-2xl shadow-dropdown border border-brand-100/50 animate-slide-up">
            <div className="px-6 py-5 border-b border-brand-100/60">
              <h3 className="text-lg font-semibold text-brand-900">{editingId ? 'Edit Doctor' : 'Add Doctor'}</h3>
            </div>
            <div className="px-6 py-5 space-y-4">
              {error && <p className="text-sm text-rose-600 bg-rose-50 px-3 py-2 rounded-lg">{error}</p>}

              <div>
                <label className="block text-xs font-semibold text-brand-500 uppercase tracking-wide mb-1">Full Name *</label>
                <input value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-xl border border-brand-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400/50"
                  placeholder="Dr. Juan Dela Cruz" />
              </div>

              <div>
                <label className="block text-xs font-semibold text-brand-500 uppercase tracking-wide mb-1">Specialty</label>
                <input value={form.specialty} onChange={e => setForm({ ...form, specialty: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-xl border border-brand-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400/50"
                  placeholder="Dermatology, Aesthetics, etc." />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-brand-500 uppercase tracking-wide mb-1">Commission Type</label>
                  <select value={form.default_commission_type}
                    onChange={e => setForm({ ...form, default_commission_type: e.target.value as 'percent' | 'fixed' })}
                    className="w-full px-3 py-2.5 rounded-xl border border-brand-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400/50">
                    <option value="percent">Percentage (%)</option>
                    <option value="fixed">Fixed Amount (₱)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-brand-500 uppercase tracking-wide mb-1">
                    {form.default_commission_type === 'percent' ? 'Rate (%)' : 'Amount (₱)'}
                  </label>
                  <input type="number" step="any" value={form.default_commission_value}
                    onChange={e => setForm({ ...form, default_commission_value: e.target.value })}
                    className="w-full px-3 py-2.5 rounded-xl border border-brand-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400/50"
                    placeholder={form.default_commission_type === 'percent' ? '30' : '500'} />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-brand-500 uppercase tracking-wide mb-1">Notes</label>
                <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-xl border border-brand-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400/50 resize-none"
                  rows={2} placeholder="Optional notes" />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-brand-100/60 flex justify-end gap-3">
              <button onClick={() => setShowModal(false)}
                className="px-4 py-2 rounded-xl border border-brand-200 text-sm font-medium text-brand-600 hover:bg-brand-50 transition-colors">
                Cancel
              </button>
              <button onClick={handleSave} disabled={isSaving}
                className="px-4 py-2 rounded-xl bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
                {isSaving ? 'Saving…' : editingId ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
