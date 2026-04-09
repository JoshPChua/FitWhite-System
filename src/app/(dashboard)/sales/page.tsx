'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/providers/auth-provider';
import { createClient } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import type { SaleStatus } from '@/types/database';

// ─── Types ──────────────────────────────────────────────────

interface SaleLineItem {
  id: string;
  item_type: string;
  name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
}

interface SaleRecord {
  id: string;
  receipt_number: string;
  branch_id: string;
  branch_name: string;
  cashier_name: string;
  customer_name: string | null;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  status: SaleStatus;
  notes: string | null;
  created_at: string;
  items?: SaleLineItem[];
  payments?: { method: string; amount: number; reference_number: string | null }[];
}

const STATUS_LABELS: Record<SaleStatus, string> = {
  completed: 'Completed',
  refunded: 'Refunded',
  partial_refund: 'Partial Refund',
  voided: 'Voided',
};

const STATUS_VARIANTS: Record<SaleStatus, 'success' | 'danger' | 'warning' | 'default'> = {
  completed: 'success',
  refunded: 'danger',
  partial_refund: 'warning',
  voided: 'default',
};

// ─── Component ──────────────────────────────────────────────

export default function SalesPage() {
  const { isOwner, isManager, selectedBranch, branches } = useAuth();
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [filterStatus, setFilterStatus] = useState<SaleStatus | ''>('');
  const [filterBranch, setFilterBranch] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 25;

  // Detail modal
  const [detailSale, setDetailSale] = useState<SaleRecord | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  // Void modal
  const [showVoid, setShowVoid] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [isVoiding, setIsVoiding] = useState(false);
  const [voidError, setVoidError] = useState('');

  // Refund modal
  const [showRefund, setShowRefund] = useState(false);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [refundReturnInv, setRefundReturnInv] = useState(false);
  const [isRefunding, setIsRefunding] = useState(false);
  const [refundError, setRefundError] = useState('');

  const supabase = createClient();

  // ─── Fetch ──────────────────────────────────────────────

  const fetchSales = useCallback(async () => {
    setIsLoading(true);
    try {
      let query = supabase
        .from('sales')
        .select('*, branches:branch_id(name), profiles:user_id(first_name, last_name), customers:customer_id(first_name, last_name)')
        .order('created_at', { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (!isOwner && selectedBranch?.id) query = query.eq('branch_id', selectedBranch.id);
      else if (filterBranch) query = query.eq('branch_id', filterBranch);

      if (filterStatus) query = query.eq('status', filterStatus);
      if (filterDateFrom) query = query.gte('created_at', filterDateFrom);
      if (filterDateTo) query = query.lte('created_at', filterDateTo + 'T23:59:59');

      const { data, error } = await query;
      if (error) { console.error('Sales fetch error:', error); return; }

      setSales((data || []).map((s: Record<string, unknown>) => ({
        id: s.id as string,
        receipt_number: s.receipt_number as string,
        branch_id: s.branch_id as string,
        branch_name: (s.branches as Record<string, unknown>)?.name as string || '',
        cashier_name: s.profiles
          ? `${(s.profiles as Record<string, unknown>).first_name} ${(s.profiles as Record<string, unknown>).last_name}`
          : '',
        customer_name: s.customers
          ? `${(s.customers as Record<string, unknown>).first_name} ${(s.customers as Record<string, unknown>).last_name}`
          : null,
        subtotal: Number(s.subtotal),
        discount: Number(s.discount),
        tax: Number(s.tax),
        total: Number(s.total),
        status: s.status as SaleStatus,
        notes: s.notes as string | null,
        created_at: s.created_at as string,
      })));
    } catch (err) {
      console.error('Sales page error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [supabase, isOwner, selectedBranch?.id, filterBranch, filterStatus, filterDateFrom, filterDateTo, page]);

  useEffect(() => { setPage(0); }, [filterStatus, filterBranch, filterDateFrom, filterDateTo, selectedBranch?.id]);
  useEffect(() => { fetchSales(); }, [fetchSales]);

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel('sales-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, () => fetchSales())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [supabase, fetchSales]);

  // ─── Load detail ─────────────────────────────────────────

  const openDetail = async (sale: SaleRecord) => {
    setDetailSale(sale);
    setIsLoadingDetail(true);
    try {
      const [{ data: items }, { data: payments }] = await Promise.all([
        supabase.from('sale_items').select('*').eq('sale_id', sale.id).order('id'),
        supabase.from('payments').select('*').eq('sale_id', sale.id),
      ]);
      setDetailSale(prev => prev ? {
        ...prev,
        items: (items || []).map((i: Record<string, unknown>) => ({
          id: i.id as string,
          item_type: i.item_type as string,
          name: i.name as string,
          quantity: i.quantity as number,
          unit_price: Number(i.unit_price),
          total_price: Number(i.total_price),
        })),
        payments: (payments || []).map((p: Record<string, unknown>) => ({
          method: p.method as string,
          amount: Number(p.amount),
          reference_number: p.reference_number as string | null,
        })),
      } : null);
    } catch (err) {
      console.error('Detail load error:', err);
    } finally {
      setIsLoadingDetail(false);
    }
  };

  // ─── Void ──────────────────────────────────────────────────

  const openVoid = () => {
    setVoidReason('');
    setVoidError('');
    setShowVoid(true);
  };

  const handleVoid = async () => {
    if (!voidReason.trim()) { setVoidError('Please provide a reason for voiding'); return; }
    if (!detailSale) return;
    setIsVoiding(true); setVoidError('');
    try {
      const res = await fetch(`/api/sales/${detailSale.id}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: voidReason }),
      });
      const data = await res.json();
      if (!res.ok) { setVoidError(data.error); return; }
      setShowVoid(false);
      setDetailSale(null);
      await fetchSales();
    } catch {
      setVoidError('Network error — please try again');
    } finally {
      setIsVoiding(false);
    }
  };

  // ─── Refund ────────────────────────────────────────────────

  const openRefund = () => {
    if (!detailSale) return;
    setRefundAmount(detailSale.total.toFixed(2));
    setRefundReason('');
    setRefundReturnInv(false);
    setRefundError('');
    setShowRefund(true);
  };

  const handleRefund = async () => {
    if (!detailSale) return;
    const amount = parseFloat(refundAmount);
    if (isNaN(amount) || amount <= 0) { setRefundError('Enter a valid refund amount'); return; }
    if (!refundReason.trim()) { setRefundError('Please provide a refund reason'); return; }
    if (amount > detailSale.total) { setRefundError(`Amount cannot exceed total ₱${detailSale.total.toFixed(2)}`); return; }
    setIsRefunding(true); setRefundError('');
    try {
      const res = await fetch(`/api/sales/${detailSale.id}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount,
          reason: refundReason,
          return_inventory: refundReturnInv,
          refund_type: 'product',
        }),
      });
      const data = await res.json();
      if (!res.ok) { setRefundError(data.error); return; }
      setShowRefund(false);
      setDetailSale(null);
      await fetchSales();
    } catch {
      setRefundError('Network error — please try again');
    } finally {
      setIsRefunding(false);
    }
  };

  // ─── Filtering (client-side search) ─────────────────────

  const filteredSales = sales.filter(s => {
    if (!searchText) return true;
    return s.receipt_number.toLowerCase().includes(searchText.toLowerCase()) ||
      (s.customer_name || '').toLowerCase().includes(searchText.toLowerCase()) ||
      s.cashier_name.toLowerCase().includes(searchText.toLowerCase());
  });

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(n);

  const formatDateTime = (dateStr: string) =>
    new Date(dateStr).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const totalRevenue = filteredSales
    .filter(s => s.status === 'completed' || s.status === 'partial_refund')
    .reduce((sum, s) => sum + s.total, 0);

  // ─── Render ─────────────────────────────────────────────

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-display font-semibold text-brand-900">Sales History</h1>
        <p className="text-sm text-brand-500 mt-1">
          {isOwner ? 'All transactions across branches' : 'Transactions for your branch'}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card px-5 py-4">
          <p className="text-xs font-medium text-brand-400 uppercase tracking-wide">Showing</p>
          <p className="text-2xl font-semibold text-brand-900 mt-1">{filteredSales.length}</p>
        </div>
        <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card px-5 py-4">
          <p className="text-xs font-medium text-brand-400 uppercase tracking-wide">Revenue</p>
          <p className="text-xl font-semibold text-emerald-700 mt-1">{formatCurrency(totalRevenue)}</p>
        </div>
        <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card px-5 py-4">
          <p className="text-xs font-medium text-brand-400 uppercase tracking-wide">Completed</p>
          <p className="text-2xl font-semibold text-brand-900 mt-1">{filteredSales.filter(s => s.status === 'completed').length}</p>
        </div>
        <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card px-5 py-4">
          <p className="text-xs font-medium text-brand-400 uppercase tracking-wide">Refunded</p>
          <p className="text-2xl font-semibold text-rose-600 mt-1">{filteredSales.filter(s => s.status === 'refunded' || s.status === 'partial_refund').length}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="lg:col-span-2">
            <label className="block text-xs font-medium text-brand-500 mb-1">Search</label>
            <input type="text" value={searchText} onChange={e => setSearchText(e.target.value)}
              placeholder="Receipt #, customer, or cashier..."
              className="w-full px-3 py-2 rounded-xl border border-brand-200 bg-surface-50 text-sm text-brand-800
                         placeholder:text-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all" />
          </div>
          {isOwner && (
            <div>
              <label className="block text-xs font-medium text-brand-500 mb-1">Branch</label>
              <select value={filterBranch} onChange={e => setFilterBranch(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-brand-200 bg-surface-50 text-sm text-brand-800
                           focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all">
                <option value="">All branches</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-brand-500 mb-1">Status</label>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as SaleStatus | '')}
              className="w-full px-3 py-2 rounded-xl border border-brand-200 bg-surface-50 text-sm text-brand-800
                         focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all">
              <option value="">All</option>
              <option value="completed">Completed</option>
              <option value="refunded">Refunded</option>
              <option value="partial_refund">Partial Refund</option>
              <option value="voided">Voided</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-brand-500 mb-1">Date From</label>
            <input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-brand-200 bg-surface-50 text-sm text-brand-800
                         focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all" />
          </div>
        </div>
        {(filterStatus || filterBranch || filterDateFrom || searchText) && (
          <div className="mt-3">
            <button onClick={() => { setFilterStatus(''); setFilterBranch(''); setFilterDateFrom(''); setSearchText(''); }}
              className="text-sm text-brand-500 hover:text-brand-700 px-3 py-1.5 rounded-xl hover:bg-brand-50 transition-colors">
              Clear filters
            </button>
          </div>
        )}
      </div>

      {/* Sales Table */}
      <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-brand-100/60 bg-surface-50">
                <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Receipt</th>
                {isOwner && <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Branch</th>}
                <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Customer</th>
                <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Cashier</th>
                <th className="text-right text-xs font-medium text-brand-400 px-5 py-3">Total</th>
                <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Status</th>
                <th className="text-left text-xs font-medium text-brand-400 px-5 py-3">Date</th>
                <th className="text-right text-xs font-medium text-brand-400 px-5 py-3">Details</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-brand-100/30">
                    <td className="px-5 py-4"><Skeleton className="h-4 w-28 mb-1" /><Skeleton className="h-3 w-16" /></td>
                    {isOwner && <td className="px-5 py-4"><Skeleton className="h-4 w-20" /></td>}
                    <td className="px-5 py-4"><Skeleton className="h-4 w-24" /></td>
                    <td className="px-5 py-4"><Skeleton className="h-4 w-20" /></td>
                    <td className="px-5 py-4 text-right"><Skeleton className="h-4 w-20 ml-auto" /></td>
                    <td className="px-5 py-4"><Skeleton className="h-5 w-20 rounded-full" /></td>
                    <td className="px-5 py-4"><Skeleton className="h-4 w-28" /></td>
                    <td className="px-5 py-4"><Skeleton className="h-4 w-12 ml-auto" /></td>
                  </tr>
                ))
              ) : filteredSales.length === 0 ? (
                <tr>
                  <td colSpan={isOwner ? 8 : 7} className="text-center py-16 text-sm text-brand-400">
                    <svg className="w-12 h-12 text-brand-200 mx-auto mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
                    </svg>
                    {searchText || filterStatus ? 'No transactions match your filters' : 'No sales recorded yet'}
                  </td>
                </tr>
              ) : (
                filteredSales.map(s => (
                  <tr key={s.id} className="border-b border-brand-100/30 hover:bg-brand-50/30 transition-colors">
                    <td className="px-5 py-4">
                      <p className="text-xs font-mono font-medium text-brand-700">{s.receipt_number}</p>
                    </td>
                    {isOwner && <td className="px-5 py-4"><span className="text-sm text-brand-500">{s.branch_name}</span></td>}
                    <td className="px-5 py-4">
                      <span className="text-sm text-brand-700">{s.customer_name || <span className="text-brand-300">Walk-in</span>}</span>
                    </td>
                    <td className="px-5 py-4">
                      <span className="text-sm text-brand-500">{s.cashier_name}</span>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <span className={`text-sm font-semibold ${s.status === 'voided' ? 'text-brand-400 line-through' : 'text-brand-800'}`}>
                        {formatCurrency(s.total)}
                      </span>
                      {s.discount > 0 && (
                        <p className="text-xs text-emerald-600">-{formatCurrency(s.discount)} off</p>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <Badge variant={STATUS_VARIANTS[s.status]} size="sm">{STATUS_LABELS[s.status]}</Badge>
                    </td>
                    <td className="px-5 py-4">
                      <span className="text-xs text-brand-400">{formatDateTime(s.created_at)}</span>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <button
                        onClick={() => openDetail(s)}
                        className="text-xs text-brand-500 hover:text-brand-700 hover:bg-brand-50 px-2.5 py-1.5 rounded-lg transition-colors font-medium"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {!isLoading && (
          <div className="px-5 py-3 border-t border-brand-100/40 flex items-center justify-between">
            <span className="text-xs text-brand-400">Page {page + 1} · {filteredSales.length} records shown</span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-brand-200 text-brand-600 hover:bg-brand-50
                           disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                ← Prev
              </button>
              <button
                onClick={() => setPage(p => p + 1)} disabled={filteredSales.length < PAGE_SIZE}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-brand-200 text-brand-600 hover:bg-brand-50
                           disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ─── Sale Detail Modal ─────────────────────────────── */}
      <Modal
        isOpen={!!detailSale} onClose={() => { setDetailSale(null); }}
        title={`Receipt: ${detailSale?.receipt_number || ''}`}
        subtitle={detailSale ? formatDateTime(detailSale.created_at) : ''}
        size="lg"
      >
        {detailSale && (
          <div className="space-y-5">
            {/* Sale meta */}
            <div className="grid grid-cols-2 gap-3 bg-surface-50 rounded-xl p-4 text-sm">
              <div><p className="text-xs text-brand-400 mb-0.5">Branch</p><p className="text-brand-800">{detailSale.branch_name}</p></div>
              <div><p className="text-xs text-brand-400 mb-0.5">Status</p><Badge variant={STATUS_VARIANTS[detailSale.status]} size="sm">{STATUS_LABELS[detailSale.status]}</Badge></div>
              <div><p className="text-xs text-brand-400 mb-0.5">Cashier</p><p className="text-brand-800">{detailSale.cashier_name}</p></div>
              <div><p className="text-xs text-brand-400 mb-0.5">Customer</p><p className="text-brand-800">{detailSale.customer_name || 'Walk-in'}</p></div>
            </div>

            {/* Items */}
            <div>
              <h3 className="text-sm font-semibold text-brand-800 mb-3">Items</h3>
              {isLoadingDetail ? (
                <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}</div>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {(detailSale.items || []).map(item => (
                    <div key={item.id} className="flex items-center justify-between gap-3 bg-surface-50 rounded-xl px-4 py-2.5 border border-brand-100/50">
                      <div>
                        <p className="text-sm text-brand-800">{item.name}</p>
                        <p className="text-xs text-brand-400 capitalize">{item.item_type} × {item.quantity}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-brand-700">{formatCurrency(item.total_price)}</p>
                        <p className="text-xs text-brand-400">{formatCurrency(item.unit_price)} ea.</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Totals */}
            <div className="bg-surface-50 rounded-xl p-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-brand-400">Subtotal</span><span className="text-brand-700">{formatCurrency(detailSale.subtotal)}</span></div>
              {detailSale.discount > 0 && <div className="flex justify-between"><span className="text-brand-400">Discount</span><span className="text-emerald-600">-{formatCurrency(detailSale.discount)}</span></div>}
              {detailSale.tax > 0 && <div className="flex justify-between"><span className="text-brand-400">Tax</span><span className="text-brand-700">{formatCurrency(detailSale.tax)}</span></div>}
              <div className="flex justify-between font-semibold border-t border-brand-100 pt-2">
                <span className="text-brand-800">Total</span>
                <span className="text-brand-900 text-base">{formatCurrency(detailSale.total)}</span>
              </div>
            </div>

            {/* Payments */}
            {!isLoadingDetail && (detailSale.payments || []).length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-brand-800 mb-2">Payments</h3>
                <div className="space-y-1.5">
                  {(detailSale.payments || []).map((pay, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 bg-surface-50 rounded-xl px-4 py-2.5 text-sm">
                      <span className="capitalize text-brand-700 font-medium">{pay.method.replace('_', ' ')}</span>
                      {pay.reference_number && <span className="text-xs text-brand-400 font-mono">{pay.reference_number}</span>}
                      <span className="text-brand-800 font-semibold">{formatCurrency(pay.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {detailSale.notes && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                <p className="text-xs font-medium text-amber-700 mb-1">Notes</p>
                <p className="text-sm text-amber-800">{detailSale.notes}</p>
              </div>
            )}

            {/* ─ Void / Refund Actions (manager+) ─ */}
            {(isOwner || isManager) && detailSale && (
              <div className="flex gap-2 pt-1">
                {(detailSale.status === 'completed' || detailSale.status === 'partial_refund') && (
                  <button onClick={openRefund}
                    className="flex-1 py-2 px-3 rounded-xl border border-amber-300 text-amber-700 text-xs font-medium hover:bg-amber-50 transition-colors">
                    Issue Refund
                  </button>
                )}
                {(detailSale.status === 'completed') && (
                  <button onClick={openVoid}
                    className="flex-1 py-2 px-3 rounded-xl border border-rose-300 text-rose-700 text-xs font-medium hover:bg-rose-50 transition-colors">
                    Void Sale
                  </button>
                )}
              </div>
            )}

            <button onClick={() => setDetailSale(null)}
              className="w-full py-2.5 px-4 rounded-xl border border-brand-200 text-brand-600 text-sm font-medium hover:bg-brand-50 transition-colors">
              Close
            </button>
          </div>
        )}
      </Modal>

      {/* ─── Void Modal ─────────────────────────────────────── */}
      <Modal
        isOpen={showVoid} onClose={() => setShowVoid(false)}
        title="Void Sale"
        subtitle={`Receipt: ${detailSale?.receipt_number}`}
        size="sm"
      >
        <div className="space-y-4">
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-4">
            <p className="text-sm font-medium text-rose-800">⚠ This action is permanent</p>
            <p className="text-xs text-rose-700 mt-1">
              Voiding will mark this sale as invalid and restore inventory for any product items sold.
              This cannot be undone.
            </p>
          </div>

          {voidError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{voidError}</div>
          )}

          <div>
            <label className="block text-sm font-medium text-brand-800 mb-1.5">Reason for Voiding <span className="text-rose-500">*</span></label>
            <textarea
              value={voidReason} onChange={e => setVoidReason(e.target.value)}
              rows={3} placeholder="Enter reason (e.g. duplicate transaction, data entry error)..."
              className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900 placeholder:text-brand-300
                         focus:outline-none focus:ring-2 focus:ring-brand-400/50 resize-none transition-all"
            />
          </div>

          <div className="flex gap-3">
            <button onClick={handleVoid} disabled={isVoiding}
              className="flex-1 py-2.5 px-4 rounded-xl bg-rose-600 text-white text-sm font-medium hover:bg-rose-700 active:scale-[0.98]
                         disabled:opacity-60 disabled:cursor-not-allowed transition-all">
              {isVoiding ? 'Voiding...' : 'Confirm Void'}
            </button>
            <button onClick={() => setShowVoid(false)}
              className="px-4 py-2.5 rounded-xl border border-brand-200 text-brand-600 text-sm font-medium hover:bg-brand-50 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      </Modal>

      {/* ─── Refund Modal ────────────────────────────────────── */}
      <Modal
        isOpen={showRefund} onClose={() => setShowRefund(false)}
        title="Issue Refund"
        subtitle={`Receipt: ${detailSale?.receipt_number} · Total: ${detailSale ? formatCurrency(detailSale.total) : ''}`}
        size="sm"
      >
        <div className="space-y-4">
          {refundError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{refundError}</div>
          )}

          <div>
            <label className="block text-sm font-medium text-brand-800 mb-1.5">Refund Amount <span className="text-rose-500">*</span></label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-400 text-sm">₱</span>
              <input
                type="number" min="0.01" step="0.01"
                value={refundAmount} onChange={e => setRefundAmount(e.target.value)}
                max={detailSale?.total || 0}
                className="w-full pl-8 pr-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900
                           focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all"
              />
            </div>
            {detailSale && (
              <p className="text-xs text-brand-400 mt-1">Max: {formatCurrency(detailSale.total)}</p>
            )}
          </div>

          {/* Quick amount buttons */}
          {detailSale && (
            <div className="flex gap-2">
              <button onClick={() => setRefundAmount(detailSale.total.toFixed(2))}
                className="flex-1 py-1.5 rounded-lg border border-brand-200 text-xs text-brand-600 hover:bg-brand-50 transition-colors">
                Full Refund
              </button>
              <button onClick={() => setRefundAmount((detailSale.total / 2).toFixed(2))}
                className="flex-1 py-1.5 rounded-lg border border-brand-200 text-xs text-brand-600 hover:bg-brand-50 transition-colors">
                50%
              </button>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-brand-800 mb-1.5">Reason <span className="text-rose-500">*</span></label>
            <textarea
              value={refundReason} onChange={e => setRefundReason(e.target.value)}
              rows={2} placeholder="e.g. Customer dissatisfied, allergic reaction..."
              className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900 placeholder:text-brand-300
                         focus:outline-none focus:ring-2 focus:ring-brand-400/50 resize-none transition-all"
            />
          </div>

          <label className="flex items-center gap-3 cursor-pointer p-3 rounded-xl border border-brand-200 hover:bg-brand-50 transition-colors">
            <input type="checkbox" checked={refundReturnInv}
              onChange={e => setRefundReturnInv(e.target.checked)}
              className="w-4 h-4 accent-brand-600" />
            <div>
              <p className="text-sm font-medium text-brand-800">Return items to inventory</p>
              <p className="text-xs text-brand-400">Restore product stock for this sale</p>
            </div>
          </label>

          <div className="flex gap-3">
            <button onClick={handleRefund} disabled={isRefunding}
              className="flex-1 py-2.5 px-4 rounded-xl bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 active:scale-[0.98]
                         disabled:opacity-60 disabled:cursor-not-allowed transition-all">
              {isRefunding ? 'Processing...' : 'Confirm Refund'}
            </button>
            <button onClick={() => setShowRefund(false)}
              className="px-4 py-2.5 rounded-xl border border-brand-200 text-brand-600 text-sm font-medium hover:bg-brand-50 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
