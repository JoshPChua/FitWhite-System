'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/providers/auth-provider';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { downloadCsv, toCsv, csvCurrency, csvDate, type CsvColumn } from '@/lib/export-csv';

// ─── Types ──────────────────────────────────────────────────

interface Commission {
  id: string;
  branch_id: string;
  doctor_id: string;
  doctor_name: string;
  gross_amount: number;
  commission_rate: number;
  commission_amount: number;
  is_paid: boolean;
  paid_at: string | null;
  created_at: string;
  source_label: string;
}

// ─── Component ──────────────────────────────────────────────

export default function CommissionsPage() {
  const { isOwner, isManager, selectedBranch, profile } = useAuth();
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterPaid, setFilterPaid] = useState<'unpaid' | 'paid' | 'all'>('unpaid');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isMarking, setIsMarking] = useState(false);

  // ─── Fetch ────────────────────────────────────────────────

  const fetchCommissions = useCallback(async () => {
    setIsLoading(true);
    try {
      let url = '/api/commissions?';
      if (filterPaid !== 'all') url += `status=${filterPaid}`;

      const res = await fetch(url);
      const result = await res.json();
      if (res.ok) {
        setCommissions((result.data || []).map((c: Record<string, unknown>) => ({
          id: c.id as string,
          branch_id: c.branch_id as string,
          doctor_id: c.doctor_id as string,
          doctor_name: c.doctor
            ? (c.doctor as Record<string, unknown>).full_name as string
            : 'Unknown',
          gross_amount: Number(c.gross_amount),
          commission_rate: Number(c.commission_rate),
          commission_amount: Number(c.commission_amount),
          is_paid: c.is_paid as boolean,
          paid_at: c.paid_at as string | null,
          created_at: c.created_at as string,
          source_label: c.sale_item
            ? `Sale: ${(c.sale_item as Record<string, unknown>).name}`
            : c.session
              ? 'Package Session'
              : 'Direct',
        })));
        setSelectedIds(new Set());
      }
    } catch (err) {
      console.error('Commissions fetch error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [filterPaid]);

  useEffect(() => { fetchCommissions(); }, [fetchCommissions]);

  // ─── Mark as Paid ─────────────────────────────────────────

  const handleMarkPaid = async () => {
    if (selectedIds.size === 0) return;
    setIsMarking(true);
    try {
      const res = await fetch('/api/commissions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      if (res.ok) {
        fetchCommissions();
      } else {
        const result = await res.json();
        alert(result.error || 'Failed to mark commissions as paid');
      }
    } catch (err) {
      console.error('Mark paid error:', err);
    } finally {
      setIsMarking(false);
    }
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  };

  const toggleAll = () => {
    const unpaid = commissions.filter(c => !c.is_paid);
    if (selectedIds.size === unpaid.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(unpaid.map(c => c.id)));
    }
  };

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(n);

  const formatDate = (d: string) =>
    new Date(d).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });

  // ─── Stats ────────────────────────────────────────────────

  const unpaidTotal = commissions.filter(c => !c.is_paid).reduce((s, c) => s + c.commission_amount, 0);
  const paidThisMonth = commissions
    .filter(c => c.is_paid && c.paid_at && new Date(c.paid_at).getMonth() === new Date().getMonth())
    .reduce((s, c) => s + c.commission_amount, 0);

  // Top earning doctor
  const doctorTotals = new Map<string, { name: string; total: number }>();
  commissions.forEach(c => {
    const existing = doctorTotals.get(c.doctor_id) || { name: c.doctor_name, total: 0 };
    existing.total += c.commission_amount;
    doctorTotals.set(c.doctor_id, existing);
  });
  const topDoctor = Array.from(doctorTotals.values()).sort((a, b) => b.total - a.total)[0];

  const canManage = isOwner || isManager;

  // ─── Render ───────────────────────────────────────────────

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-semibold text-brand-900">Doctor Commissions</h1>
          <p className="text-sm text-brand-500 mt-1">Track and manage doctor commissions for services performed</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Filter */}
          <div className="flex rounded-xl border border-brand-200 overflow-hidden bg-white">
            {(['unpaid', 'paid', 'all'] as const).map(s => (
              <button key={s} onClick={() => setFilterPaid(s)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  filterPaid === s ? 'bg-brand-600 text-white' : 'text-brand-500 hover:bg-brand-50'
                }`}>
                {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
          {/* Export CSV */}
          <button
            onClick={() => {
              const columns: CsvColumn<Commission>[] = [
                { header: 'Date', accessor: r => csvDate(r.created_at) },
                { header: 'Doctor', accessor: r => r.doctor_name },
                { header: 'Source', accessor: r => r.source_label },
                { header: 'Gross Amount', accessor: r => csvCurrency(r.gross_amount) },
                { header: 'Rate', accessor: r => r.commission_rate ? `${(r.commission_rate * 100).toFixed(0)}%` : 'Fixed' },
                { header: 'Commission', accessor: r => csvCurrency(r.commission_amount) },
                { header: 'Status', accessor: r => r.is_paid ? 'Paid' : 'Unpaid' },
                { header: 'Paid At', accessor: r => csvDate(r.paid_at) },
              ];
              downloadCsv(toCsv(commissions, columns), `commissions-${filterPaid}-${new Date().toISOString().split('T')[0]}.csv`);
            }}
            disabled={commissions.length === 0}
            className="px-3 py-1.5 rounded-xl border border-brand-200 bg-white text-xs font-medium text-brand-600 hover:bg-brand-50
                       disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            📥 Export CSV
          </button>
          {/* Bulk pay */}
          {canManage && selectedIds.size > 0 && (
            <button onClick={handleMarkPaid} disabled={isMarking}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 text-white text-sm font-medium
                         hover:from-emerald-700 hover:to-emerald-800 disabled:opacity-50 transition-all shadow-sm">
              {isMarking ? 'Processing...' : `Mark ${selectedIds.size} as Paid`}
            </button>
          )}
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {[
          { label: 'Total Unpaid', value: formatCurrency(unpaidTotal), color: 'text-rose-600' },
          { label: 'Paid This Month', value: formatCurrency(paidThisMonth), color: 'text-emerald-600' },
          { label: 'Top Doctor', value: topDoctor ? topDoctor.name : '—', sub: topDoctor ? formatCurrency(topDoctor.total) : '', color: 'text-brand-800' },
        ].map(({ label, value, sub, color }) => (
          <div key={label} className="bg-white rounded-2xl border border-brand-100/50 shadow-card px-5 py-4">
            <p className="text-xs font-medium text-brand-400 uppercase tracking-wide">{label}</p>
            <p className={`text-2xl font-semibold mt-1 ${color}`}>{value}</p>
            {sub && <p className="text-xs text-brand-400 mt-0.5">{sub}</p>}
          </div>
        ))}
      </div>

      {/* Commissions table */}
      <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-brand-100/60 bg-surface-50">
                {canManage && filterPaid === 'unpaid' && (
                  <th className="text-center text-xs font-medium text-brand-400 px-3 py-3 w-10">
                    <input type="checkbox" onChange={toggleAll}
                      checked={selectedIds.size > 0 && selectedIds.size === commissions.filter(c => !c.is_paid).length}
                      className="rounded border-brand-300 text-brand-600 focus:ring-brand-400" />
                  </th>
                )}
                <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Doctor</th>
                <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Date</th>
                <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Source</th>
                <th className="text-right text-xs font-medium text-brand-400 px-5 py-3">Gross</th>
                <th className="text-right text-xs font-medium text-brand-400 px-5 py-3">Rate</th>
                <th className="text-right text-xs font-medium text-brand-400 px-5 py-3">Commission</th>
                <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-brand-100/30">
                    {canManage && filterPaid === 'unpaid' && <td className="px-3 py-4"><Skeleton className="h-4 w-4 mx-auto" /></td>}
                    <td className="px-5 py-4"><Skeleton className="h-4 w-32" /></td>
                    <td className="px-5 py-4"><Skeleton className="h-4 w-20" /></td>
                    <td className="px-5 py-4"><Skeleton className="h-4 w-24" /></td>
                    <td className="px-5 py-4 text-right"><Skeleton className="h-4 w-16 ml-auto" /></td>
                    <td className="px-5 py-4 text-right"><Skeleton className="h-4 w-10 ml-auto" /></td>
                    <td className="px-5 py-4 text-right"><Skeleton className="h-4 w-16 ml-auto" /></td>
                    <td className="px-5 py-4"><Skeleton className="h-5 w-14 rounded-full" /></td>
                  </tr>
                ))
              ) : commissions.length === 0 ? (
                <tr>
                  <td colSpan={canManage && filterPaid === 'unpaid' ? 8 : 7} className="text-center py-16 text-sm text-brand-400">
                    No commissions found for this filter
                  </td>
                </tr>
              ) : (
                commissions.map(c => (
                  <tr key={c.id} className="border-b border-brand-100/30 hover:bg-brand-50/30 transition-colors">
                    {canManage && filterPaid === 'unpaid' && (
                      <td className="text-center px-3 py-4">
                        {!c.is_paid && (
                          <input type="checkbox" checked={selectedIds.has(c.id)}
                            onChange={() => toggleSelect(c.id)}
                            className="rounded border-brand-300 text-brand-600 focus:ring-brand-400" />
                        )}
                      </td>
                    )}
                    <td className="px-5 py-4"><span className="text-sm font-medium text-brand-800">{c.doctor_name}</span></td>
                    <td className="px-5 py-4"><span className="text-sm text-brand-500">{formatDate(c.created_at)}</span></td>
                    <td className="px-5 py-4"><span className="text-xs text-brand-400">{c.source_label}</span></td>
                    <td className="px-5 py-4 text-right"><span className="text-sm text-brand-600">{formatCurrency(c.gross_amount)}</span></td>
                    <td className="px-5 py-4 text-right"><span className="text-sm text-brand-600">{c.commission_rate ? `${(c.commission_rate * 100).toFixed(0)}%` : 'Fixed'}</span></td>
                    <td className="px-5 py-4 text-right"><span className="text-sm font-semibold text-brand-800">{formatCurrency(c.commission_amount)}</span></td>
                    <td className="px-5 py-4">
                      <Badge variant={c.is_paid ? 'success' : 'warning'} size="sm">
                        {c.is_paid ? 'Paid' : 'Unpaid'}
                      </Badge>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {!isLoading && commissions.length > 0 && (
          <div className="px-5 py-3 border-t border-brand-100/40 text-xs text-brand-400">
            Showing {commissions.length} commissions
          </div>
        )}
      </div>
    </div>
  );
}
