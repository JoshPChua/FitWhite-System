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
  is_voided: boolean;
  void_reason: string | null;
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

  // Record Visit Modal (combined session + optional payment)
  const [showVisitModal, setShowVisitModal] = useState(false);
  const [visitMode, setVisitMode] = useState<'session_only' | 'session_payment'>('session_only');
  const [visitForm, setVisitForm] = useState({
    doctor_id: '', notes: '', sessions_count: '1',
    payment_amount: '', payment_method: 'cash', reference_number: '',
  });
  const [visitSubmitting, setVisitSubmitting] = useState(false);

  // Complete Package Modal
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [completeNotes, setCompleteNotes] = useState('');
  const [completeSubmitting, setCompleteSubmitting] = useState(false);

  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [formError, setFormError] = useState('');

  // Correction state
  const [voidingSessionId, setVoidingSessionId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidSubmitting, setVoidSubmitting] = useState(false);
  const [showAdjustTotal, setShowAdjustTotal] = useState(false);
  const [adjustTotalValue, setAdjustTotalValue] = useState('');
  const [adjustTotalReason, setAdjustTotalReason] = useState('');
  const [adjustSubmitting, setAdjustSubmitting] = useState(false);

  const supabase = createClient();

  // ─── Fetch Packages ──────────────────────────────────────

  const mapPackage = (p: Record<string, unknown>): PatientPackage => ({
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
  });

  const fetchPackages = useCallback(async (): Promise<PatientPackage[]> => {
    setIsLoading(true);
    try {
      const branchId = selectedBranch?.id || profile?.branch_id;
      let url = '/api/packages?';
      if (filterStatus !== 'all') url += `status=${filterStatus}&`;
      if (!isOwner && branchId) url += `branch_id=${branchId}`;

      const res = await fetch(url);
      const result = await res.json();
      if (res.ok) {
        const mapped = (result.data || []).map(mapPackage);
        setPackages(mapped);
        return mapped;
      }
    } catch (err) {
      console.error('Packages fetch error:', err);
    } finally {
      setIsLoading(false);
    }
    return [];
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
        is_voided: s.is_voided as boolean || false,
        void_reason: s.void_reason as string | null || null,
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

  /**
   * After a session/payment write, re-fetch the packages list to get the
   * DB-updated totals (sessions_used, total_paid, remaining_balance, status),
   * then update selectedPkg so the detail modal's summary cards refresh
   * immediately without the user needing to close and reopen the modal.
   */
  const refreshDetailAfterWrite = async (pkgId: string) => {
    const freshPackages = await fetchPackages();
    const updated = freshPackages.find(p => p.id === pkgId);
    if (updated) {
      setSelectedPkg(updated);
      await openDetail(updated);
    }
  };

  // ─── Record Visit (combined session + payment) ────────────

  const handleRecordVisit = async () => {
    if (!selectedPkg) return;
    setVisitSubmitting(true);
    setFormError('');
    try {
      const paymentAmount = visitMode === 'session_payment' ? (parseFloat(visitForm.payment_amount) || 0) : 0;

      const res = await fetch(`/api/packages/${selectedPkg.id}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessions_count: parseInt(visitForm.sessions_count) || 1,
          doctor_id: visitForm.doctor_id || null,
          notes: visitForm.notes || null,
          payment_amount: paymentAmount,
          payment_method: visitForm.payment_method,
          reference_number: visitForm.reference_number || null,
        }),
      });
      const result = await res.json();
      if (!res.ok) { setFormError(result.error); return; }
      setShowVisitModal(false);
      setVisitMode('session_only');
      setVisitForm({ doctor_id: '', notes: '', sessions_count: '1', payment_amount: '', payment_method: 'cash', reference_number: '' });
      await refreshDetailAfterWrite(selectedPkg.id);
    } catch (err) {
      console.error('Record visit error:', err);
      setFormError('An unexpected error occurred');
    } finally {
      setVisitSubmitting(false);
    }
  };

  // ─── Complete Package Early ────────────────────────────

  const handleCompletePackage = async () => {
    if (!selectedPkg) return;
    setCompleteSubmitting(true);
    setFormError('');
    try {
      const res = await fetch(`/api/packages/${selectedPkg.id}/complete`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: completeNotes || null }),
      });
      const result = await res.json();
      if (!res.ok) { setFormError(result.error); return; }
      setShowCompleteModal(false);
      setCompleteNotes('');
      await refreshDetailAfterWrite(selectedPkg.id);
    } catch (err) {
      console.error('Complete package error:', err);
      setFormError('An unexpected error occurred');
    } finally {
      setCompleteSubmitting(false);
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
                  onClick={() => { setShowVisitModal(true); setFormError(''); setVisitMode('session_only'); setVisitForm(f => ({ ...f, payment_amount: '' })); }}
                  disabled={selectedPkg.sessions_used >= selectedPkg.total_sessions}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-brand-600 to-brand-700 text-white text-sm font-medium
                             hover:from-brand-700 hover:to-brand-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
                >
                  📋 Record Visit
                </button>
                <button
                  onClick={() => { setShowCompleteModal(true); setFormError(''); }}
                  className="py-2.5 px-4 rounded-xl border border-brand-300 text-brand-600 text-sm font-medium
                             hover:bg-brand-50 transition-all"
                >
                  ✅ Complete
                </button>
              </div>
            )}

            {/* Session History */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-brand-800">Session History</h3>
                {canManage && selectedPkg?.status === 'active' && (
                  <button
                    onClick={() => {
                      setShowAdjustTotal(true);
                      setAdjustTotalValue(String(selectedPkg?.total_sessions || ''));
                      setAdjustTotalReason('');
                    }}
                    className="text-xs text-brand-500 hover:text-brand-700 font-medium transition-colors"
                  >
                    ✏️ Edit Total
                  </button>
                )}
              </div>

              {/* Adjust Total Sessions inline form */}
              {showAdjustTotal && selectedPkg && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-2 space-y-2">
                  <p className="text-xs font-semibold text-amber-800">Adjust Total Sessions</p>
                  <input
                    type="number" min={1} value={adjustTotalValue}
                    onChange={e => setAdjustTotalValue(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-amber-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                    placeholder="New total sessions"
                  />
                  <input
                    type="text" value={adjustTotalReason}
                    onChange={e => setAdjustTotalReason(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-amber-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                    placeholder="Reason for adjustment (required)"
                  />
                  <div className="flex gap-2">
                    <button
                      disabled={adjustSubmitting || !adjustTotalReason.trim()}
                      onClick={async () => {
                        setAdjustSubmitting(true);
                        try {
                          const res = await fetch(`/api/packages/${selectedPkg.id}/correct`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              action: 'adjust_total',
                              new_total: parseInt(adjustTotalValue, 10),
                              reason: adjustTotalReason.trim(),
                            }),
                          });
                          const result = await res.json();
                          if (!res.ok) { setFormError(result.error || 'Adjustment failed'); return; }
                          setShowAdjustTotal(false);
                          await refreshDetailAfterWrite(selectedPkg!.id);
                        } catch { setFormError('Network error'); } finally { setAdjustSubmitting(false); }
                      }}
                      className="flex-1 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-medium hover:bg-amber-700 transition-colors disabled:opacity-50"
                    >
                      {adjustSubmitting ? 'Saving...' : 'Save'}
                    </button>
                    <button onClick={() => setShowAdjustTotal(false)} className="px-3 py-1.5 rounded-lg border border-amber-300 text-amber-700 text-xs font-medium hover:bg-amber-100 transition-colors">
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {loadingDetail ? (
                <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}</div>
              ) : sessions.length === 0 ? (
                <p className="text-sm text-brand-400 py-4 text-center bg-surface-50 rounded-xl">No sessions recorded yet</p>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {sessions.map((s, i) => (
                    <div key={s.id} className={`flex items-center justify-between rounded-xl px-4 py-3 ${
                      s.is_voided ? 'bg-rose-50/50 opacity-60' : 'bg-surface-50'
                    }`}>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${s.is_voided ? 'text-rose-400 line-through' : 'text-brand-800'}`}>
                          Session #{sessions.length - i}
                          {s.is_voided && <span className="text-xs text-rose-500 ml-1 no-underline">(Voided)</span>}
                        </p>
                        <p className="text-xs text-brand-400">{formatDate(s.created_at)} · by {s.performer_name}</p>
                        {s.doctor_name && <p className="text-xs text-brand-500">Dr. {s.doctor_name}</p>}
                        {s.notes && <p className="text-xs text-brand-400 italic mt-0.5">{s.notes}</p>}
                        {s.is_voided && s.void_reason && <p className="text-xs text-rose-500 mt-0.5">Reason: {s.void_reason}</p>}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Badge variant={s.is_voided ? 'danger' : 'brand'} size="sm">×{s.sessions_count}</Badge>
                        {canManage && !s.is_voided && (
                          voidingSessionId === s.id ? (
                            <div className="flex flex-col gap-1 ml-2">
                              <input
                                type="text" value={voidReason} onChange={e => setVoidReason(e.target.value)}
                                placeholder="Reason..." autoFocus
                                className="w-28 px-2 py-1 rounded border border-rose-300 text-xs focus:outline-none focus:ring-1 focus:ring-rose-400"
                              />
                              <div className="flex gap-1">
                                <button
                                  disabled={voidSubmitting || !voidReason.trim()}
                                  onClick={async () => {
                                    setVoidSubmitting(true);
                                    try {
                                      const res = await fetch(`/api/packages/${selectedPkg?.id}/correct`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ action: 'void_session', session_id: s.id, reason: voidReason.trim() }),
                                      });
                                      const result = await res.json();
                                      if (!res.ok) { setFormError(result.error || 'Void failed'); return; }
                                      setVoidingSessionId(null);
                                      setVoidReason('');
                                      await refreshDetailAfterWrite(selectedPkg!.id);
                                    } catch { setFormError('Network error'); } finally { setVoidSubmitting(false); }
                                  }}
                                  className="px-2 py-0.5 rounded bg-rose-600 text-white text-[10px] font-medium disabled:opacity-50"
                                >
                                  {voidSubmitting ? '...' : 'Void'}
                                </button>
                                <button onClick={() => { setVoidingSessionId(null); setVoidReason(''); }} className="px-2 py-0.5 rounded border border-brand-200 text-brand-500 text-[10px]">
                                  ✕
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              onClick={() => { setVoidingSessionId(s.id); setVoidReason(''); }}
                              className="text-xs text-rose-400 hover:text-rose-600 font-medium transition-colors"
                              title="Void this session"
                            >
                              Void
                            </button>
                          )
                        )}
                      </div>
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

      {/* ═══ Record Visit Modal (Combined Session + Optional Payment) ═══ */}
      <Modal
        isOpen={showVisitModal}
        onClose={() => setShowVisitModal(false)}
        title="Record Visit"
        subtitle={selectedPkg ? `${selectedPkg.service_name} — Session ${selectedPkg.sessions_used + 1} of ${selectedPkg.total_sessions}` : ''}
        size="sm"
      >
        <div className="space-y-4">
          {formError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{formError}</div>
          )}

          {/* Session info banner */}
          {selectedPkg && (
            <div className="bg-brand-50 border border-brand-200 rounded-xl p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-brand-600 font-medium">Sessions remaining</span>
                <span className="text-brand-800 font-semibold">{selectedPkg.total_sessions - selectedPkg.sessions_used} of {selectedPkg.total_sessions}</span>
              </div>
              {selectedPkg.remaining_balance > 0 && (
                <div className="flex items-center justify-between text-sm mt-1">
                  <span className="text-rose-500 font-medium">Outstanding balance</span>
                  <span className="text-rose-600 font-semibold">{formatCurrency(selectedPkg.remaining_balance)}</span>
                </div>
              )}
            </div>
          )}

          {/* Doctor */}
          <div>
            <label className="block text-sm font-medium text-brand-800 mb-1.5">Attending Doctor <span className="text-brand-300 font-normal">(optional)</span></label>
            <select value={visitForm.doctor_id} onChange={e => setVisitForm({ ...visitForm, doctor_id: e.target.value })}
              className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900
                         focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all">
              <option value="">No doctor</option>
              {doctors.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
            </select>
          </div>

          {/* Sessions to deduct */}
          <div>
            <label className="block text-sm font-medium text-brand-800 mb-1.5">Sessions to Deduct</label>
            <input type="number" value={visitForm.sessions_count} min="1"
              max={selectedPkg ? selectedPkg.total_sessions - selectedPkg.sessions_used : 1}
              onChange={e => setVisitForm({ ...visitForm, sessions_count: e.target.value })}
              className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900
                         focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all" />
          </div>

          {/* Payment toggle — only show if there's a remaining balance */}
          {selectedPkg && selectedPkg.remaining_balance > 0 && (
            <>
              {/* Toggle: session-only vs session+payment */}
              <div className="flex rounded-xl border border-brand-200 overflow-hidden bg-white">
                <button type="button"
                  onClick={() => setVisitMode('session_only')}
                  className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                    visitMode === 'session_only'
                      ? 'bg-brand-600 text-white' : 'text-brand-500 hover:bg-brand-50'
                  }`}>
                  Session Only (no payment)
                </button>
                <button type="button"
                  onClick={() => setVisitMode('session_payment')}
                  className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                    visitMode === 'session_payment'
                      ? 'bg-emerald-600 text-white' : 'text-brand-500 hover:bg-brand-50'
                  }`}>
                  Session + Payment
                </button>
              </div>

              {/* Payment fields (shown when payment is selected) */}
              {visitMode === 'session_payment' ? (
                <div className="space-y-3 bg-emerald-50/50 border border-emerald-100 rounded-xl p-3">
                  <div>
                    <label className="block text-xs font-medium text-brand-700 mb-1">Payment Amount (₱)</label>
                    <input type="number" value={visitForm.payment_amount} min="1" step="0.01"
                      onChange={e => setVisitForm({ ...visitForm, payment_amount: e.target.value })}
                      placeholder={`Max: ${selectedPkg.remaining_balance.toFixed(2)}`}
                      className="w-full px-4 py-2 rounded-xl border border-brand-200 bg-white text-brand-900 placeholder:text-brand-300 text-sm
                                 focus:outline-none focus:ring-2 focus:ring-emerald-400/50 transition-all" />
                    {parseFloat(visitForm.payment_amount) > 0 && (
                      <p className="text-[10px] text-emerald-600 mt-1 font-medium">
                        After this payment: {formatCurrency(Math.max(0, selectedPkg.remaining_balance - parseFloat(visitForm.payment_amount)))} remaining
                      </p>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-medium text-brand-700 mb-1">Method</label>
                      <select value={visitForm.payment_method} onChange={e => setVisitForm({ ...visitForm, payment_method: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border border-brand-200 bg-white text-brand-900 text-sm
                                   focus:outline-none focus:ring-2 focus:ring-emerald-400/50 transition-all">
                        <option value="cash">Cash</option>
                        <option value="gcash">GCash</option>
                        <option value="card">Card</option>
                        <option value="bank_transfer">Bank Transfer</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-brand-700 mb-1">Reference #</label>
                      <input type="text" value={visitForm.reference_number}
                        onChange={e => setVisitForm({ ...visitForm, reference_number: e.target.value })}
                        placeholder="Optional"
                        className="w-full px-3 py-2 rounded-xl border border-brand-200 bg-white text-brand-900 placeholder:text-brand-300 text-sm
                                   focus:outline-none focus:ring-2 focus:ring-emerald-400/50 transition-all" />
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-brand-400 bg-surface-50 rounded-xl px-4 py-3 text-center">
                  💡 No payment will be collected for this visit. Select &ldquo;Session + Payment&rdquo; above to include an installment.
                </p>
              )}
            </>
          )}

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-brand-800 mb-1.5">Notes <span className="text-brand-300 font-normal">(optional)</span></label>
            <textarea value={visitForm.notes} onChange={e => setVisitForm({ ...visitForm, notes: e.target.value })}
              rows={2} placeholder="Visit notes..."
              className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900 placeholder:text-brand-300
                         focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all resize-none" />
          </div>

          <div className="flex gap-3 pt-2">
            <button onClick={handleRecordVisit} disabled={visitSubmitting}
              className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-brand-600 to-brand-700 text-white font-medium text-sm
                         hover:from-brand-700 hover:to-brand-800 disabled:opacity-60 disabled:cursor-not-allowed transition-all shadow-sm">
              {visitSubmitting ? 'Recording...' : (visitMode === 'session_payment' && parseFloat(visitForm.payment_amount) > 0 ? '📋 Record Visit + Payment' : '📋 Record Visit')}
            </button>
            <button onClick={() => setShowVisitModal(false)}
              className="px-4 py-2.5 rounded-xl border border-brand-200 text-brand-600 text-sm font-medium hover:bg-brand-50 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      </Modal>


      <Modal
        isOpen={showCompleteModal}
        onClose={() => setShowCompleteModal(false)}
        title="Complete Package Early"
        subtitle={selectedPkg ? `${selectedPkg.service_name} — ${selectedPkg.sessions_used}/${selectedPkg.total_sessions} sessions used` : ''}
        size="sm"
      >
        <div className="space-y-4">
          {formError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{formError}</div>
          )}

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <p className="text-sm text-amber-800 font-medium">⚠️ This will mark the package as completed.</p>
            <p className="text-xs text-amber-600 mt-1">Remaining unused sessions will not be available. This action cannot be undone.</p>
            {selectedPkg && selectedPkg.remaining_balance > 0 && (
              <p className="text-xs text-rose-600 mt-2 font-medium">Note: Outstanding balance of {formatCurrency(selectedPkg.remaining_balance)} will remain.</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-brand-800 mb-1.5">Reason <span className="text-brand-300 font-normal">(optional)</span></label>
            <textarea value={completeNotes} onChange={e => setCompleteNotes(e.target.value)}
              rows={2} placeholder="e.g. Customer satisfied, no more sessions needed"
              className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900 placeholder:text-brand-300
                         focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all resize-none" />
          </div>

          <div className="flex gap-3 pt-2">
            <button onClick={handleCompletePackage} disabled={completeSubmitting}
              className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-brand-600 to-brand-700 text-white font-medium text-sm
                         hover:from-brand-700 hover:to-brand-800 disabled:opacity-60 disabled:cursor-not-allowed transition-all shadow-sm">
              {completeSubmitting ? 'Completing...' : 'Complete Package'}
            </button>
            <button onClick={() => setShowCompleteModal(false)}
              className="px-4 py-2.5 rounded-xl border border-brand-200 text-brand-600 text-sm font-medium hover:bg-brand-50 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
