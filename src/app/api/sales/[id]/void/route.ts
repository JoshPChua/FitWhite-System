import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Profile } from '@/types/database';

/**
 * POST /api/sales/[id]/void
 *
 * Security fix applied:
 *   [P1] Partial-refund sales can no longer be voided. This prevents
 *        double-restocking — inventory was already partially returned during
 *        the refund flow, and a void would return it all again.
 *        A partial-refund sale must be fully refunded first.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: saleId } = await params;
    const supabase = await createClient();
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    if (!currentUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: rawProfile } = await supabase
      .from('profiles').select('*').eq('id', currentUser.id).single();
    const caller = rawProfile as Profile | null;
    if (!caller || caller.role === 'cashier') {
      return NextResponse.json({ error: 'Forbidden — manager or owner required' }, { status: 403 });
    }

    const body = await request.json();
    const { reason = 'No reason provided' } = body as { reason?: string };

    const adminClient = createAdminClient();

    // Fetch sale
    const { data: saleData, error: saleError } = await adminClient
      .from('sales').select('*').eq('id', saleId).single();
    if (saleError || !saleData) {
      return NextResponse.json({ error: 'Sale not found' }, { status: 404 });
    }
    const sale = saleData as Record<string, unknown>;

    // Manager branch check
    if (caller.role === 'manager' && caller.branch_id !== sale.branch_id) {
      return NextResponse.json({ error: 'Cannot void sales from another branch' }, { status: 403 });
    }

    // ─── [P1 FIX] Block voiding of already-refunded states ──
    if (sale.status === 'voided') {
      return NextResponse.json({ error: 'Sale is already voided' }, { status: 400 });
    }
    if (sale.status === 'refunded') {
      return NextResponse.json({ error: 'Cannot void a fully refunded sale' }, { status: 400 });
    }
    if (sale.status === 'partial_refund') {
      return NextResponse.json({
        error: 'Cannot void a partially refunded sale — inventory was already partially restocked. ' +
               'Issue a full refund for the remaining amount first.'
      }, { status: 400 });
    }

    // Only 'completed' sales reach here

    // Void the sale
    const { error: voidError } = await adminClient
      .from('sales')
      .update({ status: 'voided' } as Record<string, unknown>)
      .eq('id', saleId);

    if (voidError) return NextResponse.json({ error: voidError.message }, { status: 500 });

    // Restore inventory for ALL product items (no prior partial restock since
    // we only allow voiding of 'completed' sales now)
    const { data: saleItems } = await adminClient
      .from('sale_items')
      .select('product_id, quantity, name')
      .eq('sale_id', saleId)
      .eq('item_type', 'product');

    for (const item of (saleItems || []) as Record<string, unknown>[]) {
      const { data: inv } = await adminClient
        .from('inventory')
        .select('id, quantity')
        .eq('product_id', item.product_id as string)
        .eq('branch_id', sale.branch_id as string)
        .single();

      if (inv) {
        const invRecord = inv as Record<string, unknown>;
        const newQty = (invRecord.quantity as number) + (item.quantity as number);
        await adminClient.from('inventory')
          .update({ quantity: newQty } as Record<string, unknown>)
          .eq('id', invRecord.id as string);

        await adminClient.from('stock_adjustments').insert({
          inventory_id: invRecord.id as string,
          branch_id: sale.branch_id as string,
          user_id: currentUser.id,
          adjustment_type: 'refund',
          quantity_change: item.quantity as number,
          reason: `Void of ${sale.receipt_number as string}`,
          reference_id: saleId,
        } as Record<string, unknown>);
      }
    }

    // Audit
    await adminClient.from('audit_logs').insert({
      user_id: currentUser.id,
      branch_id: sale.branch_id as string,
      action_type: 'SALE_VOIDED',
      entity_type: 'sale',
      entity_id: saleId,
      description: `Sale ${sale.receipt_number as string} voided — reason: ${reason}`,
      metadata: { receipt_number: sale.receipt_number, reason, total: sale.total },
    } as Record<string, unknown>);

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('POST /api/sales/[id]/void error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
