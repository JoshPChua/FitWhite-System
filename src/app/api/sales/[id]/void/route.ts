import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Profile } from '@/types/database';

/**
 * POST /api/sales/[id]/void
 *
 * Full void reversal — reverses ALL side effects of a completed sale:
 *   1. Restore product inventory (direct sales)
 *   2. Reverse service BOM consumable deductions
 *   3. Cancel patient packages + delete auto-created package_payments
 *   4. Delete doctor commissions
 *   5. Mark sale as voided (LAST — only after all reversals succeed)
 *
 * Ordering invariant:
 *   All reversals run BEFORE the sale status is set to 'voided'.
 *   If any reversal step fails, the sale stays 'completed' and the caller
 *   gets an error describing what failed. This prevents partial-void states
 *   where the sale is voided but side-effect data is inconsistent.
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

    // ─── Block voiding of already-processed states ──────────
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

    // Only 'completed' sales reach here.
    // All reversals happen BEFORE we mark the sale as voided.

    // ─── Fetch sale items (needed by all reversal steps) ────
    const { data: saleItems, error: saleItemsError } = await adminClient
      .from('sale_items')
      .select('id, product_id, service_id, quantity, name, item_type')
      .eq('sale_id', saleId);

    if (saleItemsError) {
      return NextResponse.json({
        error: `Failed to fetch sale items: ${saleItemsError.message}. Sale NOT voided.`
      }, { status: 500 });
    }

    const allSaleItems = (saleItems || []) as Record<string, unknown>[];
    const saleItemIds = allSaleItems.map(si => si.id as string);

    // ─── 1. Restore product inventory ───────────────────────
    const productSaleItems = allSaleItems.filter(si => si.item_type === 'product');

    for (const item of productSaleItems) {
      const { data: inv, error: invErr } = await adminClient
        .from('inventory')
        .select('id, quantity')
        .eq('product_id', item.product_id as string)
        .eq('branch_id', sale.branch_id as string)
        .single();

      if (invErr) {
        return NextResponse.json({
          error: `Failed to read inventory for product "${item.name}": ${invErr.message}. Sale NOT voided.`
        }, { status: 500 });
      }

      if (inv) {
        const invRecord = inv as Record<string, unknown>;
        const newQty = (invRecord.quantity as number) + (item.quantity as number);

        const { error: updateErr } = await adminClient.from('inventory')
          .update({ quantity: newQty } as Record<string, unknown>)
          .eq('id', invRecord.id as string);

        if (updateErr) {
          return NextResponse.json({
            error: `Failed to restore inventory for "${item.name}": ${updateErr.message}. Sale NOT voided.`
          }, { status: 500 });
        }

        // Stock adjustment log
        const { error: adjErr } = await adminClient.from('stock_adjustments').insert({
          inventory_id: invRecord.id as string,
          branch_id: sale.branch_id as string,
          user_id: currentUser.id,
          adjustment_type: 'refund',
          quantity_change: item.quantity as number,
          reason: `Void of ${sale.receipt_number as string}`,
          reference_id: saleId,
        } as Record<string, unknown>);

        if (adjErr) {
          console.error('Stock adjustment log failed (non-fatal):', adjErr);
        }
      }
    }

    // ─── 2. Reverse service BOM deductions ──────────────────
    const { data: bomLogs, error: bomLogsErr } = await adminClient
      .from('inventory_logs')
      .select('id, inventory_id, product_id, quantity_delta, quantity_before')
      .eq('sale_id', saleId)
      .eq('source', 'service_bom');

    if (bomLogsErr) {
      return NextResponse.json({
        error: `Failed to read BOM logs: ${bomLogsErr.message}. Sale NOT voided.`
      }, { status: 500 });
    }

    for (const log of (bomLogs || []) as Record<string, unknown>[]) {
      const restoreQty = Math.abs(log.quantity_delta as number);

      const { data: currentInv, error: readErr } = await adminClient
        .from('inventory')
        .select('id, quantity')
        .eq('id', log.inventory_id as string)
        .single();

      if (readErr) {
        return NextResponse.json({
          error: `Failed to read BOM inventory: ${readErr.message}. Sale NOT voided.`
        }, { status: 500 });
      }

      if (currentInv) {
        const currentQty = (currentInv as Record<string, unknown>).quantity as number;
        const newQty = currentQty + restoreQty;

        const { error: updateErr } = await adminClient.from('inventory')
          .update({ quantity: newQty } as Record<string, unknown>)
          .eq('id', log.inventory_id as string);

        if (updateErr) {
          return NextResponse.json({
            error: `Failed to restore BOM inventory: ${updateErr.message}. Sale NOT voided.`
          }, { status: 500 });
        }

        // Log the reversal
        const { error: logErr } = await adminClient.from('inventory_logs').insert({
          inventory_id: log.inventory_id as string,
          product_id: log.product_id as string,
          branch_id: sale.branch_id as string,
          performed_by: currentUser.id,
          source: 'manual_adjust', // safe fallback; change to 'void_reversal' after migration
          quantity_delta: restoreQty,
          quantity_before: currentQty,
          quantity_after: newQty,
          sale_id: saleId,
          notes: `Void reversal of BOM deduction — ${sale.receipt_number as string}`,
        } as Record<string, unknown>);

        if (logErr) {
          console.error('BOM reversal log failed (non-fatal):', logErr);
        }
      }
    }

    // ─── 3. Cancel patient packages + delete payments ────────
    if (saleItemIds.length > 0) {
      const { data: packages, error: pkgErr } = await adminClient
        .from('patient_packages')
        .select('id')
        .in('sale_item_id', saleItemIds);

      if (pkgErr) {
        return NextResponse.json({
          error: `Failed to read packages: ${pkgErr.message}. Sale NOT voided.`
        }, { status: 500 });
      }

      const packageIds = ((packages || []) as Record<string, unknown>[]).map(p => p.id as string);

      if (packageIds.length > 0) {
        // Delete package_payments first (FK constraint)
        const { error: ppDelErr } = await adminClient
          .from('package_payments')
          .delete()
          .in('package_id', packageIds);

        if (ppDelErr) {
          return NextResponse.json({
            error: `Failed to delete package payments: ${ppDelErr.message}. Sale NOT voided.`
          }, { status: 500 });
        }

        // Cancel the packages
        const { error: pkgCancelErr } = await adminClient
          .from('patient_packages')
          .update({ status: 'cancelled' } as Record<string, unknown>)
          .in('id', packageIds);

        if (pkgCancelErr) {
          return NextResponse.json({
            error: `Failed to cancel packages: ${pkgCancelErr.message}. Sale NOT voided.`
          }, { status: 500 });
        }
      }
    }

    // ─── 4. Delete doctor commissions ────────────────────────
    if (saleItemIds.length > 0) {
      const { error: commDelErr } = await adminClient
        .from('doctor_commissions')
        .delete()
        .in('sale_item_id', saleItemIds);

      if (commDelErr) {
        return NextResponse.json({
          error: `Failed to delete commissions: ${commDelErr.message}. Sale NOT voided.`
        }, { status: 500 });
      }
    }

    // ─── 5. Mark sale as voided (LAST) ──────────────────────
    //   All reversals succeeded. Now it is safe to flip the status.
    const { error: voidError } = await adminClient
      .from('sales')
      .update({ status: 'voided' } as Record<string, unknown>)
      .eq('id', saleId);

    if (voidError) {
      return NextResponse.json({
        error: `All reversals succeeded but failed to mark sale as voided: ${voidError.message}. ` +
               'The sale data is consistent but status was not updated. Contact support.'
      }, { status: 500 });
    }

    // ─── Audit Log ──────────────────────────────────────────
    await adminClient.from('audit_logs').insert({
      user_id: currentUser.id,
      branch_id: sale.branch_id as string,
      action_type: 'SALE_VOIDED',
      entity_type: 'sale',
      entity_id: saleId,
      description: `Sale ${sale.receipt_number as string} voided — reason: ${reason}`,
      metadata: {
        receipt_number: sale.receipt_number,
        reason,
        total: sale.total,
        products_restored: productSaleItems.length,
        bom_logs_reversed: (bomLogs || []).length,
        packages_cancelled: saleItemIds.length,
      },
    } as Record<string, unknown>);

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('POST /api/sales/[id]/void error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
