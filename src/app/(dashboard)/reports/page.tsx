'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/providers/auth-provider';
import { createClient } from '@/lib/supabase/client';
import { Skeleton } from '@/components/ui/skeleton';

// ─── Types ──────────────────────────────────────────────────

interface DailyStat {
  date: string;
  revenue: number;
  transactions: number;
}

interface TopItem {
  name: string;
  count: number;
  revenue: number;
  item_type: string;
}

interface BranchStat {
  branch_id: string;
  branch_name: string;
  revenue: number;
  transactions: number;
  avg_transaction: number;
}

interface ReportData {
  totalRevenue: number;
  totalTransactions: number;
  totalRefunds: number;
  totalRefundAmount: number;
  avgTransactionValue: number;
  dailyStats: DailyStat[];
  topItems: TopItem[];
  branchStats: BranchStat[];
  paymentMethodBreakdown: { method: string; amount: number; count: number }[];
}

// ─── Inline Bar Chart Component ──────────────────────────────

function BarChart({ data, max, color = '#4f6ef7' }: { data: number[]; max: number; color?: string }) {
  return (
    <div className="flex items-end gap-0.5 h-16">
      {data.map((val, i) => (
        <div key={i} className="flex-1 rounded-t-sm transition-all duration-300" style={{
          height: max > 0 ? `${Math.max(4, (val / max) * 64)}px` : '4px',
          backgroundColor: color,
          opacity: 0.7 + (i / data.length) * 0.3,
        }} />
      ))}
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────

export default function ReportsPage() {
  const { isOwner, isManager, selectedBranch, branches } = useAuth();
  const [data, setData] = useState<ReportData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [filterBranch, setFilterBranch] = useState('');
  const [filterPeriod, setFilterPeriod] = useState<'7d' | '30d' | '90d' | 'all'>('30d');

  const supabase = createClient();

  // ─── Fetch Report Data ───────────────────────────────────

  const fetchReports = useCallback(async () => {
    setIsLoading(true);
    try {
      const branchFilter = !isOwner && selectedBranch?.id ? selectedBranch.id : filterBranch || null;

      const periodDays = filterPeriod === '7d' ? 7 : filterPeriod === '30d' ? 30 : filterPeriod === '90d' ? 90 : null;
      const dateFrom = periodDays
        ? new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString()
        : null;

      // Sales query
      let salesQuery = supabase
        .from('sales')
        .select('id, total, subtotal, discount, status, branch_id, created_at, branches:branch_id(name)');
      if (branchFilter) salesQuery = salesQuery.eq('branch_id', branchFilter);
      if (dateFrom) salesQuery = salesQuery.gte('created_at', dateFrom);
      const { data: salesData } = await salesQuery;

      // Refunds
      let refundQuery = supabase.from('refunds').select('amount, branch_id, created_at');
      if (branchFilter) refundQuery = refundQuery.eq('branch_id', branchFilter);
      if (dateFrom) refundQuery = refundQuery.gte('created_at', dateFrom);
      const { data: refundsData } = await refundQuery;

      // Sale items for top items
      const saleIds = (salesData || [])
        .filter((s: Record<string, unknown>) => s.status === 'completed' || s.status === 'partial_refund')
        .map((s: Record<string, unknown>) => s.id as string);

      let topItemsData: Record<string, unknown>[] = [];
      if (saleIds.length > 0) {
        const { data: items } = await supabase
          .from('sale_items')
          .select('name, quantity, total_price, item_type')
          .in('sale_id', saleIds.slice(0, 1000));
        topItemsData = (items || []) as Record<string, unknown>[];
      }

      // Payments
      const paymentSaleIds = saleIds.slice(0, 1000);
      let paymentsData: Record<string, unknown>[] = [];
      if (paymentSaleIds.length > 0) {
        const { data: payments } = await supabase
          .from('payments')
          .select('method, amount')
          .in('sale_id', paymentSaleIds);
        paymentsData = (payments || []) as Record<string, unknown>[];
      }

      // ─── Process data ─────────────────────────────────────

      const sales = (salesData || []) as Record<string, unknown>[];
      const refunds = (refundsData || []) as Record<string, unknown>[];

      const completedSales = sales.filter(s => s.status === 'completed' || s.status === 'partial_refund');
      const totalRevenue = completedSales.reduce((sum, s) => sum + Number(s.total), 0);
      const totalTransactions = completedSales.length;
      const totalRefundAmount = refunds.reduce((sum, r) => sum + Number(r.amount), 0);
      const avgTransactionValue = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;

      // Daily stats
      const dailyMap = new Map<string, { revenue: number; transactions: number }>();
      const days = Math.min(periodDays || 30, 30);
      for (let i = days - 1; i >= 0; i--) {
        const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        dailyMap.set(date, { revenue: 0, transactions: 0 });
      }
      for (const sale of completedSales) {
        const date = (sale.created_at as string).split('T')[0];
        if (dailyMap.has(date)) {
          const existing = dailyMap.get(date)!;
          existing.revenue += Number(sale.total);
          existing.transactions += 1;
        }
      }
      const dailyStats: DailyStat[] = Array.from(dailyMap.entries()).map(([date, stat]) => ({
        date, revenue: stat.revenue, transactions: stat.transactions,
      }));

      // Top items
      const itemMap = new Map<string, { count: number; revenue: number; item_type: string }>();
      for (const item of topItemsData) {
        const key = item.name as string;
        const existing = itemMap.get(key) || { count: 0, revenue: 0, item_type: item.item_type as string };
        existing.count += item.quantity as number;
        existing.revenue += Number(item.total_price);
        itemMap.set(key, existing);
      }
      const topItems: TopItem[] = Array.from(itemMap.entries())
        .map(([name, stat]) => ({ name, ...stat }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 10);

      // Branch stats (owner only)
      const branchMap = new Map<string, { branch_name: string; revenue: number; transactions: number }>();
      for (const sale of completedSales) {
        const bid = sale.branch_id as string;
        const bname = (sale.branches as Record<string, unknown>)?.name as string || '';
        const existing = branchMap.get(bid) || { branch_name: bname, revenue: 0, transactions: 0 };
        existing.revenue += Number(sale.total);
        existing.transactions += 1;
        if (!existing.branch_name && bname) existing.branch_name = bname;
        branchMap.set(bid, existing);
      }
      const branchStats: BranchStat[] = Array.from(branchMap.entries())
        .map(([branch_id, stat]) => ({
          branch_id,
          branch_name: stat.branch_name,
          revenue: stat.revenue,
          transactions: stat.transactions,
          avg_transaction: stat.transactions > 0 ? stat.revenue / stat.transactions : 0,
        }))
        .sort((a, b) => b.revenue - a.revenue);

      // Payment breakdown
      const payMap = new Map<string, { amount: number; count: number }>();
      for (const pay of paymentsData) {
        const method = pay.method as string;
        const existing = payMap.get(method) || { amount: 0, count: 0 };
        existing.amount += Number(pay.amount);
        existing.count += 1;
        payMap.set(method, existing);
      }
      const paymentMethodBreakdown = Array.from(payMap.entries())
        .map(([method, stat]) => ({ method, ...stat }))
        .sort((a, b) => b.amount - a.amount);

      setData({
        totalRevenue, totalTransactions, totalRefunds: refunds.length,
        totalRefundAmount, avgTransactionValue,
        dailyStats, topItems, branchStats, paymentMethodBreakdown,
      });
    } catch (err) {
      console.error('Reports error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [supabase, isOwner, selectedBranch?.id, filterBranch, filterPeriod]);

  useEffect(() => { fetchReports(); }, [fetchReports]);

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(n);

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });

  const maxRevenue = Math.max(...(data?.dailyStats.map(d => d.revenue) || [1]));

  const paymentMethodLabels: Record<string, string> = {
    cash: 'Cash', gcash: 'GCash', card: 'Card', bank_transfer: 'Bank Transfer',
  };

  const totalPayments = (data?.paymentMethodBreakdown || []).reduce((sum, p) => sum + p.amount, 0);

  // ─── Render ─────────────────────────────────────────────

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-semibold text-brand-900">Reports & Analytics</h1>
          <p className="text-sm text-brand-500 mt-1">
            {isOwner ? 'Business intelligence across all branches' : 'Performance analytics for your branch'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Period filter */}
          <div className="flex rounded-xl border border-brand-200 overflow-hidden bg-white">
            {(['7d', '30d', '90d', 'all'] as const).map(period => (
              <button key={period} onClick={() => setFilterPeriod(period)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  filterPeriod === period ? 'bg-brand-600 text-white' : 'text-brand-500 hover:bg-brand-50'
                }`}>
                {period === '7d' ? '7 Days' : period === '30d' ? '30 Days' : period === '90d' ? '90 Days' : 'All Time'}
              </button>
            ))}
          </div>
          {/* Branch filter (owner only) */}
          {isOwner && (
            <select value={filterBranch} onChange={e => setFilterBranch(e.target.value)}
              className="px-3 py-1.5 rounded-xl border border-brand-200 bg-white text-xs text-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-400/50">
              <option value="">All branches</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-brand-100/50 shadow-card px-5 py-4">
              <Skeleton className="h-3 w-24 mb-3" />
              <Skeleton className="h-8 w-32" />
            </div>
          ))
        ) : (
          [
            { label: 'Total Revenue', value: formatCurrency(data?.totalRevenue || 0), sub: `${data?.totalTransactions || 0} transactions`, accent: 'text-emerald-700' },
            { label: 'Avg. Transaction', value: formatCurrency(data?.avgTransactionValue || 0), sub: 'per sale', accent: 'text-brand-800' },
            { label: 'Total Refunds', value: data?.totalRefunds || 0, sub: formatCurrency(data?.totalRefundAmount || 0) + ' refunded', accent: 'text-rose-600' },
            { label: 'Active Period', value: filterPeriod === 'all' ? 'All Time' : filterPeriod.toUpperCase(), sub: 'selected range', accent: 'text-brand-600' },
          ].map(({ label, value, sub, accent }) => (
            <div key={label} className="bg-white rounded-2xl border border-brand-100/50 shadow-card px-5 py-4">
              <p className="text-xs font-medium text-brand-400 uppercase tracking-wide">{label}</p>
              <p className={`text-2xl font-semibold mt-1 ${accent}`}>{value}</p>
              <p className="text-xs text-brand-400 mt-1">{sub}</p>
            </div>
          ))
        )}
      </div>

      {/* Revenue Chart */}
      <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-brand-800">Daily Revenue</h2>
            <p className="text-xs text-brand-400 mt-0.5">Revenue over time (last {filterPeriod === 'all' ? '30' : filterPeriod.replace('d', '')} days)</p>
          </div>
          {!isLoading && data && (
            <p className="text-sm font-semibold text-emerald-700">{formatCurrency(data.totalRevenue)}</p>
          )}
        </div>
        {isLoading ? (
          <Skeleton className="h-20 w-full rounded-xl" />
        ) : (
          <>
            <BarChart
              data={(data?.dailyStats || []).map(d => d.revenue)}
              max={maxRevenue}
              color="#4f6ef7"
            />
            <div className="flex justify-between mt-2">
              <span className="text-xs text-brand-400">{data?.dailyStats[0]?.date ? formatDate(data.dailyStats[0].date) : ''}</span>
              <span className="text-xs text-brand-400">{data?.dailyStats[data.dailyStats.length - 1]?.date ? formatDate(data.dailyStats[data.dailyStats.length - 1].date) : ''}</span>
            </div>
          </>
        )}
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Top Items */}
        <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card p-6">
          <h2 className="text-sm font-semibold text-brand-800 mb-4">Top Items by Revenue</h2>
          {isLoading ? (
            <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-xl" />)}</div>
          ) : (data?.topItems || []).length === 0 ? (
            <p className="text-sm text-brand-400 text-center py-8">No sales data for this period</p>
          ) : (
            <div className="space-y-2.5">
              {(data?.topItems || []).map((item, i) => {
                const maxRev = (data?.topItems[0]?.revenue || 1);
                return (
                  <div key={i} className="space-y-1">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <span className="text-xs font-medium text-brand-700 truncate block">{item.name}</span>
                        <span className="text-xs text-brand-400 capitalize">{item.item_type} · {item.count}× sold</span>
                      </div>
                      <span className="text-xs font-semibold text-brand-800 flex-shrink-0">{formatCurrency(item.revenue)}</span>
                    </div>
                    <div className="w-full bg-brand-50 rounded-full h-1.5">
                      <div className="bg-brand-500 h-1.5 rounded-full transition-all duration-500"
                        style={{ width: `${(item.revenue / maxRev) * 100}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Payment Methods */}
        <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card p-6">
          <h2 className="text-sm font-semibold text-brand-800 mb-4">Payment Methods</h2>
          {isLoading ? (
            <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}</div>
          ) : (data?.paymentMethodBreakdown || []).length === 0 ? (
            <p className="text-sm text-brand-400 text-center py-8">No payment data for this period</p>
          ) : (
            <div className="space-y-3">
              {(data?.paymentMethodBreakdown || []).map((pay, i) => {
                const pct = totalPayments > 0 ? (pay.amount / totalPayments) * 100 : 0;
                const colors = ['bg-brand-500', 'bg-emerald-500', 'bg-amber-500', 'bg-violet-500'];
                return (
                  <div key={i}>
                    <div className="flex items-center justify-between gap-3 mb-1">
                      <div className="flex items-center gap-2">
                        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${colors[i % colors.length]}`} />
                        <span className="text-sm text-brand-700">{paymentMethodLabels[pay.method] || pay.method}</span>
                        <span className="text-xs text-brand-400">({pay.count} txns)</span>
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-semibold text-brand-800">{formatCurrency(pay.amount)}</span>
                        <span className="text-xs text-brand-400 ml-2">{pct.toFixed(1)}%</span>
                      </div>
                    </div>
                    <div className="w-full bg-brand-50 rounded-full h-1.5">
                      <div className={`${colors[i % colors.length]} h-1.5 rounded-full transition-all duration-500`}
                        style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>

      {/* Branch Performance (Owner only) */}
      {isOwner && (
        <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card overflow-hidden">
          <div className="px-6 py-4 border-b border-brand-100/40">
            <h2 className="text-sm font-semibold text-brand-800">Branch Performance</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-surface-50 border-b border-brand-100/40">
                  <th className="text-left text-xs font-medium text-brand-400 px-6 py-3">Branch</th>
                  <th className="text-right text-xs font-medium text-brand-400 px-6 py-3">Revenue</th>
                  <th className="text-right text-xs font-medium text-brand-400 px-6 py-3">Transactions</th>
                  <th className="text-right text-xs font-medium text-brand-400 px-6 py-3">Avg. Sale</th>
                  <th className="text-left text-xs font-medium text-brand-400 px-6 py-3 w-40">Share</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i} className="border-b border-brand-100/30">
                      <td className="px-6 py-4"><Skeleton className="h-4 w-32" /></td>
                      <td className="px-6 py-4 text-right"><Skeleton className="h-4 w-20 ml-auto" /></td>
                      <td className="px-6 py-4 text-right"><Skeleton className="h-4 w-12 ml-auto" /></td>
                      <td className="px-6 py-4 text-right"><Skeleton className="h-4 w-20 ml-auto" /></td>
                      <td className="px-6 py-4"><Skeleton className="h-2 w-32" /></td>
                    </tr>
                  ))
                ) : (data?.branchStats || []).length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-8 text-sm text-brand-400">No branch data for this period</td></tr>
                ) : (
                  (data?.branchStats || []).map((branch, i) => {
                    const pct = data!.totalRevenue > 0 ? (branch.revenue / data!.totalRevenue) * 100 : 0;
                    return (
                      <tr key={i} className="border-b border-brand-100/30 hover:bg-brand-50/30 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${i === 0 ? 'bg-brand-500' : i === 1 ? 'bg-emerald-500' : 'bg-amber-400'}`} />
                            <span className="text-sm font-medium text-brand-800">{branch.branch_name}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className="text-sm font-semibold text-brand-800">{formatCurrency(branch.revenue)}</span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className="text-sm text-brand-600">{branch.transactions}</span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className="text-sm text-brand-600">{formatCurrency(branch.avg_transaction)}</span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-brand-50 rounded-full h-2">
                              <div className="bg-brand-500 h-2 rounded-full transition-all duration-500"
                                style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-xs text-brand-400 w-8 text-right">{pct.toFixed(0)}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
