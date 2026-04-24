'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/providers/auth-provider';
import { createClient } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { downloadCsv, toCsv, csvCurrency, csvDate, type CsvColumn } from '@/lib/export-csv';

// ─── Types ──────────────────────────────────────────────────

interface PatientPackage {
  id: string;
  branch_id: string;
  customer_id: string;
  service_id: string;
  total_price: number;
  downpayment: number;
  total_paid: number;
  remaining_balance: number;
  total_sessions: number;
  sessions_used: number;
  status: string;
  notes: string | null;
  created_at: string;
  customer_name: string;
  service_name: string;
  doctor_name: string | null;
}

interface PackageSession {
  id: string;
  sessions_count: number;
  notes: string | null;
  created_at: string;
  performer_name: string;
  doctor_name: string | null;
}

interface PackagePayment {
  id: string;
  amount: number;
  method: string;
  reference_number: string | null;
  notes: string | null;
  created_at: string;
  receiver_name: string;
}

interface Doctor {
  id: string;
  full_name: string;
}

// ─── Component ──────────────────────────────────────────────

export default function PackagesPage() {
  const { isOwner, isManager, selectedBranch, profile } = useAuth();
  const [packages, setPackages] = useState<PatientPackage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<'active' | 'completed' | 'all'>('active');

  // Detail view
  const [selectedPkg, setSelectedPkg] = useState<PatientPackage | null>(null);
  const [sessions, setSessions] = useState<PackageSession[]>([]);
  const [pkgPayments, setPkgPayments] = useState<PackagePayment[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Record Session Modal
  const [showSessionModal, setShowSessionModal] = useState(false);
  const [sessionForm, setSessionForm] = useState({ doctor_id: '', notes: '', sessions_count: '1' });
  const [sessionSubmitting, setSessionSubmitting] = useState(false);

  // Record Payment Modal
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentForm, setPaymentForm] = useState({ amount: '', method: 'cash', reference_number: '', notes: '' });
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);

  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [formError, setFormError] = useState('');

  const supabase = createClient();

  // ─── Fetch Packages ──────────────────────────────────────

  const fetchPackages = useCallback(async () => {
    setIsLoading(true);
    try {
      const branchId = selectedBranch?.id || profile?.branch_id;
      let url = '/api/packages?';
      if (filterStatus !== 'all') url += `status=${filterStatus}&`;
      if (!isOwner && branchId) url += `branch_id=${branchId}`;

      const res = await fetch(url);
      const result = await res.json();
      if (res.ok) {
        setPackages((result.data || []).map((p: Record<string, unknown>) => ({
          id: p.id as string,
          branch_id: p.branch_id as string,
          customer_id: p.customer_id as string,
          service_id: p.service_id as string,
          total_price: Number(p.total_price),
          downpayment: Number(p.downpayment),
          total_paid: Number(p.total_paid),
          remaining_balance: Number(p.remaining_balance),
          total_sessions: Number(p.total_sessions),
          sessions_used: Number(p.sessions_used),
          status: p.status as string,
          notes: p.notes as string | null,
          created_at: p.created_at as string,
          customer_name: p.customers
            ? `${(p.customers as Record<string, unknown>).first_name} ${(p.customers as Record<string, unknown>).last_name}`
            : 'Unknown',
          service_name: p.services
            ? (p.services as Record<string, unknown>).name as string
            : 'Unknown',
          doctor_name: p.doctors
            ? (p.doctors as Record<string, unknown>).full_name as string
            : null,
        })));
      }
    } catch (err) {
      console.error('Packages fetch error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [selectedBranch?.id, profile?.branch_id, isOwner, filterStatus]);

  useEffect(() => { fetchPackages(); }, [fetchPackages]);

  // Fetch doctors for session modal
  useEffect(() => {
    const branchId = selectedBranch?.id || profile?.branch_id;
    if (!branchId) return;
    const fetchDoctors = async () => {
      try {
        const res = await fetch(`/api/doctors?branch_id=${branchId}&active=true`);
        const json = await res.json();
        setDoctors((json.data || []) as Doctor[]);
      } catch { /* ignore */ }
    };
    fetchDoctors();
  }, [selectedBranch?.id, profile?.branch_id]);

  // ─── Package Detail ──────────────────────────────────────

  const openDetail = async (pkg: PatientPackage) => {
    setSelectedPkg(pkg);
    setLoadingDetail(true);
    try {
      const [sessRes, payRes] = await Promise.all([
        fetch(`/api/packages/${pkg.id}/sessions`),
        fetch(`/api/packages/${pkg.id}/payments`),
      ]);
      const sessData = await sessRes.json();
      const payData = await payRes.json();

      setSessions((sessData.data || []).map((s: Record<string, unknown>) => ({
        id: s.id as string,
        sessions_count: Number(s.sessions_count),
        notes: s.notes as string | null,
        created_at: s.created_at as string,
        performer_name: s.performer
          ? `${(s.performer as Record<string, unknown>).first_name} ${(s.performer as Record<string, unknown>).last_name}`
          : 'Unknown',
        doctor_name: s.doctor
          ? (s.doctor as Record<string, unknown>).full_name as string
          : null,
      })));

      setPkgPayments((payData.data || []).map((p: Record<string, unknown>) => ({
        id: p.id as string,
        amount: Number(p.amount),
        method: p.method as string,
        reference_number: p.reference_number as string | null,
        notes: p.notes as string | null,
        created_at: p.created_at as string,
        receiver_name: p.receiver
          ? `${(p.receiver as Record<string, unknown>).first_name} ${(p.receiver as Record<string, unknown>).last_name}`
          : 'Unknown',
      })));
    } catch (err) {
      console.error('Package detail error:', err);
    } finally {
      setLoadingDetail(false);
    }
  };

  // ─── Record Session ──────────────────────────────────────

  const handleRecordSession = async () => {
    if (!selectedPkg) return;
    setSessionSubmitting(true);
    setFormError('');
    try {
      const res = await fetch(`/api/packages/${selectedPkg.id}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessions_count: parseInt(sessionForm.sessions_count) || 1,
          doctor_id: sessionForm.doctor_id || null,
          notes: sessionForm.notes || null,
        }),
      });
      const result = await res.json();
      if (!res.ok) { setFormError(result.error); return; }
      setShowSessionModal(false);
      setSessionForm({ doctor_id: '', notes: '', sessions_count: '1' });
      await openDetail(selectedPkg);
      fetchPackages();
    } catch (err) {
      console.error('Record session error:', err);
      setFormError('An unexpected error occurred');
    } finally {
      setSessionSubmitting(false);
    }
  };

  // ─── Record Payment ──────────────────────────────────────

  const handleRecordPayment = async () => {
    if (!selectedPkg) return;
    setPaymentSubmitting(true);
    setFormError('');
    try {
      const amount = parseFloat(paymentForm.amount);
      if (isNaN(amount) || amount <= 0) { setFormError('Enter a valid amount'); return; }

      const res = await fetch(`/api/packages/${selectedPkg.id}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount,
          method: paymentForm.method,
          reference_number: paymentForm.reference_number || null,
          notes: paymentForm.notes || null,
        }),
      });
      const result = await res.json();
      if (!res.ok) { setFormError(result.error); return; }
      setShowPaymentModal(false);
      setPaymentForm({ amount: '', method: 'cash', reference_number: '', notes: '' });
      await openDetail(selectedPkg);
      fetchPackages();
    } catch (err) {
      console.error('Record payment error:', err);
      setFormError('An unexpected error occurred');
    } finally {
      setPaymentSubmitting(false);
    }
  };

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(n);

  const formatDate = (d: string) =>
    new Date(d).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const canManage = isOwner || isManager;

  // ─── Stats ────────────────────────────────────────────────

  const activePackages = packages.filter(p => p.status === 'active');
  const totalAR = activePackages.reduce((sum, p) => sum + p.remaining_balance, 0);
  const totalPaidThisMonth = packages
    .filter(p => new Date(p.created_at).getMonth() === new Date().getMonth())
    .reduce((sum, p) => sum + p.total_paid, 0);

  // ─── Render ───────────────────────────────────────────────

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-semibold text-brand-900">Patient Packages</h1>
          <p className="text-sm text-brand-500 mt-1">
            Manage session packages, track sessions used, and process installment payments
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Status filter */}
          <div className="flex rounded-xl border border-brand-200 overflow-hidden bg-white">
            {(['active', 'completed', 'all'] as const).map(s => (
              <button key={s} onClick={() => setFilterStatus(s)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  filterStatus === s ? 'bg-brand-600 text-white' : 'text-brand-500 hover:bg-brand-50'
                }`}>
                {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
          {/* Export CSV */}
          <button
            onClick={() => {
              const columns: CsvColumn<PatientPackage>[] = [
                { header: 'Client', accessor: r => r.customer_name },
                { header: 'Service', accessor: r => r.service_name },
                { header: 'Status', accessor: r => r.status },
                { header: 'Total Price', accessor: r => csvCurrency(r.total_price) },
                { header: 'Paid', accessor: r => csvCurrency(r.total_paid) },
                { header: 'Balance', accessor: r => csvCurrency(r.remaining_balance) },
                { header: 'Sessions Used', accessor: r => `${r.sessions_used}/${r.total_sessions}` },
                { header: 'Created', accessor: r => csvDate(r.created_at) },
              ];
              downloadCsv(toCsv(packages, columns), `packages-${filterStatus}-${new Date().toISOString().split('T')[0]}.csv`);
            }}
            disabled={packages.length === 0}
            className="px-3 py-1.5 rounded-xl border border-brand-200 bg-white text-xs font-medium text-brand-600 hover:bg-brand-50
                       disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            📥 Export CSV
          </button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Active Packages', value: activePackages.length, color: 'text-brand-900' },
          { label: 'Outstanding A/R', value: formatCurrency(totalAR), color: 'text-rose-600' },
          { label: 'Collected This Month', value: formatCurrency(totalPaidThisMonth), color: 'text-emerald-600' },
          { label: 'Total Packages', value: packages.length, color: 'text-brand-700' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-2xl border border-brand-100/50 shadow-card px-5 py-4">
            <p className="text-xs font-medium text-brand-400 uppercase tracking-wide">{label}</p>
            <p className={`text-2xl font-semibold mt-1 ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Packages table */}
      <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-brand-100/60 bg-surface-50">
                <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Patient</th>
                <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Service</th>
                <th className="text-center text-xs font-medium text-brand-400 px-5 py-3">Sessions</th>
                <th className="text-right text-xs font-medium text-brand-400 px-5 py-3">Total</th>
                <th className="text-right text-xs font-medium text-brand-400 px-5 py-3">Balance</th>
                <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Status</th>
                <th className="text-right text-xs font-medium text-brand-400 px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-brand-100/30">
                    <td className="px-5 py-4"><Skeleton className="h-4 w-32" /></td>
                    <td className="px-5 py-4"><Skeleton className="h-4 w-28" /></td>
                    <td className="px-5 py-4 text-center"><Skeleton className="h-4 w-16 mx-auto" /></td>
                    <td className="px-5 py-4 text-right"><Skeleton className="h-4 w-20 ml-auto" /></td>
                    <td className="px-5 py-4 text-right"><Skeleton className="h-4 w-20 ml-auto" /></td>
                    <td className="px-5 py-4"><Skeleton className="h-5 w-16 rounded-full" /></td>
                    <td className="px-5 py-4"><Skeleton className="h-4 w-16 ml-auto" /></td>
                  </tr>
                ))
              ) : packages.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-16 text-sm text-brand-400">
                    <svg className="w-12 h-12 text-brand-200 mx-auto mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0l-3-3m3 3l3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
                    </svg>
                    No packages found
                  </td>
                </tr>
              ) : (
                packages.map(pkg => {
                  const progressPct = pkg.total_sessions > 0 ? (pkg.sessions_used / pkg.total_sessions) * 100 : 0;
                  return (
                    <tr key={pkg.id} className="border-b border-brand-100/30 hover:bg-brand-50/30 transition-colors">
                      <td className="px-5 py-4">
                        <p className="text-sm font-medium text-brand-800">{pkg.customer_name}</p>
                        {pkg.doctor_name && <p className="text-xs text-brand-400">Dr. {pkg.doctor_name}</p>}
                      </td>
                      <td className="px-5 py-4">
                        <p className="text-sm text-brand-700">{pkg.service_name}</p>
                      </td>
                      <td className="px-5 py-4 text-center">
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-sm font-semibold text-brand-800">
                            {pkg.sessions_used}/{pkg.total_sessions}
                          </span>
                          <div className="w-16 bg-brand-50 rounded-full h-1.5">
                            <div className="bg-brand-500 h-1.5 rounded-full transition-all duration-500"
                              style={{ width: `${progressPct}%` }} />
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <span className="text-sm font-semibold text-brand-800">{formatCurrency(pkg.total_price)}</span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <span className={`text-sm font-semibold ${pkg.remaining_balance > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                          {pkg.remaining_balance > 0 ? formatCurrency(pkg.remaining_balance) : 'Paid'}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <Badge variant={
                          pkg.status === 'active' ? 'success' :
                          pkg.status === 'completed' ? 'brand' :
                          pkg.status === 'cancelled' ? 'danger' : 'default'
                        } size="sm">
                          {pkg.status}
                        </Badge>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <button onClick={() => openDetail(pkg)}
                          className="text-xs font-medium text-brand-500 hover:text-brand-700 px-2 py-1 rounded-lg hover:bg-brand-50 transition-colors">
                          View →
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {!isLoading && packages.length > 0 && (
          <div className="px-5 py-3 border-t border-brand-100/40 text-xs text-brand-400">
            Showing {packages.length} packages
          </div>
        )}
      </div>

      {/* ═══ Package Detail Modal ══════════════════════════════ */}
      <Modal
        isOpen={!!selectedPkg}
        onClose={() => { setSelectedPkg(null); setSessions([]); setPkgPayments([]); }}
        title={selectedPkg ? `${selectedPkg.service_name}` : 'Package Details'}
        subtitle={selectedPkg ? `${selectedPkg.customer_name}` : ''}
        size="lg"
      >
        {selectedPkg && (
          <div className="space-y-5">
            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-surface-50 rounded-xl p-3 text-center">
                <p className="text-xs text-brand-400">Sessions</p>
                <p className="text-lg font-semibold text-brand-800">{selectedPkg.sessions_used}/{selectedPkg.total_sessions}</p>
              </div>
              <div className="bg-surface-50 rounded-xl p-3 text-center">
                <p className="text-xs text-brand-400">Total</p>
                <p className="text-lg font-semibold text-brand-800">{formatCurrency(selectedPkg.total_price)}</p>
              </div>
              <div className="bg-surface-50 rounded-xl p-3 text-center">
                <p className="text-xs text-brand-400">Paid</p>
                <p className="text-lg font-semibold text-emerald-600">{formatCurrency(selectedPkg.total_paid)}</p>
              </div>
              <div className="bg-surface-50 rounded-xl p-3 text-center">
                <p className="text-xs text-brand-400">Balance</p>
                <p className={`text-lg font-semibold ${selectedPkg.remaining_balance > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                  {selectedPkg.remaining_balance > 0 ? formatCurrency(selectedPkg.remaining_balance) : 'Paid'}
                </p>
              </div>
            </div>

            {/* Action buttons */}
            {selectedPkg.status === 'active' && (
              <div className="flex gap-3">
                <button
                  onClick={() => { setShowSessionModal(true); setFormError(''); }}
                  disabled={selectedPkg.sessions_used >= selectedPkg.total_sessions}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-brand-600 to-brand-700 text-white text-sm font-medium
                             hover:from-brand-700 hover:to-brand-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
                >
                  📋 Record Session
                </button>
                <button
                  onClick={() => { setShowPaymentModal(true); setFormError(''); }}
                  disabled={selectedPkg.remaining_balance <= 0}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 text-white text-sm font-medium
                             hover:from-emerald-700 hover:to-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
                >
                  💳 Record Payment
                </button>
              </div>
            )}

            {/* Session History */}
            <div>
              <h3 className="text-sm font-semibold text-brand-800 mb-2">Session History</h3>
              {loadingDetail ? (
                <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}</div>
              ) : sessions.length === 0 ? (
                <p className="text-sm text-brand-400 py-4 text-center bg-surface-50 rounded-xl">No sessions recorded yet</p>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {sessions.map((s, i) => (
                    <div key={s.id} className="flex items-center justify-between bg-surface-50 rounded-xl px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-brand-800">Session #{sessions.length - i}</p>
                        <p className="text-xs text-brand-400">{formatDate(s.created_at)} · by {s.performer_name}</p>
                        {s.doctor_name && <p className="text-xs text-brand-500">Dr. {s.doctor_name}</p>}
                        {s.notes && <p className="text-xs text-brand-400 italic mt-0.5">{s.notes}</p>}
                      </div>
                      <Badge variant="brand" size="sm">×{s.sessions_count}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Payment History */}
            <div>
              <h3 className="text-sm font-semibold text-brand-800 mb-2">Payment History</h3>
              {loadingDetail ? (
                <div className="space-y-2">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}</div>
              ) : pkgPayments.length === 0 ? (
                <p className="text-sm text-brand-400 py-4 text-center bg-surface-50 rounded-xl">No payments recorded yet</p>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {pkgPayments.map(p => (
                    <div key={p.id} className="flex items-center justify-between bg-surface-50 rounded-xl px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-brand-800">{formatCurrency(p.amount)}</p>
                        <p className="text-xs text-brand-400">{formatDate(p.created_at)} · {p.method} · by {p.receiver_name}</p>
                        {p.reference_number && <p className="text-xs text-brand-500">Ref: {p.reference_number}</p>}
                        {p.notes && <p className="text-xs text-brand-400 italic">{p.notes}</p>}
                      </div>
                      <Badge variant="success" size="sm">Paid</Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* ═══ Record Session Modal ════════════════════════════ */}
      <Modal
        isOpen={showSessionModal}
        onClose={() => setShowSessionModal(false)}
        title="Record Session"
        subtitle={selectedPkg ? `${selectedPkg.service_name} — ${selectedPkg.sessions_used + 1}/${selectedPkg.total_sessions}` : ''}
        size="sm"
      >
        <div className="space-y-4">
          {formError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{formError}</div>
          )}

          <div>
            <label className="block text-sm font-medium text-brand-800 mb-1.5">Attending Doctor <span className="text-brand-300 font-normal">(optional)</span></label>
            <select value={sessionForm.doctor_id} onChange={e => setSessionForm({ ...sessionForm, doctor_id: e.target.value })}
              className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900
                         focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all">
              <option value="">No doctor</option>
              {doctors.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-brand-800 mb-1.5">Sessions to Deduct</label>
            <input type="number" value={sessionForm.sessions_count} min="1"
              max={selectedPkg ? selectedPkg.total_sessions - selectedPkg.sessions_used : 1}
              onChange={e => setSessionForm({ ...sessionForm, sessions_count: e.target.value })}
              className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900
                         focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all" />
            {selectedPkg && (
              <p className="text-[10px] text-brand-400 mt-1">
                Remaining: {selectedPkg.total_sessions - selectedPkg.sessions_used} of {selectedPkg.total_sessions} sessions
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-brand-800 mb-1.5">Notes <span className="text-brand-300 font-normal">(optional)</span></label>
            <textarea value={sessionForm.notes} onChange={e => setSessionForm({ ...sessionForm, notes: e.target.value })}
              rows={2} placeholder="Session notes..."
              className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900 placeholder:text-brand-300
                         focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all resize-none" />
          </div>

          <div className="flex gap-3 pt-2">
            <button onClick={handleRecordSession} disabled={sessionSubmitting}
              className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-brand-600 to-brand-700 text-white font-medium text-sm
                         hover:from-brand-700 hover:to-brand-800 disabled:opacity-60 disabled:cursor-not-allowed transition-all shadow-sm">
              {sessionSubmitting ? 'Recording...' : 'Record Session'}
            </button>
            <button onClick={() => setShowSessionModal(false)}
              className="px-4 py-2.5 rounded-xl border border-brand-200 text-brand-600 text-sm font-medium hover:bg-brand-50 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      </Modal>

      {/* ═══ Record Payment Modal ════════════════════════════ */}
      <Modal
        isOpen={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        title="Record Installment Payment"
        subtitle={selectedPkg ? `Balance: ${formatCurrency(selectedPkg.remaining_balance)}` : ''}
        size="sm"
      >
        <div className="space-y-4">
          {formError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{formError}</div>
          )}

          <div>
            <label className="block text-sm font-medium text-brand-800 mb-1.5">Amount (PHP)</label>
            <input type="number" value={paymentForm.amount} min="1" step="0.01"
              onChange={e => setPaymentForm({ ...paymentForm, amount: e.target.value })}
              placeholder={selectedPkg ? `Max: ${selectedPkg.remaining_balance.toFixed(2)}` : '0.00'}
              className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900 placeholder:text-brand-300
                         focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all" />
          </div>

          <div>
            <label className="block text-sm font-medium text-brand-800 mb-1.5">Payment Method</label>
            <select value={paymentForm.method} onChange={e => setPaymentForm({ ...paymentForm, method: e.target.value })}
              className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900
                         focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all">
              <option value="cash">Cash</option>
              <option value="gcash">GCash</option>
              <option value="card">Card</option>
              <option value="bank_transfer">Bank Transfer</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-brand-800 mb-1.5">Reference # <span className="text-brand-300 font-normal">(optional)</span></label>
            <input type="text" value={paymentForm.reference_number}
              onChange={e => setPaymentForm({ ...paymentForm, reference_number: e.target.value })}
              placeholder="e.g. GCash ref #"
              className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900 placeholder:text-brand-300
                         focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all" />
          </div>

          <div className="flex gap-3 pt-2">
            <button onClick={handleRecordPayment} disabled={paymentSubmitting}
              className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 text-white font-medium text-sm
                         hover:from-emerald-700 hover:to-emerald-800 disabled:opacity-60 disabled:cursor-not-allowed transition-all shadow-sm">
              {paymentSubmitting ? 'Processing...' : 'Record Payment'}
            </button>
            <button onClick={() => setShowPaymentModal(false)}
              className="px-4 py-2.5 rounded-xl border border-brand-200 text-brand-600 text-sm font-medium hover:bg-brand-50 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
