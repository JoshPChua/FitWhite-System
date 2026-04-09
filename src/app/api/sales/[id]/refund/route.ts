import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Profile } from '@/types/database';

/**
 * POST /api/sales/[id]/refund
 *
 * Processes a partial or full refund.
 * Body:
 * {
 *   refund_type: 'product' | 'service' | 'consumed'
 *   amount: number
 *   reason: string
 *   notes?: string
 *   return_inventory?: boolean
 *   refund_items: Array<{ sale_item_id: string; quantity: number; amount: number }>
 * }
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
    const {
      refund_type = 'product',
      amount,
      reason,
      notes = '',
      return_inventory = false,
      refund_items = [],
    } = body as {
      refund_type?: 'product' | 'service' | 'consumed';
      amount: number;
      reason: string;
      notes?: string;
      return_inventory?: boolean;
      refund_items: Array<{ sale_item_id: string; quantity: number; amount: number }>;
    };

    if (!amount || amount <= 0) return NextResponse.json({ error: 'Invalid refund amount' }, { status: 400 });
    if (!reason?.trim()) return NextResponse.json({ error: 'Refund reason is required' }, { status: 400 });

    const adminClient = createAdminClient();

    // Fetch sale
    const { data: saleData, error: saleError } = await adminClient
      .from('sales').select('*').eq('id', saleId).single();
    if (saleError || !saleData) {
      return NextResponse.json({ error: 'Sale not found' }, { status: 404 });
    }
    const sale = saleData as Record<string, unknown>;

    if (caller.role === 'manager' && caller.branch_id !== sale.branch_id) {
      return NextResponse.json({ error: 'Cannot refund sales from another branch' }, { status: 403 });
    }
    if (sale.status === 'voided' || sale.status === 'refunded') {
      return NextResponse.json({ error: `Cannot refund a ${sale.status} sale` }, { status: 400 });
    }
    if (amount > (sale.total as number)) {
      return NextResponse.json({ error: `Refund amount (₱${amount}) exceeds sale total (₱${sale.total})` }, { status: 400 });
    }

    // Create refund record
    const { data: refundData, error: refundError } = await adminClient
      .from('refunds')
      .insert({
        sale_id: saleId,
        branch_id: sale.branch_id as string,
        user_id: currentUser.id,
        refund_type,
        amount,
        reason,
        notes: notes || '',
        return_inventory,
      } as Record<string, unknown>)
      .select('id')
      .single();

    if (refundError) return NextResponse.json({ error: refundError.message }, { status: 500 });
    const refundId = (refundData as Record<string, unknown>).id as string;

    // Insert refund items
    if (refund_items.length > 0) {
      const refundItemsPayload = refund_items.map(ri => ({
        refund_id: refundId,
        sale_item_id: ri.sale_item_id,
        quantity: ri.quantity,
        amount: ri.amount,
      }));
      await adminClient.from('refund_items').insert(refundItemsPayload as Record<string, unknown>[]);

      // Restore inventory if requested
      if (return_inventory) {
        for (const ri of refund_items) {
          const { data: saleItem } = await adminClient
            .from('sale_items')
            .select('product_id, quantity')
            .eq('id', ri.sale_item_id)
            .eq('item_type', 'product')
            .single();

          if (saleItem) {
            const siRecord = saleItem as Record<string, unknown>;
            const { data: inv } = await adminClient
              .from('inventory')
              .select('id, quantity')
              .eq('product_id', siRecord.product_id as string)
              .eq('branch_id', sale.branch_id as string)
              .single();

            if (inv) {
              const invRecord = inv as Record<string, unknown>;
              const newQty = (invRecord.quantity as number) + ri.quantity;
              await adminClient.from('inventory')
                .update({ quantity: newQty } as Record<string, unknown>)
                .eq('id', invRecord.id as string);

              await adminClient.from('stock_adjustments').insert({
                inventory_id: invRecord.id as string,
                branch_id: sale.branch_id as string,
                user_id: currentUser.id,
                adjustment_type: 'refund',
                quantity_change: ri.quantity,
                reason: `Refund on ${sale.receipt_number as string}`,
                reference_id: saleId,
              } as Record<string, unknown>);
            }
          }
        }
      }
    }

    // Determine new sale status: full refund vs partial
    const isFullRefund = Math.abs(amount - (sale.total as number)) < 0.01;
    const newStatus = isFullRefund ? 'refunded' : 'partial_refund';
    await adminClient
      .from('sales')
      .update({ status: newStatus } as Record<string, unknown>)
      .eq('id', saleId);

    // Audit log
    await adminClient.from('audit_logs').insert({
      user_id: currentUser.id,
      branch_id: sale.branch_id as string,
      action_type: 'SALE_REFUNDED',
      entity_type: 'sale',
      entity_id: saleId,
      description: `${isFullRefund ? 'Full' : 'Partial'} refund ₱${amount.toFixed(2)} on ${sale.receipt_number as string} — ${reason}`,
      metadata: { refund_id: refundId, amount, reason, return_inventory, is_full: isFullRefund },
    } as Record<string, unknown>);

    return NextResponse.json({ success: true, refund_id: refundId, new_status: newStatus });

  } catch (error) {
    console.error('POST /api/sales/[id]/refund error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
