import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  requireActiveProfile, enforceImusOnly, isErrorResponse, jsonError,
} from '@/lib/api-helpers';
import type { Profile } from '@/types/database';

/**
 * POST /api/sales/[id]/refund
 *
 * Creates a refund with full rollback-ledger protection:
 *   - Every write is error-checked
 *   - refund_items failure → rollback refund row
 *   - Inventory update failure → rollback refund + items
 *   - Stock adjustment/log failure → restore previous inventory qty
 *   - Sale status update failure → rollback all refund side-effects
 *   - Cumulative refund cap (cannot exceed original sale total)
 *   - refund_items must belong to this sale; qty cannot exceed refundable amount
 *   - refund_items amount and quantity validated as positive numbers
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: saleId } = await params;
    const supabase = await createClient();
    const auth = await requireActiveProfile(supabase);
    if (isErrorResponse(auth)) return auth;
    const { userId, profile: caller } = auth;

    if (caller.role === 'cashier') {
      return jsonError('Forbidden — manager or owner required', 403);
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

    // ─── Input validation ────────────────────────────────────
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      return jsonError('Invalid refund amount — must be a positive number', 400);
    }
    if (!reason?.trim()) {
      return jsonError('Refund reason is required', 400);
    }

    // Validate each refund_item has positive numbers
    for (const ri of refund_items) {
      if (typeof ri.quantity !== 'number' || !Number.isFinite(ri.quantity) || ri.quantity <= 0) {
        return jsonError(`Invalid quantity for refund item ${ri.sale_item_id} — must be > 0`, 400);
      }
      if (typeof ri.amount !== 'number' || !Number.isFinite(ri.amount) || ri.amount <= 0) {
        return jsonError(`Invalid amount for refund item ${ri.sale_item_id} — must be > 0`, 400);
      }
    }

    const adminClient = createAdminClient();

    // ─── Imus-only guard ─────────────────────────────────────

    // Fetch sale
    const { data: saleData, error: saleError } = await adminClient
      .from('sales').select('*').eq('id', saleId).single();
    if (saleError || !saleData) {
      return jsonError('Sale not found', 404);
    }
    const sale = saleData as Record<string, unknown>;

    // Imus-only enforcement: refund must be on an Imus-branch sale
    const imusGuard = await enforceImusOnly(adminClient, sale.branch_id as string);
    if (imusGuard) return imusGuard;

    if (caller.role === 'manager' && caller.branch_id !== sale.branch_id) {
      return jsonError('Cannot refund sales from another branch', 403);
    }
    if (sale.status === 'voided' || sale.status === 'refunded') {
      return jsonError(`Cannot refund a ${sale.status} sale`, 400);
    }

    // ─── Cumulative refund check ─────────────────────────────
    const { data: priorRefundsData } = await adminClient
      .from('refunds')
      .select('amount')
      .eq('sale_id', saleId);

    const priorRefundTotal = ((priorRefundsData || []) as Record<string, unknown>[])
      .reduce((sum, r) => sum + Number(r.amount), 0);

    const saleTotal = sale.total as number;
    const remainingRefundable = saleTotal - priorRefundTotal;

    if (amount > remainingRefundable + 0.01) {
      return jsonError(
        `Refund amount (₱${amount.toFixed(2)}) exceeds remaining refundable amount ` +
        `(₱${remainingRefundable.toFixed(2)} of original ₱${saleTotal.toFixed(2)})`,
        400,
      );
    }

    // ─── Validate refund_items belong to this sale ───────────
    // Build a lookup from sale_items for validation and inventory restoration
    const { data: salItemsData } = await adminClient
      .from('sale_items')
      .select('id, quantity, item_type, product_id')
      .eq('sale_id', saleId);

    const validSaleItems = new Map(
      ((salItemsData || []) as Record<string, unknown>[]).map(si => [si.id as string, si])
    );

    if (refund_items.length > 0) {
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
          return jsonError(
            `sale_item_id ${ri.sale_item_id} does not belong to sale ${saleId}`,
            400,
          );
        }

        const saleItem = validSaleItems.get(ri.sale_item_id)!;
        const originalQty = saleItem.quantity as number;
        const alreadyRefunded = refundedQtyMap.get(ri.sale_item_id) ?? 0;
        const stillRefundable = originalQty - alreadyRefunded;

        if (ri.quantity > stillRefundable) {
          return jsonError(
            `Requested refund quantity (${ri.quantity}) exceeds still-refundable ` +
            `quantity (${stillRefundable}) for item ${ri.sale_item_id}`,
            400,
          );
        }
      }
    }

    // ─── Rollback ledger ─────────────────────────────────────
    // Tracks all successful writes so any subsequent failure can undo them.

    interface StockMutation {
      inventoryId: string;
      quantityBefore: number;
    }
    const stockMutations: StockMutation[] = [];
    let refundId: string | null = null;
    let refundItemsInserted = false;

    const rollback = async () => {
      try {
        // Reverse stock mutations (in reverse order)
        for (const m of [...stockMutations].reverse()) {
          await adminClient.from('inventory')
            .update({ quantity: m.quantityBefore } as Record<string, unknown>)
            .eq('id', m.inventoryId);
        }
        // Remove stock adjustments and logs for this refund
        if (refundId) {
          await adminClient.from('stock_adjustments').delete().eq('reference_id', saleId);
          await adminClient.from('inventory_logs').delete().eq('sale_id', saleId);
        }
        // Remove refund items
        if (refundId && refundItemsInserted) {
          await adminClient.from('refund_items').delete().eq('refund_id', refundId);
        }
        // Remove refund record
        if (refundId) {
          await adminClient.from('refunds').delete().eq('id', refundId);
        }
      } catch (rbErr) {
        console.error('Refund rollback error (may be partially written):', rbErr);
      }
    };

    // ─── Create refund record ────────────────────────────────

    const { data: refundData, error: refundError } = await adminClient
      .from('refunds')
      .insert({
        sale_id: saleId,
        branch_id: sale.branch_id as string,
        user_id: userId,
        refund_type,
        amount,
        reason,
        notes: notes || '',
        return_inventory,
      } as Record<string, unknown>)
      .select('id')
      .single();

    if (refundError) return jsonError(refundError.message, 500);
    refundId = (refundData as Record<string, unknown>).id as string;

    // ─── Insert refund items ─────────────────────────────────

    if (refund_items.length > 0) {
      const refundItemsPayload = refund_items.map(ri => ({
        refund_id: refundId,
        sale_item_id: ri.sale_item_id,
        quantity: ri.quantity,
        amount: ri.amount,
      }));

      const { error: riError } = await adminClient
        .from('refund_items')
        .insert(refundItemsPayload as Record<string, unknown>[]);

      if (riError) {
        console.error('refund_items insert failed, rolling back refund:', riError.message);
        await rollback();
        return jsonError(`Refund items creation failed: ${riError.message}. Refund was not completed.`, 500);
      }
      refundItemsInserted = true;

      // ─── Optionally restore inventory ──────────────────────

      if (return_inventory) {
        for (const ri of refund_items) {
          const saleItem = validSaleItems.get(ri.sale_item_id);
          if (!saleItem || saleItem.item_type !== 'product' || !saleItem.product_id) continue;

          const { data: inv } = await adminClient
            .from('inventory')
            .select('id, quantity')
            .eq('product_id', saleItem.product_id as string)
            .eq('branch_id', sale.branch_id as string)
            .single();

          if (!inv) continue;

          const invRecord = inv as Record<string, unknown>;
          const oldQty = invRecord.quantity as number;
          const newQty = oldQty + ri.quantity;

          // Update inventory
          const { error: updateErr } = await adminClient.from('inventory')
            .update({ quantity: newQty } as Record<string, unknown>)
            .eq('id', invRecord.id as string);

          if (updateErr) {
            console.error('Inventory restoration failed, rolling back:', updateErr.message);
            await rollback();
            return jsonError(
              `Inventory restoration failed: ${updateErr.message}. Refund rolled back.`,
              500,
            );
          }

          // Record in ledger for potential rollback
          stockMutations.push({ inventoryId: invRecord.id as string, quantityBefore: oldQty });

          // Legacy stock_adjustments (backward compat)
          const { error: adjErr } = await adminClient.from('stock_adjustments').insert({
            inventory_id: invRecord.id as string,
            branch_id: sale.branch_id as string,
            user_id: userId,
            adjustment_type: 'refund',
            quantity_change: ri.quantity,
            reason: `Refund on ${sale.receipt_number as string}`,
            reference_id: saleId,
          } as Record<string, unknown>);

          if (adjErr) {
            console.error('stock_adjustments write failed, rolling back:', adjErr.message);
            await rollback();
            return jsonError(
              `Stock adjustment write failed: ${adjErr.message}. Refund rolled back.`,
              500,
            );
          }

          // Canonical inventory_logs
          const { error: logErr } = await adminClient.from('inventory_logs').insert({
            inventory_id: invRecord.id as string,
            product_id: saleItem.product_id as string,
            branch_id: sale.branch_id as string,
            performed_by: userId,
            source: 'refund',
            quantity_delta: ri.quantity,
            quantity_before: oldQty,
            quantity_after: newQty,
            sale_id: saleId,
            notes: `Refund inventory restoration — ${sale.receipt_number as string}`,
          } as Record<string, unknown>);

          if (logErr) {
            console.error('inventory_logs write failed, rolling back:', logErr.message);
            await rollback();
            return jsonError(
              `Inventory log write failed: ${logErr.message}. Refund rolled back.`,
              500,
            );
          }
        }
      }
    }

    // ─── Determine new sale status ───────────────────────────

    const newTotalRefunded = priorRefundTotal + amount;
    const isFullRefund = Math.abs(newTotalRefunded - saleTotal) < 0.01;
    const newStatus = isFullRefund ? 'refunded' : 'partial_refund';

    const { error: statusErr } = await adminClient
      .from('sales')
      .update({ status: newStatus } as Record<string, unknown>)
      .eq('id', saleId);

    if (statusErr) {
      console.error('Sale status update failed, rolling back:', statusErr.message);
      await rollback();
      return jsonError(
        `Sale status update failed: ${statusErr.message}. Refund rolled back.`,
        500,
      );
    }

    // Audit log (non-critical, outside rollback scope)
    await adminClient.from('audit_logs').insert({
      user_id: userId,
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
    return jsonError('Internal server error', 500);
  }
}
