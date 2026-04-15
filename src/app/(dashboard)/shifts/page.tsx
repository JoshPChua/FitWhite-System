'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/providers/auth-provider';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';

// ─── Types ──────────────────────────────────────────────────

interface Shift {
  id: string;
  branch_id: string;
  status: string;
  opening_cash: number;
  closing_cash: number | null;
  expected_cash: number | null;
  opened_at: string;
  closed_at: string | null;
  notes: string | null;
  opener_name: string;
  closer_name: string | null;
}

interface CashMovement {
  id: string;
  movement_type: string;
  amount: number;
  description: string;
  reference: string | null;
  created_at: string;
  performer_name: string;
}

// ─── Component ──────────────────────────────────────────────

export default function ShiftsPage() {
  const { isOwner, isManager, selectedBranch, profile } = useAuth();
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Open shift modal
  const [showOpenModal, setShowOpenModal] = useState(false);
  const [openingCash, setOpeningCash] = useState('');
  const [openSubmitting, setOpenSubmitting] = useState(false);

  // Close shift modal
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closingCash, setClosingCash] = useState('');
  const [closeNotes, setCloseNotes] = useState('');
  const [closeSubmitting, setCloseSubmitting] = useState(false);

  // Cash movement modal
  const [showCashModal, setShowCashModal] = useState(false);
  const [cashForm, setCashForm] = useState({ movement_type: 'petty_cash_out', amount: '', description: '', reference: '' });
  const [cashSubmitting, setCashSubmitting] = useState(false);

  // Cash movements list
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [loadingMovements, setLoadingMovements] = useState(false);

  const [formError, setFormError] = useState('');

  const branchId = selectedBranch?.id || profile?.branch_id || '';
  const canManage = isOwner || isManager;

  // ─── Fetch Shifts ─────────────────────────────────────────

  const fetchShifts = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/shifts?branch_id=${branchId}`);
      const result = await res.json();
      if (res.ok) {
        setShifts((result.data || []).map((s: Record<string, unknown>) => ({
          id: s.id as string,
          branch_id: s.branch_id as string,
          status: s.status as string,
          opening_cash: Number(s.opening_cash),
          closing_cash: s.closing_cash != null ? Number(s.closing_cash) : null,
          expected_cash: s.expected_cash != null ? Number(s.expected_cash) : null,
          opened_at: s.opened_at as string,
          closed_at: s.closed_at as string | null,
          notes: s.notes as string | null,
          opener_name: s.opener
            ? `${(s.opener as Record<string, unknown>).first_name} ${(s.opener as Record<string, unknown>).last_name}`
            : 'Unknown',
          closer_name: s.closer
            ? `${(s.closer as Record<string, unknown>).first_name} ${(s.closer as Record<string, unknown>).last_name}`
            : null,
        })));
      }
    } catch (err) {
      console.error('Shifts fetch error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [branchId]);

  useEffect(() => { if (branchId) fetchShifts(); }, [fetchShifts, branchId]);

  const openShift = shifts.find(s => s.status === 'open');
  const closedShifts = shifts.filter(s => s.status === 'closed');

  // Fetch movements for current shift
  useEffect(() => {
    if (!openShift) { setMovements([]); return; }
    setLoadingMovements(true);
    fetch(`/api/cash-movements?shift_id=${openShift.id}`)
      .then(r => r.json())
      .then(result => {
        setMovements((result.data || []).map((m: Record<string, unknown>) => ({
          id: m.id as string,
          movement_type: m.movement_type as string,
          amount: Number(m.amount),
          description: m.description as string,
          reference: m.reference as string | null,
          created_at: m.created_at as string,
          performer_name: m.performer
            ? `${(m.performer as Record<string, unknown>).first_name} ${(m.performer as Record<string, unknown>).last_name}`
            : 'Unknown',
        })));
      })
      .finally(() => setLoadingMovements(false));
  }, [openShift?.id]);

  // ─── Open Shift ───────────────────────────────────────────

  const handleOpenShift = async () => {
    setOpenSubmitting(true);
    setFormError('');
    try {
      const res = await fetch('/api/shifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch_id: branchId, opening_cash: parseFloat(openingCash) || 0 }),
      });
      const result = await res.json();
      if (!res.ok) { setFormError(result.error); return; }
      setShowOpenModal(false);
      setOpeningCash('');
      fetchShifts();
    } catch (err) {
      console.error(err);
      setFormError('An unexpected error occurred');
    } finally {
      setOpenSubmitting(false);
    }
  };

  // ─── Close Shift ──────────────────────────────────────────

  const handleCloseShift = async () => {
    if (!openShift) return;
    setCloseSubmitting(true);
    setFormError('');
    try {
      const res = await fetch(`/api/shifts/${openShift.id}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ closing_cash: parseFloat(closingCash) || 0, notes: closeNotes || null }),
      });
      const result = await res.json();
      if (!res.ok) { setFormError(result.error); return; }
      setShowCloseModal(false);
      setClosingCash('');
      setCloseNotes('');
      fetchShifts();
    } catch (err) {
      console.error(err);
      setFormError('An unexpected error occurred');
    } finally {
      setCloseSubmitting(false);
    }
  };

  // ─── Record Cash Movement ────────────────────────────────

  const handleRecordCash = async () => {
    setCashSubmitting(true);
    setFormError('');
    try {
      const amount = parseFloat(cashForm.amount);
      if (isNaN(amount) || amount <= 0) { setFormError('Enter a valid amount'); setCashSubmitting(false); return; }
      if (!cashForm.description.trim()) { setFormError('Description is required'); setCashSubmitting(false); return; }

      const res = await fetch('/api/cash-movements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branch_id: branchId,
          shift_id: openShift?.id || null,
          movement_type: cashForm.movement_type,
          amount,
          description: cashForm.description.trim(),
          reference: cashForm.reference || null,
        }),
      });
      const result = await res.json();
      if (!res.ok) { setFormError(result.error); return; }
      setShowCashModal(false);
      setCashForm({ movement_type: 'petty_cash_out', amount: '', description: '', reference: '' });
      fetchShifts();
    } catch (err) {
      console.error(err);
      setFormError('An unexpected error occurred');
    } finally {
      setCashSubmitting(false);
    }
  };

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(n);

  const formatDate = (d: string) =>
    new Date(d).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  const formatDuration = (start: string, end?: string | null) => {
    const ms = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime();
    const hours = Math.floor(ms / 3600000);
    const mins = Math.floor((ms % 3600000) / 60000);
    return `${hours}h ${mins}m`;
  };

  const movementLabels: Record<string, string> = {
    petty_cash_out: 'Petty Cash Out',
    bank_deposit: 'Bank Deposit',
    cash_in: 'Cash In',
    opening_float: 'Opening Float',
  };

  // ─── Render ───────────────────────────────────────────────

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-semibold text-brand-900">Shift Management</h1>
          <p className="text-sm text-brand-500 mt-1">Manage cash drawer shifts and petty cash movements</p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            {!openShift ? (
              <button onClick={() => { setShowOpenModal(true); setFormError(''); }}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 text-white text-sm font-medium
                           hover:from-emerald-700 hover:to-emerald-800 transition-all shadow-sm">
                🔓 Open Shift
              </button>
            ) : (
              <>
                <button onClick={() => { setShowCashModal(true); setFormError(''); }}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-brand-200 text-brand-700 text-sm font-medium hover:bg-brand-50 transition-colors">
                  💰 Cash Movement
                </button>
                <button onClick={() => { setShowCloseModal(true); setFormError(''); }}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-rose-600 to-rose-700 text-white text-sm font-medium
                             hover:from-rose-700 hover:to-rose-800 transition-all shadow-sm">
                  🔒 Close Shift
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Current Shift Card */}
      {openShift ? (
        <div className="bg-white rounded-2xl border-2 border-emerald-200 shadow-card p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-3 h-3 bg-emerald-500 rounded-full animate-pulse-soft" />
            <h2 className="text-lg font-semibold text-brand-900">Current Shift — Active</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-brand-400">Opened by</p>
              <p className="text-sm font-medium text-brand-800">{openShift.opener_name}</p>
            </div>
            <div>
              <p className="text-xs text-brand-400">Opening Cash</p>
              <p className="text-sm font-semibold text-brand-800">{formatCurrency(openShift.opening_cash)}</p>
            </div>
            <div>
              <p className="text-xs text-brand-400">Duration</p>
              <p className="text-sm font-medium text-brand-800">{formatDuration(openShift.opened_at)}</p>
            </div>
            <div>
              <p className="text-xs text-brand-400">Started</p>
              <p className="text-sm text-brand-600">{formatDate(openShift.opened_at)}</p>
            </div>
          </div>

          {/* Cash movements for this shift */}
          {movements.length > 0 && (
            <div className="mt-4 border-t border-brand-100 pt-4">
              <h3 className="text-xs font-semibold text-brand-500 uppercase mb-2">Cash Movements This Shift</h3>
              <div className="space-y-1.5">
                {movements.map(m => (
                  <div key={m.id} className="flex items-center justify-between text-sm bg-surface-50 rounded-lg px-3 py-2">
                    <div>
                      <span className="font-medium text-brand-700">{movementLabels[m.movement_type] || m.movement_type}</span>
                      <span className="text-brand-400 ml-2">— {m.description}</span>
                    </div>
                    <span className={`font-semibold ${m.movement_type === 'cash_in' || m.movement_type === 'opening_float' ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {m.movement_type === 'cash_in' || m.movement_type === 'opening_float' ? '+' : '-'}{formatCurrency(m.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-brand-50 flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-brand-300" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
          <p className="text-sm text-brand-500">No shift is currently open</p>
          {canManage && <p className="text-xs text-brand-400 mt-1">Open a shift to begin tracking cash flow</p>}
        </div>
      )}

      {/* Recent Closed Shifts */}
      <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card overflow-hidden">
        <div className="px-6 py-4 border-b border-brand-100/40">
          <h2 className="text-sm font-semibold text-brand-800">Recent Shifts</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-surface-50 border-b border-brand-100/40">
                <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Date</th>
                <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Opened By</th>
                <th className="text-right text-xs font-medium text-brand-400 px-5 py-3">Opening</th>
                <th className="text-right text-xs font-medium text-brand-400 px-5 py-3">Expected</th>
                <th className="text-right text-xs font-medium text-brand-400 px-5 py-3">Actual</th>
                <th className="text-right text-xs font-medium text-brand-400 px-5 py-3">Variance</th>
                <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Duration</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-brand-100/30">
                    <td className="px-5 py-4"><Skeleton className="h-4 w-20" /></td>
                    <td className="px-5 py-4"><Skeleton className="h-4 w-24" /></td>
                    <td className="px-5 py-4 text-right"><Skeleton className="h-4 w-16 ml-auto" /></td>
                    <td className="px-5 py-4 text-right"><Skeleton className="h-4 w-16 ml-auto" /></td>
                    <td className="px-5 py-4 text-right"><Skeleton className="h-4 w-16 ml-auto" /></td>
                    <td className="px-5 py-4 text-right"><Skeleton className="h-4 w-16 ml-auto" /></td>
                    <td className="px-5 py-4"><Skeleton className="h-4 w-12" /></td>
                  </tr>
                ))
              ) : closedShifts.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-sm text-brand-400">No closed shifts yet</td></tr>
              ) : (
                closedShifts.map(s => {
                  const variance = (s.closing_cash ?? 0) - (s.expected_cash ?? 0);
                  const varianceColor = Math.abs(variance) < 1 ? 'text-emerald-600' :
                    Math.abs(variance) < 100 ? 'text-amber-600' : 'text-rose-600';
                  return (
                    <tr key={s.id} className="border-b border-brand-100/30 hover:bg-brand-50/30 transition-colors">
                      <td className="px-5 py-4 text-sm text-brand-600">{formatDate(s.opened_at)}</td>
                      <td className="px-5 py-4 text-sm text-brand-700">{s.opener_name}</td>
                      <td className="px-5 py-4 text-right text-sm text-brand-600">{formatCurrency(s.opening_cash)}</td>
                      <td className="px-5 py-4 text-right text-sm text-brand-600">{s.expected_cash != null ? formatCurrency(s.expected_cash) : '—'}</td>
                      <td className="px-5 py-4 text-right text-sm font-semibold text-brand-800">{s.closing_cash != null ? formatCurrency(s.closing_cash) : '—'}</td>
                      <td className="px-5 py-4 text-right">
                        <span className={`text-sm font-semibold ${varianceColor}`}>
                          {variance >= 0 ? '+' : ''}{formatCurrency(variance)}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-sm text-brand-500">
                        {s.closed_at ? formatDuration(s.opened_at, s.closed_at) : '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ═══ Open Shift Modal ═════════════════════════════════ */}
      <Modal isOpen={showOpenModal} onClose={() => setShowOpenModal(false)}
        title="Open New Shift" subtitle="Count the opening cash in the drawer" size="sm">
        <div className="space-y-4">
          {formError && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{formError}</div>}
          <div>
            <label className="block text-sm font-medium text-brand-800 mb-1.5">Opening Cash (PHP)</label>
            <input type="number" value={openingCash} min="0" step="0.01"
              onChange={e => setOpeningCash(e.target.value)} placeholder="0.00"
              className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900 placeholder:text-brand-300
                         focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all" />
          </div>
          <div className="flex gap-3">
            <button onClick={handleOpenShift} disabled={openSubmitting}
              className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 text-white font-medium text-sm
                         disabled:opacity-60 transition-all shadow-sm">
              {openSubmitting ? 'Opening...' : 'Open Shift'}
            </button>
            <button onClick={() => setShowOpenModal(false)}
              className="px-4 py-2.5 rounded-xl border border-brand-200 text-brand-600 text-sm font-medium hover:bg-brand-50 transition-colors">Cancel</button>
          </div>
        </div>
      </Modal>

      {/* ═══ Close Shift Modal ════════════════════════════════ */}
      <Modal isOpen={showCloseModal} onClose={() => setShowCloseModal(false)}
        title="Close Shift" subtitle="Count the cash in the drawer" size="sm">
        <div className="space-y-4">
          {formError && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{formError}</div>}
          <div className="bg-surface-50 rounded-xl p-4">
            <p className="text-xs text-brand-400">Opening Cash</p>
            <p className="text-lg font-semibold text-brand-800">{openShift ? formatCurrency(openShift.opening_cash) : '—'}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-brand-800 mb-1.5">Actual Cash Count (PHP)</label>
            <input type="number" value={closingCash} min="0" step="0.01"
              onChange={e => setClosingCash(e.target.value)} placeholder="Count the drawer..."
              className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900 placeholder:text-brand-300
                         focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all" />
          </div>
          <div>
            <label className="block text-sm font-medium text-brand-800 mb-1.5">Notes <span className="text-brand-300 font-normal">(optional)</span></label>
            <textarea value={closeNotes} onChange={e => setCloseNotes(e.target.value)} rows={2} placeholder="End of shift notes..."
              className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900 placeholder:text-brand-300
                         focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all resize-none" />
          </div>
          <div className="flex gap-3">
            <button onClick={handleCloseShift} disabled={closeSubmitting}
              className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-rose-600 to-rose-700 text-white font-medium text-sm
                         disabled:opacity-60 transition-all shadow-sm">
              {closeSubmitting ? 'Closing...' : 'Close Shift'}
            </button>
            <button onClick={() => setShowCloseModal(false)}
              className="px-4 py-2.5 rounded-xl border border-brand-200 text-brand-600 text-sm font-medium hover:bg-brand-50 transition-colors">Cancel</button>
          </div>
        </div>
      </Modal>

      {/* ═══ Cash Movement Modal ══════════════════════════════ */}
      <Modal isOpen={showCashModal} onClose={() => setShowCashModal(false)}
        title="Record Cash Movement" subtitle="Track petty cash, deposits, or cash additions" size="sm">
        <div className="space-y-4">
          {formError && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{formError}</div>}
          <div>
            <label className="block text-sm font-medium text-brand-800 mb-1.5">Type</label>
            <select value={cashForm.movement_type} onChange={e => setCashForm({ ...cashForm, movement_type: e.target.value })}
              className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900
                         focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all">
              <option value="petty_cash_out">Petty Cash Out</option>
              <option value="bank_deposit">Bank Deposit</option>
              <option value="cash_in">Cash In</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-brand-800 mb-1.5">Amount (PHP)</label>
            <input type="number" value={cashForm.amount} min="1" step="0.01"
              onChange={e => setCashForm({ ...cashForm, amount: e.target.value })} placeholder="0.00"
              className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900 placeholder:text-brand-300
                         focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all" />
          </div>
          <div>
            <label className="block text-sm font-medium text-brand-800 mb-1.5">Description</label>
            <input type="text" value={cashForm.description}
              onChange={e => setCashForm({ ...cashForm, description: e.target.value })} placeholder="e.g. Office supplies"
              className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900 placeholder:text-brand-300
                         focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all" />
          </div>
          <div>
            <label className="block text-sm font-medium text-brand-800 mb-1.5">Reference <span className="text-brand-300 font-normal">(optional)</span></label>
            <input type="text" value={cashForm.reference}
              onChange={e => setCashForm({ ...cashForm, reference: e.target.value })} placeholder="Receipt #, etc."
              className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900 placeholder:text-brand-300
                         focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all" />
          </div>
          <div className="flex gap-3">
            <button onClick={handleRecordCash} disabled={cashSubmitting}
              className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-brand-600 to-brand-700 text-white font-medium text-sm
                         disabled:opacity-60 transition-all shadow-sm">
              {cashSubmitting ? 'Recording...' : 'Record Movement'}
            </button>
            <button onClick={() => setShowCashModal(false)}
              className="px-4 py-2.5 rounded-xl border border-brand-200 text-brand-600 text-sm font-medium hover:bg-brand-50 transition-colors">Cancel</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
