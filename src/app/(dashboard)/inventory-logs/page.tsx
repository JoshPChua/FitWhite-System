'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/providers/auth-provider';
import { createClient } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { downloadCsv, toCsv, csvCurrency, csvDate, type CsvColumn } from '@/lib/export-csv';

// ─── Types ──────────────────────────────────────────────────

interface InventoryLog {
  id: string;
  product_name: string;
  branch_name: string;
  performed_by_name: string;
  source: string;
  quantity_delta: number;
  quantity_before: number;
  quantity_after: number;
  notes: string | null;
  created_at: string;
}

const SOURCE_LABELS: Record<string, string> = {
  sale_product: 'Product Sale',
  service_bom: 'Service BOM',
  addon_manual: 'Extra Consumable',
  manual_adjust: 'Manual Adjustment',
  refund_restock: 'Refund Restock',
  void_restock: 'Void Restock',
};

const SOURCE_VARIANTS: Record<string, 'brand' | 'success' | 'warning' | 'danger' | 'default'> = {
  sale_product: 'brand',
  service_bom: 'warning',
  addon_manual: 'warning',
  manual_adjust: 'default',
  refund_restock: 'success',
  void_restock: 'success',
};

// ─── Component ──────────────────────────────────────────────

export default function InventoryLogsPage() {
  const { isOwner, isManager, selectedBranch, profile } = useAuth();
  const [logs, setLogs] = useState<InventoryLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterSource, setFilterSource] = useState('');
  const [filterDays, setFilterDays] = useState<'7' | '30' | '90' | 'all'>('30');

  const supabase = createClient();

  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    try {
      const branchId = isOwner ? null : (selectedBranch?.id ?? profile?.branch_id);

      let query = supabase
        .from('inventory_logs')
        .select('*, products:product_id(name), branches:branch_id(name), performer:performed_by(first_name, last_name)')
        .order('created_at', { ascending: false })
        .limit(500);

      if (branchId) query = query.eq('branch_id', branchId);
      if (filterSource) query = query.eq('source', filterSource);
      if (filterDays !== 'all') {
        const d = parseInt(filterDays);
        const dateFrom = new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString();
        query = query.gte('created_at', dateFrom);
      }

      const { data, error } = await query;
      if (error) { console.error('Inventory logs error:', error); return; }

      setLogs((data || []).map((l: Record<string, unknown>) => ({
        id: l.id as string,
        product_name: (l.products as Record<string, unknown>)?.name as string || 'Unknown',
        branch_name: (l.branches as Record<string, unknown>)?.name as string || '',
        performed_by_name: l.performer
          ? `${(l.performer as Record<string, unknown>).first_name} ${(l.performer as Record<string, unknown>).last_name}`
          : 'System',
        source: l.source as string,
        quantity_delta: Number(l.quantity_delta),
        quantity_before: Number(l.quantity_before),
        quantity_after: Number(l.quantity_after),
        notes: l.notes as string | null,
        created_at: l.created_at as string,
      })));
    } catch (err) {
      console.error('Inventory logs page error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [supabase, isOwner, selectedBranch?.id, profile?.branch_id, filterSource, filterDays]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const formatDate = (d: string) =>
    new Date(d).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  // ─── CSV Export ─────────────────────────────────────────────
  const handleExport = () => {
    const columns: CsvColumn<InventoryLog>[] = [
      { header: 'Date', accessor: r => csvDate(r.created_at) },
      { header: 'Product', accessor: r => r.product_name },
      { header: 'Branch', accessor: r => r.branch_name },
      { header: 'Source', accessor: r => SOURCE_LABELS[r.source] || r.source },
      { header: 'Change', accessor: r => r.quantity_delta },
      { header: 'Before', accessor: r => r.quantity_before },
      { header: 'After', accessor: r => r.quantity_after },
      { header: 'Performed By', accessor: r => r.performed_by_name },
      { header: 'Notes', accessor: r => r.notes || '' },
    ];
    downloadCsv(toCsv(logs, columns), `inventory-logs-${new Date().toISOString().split('T')[0]}.csv`);
  };

  // ─── Stats ─────────────────────────────────────────────────
  const totalDeductions = logs.filter(l => l.quantity_delta < 0).reduce((s, l) => s + Math.abs(l.quantity_delta), 0);
  const totalAdditions = logs.filter(l => l.quantity_delta > 0).reduce((s, l) => s + l.quantity_delta, 0);
  const bomDeductions = logs.filter(l => l.source === 'service_bom').reduce((s, l) => s + Math.abs(l.quantity_delta), 0);

  const canView = isOwner || isManager;
  if (!canView) {
    return (
      <div className="flex items-center justify-center h-[60vh] text-brand-400 text-sm">
        You do not have permission to view inventory logs.
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-semibold text-brand-900">Inventory Logs</h1>
          <p className="text-sm text-brand-500 mt-1">Complete audit trail of all stock movements</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Period filter */}
          <div className="flex rounded-xl border border-brand-200 overflow-hidden bg-white">
            {(['7', '30', '90', 'all'] as const).map(d => (
              <button key={d} onClick={() => setFilterDays(d)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  filterDays === d ? 'bg-brand-600 text-white' : 'text-brand-500 hover:bg-brand-50'
                }`}>
                {d === 'all' ? 'All' : `${d}d`}
              </button>
            ))}
          </div>
          {/* Source filter */}
          <select value={filterSource} onChange={e => setFilterSource(e.target.value)}
            className="px-3 py-1.5 rounded-xl border border-brand-200 bg-white text-xs text-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-400/50">
            <option value="">All sources</option>
            {Object.entries(SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          {/* Export */}
          <button onClick={handleExport} disabled={logs.length === 0}
            className="px-3 py-1.5 rounded-xl border border-brand-200 bg-white text-xs font-medium text-brand-600 hover:bg-brand-50
                       disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
            📥 Export CSV
          </button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total Entries', value: logs.length, color: 'text-brand-900' },
          { label: 'Items Added', value: `+${totalAdditions}`, color: 'text-emerald-600' },
          { label: 'Items Deducted', value: `-${totalDeductions}`, color: 'text-rose-600' },
          { label: 'BOM Deductions', value: bomDeductions, color: 'text-amber-600' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-2xl border border-brand-100/50 shadow-card px-5 py-4">
            <p className="text-xs font-medium text-brand-400 uppercase tracking-wide">{label}</p>
            <p className={`text-2xl font-semibold mt-1 ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Logs table */}
      <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-brand-100/60 bg-surface-50">
                <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Time</th>
                <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Product</th>
                {isOwner && <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Branch</th>}
                <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Source</th>
                <th className="text-right text-xs font-medium text-brand-400 px-5 py-3">Change</th>
                <th className="text-right text-xs font-medium text-brand-400 px-5 py-3">Before → After</th>
                <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">By</th>
                <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Notes</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-brand-100/30">
                    <td className="px-5 py-4"><Skeleton className="h-4 w-32" /></td>
                    <td className="px-5 py-4"><Skeleton className="h-4 w-28" /></td>
                    {isOwner && <td className="px-5 py-4"><Skeleton className="h-4 w-20" /></td>}
                    <td className="px-5 py-4"><Skeleton className="h-5 w-24 rounded-full" /></td>
                    <td className="px-5 py-4 text-right"><Skeleton className="h-4 w-10 ml-auto" /></td>
                    <td className="px-5 py-4 text-right"><Skeleton className="h-4 w-20 ml-auto" /></td>
                    <td className="px-5 py-4"><Skeleton className="h-4 w-20" /></td>
                    <td className="px-5 py-4"><Skeleton className="h-4 w-32" /></td>
                  </tr>
                ))
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={isOwner ? 8 : 7} className="text-center py-16 text-sm text-brand-400">
                    No inventory logs found for this filter
                  </td>
                </tr>
              ) : (
                logs.map(log => (
                  <tr key={log.id} className="border-b border-brand-100/30 hover:bg-brand-50/30 transition-colors">
                    <td className="px-5 py-3"><span className="text-xs text-brand-500">{formatDate(log.created_at)}</span></td>
                    <td className="px-5 py-3"><span className="text-sm font-medium text-brand-800">{log.product_name}</span></td>
                    {isOwner && <td className="px-5 py-3"><span className="text-sm text-brand-500">{log.branch_name}</span></td>}
                    <td className="px-5 py-3">
                      <Badge variant={SOURCE_VARIANTS[log.source] || 'default'} size="sm">
                        {SOURCE_LABELS[log.source] || log.source}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span className={`text-sm font-semibold ${log.quantity_delta >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {log.quantity_delta >= 0 ? '+' : ''}{log.quantity_delta}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span className="text-xs text-brand-400">{log.quantity_before} → {log.quantity_after}</span>
                    </td>
                    <td className="px-5 py-3"><span className="text-xs text-brand-500">{log.performed_by_name}</span></td>
                    <td className="px-5 py-3"><span className="text-xs text-brand-400 truncate max-w-[200px] block">{log.notes || '—'}</span></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {!isLoading && logs.length > 0 && (
          <div className="px-5 py-3 border-t border-brand-100/40 text-xs text-brand-400">
            Showing {logs.length} log entries
          </div>
        )}
      </div>
    </div>
  );
}
