'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/providers/auth-provider';
import { createClient } from '@/lib/supabase/client';
import { StatCard } from '@/components/ui/stat-card';
import { Badge } from '@/components/ui/badge';
import { StatCardSkeleton } from '@/components/ui/skeleton';
import { ENABLE_PATIENT_PACKAGES, ENABLE_DOCTOR_COMMISSIONS } from '@/lib/feature-flags';

interface DashboardStats {
  totalRevenue: number;
  totalSales: number;
  totalRefunds: number;
  netRevenue: number;
  totalCustomers: number;
  lowStockCount: number;
  todaySales: number;
  todayRevenue: number;
}

interface BranchPerformance {
  branch_id: string;
  branch_name: string;
  total_revenue: number;
  sale_count: number;
}

interface RecentSale {
  id: string;
  receipt_number: string;
  total: number;
  status: string;
  created_at: string;
  branch_name?: string;
  cashier_name?: string;
}

interface LowStockItem {
  product_name: string;
  branch_name: string;
  quantity: number;
  low_stock_threshold: number;
}

export default function DashboardPage() {
  const { isOwner, selectedBranch, profile } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [branchPerf, setBranchPerf] = useState<BranchPerformance[]>([]);
  const [recentSales, setRecentSales] = useState<RecentSale[]>([]);
  const [lowStock, setLowStock] = useState<LowStockItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [outstandingAR, setOutstandingAR] = useState(0);
  const [unpaidCommissions, setUnpaidCommissions] = useState(0);

  const supabase = createClient();

  const fetchDashboard = useCallback(async () => {
    setIsLoading(true);
    try {
      // P1 fix: non-owners are ALWAYS scoped to their branch — use profile.branch_id as
      // hard fallback so even a missing selectedBranch can't return unscoped data.
      const branchFilter = isOwner
        ? null
        : (selectedBranch?.id ?? profile?.branch_id ?? '__none__');

      // Fetch sales stats (with branch join for name resolution in branch perf)
      const salesQuery = branchFilter
        ? supabase.from('sales').select('total, status, branch_id, created_at, branches:branch_id(name)').eq('branch_id', branchFilter)
        : supabase.from('sales').select('total, status, branch_id, created_at, branches:branch_id(name)');
      const { data: salesData } = await salesQuery;

      // Fetch refunds
      const refundsQuery = branchFilter
        ? supabase.from('refunds').select('amount, branch_id').eq('branch_id', branchFilter)
        : supabase.from('refunds').select('amount, branch_id');
      const { data: refundsData } = await refundsQuery;

      // Fetch customers count
      const custQuery = branchFilter
        ? supabase.from('customers').select('id', { count: 'exact', head: true }).eq('branch_id', branchFilter)
        : supabase.from('customers').select('id', { count: 'exact', head: true });
      const { count: customerCount } = await custQuery;

      // Fetch low stock
      const invBase = supabase
        .from('inventory')
        .select('quantity, low_stock_threshold, product_id, branch_id, products(name), branches(name)');
      const invQuery = branchFilter ? invBase.eq('branch_id', branchFilter) : invBase;
      const { data: inventoryData } = await invQuery;

      // Fetch recent sales
      const recentBase = supabase
        .from('sales')
        .select('id, receipt_number, total, status, created_at, branches(name), profiles:user_id(first_name, last_name)')
        .order('created_at', { ascending: false })
        .limit(10);
      const recentQuery = branchFilter ? recentBase.eq('branch_id', branchFilter) : recentBase;
      const { data: recentData } = await recentQuery;

      // Calculate stats
      const today = new Date().toISOString().split('T')[0];
      const sales = (salesData || []) as Array<Record<string, unknown>>;
      const refunds = (refundsData || []) as Array<Record<string, unknown>>;

      const totalRevenue = sales
        .filter(s => s.status === 'completed' || s.status === 'partial_refund')
        .reduce((sum, s) => sum + Number(s.total), 0);

      const totalRefundAmount = refunds.reduce((sum, r) => sum + Number(r.amount), 0);

      const todaySalesArr = sales.filter(s => (s.created_at as string)?.startsWith(today));
      const todayRevenue = todaySalesArr
        .filter(s => s.status === 'completed' || s.status === 'partial_refund')
        .reduce((sum, s) => sum + Number(s.total), 0);

      // Low stock items
      const lowStockItems: LowStockItem[] = (inventoryData || [])
        .filter((inv: Record<string, unknown>) => (inv.quantity as number) <= (inv.low_stock_threshold as number))
        .map((inv: Record<string, unknown>) => ({
          product_name: (inv.products as Record<string, unknown>)?.name as string || 'Unknown',
          branch_name: (inv.branches as Record<string, unknown>)?.name as string || 'Unknown',
          quantity: inv.quantity as number,
          low_stock_threshold: inv.low_stock_threshold as number,
        }));

      // Branch performance (owner only)
      if (isOwner) {
        const branchMap = new Map<string, BranchPerformance>();
        for (const sale of sales) {
          if (sale.status !== 'completed' && sale.status !== 'partial_refund') continue;
          const branchName = (sale.branches as Record<string, unknown>)?.name as string || '';
          const existing = branchMap.get(sale.branch_id as string) || {
            branch_id: sale.branch_id as string,
            branch_name: branchName,
            total_revenue: 0,
            sale_count: 0,
          };
          existing.total_revenue += Number(sale.total);
          existing.sale_count += 1;
          if (!existing.branch_name && branchName) existing.branch_name = branchName;
          branchMap.set(sale.branch_id as string, existing);
        }
        setBranchPerf(Array.from(branchMap.values()).sort((a, b) => b.total_revenue - a.total_revenue));
      }

      setStats({
        totalRevenue,
        totalSales: sales.length,
        totalRefunds: refunds.length,
        netRevenue: totalRevenue - totalRefundAmount,
        totalCustomers: customerCount || 0,
        lowStockCount: lowStockItems.length,
        todaySales: todaySalesArr.length,
        todayRevenue,
      });

      setLowStock(lowStockItems.slice(0, 10));

      setRecentSales(
        (recentData || []).map((s: Record<string, unknown>) => ({
          id: s.id as string,
          receipt_number: s.receipt_number as string,
          total: Number(s.total),
          status: s.status as string,
          created_at: s.created_at as string,
          branch_name: (s.branches as Record<string, unknown>)?.name as string || '',
          cashier_name: s.profiles
            ? `${(s.profiles as Record<string, unknown>).first_name} ${(s.profiles as Record<string, unknown>).last_name}`
            : '',
        }))
      );
      // Phase 4: Fetch A/R (outstanding package balances)
      if (ENABLE_PATIENT_PACKAGES) {
        const arQuery = branchFilter
          ? supabase.from('patient_packages').select('remaining_balance').eq('status', 'active').eq('branch_id', branchFilter)
          : supabase.from('patient_packages').select('remaining_balance').eq('status', 'active');
        const { data: arData } = await arQuery;
        const totalAR = (arData || []).reduce((sum: number, p: Record<string, unknown>) => sum + Number(p.remaining_balance || 0), 0);
        setOutstandingAR(totalAR);
      }

      // Phase 4: Fetch unpaid commissions
      if (ENABLE_DOCTOR_COMMISSIONS) {
        const commQuery = branchFilter
          ? supabase.from('doctor_commissions').select('commission_amount').eq('is_paid', false).eq('branch_id', branchFilter)
          : supabase.from('doctor_commissions').select('commission_amount').eq('is_paid', false);
        const { data: commData } = await commQuery;
        const totalComm = (commData || []).reduce((sum: number, c: Record<string, unknown>) => sum + Number(c.commission_amount || 0), 0);
        setUnpaidCommissions(totalComm);
      }
    } catch (error) {
      console.error('Dashboard fetch error:', error);
    } finally {
      setIsLoading(false);
    }
  }, [supabase, isOwner, selectedBranch?.id]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  // Realtime subscription for sales
  useEffect(() => {
    const channel = supabase
      .channel('dashboard-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, () => {
        fetchDashboard();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, () => {
        fetchDashboard();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [supabase, fetchDashboard]);

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(amount);

  const formatTime = (dateStr: string) =>
    new Date(dateStr).toLocaleString('en-PH', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });

  const greeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 17) return 'Good Afternoon';
    return 'Good Evening';
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-display font-semibold text-brand-900">
          {greeting()}, {profile?.first_name}
        </h1>
        <p className="text-sm text-brand-500 mt-1">
          {isOwner ? 'Global overview across all branches' : `${selectedBranch?.name || ''} branch overview`}
        </p>
      </div>

      {/* Stat Cards */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton />
        </div>
      ) : stats && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              title="Today's Revenue"
              value={formatCurrency(stats.todayRevenue)}
              subtitle={`${stats.todaySales} transactions`}
              variant="success"
              icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              }
            />
            <StatCard
              title="Net Revenue"
              value={formatCurrency(stats.netRevenue)}
              subtitle={`${stats.totalSales} total sales`}
              variant="default"
              icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
                </svg>
              }
            />
            <StatCard
              title="Customers"
              value={stats.totalCustomers}
              subtitle="Registered patients"
              variant="info"
              icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
                </svg>
              }
            />
            <StatCard
              title="Low Stock Alerts"
              value={stats.lowStockCount}
              subtitle="Products below threshold"
              variant={stats.lowStockCount > 0 ? 'danger' : 'success'}
              icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
              }
            />
          </div>

          {/* Second row: Refunds + Phase 4 KPIs */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              title="Gross Revenue"
              value={formatCurrency(stats.totalRevenue)}
              subtitle="Before refunds"
              variant="default"
            />
            <StatCard
              title="Total Refunds"
              value={stats.totalRefunds}
              subtitle="Processed refunds"
              variant={stats.totalRefunds > 0 ? 'warning' : 'default'}
            />
            {ENABLE_PATIENT_PACKAGES && (
              <StatCard
                title="Outstanding A/R"
                value={formatCurrency(outstandingAR)}
                subtitle="Active package balances"
                variant={outstandingAR > 0 ? 'warning' : 'success'}
                icon={
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0l-3-3m3 3l3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
                  </svg>
                }
              />
            )}
            {ENABLE_DOCTOR_COMMISSIONS && (
              <StatCard
                title="Unpaid Commissions"
                value={formatCurrency(unpaidCommissions)}
                subtitle="Due to doctors"
                variant={unpaidCommissions > 0 ? 'danger' : 'default'}
                icon={
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                }
              />
            )}
          </div>
        </>
      )}

      {/* Main grid: Recent sales + Low stock / Branch performance */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Transactions */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-brand-100/50 shadow-card">
          <div className="p-5 border-b border-brand-100/60">
            <h2 className="text-base font-semibold text-brand-900">Recent Transactions</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-brand-100/40">
                  <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Receipt</th>
                  {isOwner && <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Branch</th>}
                  <th className="text-right text-xs font-medium text-brand-400 px-5 py-3">Amount</th>
                  <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Status</th>
                  <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Time</th>
                </tr>
              </thead>
              <tbody>
                {recentSales.length === 0 ? (
                  <tr>
                    <td colSpan={isOwner ? 5 : 4} className="text-center py-12 text-sm text-brand-400">
                      No transactions yet
                    </td>
                  </tr>
                ) : (
                  recentSales.map((sale) => (
                    <tr key={sale.id} className="border-b border-brand-100/30 hover:bg-brand-50/30 transition-colors">
                      <td className="px-5 py-3 text-sm font-mono text-brand-700">{sale.receipt_number}</td>
                      {isOwner && <td className="px-5 py-3 text-sm text-brand-600">{sale.branch_name}</td>}
                      <td className="px-5 py-3 text-sm font-semibold text-brand-800 text-right">
                        {formatCurrency(sale.total)}
                      </td>
                      <td className="px-5 py-3">
                        <Badge
                          variant={
                            sale.status === 'completed' ? 'success' :
                            sale.status === 'refunded' ? 'danger' :
                            sale.status === 'partial_refund' ? 'warning' : 'default'
                          }
                          size="sm"
                        >
                          {sale.status.replace('_', ' ')}
                        </Badge>
                      </td>
                      <td className="px-5 py-3 text-xs text-brand-400">{formatTime(sale.created_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Low Stock Alerts */}
          {lowStock.length > 0 && (
            <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card">
              <div className="p-5 border-b border-brand-100/60 flex items-center gap-2">
                <div className="w-2 h-2 bg-rose-500 rounded-full animate-pulse-soft" />
                <h2 className="text-base font-semibold text-brand-900">Low Stock Alerts</h2>
              </div>
              <div className="p-3">
                {lowStock.map((item, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-rose-50/50 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-brand-800 truncate">{item.product_name}</p>
                      <p className="text-xs text-brand-400">{item.branch_name}</p>
                    </div>
                    <Badge variant="danger" size="sm">
                      {item.quantity} left
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Branch Performance (Owner only) */}
          {isOwner && branchPerf.length > 0 && (
            <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card">
              <div className="p-5 border-b border-brand-100/60">
                <h2 className="text-base font-semibold text-brand-900">Branch Performance</h2>
              </div>
              <div className="p-3">
                {branchPerf.map((bp, i) => (
                  <div
                    key={bp.branch_id}
                    className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-brand-50/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-bold text-brand-400 w-5">#{i + 1}</span>
                      <div>
                        <p className="text-sm font-medium text-brand-800">{bp.branch_name || 'Branch'}</p>
                        <p className="text-xs text-brand-400">{bp.sale_count} sales</p>
                      </div>
                    </div>
                    <span className="text-sm font-semibold text-brand-700">
                      {formatCurrency(bp.total_revenue)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Needs Attention */}
          <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card p-5">
            <h2 className="text-base font-semibold text-brand-900 mb-3">Needs Attention</h2>
            <div className="space-y-2">
              {stats && stats.lowStockCount > 0 && (
                <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 px-3 py-2 rounded-lg">
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                  {stats.lowStockCount} product{stats.lowStockCount > 1 ? 's' : ''} below stock threshold
                </div>
              )}
              {stats && stats.totalRefunds > 0 && (
                <div className="flex items-center gap-2 text-sm text-blue-700 bg-blue-50 px-3 py-2 rounded-lg">
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                  </svg>
                  {stats.totalRefunds} refund{stats.totalRefunds > 1 ? 's' : ''} processed
                </div>
              )}
              {stats && stats.lowStockCount === 0 && stats.totalRefunds === 0 && (
                <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 px-3 py-2 rounded-lg">
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  All systems running smoothly
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
