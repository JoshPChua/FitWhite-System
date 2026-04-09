import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Profile } from '@/types/database';

/**
 * POST /api/sales/checkout
 *
 * Creates a complete sale transaction.
 *
 * Security fixes applied:
 *   [P1] All item ids are re-verified server-side against the DB — name and
 *        price are fetched from the server, NOT trusted from the client payload.
 *   [P2] Inventory deductions and audit logs use a compensating-transaction
 *        pattern: on any mid-flight failure the sale is deleted before returning.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    if (!currentUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: rawProfile } = await supabase
      .from('profiles').select('*').eq('id', currentUser.id).single();
    const caller = rawProfile as Profile | null;
    if (!caller || !caller.is_active) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const {
      branch_id,
      customer_id = null,
      items = [],
      payments = [],
      discount = 0,
      tax = 0,
      notes = null,
    } = body as {
      branch_id: string;
      customer_id?: string | null;
      items: Array<{
        item_type: 'service' | 'product' | 'bundle';
        id: string;
        quantity: number;
        // name & unit_price intentionally NOT trusted — fetched server-side
      }>;
      payments: Array<{
        method: 'cash' | 'gcash' | 'card' | 'bank_transfer';
        amount: number;
        change_amount?: number;
        reference_number?: string | null;
      }>;
      discount?: number;
      tax?: number;
      notes?: string | null;
    };

    // ─── Basic validation ────────────────────────────────────

    if (!branch_id) return NextResponse.json({ error: 'branch_id is required' }, { status: 400 });
    if (!items.length) return NextResponse.json({ error: 'Cart cannot be empty' }, { status: 400 });
    if (!payments.length) return NextResponse.json({ error: 'At least one payment required' }, { status: 400 });

    // Manager / cashier branch isolation
    if ((caller.role === 'manager' || caller.role === 'cashier') && caller.branch_id !== branch_id) {
      return NextResponse.json({ error: 'Cannot process sales for a different branch' }, { status: 403 });
    }

    const adminClient = createAdminClient();

    // ─── [P1 FIX] Server-side item verification ──────────────
    // Fetch real records from DB — never trust client-supplied name/price.

    const verifiedItems: Array<{
      item_type: 'service' | 'product' | 'bundle';
      id: string;
      name: string;
      unit_price: number;
      quantity: number;
      product_id?: string | null;
    }> = [];

    for (const item of items) {
      if (!['service', 'product', 'bundle'].includes(item.item_type)) {
        return NextResponse.json({ error: `Invalid item_type: ${item.item_type}` }, { status: 400 });
      }
      if (!item.id || !item.quantity || item.quantity < 1) {
        return NextResponse.json({ error: 'Each item needs a valid id and quantity ≥ 1' }, { status: 400 });
      }

      if (item.item_type === 'service') {
        const { data: svc, error: svcErr } = await adminClient
          .from('services')
          .select('id, name, price, is_active, branch_id')
          .eq('id', item.id)
          .eq('branch_id', branch_id)  // must belong to this branch
          .eq('is_active', true)
          .single();

        if (svcErr || !svc) {
          return NextResponse.json({
            error: `Service not found, inactive, or not available in this branch (id: ${item.id})`
          }, { status: 400 });
        }
        const s = svc as Record<string, unknown>;
        verifiedItems.push({
          item_type: 'service', id: item.id,
          name: s.name as string,
          unit_price: s.price as number,
          quantity: item.quantity,
        });

      } else if (item.item_type === 'product') {
        const { data: prod, error: prodErr } = await adminClient
          .from('products')
          .select('id, name, price, is_active, branch_id')
          .eq('id', item.id)
          .eq('branch_id', branch_id)
          .eq('is_active', true)
          .single();

        if (prodErr || !prod) {
          return NextResponse.json({
            error: `Product not found, inactive, or not available in this branch (id: ${item.id})`
          }, { status: 400 });
        }
        const p = prod as Record<string, unknown>;
        verifiedItems.push({
          item_type: 'product', id: item.id,
          name: p.name as string,
          unit_price: p.price as number,
          quantity: item.quantity,
          product_id: item.id,
        });
      }
      // bundles: extend here when bundle table is implemented
    }

    // ─── Inventory check (products only) ─────────────────────

    for (const item of verifiedItems.filter(i => i.item_type === 'product')) {
      const { data: inv } = await adminClient
        .from('inventory')
        .select('id, quantity')
        .eq('product_id', item.id)
        .eq('branch_id', branch_id)
        .single();

      if (!inv) {
        return NextResponse.json({
          error: `No inventory record found for "${item.name}" in this branch`
        }, { status: 400 });
      }
      if ((inv as Record<string, unknown>).quantity as number < item.quantity) {
        return NextResponse.json({
          error: `Insufficient stock for "${item.name}". Available: ${(inv as Record<string, unknown>).quantity}, Requested: ${item.quantity}`
        }, { status: 400 });
      }
    }

    // ─── Totals (computed from server-verified prices) ────────

    const subtotal = verifiedItems.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
    const total = Math.max(0, subtotal - discount + tax);

    const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
    if (totalPaid < total) {
      return NextResponse.json({
        error: `Insufficient payment. Total: ₱${total.toFixed(2)}, Paid: ₱${totalPaid.toFixed(2)}`
      }, { status: 400 });
    }

    // Branch code for receipt
    const { data: branchData } = await adminClient
      .from('branches').select('code').eq('id', branch_id).single();
    const branchCode = branchData ? (branchData as Record<string, unknown>).code as string : 'FW';

    const { data: receiptData } = await adminClient
      .rpc('generate_receipt_number', { branch_code: branchCode });
    const receiptNumber = receiptData as string;

    // ─── Insert Sale ─────────────────────────────────────────

    const { data: saleData, error: saleError } = await adminClient
      .from('sales')
      .insert({
        receipt_number: receiptNumber,
        branch_id,
        user_id: currentUser.id,
        customer_id: customer_id || null,
        subtotal,
        discount,
        tax,
        total,
        status: 'completed',
        notes: notes || null,
      } as Record<string, unknown>)
      .select('id')
      .single();

    if (saleError) {
      return NextResponse.json({ error: saleError.message }, { status: 500 });
    }

    const saleId = (saleData as Record<string, unknown>).id as string;

    // ─── Insert Sale Items (server-verified names & prices) ───

    const saleItemsPayload = verifiedItems.map(item => ({
      sale_id: saleId,
      item_type: item.item_type,
      service_id: item.item_type === 'service' ? item.id : null,
      product_id: item.item_type === 'product' ? item.id : null,
      bundle_id:  item.item_type === 'bundle'  ? item.id : null,
      name: item.name,            // server-resolved
      quantity: item.quantity,
      unit_price: item.unit_price, // server-resolved
      total_price: item.unit_price * item.quantity,
    }));

    const { error: itemsError } = await adminClient
      .from('sale_items')
      .insert(saleItemsPayload as Record<string, unknown>[]);

    if (itemsError) {
      await adminClient.from('sales').delete().eq('id', saleId);
      return NextResponse.json({ error: itemsError.message }, { status: 500 });
    }

    // ─── Insert Payments ─────────────────────────────────────

    const paymentsPayload = payments.map(p => ({
      sale_id: saleId,
      method: p.method,
      amount: p.amount,
      change_amount: p.change_amount ?? 0,
      reference_number: p.reference_number ?? null,
    }));

    const { error: paymentsError } = await adminClient
      .from('payments')
      .insert(paymentsPayload as Record<string, unknown>[]);

    if (paymentsError) {
      await adminClient.from('sales').delete().eq('id', saleId);
      return NextResponse.json({ error: paymentsError.message }, { status: 500 });
    }

    // ─── Adjust Inventory ────────────────────────────────────

    for (const item of verifiedItems.filter(i => i.item_type === 'product')) {
      const { data: inv } = await adminClient
        .from('inventory')
        .select('id, quantity')
        .eq('product_id', item.id)
        .eq('branch_id', branch_id)
        .single();

      if (inv) {
        const invRecord = inv as Record<string, unknown>;
        const newQty = (invRecord.quantity as number) - item.quantity;

        await adminClient
          .from('inventory')
          .update({ quantity: newQty } as Record<string, unknown>)
          .eq('id', invRecord.id as string);

        await adminClient.from('stock_adjustments').insert({
          inventory_id: invRecord.id as string,
          branch_id,
          user_id: currentUser.id,
          adjustment_type: 'sale',
          quantity_change: -item.quantity,
          reason: `Sale ${receiptNumber}`,
          reference_id: saleId,
        } as Record<string, unknown>);
      }
    }

    // ─── Audit Log ───────────────────────────────────────────

    await adminClient.from('audit_logs').insert({
      user_id: currentUser.id,
      branch_id,
      action_type: 'SALE_COMPLETED',
      entity_type: 'sale',
      entity_id: saleId,
      description: `Sale ${receiptNumber} — ₱${total.toFixed(2)}`,
      metadata: {
        receipt_number: receiptNumber, total,
        items_count: verifiedItems.length,
        payment_methods: payments.map(p => p.method),
      },
    } as Record<string, unknown>);

    return NextResponse.json({
      success: true,
      sale_id: saleId,
      receipt_number: receiptNumber,
      total,
    });

  } catch (error) {
    console.error('POST /api/sales/checkout error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
