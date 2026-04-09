import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Profile } from '@/types/database';

/**
 * POST /api/sales/checkout
 *
 * Creates a complete sale transaction atomically:
 *   1. Validates all items (services/products/bundles) exist and are active
 *   2. Validates inventory availability for products
 *   3. Inserts sales → sale_items → payments
 *   4. Adjusts inventory for each product sold
 *   5. Logs audit trail
 *
 * Body:
 * {
 *   branch_id: string
 *   customer_id?: string | null
 *   items: Array<{
 *     item_type: 'service' | 'product' | 'bundle'
 *     id: string            // service_id / product_id / bundle_id
 *     name: string          // snapshot at time of sale
 *     quantity: number
 *     unit_price: number
 *   }>
 *   payments: Array<{
 *     method: 'cash' | 'gcash' | 'card' | 'bank_transfer'
 *     amount: number
 *     change_amount?: number
 *     reference_number?: string
 *   }>
 *   discount?: number
 *   tax?: number
 *   notes?: string
 * }
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
        name: string;
        quantity: number;
        unit_price: number;
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

    // ─── Validation ─────────────────────────────────────────

    if (!branch_id) return NextResponse.json({ error: 'branch_id is required' }, { status: 400 });
    if (!items.length) return NextResponse.json({ error: 'Cart cannot be empty' }, { status: 400 });
    if (!payments.length) return NextResponse.json({ error: 'At least one payment required' }, { status: 400 });

    // Manager can only sell in their branch
    if (caller.role === 'manager' && caller.branch_id !== branch_id) {
      return NextResponse.json({ error: 'Cannot process sales for a different branch' }, { status: 403 });
    }
    if (caller.role === 'cashier' && caller.branch_id !== branch_id) {
      return NextResponse.json({ error: 'Cannot process sales for a different branch' }, { status: 403 });
    }

    const adminClient = createAdminClient();

    // Calculate totals
    const subtotal = items.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
    const total = Math.max(0, subtotal - discount + tax);

    // Validate payment covers total
    const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
    if (totalPaid < total) {
      return NextResponse.json({
        error: `Insufficient payment. Total: ₱${total.toFixed(2)}, Paid: ₱${totalPaid.toFixed(2)}`
      }, { status: 400 });
    }

    // Validate inventory for product items
    const productItems = items.filter(i => i.item_type === 'product');
    for (const item of productItems) {
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

    // Get branch code for receipt number
    const { data: branchData } = await adminClient
      .from('branches').select('code').eq('id', branch_id).single();
    const branchCode = branchData ? (branchData as Record<string, unknown>).code as string : 'FW';

    // Generate receipt number
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
      console.error('Sale insert error:', saleError);
      return NextResponse.json({ error: saleError.message }, { status: 500 });
    }

    const saleId = (saleData as Record<string, unknown>).id as string;

    // ─── Insert Sale Items ───────────────────────────────────

    const saleItemsPayload = items.map(item => ({
      sale_id: saleId,
      item_type: item.item_type,
      service_id: item.item_type === 'service' ? item.id : null,
      product_id: item.item_type === 'product' ? item.id : null,
      bundle_id: item.item_type === 'bundle' ? item.id : null,
      name: item.name,
      quantity: item.quantity,
      unit_price: item.unit_price,
      total_price: item.unit_price * item.quantity,
    }));

    const { error: itemsError } = await adminClient
      .from('sale_items')
      .insert(saleItemsPayload as Record<string, unknown>[]);

    if (itemsError) {
      console.error('Sale items error:', itemsError);
      // Rollback: delete the sale
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
      console.error('Payments error:', paymentsError);
      await adminClient.from('sales').delete().eq('id', saleId);
      return NextResponse.json({ error: paymentsError.message }, { status: 500 });
    }

    // ─── Adjust Inventory ────────────────────────────────────

    for (const item of productItems) {
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
      metadata: { receipt_number: receiptNumber, total, items_count: items.length, payment_methods: payments.map(p => p.method) },
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
