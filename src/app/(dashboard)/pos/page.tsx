'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '@/providers/auth-provider';
import { createClient } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { ENABLE_DOCTOR_COMMISSIONS, ENABLE_SERVICE_BOM } from '@/lib/feature-flags';

// ─── Types ───────────────────────────────────────────────────

type ItemType = 'service' | 'product' | 'bundle';
type PaymentMethod = 'cash' | 'gcash' | 'card' | 'bank_transfer';
type POSTab = 'services' | 'products' | 'bundles';

interface CatalogItem {
  id: string;
  item_type: ItemType;
  name: string;
  price: number;
  category?: string | null;
  unit?: string;
  description?: string | null;
  stock?: number | null;        // only for products
  is_active: boolean;
}

interface CartLine {
  key: string;              // unique: `${item_type}:${id}`
  item_type: ItemType;
  id: string;
  name: string;
  unit_price: number;
  quantity: number;
  total_price: number;
  stock?: number | null;   // track for product cap
}

interface Customer {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  store_credit: number;
  allergies: string | null;
}

interface CompletedSale {
  receipt_number: string;
  total: number;
  total_paid: number;
  change: number;
  cashier_name: string;
  customer_name: string | null;
  items: CartLine[];
  payments: Array<{ method: PaymentMethod; amount: number; change_amount?: number; reference_number?: string | null }>;
  timestamp: string;
  payment_type: 'full' | 'installment';
  packages_created: Array<{ id: string; service_name: string; total_sessions: number }>;
  balance_remaining: number;
}

interface Doctor {
  id: string;
  first_name: string;
  last_name: string;
}

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: '💵 Cash',
  gcash: '📱 GCash',
  card: '💳 Card',
  bank_transfer: '🏦 Bank Transfer',
};

// ─── Component ───────────────────────────────────────────────

export default function POSPage() {
  const { profile, isOwner, isManager, selectedBranch, branches } = useAuth();
  const supabase = createClient();

  // POS Branch — cashier uses their own, owner/manager can switch
  const [posBranch, setPosBranch] = useState(selectedBranch);

  // Catalog
  const [activeTab, setActiveTab] = useState<POSTab>('services');
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  // Cart
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discount, setDiscount] = useState(0);
  const [discountMode, setDiscountMode] = useState<'flat' | 'percent'>('flat');
  const [notes, setNotes] = useState('');

  // Customer
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [showCustomerSearch, setShowCustomerSearch] = useState(false);
  const customerInputRef = useRef<HTMLInputElement>(null);

  // Payment modal
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [payments, setPayments] = useState<Array<{ method: PaymentMethod; amount: string; reference_number: string }>>([
    { method: 'cash', amount: '', reference_number: '' }
  ]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentError, setPaymentError] = useState('');

  // Receipt modal
  const [completedSale, setCompletedSale] = useState<CompletedSale | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);

  // Phase 4: Doctor & Payment Type
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [attendingDoctorId, setAttendingDoctorId] = useState<string>('');
  const [paymentType, setPaymentType] = useState<'full' | 'installment'>('full');

  // Extra consumables modal
  const [showExtraConsumable, setShowExtraConsumable] = useState(false);
  const [extraProducts, setExtraProducts] = useState<Array<{id: string; name: string; stock: number}>>([]);
  const [extraSelectedProduct, setExtraSelectedProduct] = useState('');
  const [extraQty, setExtraQty] = useState('1');
  const [extraNotes, setExtraNotes] = useState('');
  const [extraSubmitting, setExtraSubmitting] = useState(false);
  const [extraError, setExtraError] = useState('');

  // ─── Fetch Catalog ────────────────────────────────────────

  const fetchCatalog = useCallback(async () => {
    if (!posBranch?.id) return;
    setIsLoadingCatalog(true);
    setCatalog([]);
    setCategoryFilter('');

    try {
      if (activeTab === 'services') {
        const { data } = await supabase
          .from('services')
          .select('id, name, price, category, description, is_active')
          .eq('branch_id', posBranch.id)
          .eq('is_active', true)
          .order('category')
          .order('name');
        setCatalog((data || []).map((s: Record<string, unknown>) => ({
          id: s.id as string,
          item_type: 'service' as ItemType,
          name: s.name as string,
          price: Number(s.price),
          category: s.category as string | null,
          description: s.description as string | null,
          is_active: s.is_active as boolean,
        })));
      } else if (activeTab === 'products') {
        const { data } = await supabase
          .from('products')
          .select('id, name, price, category, unit, description, is_active, inventory!inner(quantity, branch_id)')
          .eq('branch_id', posBranch.id)
          .eq('is_active', true)
          .eq('inventory.branch_id', posBranch.id)
          .order('name');
        setCatalog((data || []).map((p: Record<string, unknown>) => ({
          id: p.id as string,
          item_type: 'product' as ItemType,
          name: p.name as string,
          price: Number(p.price),
          category: p.category as string | null,
          unit: p.unit as string,
          description: p.description as string | null,
          is_active: p.is_active as boolean,
          stock: ((p.inventory as Record<string, unknown>[])?.[0]?.quantity ?? 0) as number,
        })));
      } else {
        const { data } = await supabase
          .from('bundles')
          .select('id, name, price, description, is_active, bundle_items(id, quantity, services:service_id(name), products:product_id(name))')
          .eq('branch_id', posBranch.id)
          .eq('is_active', true)
          .order('name');
        setCatalog((data || []).map((b: Record<string, unknown>) => ({
          id: b.id as string,
          item_type: 'bundle' as ItemType,
          name: b.name as string,
          price: Number(b.price),
          description: b.description as string | null,
          is_active: b.is_active as boolean,
        })));
      }
    } finally {
      setIsLoadingCatalog(false);
    }
  }, [supabase, activeTab, posBranch?.id]);

  useEffect(() => { fetchCatalog(); }, [fetchCatalog]);

  useEffect(() => {
    setPosBranch(selectedBranch);
  }, [selectedBranch]);

  // ─── Customer Search ──────────────────────────────────────

  useEffect(() => {
    const searchCustomers = async () => {
      if (!customerSearch.trim() || customerSearch.length < 2 || !posBranch?.id) {
        setCustomerResults([]);
        return;
      }
      const q = customerSearch.toLowerCase();
      const branchFilter = isOwner ? {} : { branch_id: posBranch.id };
      const { data } = await supabase
        .from('customers')
        .select('id, first_name, last_name, phone, email, store_credit, allergies, branch_id')
        .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,phone.ilike.%${q}%`)
        .eq('branch_id', posBranch.id)
        .limit(6);
      setCustomerResults((data || []).map((c: Record<string, unknown>) => ({
        id: c.id as string,
        first_name: c.first_name as string,
        last_name: c.last_name as string,
        phone: c.phone as string | null,
        email: c.email as string | null,
        store_credit: Number(c.store_credit),
        allergies: c.allergies as string | null,
      })));
    };
    const t = setTimeout(searchCustomers, 250);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerSearch, posBranch?.id]);

  // ─── Fetch Doctors (for commission tracking) ──────────────

  useEffect(() => {
    if (!ENABLE_DOCTOR_COMMISSIONS) return;
    const fetchDoctors = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, first_name, last_name')
        .eq('is_doctor', true)
        .eq('is_active', true);
      setDoctors((data || []) as Doctor[]);
    };
    fetchDoctors();
  }, [supabase]);

  // ─── Cart ─────────────────────────────────────────────────

  const addToCart = (item: CatalogItem) => {
    const key = `${item.item_type}:${item.id}`;
    setCart(prev => {
      const existing = prev.find(l => l.key === key);
      if (existing) {
        // Cap product at stock
        if (item.item_type === 'product' && item.stock !== null && item.stock !== undefined) {
          if (existing.quantity >= item.stock) return prev;
        }
        return prev.map(l => l.key === key ? {
          ...l,
          quantity: l.quantity + 1,
          total_price: (l.quantity + 1) * l.unit_price,
        } : l);
      }
      return [...prev, {
        key,
        item_type: item.item_type,
        id: item.id,
        name: item.name,
        unit_price: item.price,
        quantity: 1,
        total_price: item.price,
        stock: item.stock,
      }];
    });
  };

  const updateQty = (key: string, delta: number) => {
    setCart(prev => prev
      .map(l => {
        if (l.key !== key) return l;
        const newQty = l.quantity + delta;
        if (newQty < 1) return l;
        // Cap at stock
        if (l.item_type === 'product' && l.stock !== null && l.stock !== undefined) {
          if (newQty > l.stock) return l;
        }
        return { ...l, quantity: newQty, total_price: newQty * l.unit_price };
      })
      .filter(l => l.quantity > 0));
  };

  const removeFromCart = (key: string) => {
    setCart(prev => prev.filter(l => l.key !== key));
  };

  const clearCart = () => {
    setCart([]);
    setDiscount(0);
    setNotes('');
    setCustomer(null);
    setCustomerSearch('');
  };

  // ─── Totals ───────────────────────────────────────────────

  const subtotal = cart.reduce((sum, l) => sum + l.total_price, 0);
  const discountAmount = discountMode === 'percent'
    ? subtotal * (discount / 100)
    : Math.min(discount, subtotal);
  const total = Math.max(0, subtotal - discountAmount);

  const totalPaid = payments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
  const change = Math.max(0, totalPaid - total);
  const amountDue = Math.max(0, total - totalPaid);

  // ─── Payment Modal ────────────────────────────────────────

  const openPayment = () => {
    if (!cart.length) return;
    setPayments([{ method: 'cash', amount: total.toFixed(2), reference_number: '' }]);
    setPaymentError('');
    setShowPaymentModal(true);
  };

  const addPaymentLine = () => {
    setPayments(prev => [...prev, { method: 'gcash', amount: '', reference_number: '' }]);
  };

  const removePaymentLine = (i: number) => {
    setPayments(prev => prev.filter((_, idx) => idx !== i));
  };

  const updatePaymentLine = (i: number, field: keyof typeof payments[0], value: string) => {
    setPayments(prev => prev.map((p, idx) => idx === i ? { ...p, [field]: value } : p));
  };

  // ─── Checkout ─────────────────────────────────────────────

  const handleCheckout = async () => {
    setPaymentError('');
    if (!posBranch?.id) { setPaymentError('No branch selected'); return; }
    // For installment sales, allow partial payment
    if (paymentType === 'full' && totalPaid < total - 0.01) {
      setPaymentError(`Payment insufficient. Amount due: ₱${amountDue.toFixed(2)}`);
      return;
    }
    if (paymentType === 'installment' && !customer) {
      setPaymentError('Customer is required for installment/package sales');
      return;
    }

    setIsProcessing(true);
    try {
      const paymentsPayload = payments
        .filter(p => parseFloat(p.amount) > 0)
        .map(p => ({
          method: p.method,
          amount: parseFloat(p.amount),
          change_amount: p.method === 'cash' ? change : 0,
          reference_number: p.reference_number || null,
        }));

      const itemsPayload = cart.map(l => ({
        item_type: l.item_type,
        id: l.id,
        name: l.name,
        quantity: l.quantity,
        unit_price: l.unit_price,
      }));

      const res = await fetch('/api/sales/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branch_id: posBranch.id,
          customer_id: customer?.id ?? null,
          items: itemsPayload,
          payments: paymentsPayload,
          discount: discountAmount,
          tax: 0,
          notes: notes || null,
          attending_doctor_id: attendingDoctorId || null,
          payment_type: paymentType,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setPaymentError(data.error || 'Checkout failed');
        return;
      }

      // Show receipt
      const completed: CompletedSale = {
        receipt_number: data.receipt_number,
        total,
        total_paid: totalPaid,
        change,
        cashier_name: `${profile?.first_name} ${profile?.last_name}`,
        customer_name: customer ? `${customer.first_name} ${customer.last_name}` : null,
        items: [...cart],
        payments: paymentsPayload,
        timestamp: new Date().toLocaleString('en-PH', {
          month: 'long', day: 'numeric', year: 'numeric',
          hour: '2-digit', minute: '2-digit',
        }),
        payment_type: paymentType,
        packages_created: data.packages_created || [],
        balance_remaining: paymentType === 'installment' ? total - totalPaid : 0,
      };
      setCompletedSale(completed);
      setShowPaymentModal(false);
      setShowReceipt(true);

      // Reset POS
      clearCart();
      setAttendingDoctorId('');
      setPaymentType('full');
    } catch {
      setPaymentError('Network error — please try again');
    } finally {
      setIsProcessing(false);
    }
  };

  // ─── Helpers ──────────────────────────────────────────────

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(n);

  const filteredCatalog = catalog.filter(item => {
    const matchesSearch = !catalogSearch ||
      item.name.toLowerCase().includes(catalogSearch.toLowerCase());
    const matchesCategory = !categoryFilter ||
      item.category === categoryFilter;
    const inStock = item.item_type !== 'product' || (item.stock !== null && item.stock! > 0);
    return matchesSearch && matchesCategory && inStock;
  });

  const categories = [...new Set(catalog
    .map(i => i.category)
    .filter(Boolean))] as string[];

  const TAB_LABELS: Record<POSTab, string> = { services: 'Services', products: 'Products', bundles: 'Bundles' };

  // ─── Render ──────────────────────────────────────────────

  return (
    <div className="flex h-[calc(100vh-112px)] gap-5 animate-fade-in overflow-hidden">

      {/* ═══ LEFT PANE — Catalog ═══════════════════════════════ */}
      <div className="flex-1 flex flex-col gap-4 min-w-0">

        {/* POS Header */}
        <div className="flex items-center justify-between gap-3 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex rounded-xl border border-brand-200 bg-white overflow-hidden shadow-sm">
              {(['services', 'products', 'bundles'] as POSTab[]).map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${
                    activeTab === tab
                      ? 'bg-brand-600 text-white'
                      : 'text-brand-500 hover:bg-brand-50'
                  }`}>
                  {TAB_LABELS[tab]}
                </button>
              ))}
            </div>
            {/* Branch selector (owner/manager only) */}
            {(isOwner || isManager) && (
              <select
                value={posBranch?.id || ''}
                onChange={e => {
                  const b = branches.find(br => br.id === e.target.value);
                  setPosBranch(b || null);
                  clearCart();
                }}
                className="px-3 py-2 rounded-xl border border-brand-200 bg-white text-sm text-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-400/50 shadow-sm"
              >
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            )}
          </div>
          <div className="relative">
            <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-brand-400 pointer-events-none" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              type="text" value={catalogSearch}
              onChange={e => setCatalogSearch(e.target.value)}
              placeholder={`Search ${TAB_LABELS[activeTab].toLowerCase()}...`}
              className="pl-9 pr-4 py-2 w-56 rounded-xl border border-brand-200 bg-white text-sm text-brand-800
                         placeholder:text-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-400/50 shadow-sm"
            />
          </div>
        </div>

        {/* Category pills */}
        {categories.length > 0 && (
          <div className="flex gap-2 flex-wrap flex-shrink-0">
            <button onClick={() => setCategoryFilter('')}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${!categoryFilter ? 'bg-brand-600 text-white' : 'bg-white text-brand-500 border border-brand-200 hover:border-brand-400'}`}>
              All
            </button>
            {categories.map(cat => (
              <button key={cat} onClick={() => setCategoryFilter(cat === categoryFilter ? '' : cat)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${categoryFilter === cat ? 'bg-brand-600 text-white' : 'bg-white text-brand-500 border border-brand-200 hover:border-brand-400'}`}>
                {cat}
              </button>
            ))}
          </div>
        )}

        {/* Catalog Grid */}
        <div className="flex-1 overflow-y-auto pr-1">
          {isLoadingCatalog ? (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="h-24 bg-white animate-pulse rounded-2xl border border-brand-100/50" />
              ))}
            </div>
          ) : filteredCatalog.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <svg className="w-12 h-12 text-brand-200 mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
              </svg>
              <p className="text-sm text-brand-400">
                {!posBranch ? 'Select a branch to begin' : `No ${activeTab} found`}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredCatalog.map(item => {
                const inCart = cart.find(l => l.key === `${item.item_type}:${item.id}`);
                const outOfStock = item.item_type === 'product' && (item.stock ?? 0) <= 0;
                return (
                  <button
                    key={item.id}
                    onClick={() => !outOfStock && addToCart(item)}
                    disabled={outOfStock}
                    className={`relative text-left bg-white border rounded-2xl p-4 transition-all duration-150 group
                      ${ outOfStock
                          ? 'border-brand-100/30 opacity-50 cursor-not-allowed'
                          : inCart
                            ? 'border-brand-400 shadow-md ring-2 ring-brand-400/20 cursor-pointer'
                            : 'border-brand-100/50 shadow-card hover:border-brand-300 hover:shadow-md cursor-pointer'
                      }`}
                  >
                    {/* Item type tag */}
                    <span className={`absolute top-3 right-3 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${
                      item.item_type === 'service' ? 'bg-brand-100 text-brand-600' :
                      item.item_type === 'product' ? 'bg-amber-100 text-amber-700' :
                      'bg-violet-100 text-violet-700'
                    }`}>
                      {item.item_type}
                    </span>

                    <p className="text-sm font-semibold text-brand-800 pr-14 leading-tight line-clamp-2 mb-2">{item.name}</p>

                    {item.category && (
                      <p className="text-[10px] text-brand-400 mb-1.5">{item.category}</p>
                    )}

                    <div className="flex items-center justify-between mt-auto">
                      <span className="text-base font-bold text-brand-700">{formatCurrency(item.price)}</span>
                      {item.item_type === 'product' && item.stock !== null && (
                        <span className={`text-[10px] font-medium ${(item.stock ?? 0) <= 5 ? 'text-rose-500' : 'text-brand-400'}`}>
                          {item.stock} {item.unit || 'pcs'} left
                        </span>
                      )}
                    </div>

                    {inCart && (
                      <div className="absolute inset-0 rounded-2xl flex items-center justify-center bg-brand-600/10 pointer-events-none">
                        <span className="w-7 h-7 rounded-full bg-brand-600 text-white text-xs font-bold flex items-center justify-center shadow">
                          {inCart.quantity}
                        </span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ═══ RIGHT PANE — Cart & Payment ═══════════════════════ */}
      <div className="w-80 lg:w-96 flex-shrink-0 flex flex-col gap-3">

        {/* Cart Header */}
        <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card px-4 py-3 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-brand-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
            </svg>
            <span className="text-sm font-semibold text-brand-800">Cart</span>
            {cart.length > 0 && (
              <span className="w-5 h-5 rounded-full bg-brand-600 text-white text-[10px] font-bold flex items-center justify-center">
                {cart.reduce((s, l) => s + l.quantity, 0)}
              </span>
            )}
          </div>
          {cart.length > 0 && (
            <button onClick={clearCart}
              className="text-xs text-rose-400 hover:text-rose-600 transition-colors font-medium">
              Clear all
            </button>
          )}
        </div>

        {/* Customer Search */}
        <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card px-4 py-3 flex-shrink-0 relative">
          {customer ? (
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0 text-xs font-semibold text-brand-600">
                  {customer.first_name[0]}{customer.last_name[0]}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-brand-800 truncate">{customer.first_name} {customer.last_name}</p>
                  <p className="text-xs text-brand-400">{customer.phone || customer.email || 'No contact'}</p>
                  {customer.allergies && (
                    <p className="text-[10px] text-rose-600 mt-0.5">⚠ {customer.allergies}</p>
                  )}
                </div>
              </div>
              <button onClick={() => { setCustomer(null); setCustomerSearch(''); }}
                className="flex-shrink-0 text-brand-400 hover:text-brand-700 transition-colors p-1">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-brand-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                </svg>
                <input
                  ref={customerInputRef}
                  type="text"
                  value={customerSearch}
                  onChange={e => setCustomerSearch(e.target.value)}
                  onFocus={() => setShowCustomerSearch(true)}
                  onBlur={() => setTimeout(() => setShowCustomerSearch(false), 200)}
                  placeholder="Search patient (optional)..."
                  className="flex-1 text-sm text-brand-800 placeholder:text-brand-300 bg-transparent focus:outline-none"
                />
              </div>
              {showCustomerSearch && customerResults.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-brand-200 rounded-xl shadow-dropdown z-10 overflow-hidden">
                  {customerResults.map(c => (
                    <button key={c.id}
                      onMouseDown={() => { setCustomer(c); setCustomerSearch(''); setShowCustomerSearch(false); }}
                      className="w-full text-left px-4 py-2.5 hover:bg-brand-50 border-b border-brand-100/40 last:border-0 flex items-center gap-2 transition-colors"
                    >
                      <div className="w-7 h-7 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0 text-[10px] font-semibold text-brand-600">
                        {c.first_name[0]}{c.last_name[0]}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-brand-800">{c.first_name} {c.last_name}</p>
                        <p className="text-xs text-brand-400">{c.phone || c.email || ''}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Doctor & Payment Type (Phase 4) */}
        {(ENABLE_DOCTOR_COMMISSIONS || cart.some(l => l.item_type === 'service')) && (
          <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card px-4 py-3 flex-shrink-0 space-y-2">
            {/* Attending Doctor */}
            {ENABLE_DOCTOR_COMMISSIONS && doctors.length > 0 && (
              <div>
                <label className="block text-[10px] font-semibold text-brand-400 uppercase tracking-wide mb-1">Attending Doctor</label>
                <select value={attendingDoctorId} onChange={e => setAttendingDoctorId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-brand-200 bg-surface-50 text-sm text-brand-900
                             focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all">
                  <option value="">No doctor</option>
                  {doctors.map(d => <option key={d.id} value={d.id}>Dr. {d.first_name} {d.last_name}</option>)}
                </select>
              </div>
            )}
            {/* Payment Type */}
            {cart.some(l => l.item_type === 'service') && customer && (
              <div>
                <label className="block text-[10px] font-semibold text-brand-400 uppercase tracking-wide mb-1">Payment Type</label>
                <div className="flex rounded-xl border border-brand-200 overflow-hidden">
                  <button onClick={() => setPaymentType('full')}
                    className={`flex-1 py-2 text-xs font-medium transition-colors ${paymentType === 'full' ? 'bg-brand-600 text-white' : 'text-brand-500 hover:bg-brand-50'}`}>
                    Full Payment
                  </button>
                  <button onClick={() => setPaymentType('installment')}
                    className={`flex-1 py-2 text-xs font-medium transition-colors ${paymentType === 'installment' ? 'bg-amber-600 text-white' : 'text-brand-500 hover:bg-brand-50'}`}>
                    📦 Installment
                  </button>
                </div>
                {paymentType === 'installment' && (
                  <p className="text-[10px] text-amber-600 mt-1">Partial payment accepted — a package will be created for multi-session services</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Cart Lines */}
        <div className="flex-1 bg-white rounded-2xl border border-brand-100/50 shadow-card overflow-hidden flex flex-col">
          {cart.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center py-8 px-4">
              <svg className="w-12 h-12 text-brand-200 mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
              </svg>
              <p className="text-sm text-brand-400">Cart is empty</p>
              <p className="text-xs text-brand-300 mt-1">Tap items from the catalog to add</p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto divide-y divide-brand-100/40">
              {cart.map(line => (
                <div key={line.key} className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-brand-800 truncate">{line.name}</p>
                    <p className="text-xs text-brand-400">{formatCurrency(line.unit_price)} ea.</p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button onClick={() => updateQty(line.key, -1)}
                      className="w-6 h-6 rounded-full border border-brand-200 text-brand-500 hover:bg-brand-50 flex items-center justify-center text-sm font-bold transition-colors">
                      −
                    </button>
                    <span className="w-6 text-center text-sm font-semibold text-brand-800">{line.quantity}</span>
                    <button onClick={() => updateQty(line.key, 1)}
                      disabled={line.item_type === 'product' && line.stock !== null && line.stock !== undefined && line.quantity >= line.stock}
                      className="w-6 h-6 rounded-full border border-brand-200 text-brand-500 hover:bg-brand-50 flex items-center justify-center text-sm font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                      +
                    </button>
                  </div>
                  <span className="w-20 text-right text-sm font-semibold text-brand-700 flex-shrink-0">{formatCurrency(line.total_price)}</span>
                  <button onClick={() => removeFromCart(line.key)}
                    className="text-rose-300 hover:text-rose-600 transition-colors flex-shrink-0">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Discount & Notes */}
        {cart.length > 0 && (
          <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card px-4 py-3 space-y-3 flex-shrink-0">
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-brand-500 whitespace-nowrap">Discount</label>
              <div className="flex rounded-lg border border-brand-200 overflow-hidden text-xs">
                <button onClick={() => setDiscountMode('flat')}
                  className={`px-2 py-1 transition-colors ${discountMode === 'flat' ? 'bg-brand-600 text-white' : 'text-brand-500 hover:bg-brand-50'}`}>
                  ₱
                </button>
                <button onClick={() => setDiscountMode('percent')}
                  className={`px-2 py-1 transition-colors ${discountMode === 'percent' ? 'bg-brand-600 text-white' : 'text-brand-500 hover:bg-brand-50'}`}>
                  %
                </button>
              </div>
              <input
                type="number" min="0" value={discount || ''}
                onChange={e => setDiscount(parseFloat(e.target.value) || 0)}
                placeholder="0"
                className="flex-1 px-2 py-1 rounded-lg border border-brand-200 text-sm text-brand-800 text-right focus:outline-none focus:ring-1 focus:ring-brand-400"
              />
              {discountAmount > 0 && (
                <span className="text-xs text-emerald-600 font-medium whitespace-nowrap">-{formatCurrency(discountAmount)}</span>
              )}
            </div>
            <textarea
              value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Notes (optional)..." rows={1}
              className="w-full px-2 py-1.5 rounded-lg border border-brand-200 text-xs text-brand-700 placeholder:text-brand-300 resize-none focus:outline-none focus:ring-1 focus:ring-brand-400"
            />
          </div>
        )}

        {/* Totals + Charge Button */}
        <div className="bg-white rounded-2xl border border-brand-100/50 shadow-card px-4 py-4 flex-shrink-0">
          <div className="space-y-1.5 mb-4">
            <div className="flex justify-between text-sm">
              <span className="text-brand-400">Subtotal</span>
              <span className="text-brand-700">{formatCurrency(subtotal)}</span>
            </div>
            {discountAmount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-brand-400">Discount</span>
                <span className="text-emerald-600">-{formatCurrency(discountAmount)}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold border-t border-brand-100 pt-2">
              <span className="text-brand-900">Total</span>
              <span className="text-xl text-brand-900">{formatCurrency(total)}</span>
            </div>
          </div>
          <div className="flex gap-2">
            {ENABLE_SERVICE_BOM && posBranch?.id && (
              <button
                onClick={async () => {
                  setExtraError('');
                  setExtraSelectedProduct('');
                  setExtraQty('1');
                  setExtraNotes('');
                  // Fetch products with stock for the branch
                  const { data: prods } = await supabase
                    .from('products')
                    .select('id, name, inventory!inner(quantity)')
                    .eq('branch_id', posBranch.id)
                    .eq('is_active', true)
                    .order('name');
                  setExtraProducts((prods || []).map((p: Record<string, unknown>) => ({
                    id: p.id as string,
                    name: p.name as string,
                    stock: ((p.inventory as Record<string, unknown>[])?.[0]?.quantity as number) ?? 0,
                  })).filter(p => p.stock > 0));
                  setShowExtraConsumable(true);
                }}
                className="py-3 px-4 rounded-xl border-2 border-dashed border-amber-400 text-amber-700 font-semibold text-sm
                           hover:bg-amber-50 active:scale-[0.99] transition-all duration-200"
                title="Deduct inventory items without charging the customer"
              >
                🧪 Extra Consumable
              </button>
            )}
            <button
              onClick={openPayment}
              disabled={!cart.length || !posBranch?.id}
              className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-brand-600 to-brand-700 text-white font-semibold text-base
                         hover:from-brand-700 hover:to-brand-800 active:scale-[0.99] transition-all duration-200 shadow-sm hover:shadow-md
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Charge {cart.length > 0 ? formatCurrency(total) : ''}
            </button>
          </div>
        </div>
      </div>

      {/* ═══ Payment Modal ══════════════════════════════════════ */}
      {showPaymentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-brand-950/40 backdrop-blur-sm" onClick={() => !isProcessing && setShowPaymentModal(false)} />
          <div className="relative w-full max-w-md bg-white rounded-2xl shadow-dropdown border border-brand-100/50 animate-slide-up overflow-hidden">
            <div className="flex items-center justify-between px-6 py-5 border-b border-brand-100/60">
              <div>
                <h2 className="text-lg font-semibold text-brand-900">Payment</h2>
                <p className="text-sm text-brand-500">Total due: <span className="font-semibold text-brand-800">{formatCurrency(total)}</span></p>
              </div>
              {!isProcessing && (
                <button onClick={() => setShowPaymentModal(false)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-brand-400 hover:text-brand-700 hover:bg-brand-50 transition-colors">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
            <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
              {paymentError && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{paymentError}</div>
              )}

              {/* Payment lines */}
              <div className="space-y-3">
                {payments.map((p, i) => (
                  <div key={i} className="space-y-2">
                    <div className="flex gap-2 items-start">
                      <select
                        value={p.method}
                        onChange={e => updatePaymentLine(i, 'method', e.target.value)}
                        disabled={isProcessing}
                        className="flex-1 px-3 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-sm text-brand-800 focus:outline-none focus:ring-2 focus:ring-brand-400/50"
                      >
                        {(Object.entries(PAYMENT_LABELS) as [PaymentMethod, string][]).map(([val, label]) => (
                          <option key={val} value={val}>{label}</option>
                        ))}
                      </select>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-brand-400">₱</span>
                        <input
                          type="number" min="0" step="0.01"
                          value={p.amount}
                          onChange={e => updatePaymentLine(i, 'amount', e.target.value)}
                          disabled={isProcessing}
                          placeholder="0.00"
                          className="w-28 pl-7 pr-2 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-sm text-brand-800 text-right focus:outline-none focus:ring-2 focus:ring-brand-400/50"
                        />
                      </div>
                      {payments.length > 1 && !isProcessing && (
                        <button onClick={() => removePaymentLine(i)}
                          className="p-2.5 rounded-xl text-rose-400 hover:text-rose-600 hover:bg-rose-50 transition-colors flex-shrink-0">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                    {(p.method === 'gcash' || p.method === 'card' || p.method === 'bank_transfer') && (
                      <input
                        type="text" value={p.reference_number}
                        onChange={e => updatePaymentLine(i, 'reference_number', e.target.value)}
                        disabled={isProcessing}
                        placeholder="Reference / transaction number..."
                        className="w-full px-3 py-2 rounded-xl border border-brand-200 bg-surface-50 text-sm text-brand-800 placeholder:text-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-400/50"
                      />
                    )}
                  </div>
                ))}
              </div>

              {/* Add payment method */}
              {payments.length < 4 && !isProcessing && (
                <button onClick={addPaymentLine}
                  className="w-full py-2 rounded-xl border border-dashed border-brand-300 text-sm text-brand-500 hover:border-brand-400 hover:text-brand-700 hover:bg-brand-50 transition-all">
                  + Split payment
                </button>
              )}

              {/* Summary */}
              <div className="bg-surface-50 rounded-xl p-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-brand-400">Total</span><span className="font-semibold text-brand-800">{formatCurrency(total)}</span></div>
                <div className="flex justify-between"><span className="text-brand-400">Paid</span><span className={`font-semibold ${totalPaid >= total ? 'text-emerald-600' : 'text-rose-600'}`}>{formatCurrency(totalPaid)}</span></div>
                {change > 0 && <div className="flex justify-between"><span className="text-brand-400">Change</span><span className="font-semibold text-emerald-600">{formatCurrency(change)}</span></div>}
                {amountDue > 0.01 && <div className="flex justify-between"><span className="text-brand-400">Still due</span><span className="font-semibold text-rose-600">{formatCurrency(amountDue)}</span></div>}
              </div>

              <button
                onClick={handleCheckout}
                disabled={isProcessing || totalPaid < total - 0.01}
                className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 text-white font-semibold
                           hover:from-emerald-700 hover:to-emerald-800 active:scale-[0.99] transition-all shadow-sm hover:shadow-md
                           disabled:opacity-50 disabled:cursor-not-allowed text-base"
              >
                {isProcessing ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Processing...
                  </span>
                ) : 'Confirm & Complete Sale'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Receipt Modal ══════════════════════════════════════ */}
      {showReceipt && completedSale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-brand-950/40 backdrop-blur-sm" />
          <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-dropdown border border-brand-100/50 animate-slide-up overflow-hidden">

            {/* Receipt header */}
            <div className="bg-gradient-to-br from-brand-600 to-brand-800 px-6 py-6 text-center">
              <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center mx-auto mb-2">
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-white/70 text-xs mb-1">Sale Completed</p>
              <p className="text-white font-mono text-sm font-bold">{completedSale.receipt_number}</p>
              <p className="text-white/60 text-[10px] mt-1">{completedSale.timestamp}</p>
            </div>

            <div className="px-6 py-5 space-y-4 max-h-[60vh] overflow-y-auto">
              {/* Meta */}
              <div className="flex justify-between text-sm">
                <div>
                  <p className="text-brand-400 text-xs mb-0.5">Patient</p>
                  <p className="text-brand-800">{completedSale.customer_name || 'Walk-in'}</p>
                </div>
                <div className="text-right">
                  <p className="text-brand-400 text-xs mb-0.5">Cashier</p>
                  <p className="text-brand-800">{completedSale.cashier_name}</p>
                </div>
              </div>

              {/* Items */}
              <div className="border-t border-b border-brand-100 py-3 space-y-2">
                {completedSale.items.map(item => (
                  <div key={item.key} className="flex items-center justify-between gap-3 text-sm">
                    <div>
                      <p className="text-brand-800">{item.name}</p>
                      <p className="text-brand-400 text-xs">× {item.quantity} @ {formatCurrency(item.unit_price)}</p>
                    </div>
                    <span className="font-medium text-brand-700">{formatCurrency(item.total_price)}</span>
                  </div>
                ))}
              </div>

              {/* Totals */}
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between text-brand-500">
                  <span>Subtotal</span>
                  <span>{formatCurrency(completedSale.items.reduce((s, i) => s + i.total_price, 0))}</span>
                </div>
                {completedSale.total !== completedSale.items.reduce((s, i) => s + i.total_price, 0) && (
                  <div className="flex justify-between text-emerald-600">
                    <span>Discount</span>
                    <span>-{formatCurrency(completedSale.items.reduce((s, i) => s + i.total_price, 0) - completedSale.total)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-brand-900 text-base border-t border-brand-100 pt-1.5">
                  <span>Total</span>
                  <span>{formatCurrency(completedSale.total)}</span>
                </div>
              </div>

              {/* Payments */}
              <div className="space-y-1.5">
                {completedSale.payments.map((p, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="text-brand-500 capitalize">{p.method.replace('_', ' ')}{p.reference_number ? ` #${p.reference_number}` : ''}</span>
                    <span className="text-brand-700">{formatCurrency(p.amount)}</span>
                  </div>
                ))}
                {completedSale.change > 0 && (
                  <div className="flex justify-between text-sm font-semibold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-lg">
                    <span>Change</span>
                    <span>{formatCurrency(completedSale.change)}</span>
                  </div>
                )}
              </div>

              {/* Balance Remaining (installment) */}
              {completedSale.payment_type === 'installment' && completedSale.balance_remaining > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-center">
                  <p className="text-xs text-amber-600 font-medium">Balance Remaining</p>
                  <p className="text-xl font-bold text-amber-700">{formatCurrency(completedSale.balance_remaining)}</p>
                </div>
              )}

              {/* Packages Created */}
              {completedSale.packages_created.length > 0 && (
                <div className="bg-brand-50 border border-brand-200 rounded-xl px-4 py-3 space-y-1">
                  <p className="text-xs text-brand-600 font-semibold">📦 Packages Created</p>
                  {completedSale.packages_created.map((pkg, i) => (
                    <p key={i} className="text-xs text-brand-700">{pkg.service_name} — {pkg.total_sessions} sessions</p>
                  ))}
                </div>
              )}

              {/* Badge */}
              <div className="text-center">
                <Badge variant={completedSale.payment_type === 'installment' ? 'warning' : 'success'}>
                  {completedSale.payment_type === 'installment' ? 'Installment Sale' : 'Transaction Complete'}
                </Badge>
                <p className="text-[10px] text-brand-400 mt-2">FitWhite Aesthetics · Thank you!</p>
              </div>
            </div>

            {/* Actions */}
            <div className="px-6 pb-5 flex gap-3">
              <button
                onClick={() => window.print()}
                className="flex-1 py-2.5 px-4 rounded-xl border border-brand-200 text-brand-600 text-sm font-medium hover:bg-brand-50 transition-colors"
              >
                🖨 Print
              </button>
              <button
                onClick={() => { setShowReceipt(false); setCompletedSale(null); }}
                className="flex-1 py-2.5 px-4 rounded-xl bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition-colors"
              >
                New Sale
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ═══ Extra Consumable Modal ════════════════════════════ */}
      {showExtraConsumable && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-brand-950/40 backdrop-blur-sm" onClick={() => !extraSubmitting && setShowExtraConsumable(false)} />
          <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-dropdown border border-brand-100/50 animate-slide-up overflow-hidden">
            <div className="px-6 py-5 border-b border-brand-100/60">
              <h2 className="text-lg font-semibold text-brand-900">🧪 Extra Consumable</h2>
              <p className="text-xs text-brand-400 mt-1">Deduct inventory items without charging the customer</p>
            </div>
            <div className="px-6 py-5 space-y-4">
              {extraError && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{extraError}</div>
              )}
              <div>
                <label className="block text-sm font-medium text-brand-800 mb-1.5">Product</label>
                <select value={extraSelectedProduct} onChange={e => setExtraSelectedProduct(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900
                             focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all">
                  <option value="">Select product...</option>
                  {extraProducts.map(p => (
                    <option key={p.id} value={p.id}>{p.name} ({p.stock} in stock)</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-brand-800 mb-1.5">Quantity</label>
                <input type="number" value={extraQty} min="1" onChange={e => setExtraQty(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900
                             focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all" />
              </div>
              <div>
                <label className="block text-sm font-medium text-brand-800 mb-1.5">Notes <span className="text-brand-300 font-normal">(optional)</span></label>
                <input type="text" value={extraNotes} onChange={e => setExtraNotes(e.target.value)}
                  placeholder="e.g. Additional syringe for patient"
                  className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900 placeholder:text-brand-300
                             focus:outline-none focus:ring-2 focus:ring-brand-400/50 transition-all" />
              </div>
              <div className="flex gap-3">
                <button
                  disabled={!extraSelectedProduct || extraSubmitting}
                  onClick={async () => {
                    setExtraSubmitting(true);
                    setExtraError('');
                    try {
                      const res = await fetch('/api/inventory/extra-consumable', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          product_id: extraSelectedProduct,
                          branch_id: posBranch?.id,
                          quantity: parseInt(extraQty) || 1,
                          notes: extraNotes || null,
                        }),
                      });
                      const result = await res.json();
                      if (!res.ok) { setExtraError(result.error); return; }
                      setShowExtraConsumable(false);
                      fetchCatalog(); // refresh stock counts
                    } catch {
                      setExtraError('Network error');
                    } finally {
                      setExtraSubmitting(false);
                    }
                  }}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-amber-600 to-amber-700 text-white font-medium text-sm
                             disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
                >
                  {extraSubmitting ? 'Deducting...' : 'Deduct from Inventory'}
                </button>
                <button onClick={() => setShowExtraConsumable(false)}
                  className="px-4 py-2.5 rounded-xl border border-brand-200 text-brand-600 text-sm font-medium hover:bg-brand-50 transition-colors">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
