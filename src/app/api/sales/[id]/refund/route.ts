import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Profile } from '@/types/database';

/**
 * POST /api/sales/[id]/refund
 *
 * Security fixes applied:
 *   [P1] Amount check now accounts for ALL prior refunds — cumulative refunds
 *        cannot exceed the original sale total.
 *   [P1] refund_items[].sale_item_id is validated to belong to this sale, and
 *        the requested quantity cannot exceed the still-refundable quantity.
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

    // ─── [P1 FIX] Cumulative refund check ───────────────────
    // Fetch the sum of all prior refunds on this sale.
    const { data: priorRefundsData } = await adminClient
      .from('refunds')
      .select('amount')
      .eq('sale_id', saleId);

    const priorRefundTotal = ((priorRefundsData || []) as Record<string, unknown>[])
      .reduce((sum, r) => sum + Number(r.amount), 0);

    const saleTotal = sale.total as number;
    const remainingRefundable = saleTotal - priorRefundTotal;

    if (amount > remainingRefundable) {
      return NextResponse.json({
        error: `Refund amount (₱${amount.toFixed(2)}) exceeds remaining refundable amount ` +
               `(₱${remainingRefundable.toFixed(2)} of original ₱${saleTotal.toFixed(2)})`
      }, { status: 400 });
    }

    // ─── [P1 FIX] Validate refund_items belong to this sale ─
    if (refund_items.length > 0) {
      // Fetch all valid sale items for this sale
      const { data: salItemsData } = await adminClient
        .from('sale_items')
        .select('id, quantity, item_type, product_id')
        .eq('sale_id', saleId);

      const validSaleItems = new Map(
        ((salItemsData || []) as Record<string, unknown>[]).map(si => [si.id as string, si])
      );

      // Fetch already-refunded quantities per sale_item
      const { data: priorItemsData } = await adminClient
        .from('refund_items')
        .select('sale_item_id, quantity')
        .in('sale_item_id', [...validSaleItems.keys()]);

      const refundedQtyMap = new Map<string, number>();
      for (const ri of (priorItemsData || []) as Record<string, unknown>[]) {
        const key = ri.sale_item_id as string;
        refundedQtyMap.set(key, (refundedQtyMap.get(key) ?? 0) + (ri.quantity as number));
      }

      for (const ri of refund_items) {
        // Must belong to this sale
        if (!validSaleItems.has(ri.sale_item_id)) {
          return NextResponse.json({
            error: `sale_item_id ${ri.sale_item_id} does not belong to sale ${saleId}`
          }, { status: 400 });
        }

        const saleItem = validSaleItems.get(ri.sale_item_id)!;
        const originalQty = saleItem.quantity as number;
        const alreadyRefunded = refundedQtyMap.get(ri.sale_item_id) ?? 0;
        const stillRefundable = originalQty - alreadyRefunded;

        if (ri.quantity > stillRefundable) {
          return NextResponse.json({
            error: `Requested refund quantity (${ri.quantity}) exceeds still-refundable ` +
                   `quantity (${stillRefundable}) for item ${ri.sale_item_id}`
          }, { status: 400 });
        }
      }
    }

    // ─── Create refund record ────────────────────────────────

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

    // ─── Insert refund items & optionally restore inventory ──

    if (refund_items.length > 0) {
      const refundItemsPayload = refund_items.map(ri => ({
        refund_id: refundId,
        sale_item_id: ri.sale_item_id,
        quantity: ri.quantity,
        amount: ri.amount,
      }));
      await adminClient.from('refund_items').insert(refundItemsPayload as Record<string, unknown>[]);

      if (return_inventory) {
        for (const ri of refund_items) {
          const { data: saleItem } = await adminClient
            .from('sale_items')
            .select('product_id, quantity')
            .eq('id', ri.sale_item_id)
            .eq('sale_id', saleId)   // re-scoped to this sale for safety
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

    // ─── Determine new sale status ───────────────────────────

    const newTotalRefunded = priorRefundTotal + amount;
    const isFullRefund = Math.abs(newTotalRefunded - saleTotal) < 0.01;
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
      metadata: {
        refund_id: refundId, amount, reason, return_inventory,
        is_full: isFullRefund, prior_refund_total: priorRefundTotal,
      },
    } as Record<string, unknown>);

    return NextResponse.json({ success: true, refund_id: refundId, new_status: newStatus });

  } catch (error) {
    console.error('POST /api/sales/[id]/refund error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
