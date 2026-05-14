import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyPin, isValidPinFormat, MAX_PIN_ATTEMPTS } from '@/lib/auditor-pin';
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
 * Authorization:
 *   - Owner: can void directly (no PIN)
 *   - Manager: must provide auditor_pin for approval
 *   - Cashier/Auditor: cannot void
 *
 * Ordering invariant:
 *   All reversals run BEFORE the sale status is set to 'voided'.
 *   If any reversal step fails, the sale stays 'completed' and all
 *   previously-applied mutations are rolled back using an in-memory ledger.
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
    if (!caller || caller.role === 'cashier' || caller.role === 'auditor') {
      return NextResponse.json({ error: 'Forbidden — manager or owner required' }, { status: 403 });
    }

    const body = await request.json();
    const { reason = 'No reason provided', auditor_pin } = body as { reason?: string; auditor_pin?: string };

    const adminClient = createAdminClient();

    // ─── Auditor PIN validation (managers only) ──────────
    let approvedByAuditorId: string | null = null;

    if (caller.role === 'manager') {
      if (!auditor_pin) {
        return NextResponse.json({ error: 'Auditor PIN required for void approval' }, { status: 400 });
      }
      if (!isValidPinFormat(auditor_pin)) {
        return NextResponse.json({ error: 'PIN must be exactly 6 digits' }, { status: 400 });
      }

      // Fetch active auditors
      const { data: auditors } = await adminClient
        .from('profiles')
        .select('id, first_name, last_name, auditor_pin, pin_failed_attempts, pin_locked_until')
        .eq('role', 'auditor')
        .eq('is_active', true)
        .not('auditor_pin', 'is', null);

      if (!auditors || auditors.length === 0) {
        return NextResponse.json({ error: 'No auditors configured. Contact the owner to set up an auditor account.' }, { status: 400 });
      }

      const now = new Date();
      let pinValid = false;

      for (const auditor of auditors as Record<string, unknown>[]) {
        const lockedUntil = auditor.pin_locked_until ? new Date(auditor.pin_locked_until as string) : null;
        if (lockedUntil && lockedUntil > now) continue; // skip locked auditor

        const isValid = await verifyPin(auditor_pin, auditor.auditor_pin as string);
        if (isValid) {
          approvedByAuditorId = auditor.id as string;
          pinValid = true;
          // Reset failed attempts
          await adminClient.from('profiles')
            .update({ pin_failed_attempts: 0, pin_locked_until: null } as Record<string, unknown>)
            .eq('id', auditor.id as string);
          break;
        }
      }

      if (!pinValid) {
        // Increment failed attempts
        for (const auditor of auditors as Record<string, unknown>[]) {
          const failed = ((auditor.pin_failed_attempts as number) || 0) + 1;
          const update: Record<string, unknown> = { pin_failed_attempts: failed };
          if (failed >= MAX_PIN_ATTEMPTS) {
            update.pin_locked_until = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
          }
          await adminClient.from('profiles').update(update).eq('id', auditor.id as string);
        }
        return NextResponse.json({ error: 'Invalid auditor PIN' }, { status: 403 });
      }
    }


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

    // ─── Rollback ledger: tracks every void-side mutation ────
    //     If any step fails, we reverse all previous mutations.

    interface VoidMutation {
      inventoryId: string;
      quantityBefore: number;
    }
    const voidMutations: VoidMutation[] = [];
    const voidLogIds: string[] = []; // inventory_logs created during void
    const voidStockAdjustmentIds: string[] = []; // stock_adjustments created during void

    // Strip generated/computed columns that Postgres rejects on INSERT
    const sanitizeCommissionForInsert = (row: Record<string, unknown>): Record<string, unknown> => {
      const { net_branch_amount, ...safe } = row;
      void net_branch_amount; // acknowledge unused
      return safe;
    };

    // Package state snapshots for rollback
    let savedPackagePayments: Record<string, unknown>[] = [];
    const cancelledPackages: Array<{ id: string; previousStatus: string; previousDownpayment: number; previousTotalPaid: number }> = [];
    let savedCommissions: Record<string, unknown>[] = [];

    const rollbackVoid = async () => {
      try {
        // 1. Reverse inventory mutations in reverse order
        for (const m of [...voidMutations].reverse()) {
          await adminClient.from('inventory')
            .update({ quantity: m.quantityBefore } as Record<string, unknown>)
            .eq('id', m.inventoryId);
        }
        // 2. Delete any void-side inventory logs
        if (voidLogIds.length > 0) {
          await adminClient.from('inventory_logs').delete().in('id', voidLogIds);
        }
        // 3. Delete any void-side stock adjustments
        if (voidStockAdjustmentIds.length > 0) {
          await adminClient.from('stock_adjustments').delete().in('id', voidStockAdjustmentIds);
        }
        // 4. Restore cancelled packages to their previous statuses and paid amounts
        for (const pkg of cancelledPackages) {
          await adminClient.from('patient_packages')
            .update({
              status: pkg.previousStatus,
              downpayment: pkg.previousDownpayment,
              total_paid: pkg.previousTotalPaid,
            } as Record<string, unknown>)
            .eq('id', pkg.id);
        }
        // 5. Reinsert deleted package_payments from saved full rows
        if (savedPackagePayments.length > 0) {
          await adminClient.from('package_payments').insert(savedPackagePayments);
        }
        // 6. Reinsert deleted doctor commissions (sanitized — no generated columns)
        if (savedCommissions.length > 0) {
          const safeCommissions = savedCommissions.map(sanitizeCommissionForInsert);
          await adminClient.from('doctor_commissions').insert(safeCommissions);
        }
      } catch (rbErr) {
        console.error('Void rollback error (sale may have inconsistent state):', rbErr);
      }
    };

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
        await rollbackVoid();
        return NextResponse.json({
          error: `Failed to read inventory for product "${item.name}": ${invErr.message}. Sale NOT voided.`
        }, { status: 500 });
      }

      if (inv) {
        const invRecord = inv as Record<string, unknown>;
        const oldQty = invRecord.quantity as number;
        const newQty = oldQty + (item.quantity as number);

        const { error: updateErr } = await adminClient.from('inventory')
          .update({ quantity: newQty } as Record<string, unknown>)
          .eq('id', invRecord.id as string);

        if (updateErr) {
          await rollbackVoid();
          return NextResponse.json({
            error: `Failed to restore inventory for "${item.name}": ${updateErr.message}. Sale NOT voided.`
          }, { status: 500 });
        }

        // Track mutation for rollback
        voidMutations.push({ inventoryId: invRecord.id as string, quantityBefore: oldQty });

        // Stock adjustment log (tracked for rollback if it succeeds)
        const { data: adjData, error: adjErr } = await adminClient.from('stock_adjustments').insert({
          inventory_id: invRecord.id as string,
          branch_id: sale.branch_id as string,
          user_id: currentUser.id,
          adjustment_type: 'refund',
          quantity_change: item.quantity as number,
          reason: `Void of ${sale.receipt_number as string}`,
          reference_id: saleId,
        } as Record<string, unknown>).select('id').single();

        if (adjErr) {
          console.error('Stock adjustment log failed (non-fatal):', adjErr);
        } else if (adjData) {
          voidStockAdjustmentIds.push((adjData as Record<string, unknown>).id as string);
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
      await rollbackVoid();
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
        await rollbackVoid();
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
          await rollbackVoid();
          return NextResponse.json({
            error: `Failed to restore BOM inventory: ${updateErr.message}. Sale NOT voided.`
          }, { status: 500 });
        }

        // Track mutation for rollback
        voidMutations.push({ inventoryId: log.inventory_id as string, quantityBefore: currentQty });

        // Log the reversal
        const { data: reversalLog, error: logErr } = await adminClient.from('inventory_logs').insert({
          inventory_id: log.inventory_id as string,
          product_id: log.product_id as string,
          branch_id: sale.branch_id as string,
          performed_by: currentUser.id,
          source: 'void_reversal',
          quantity_delta: restoreQty,
          quantity_before: currentQty,
          quantity_after: newQty,
          sale_id: saleId,
          notes: `Void reversal of BOM deduction — ${sale.receipt_number as string}`,
        } as Record<string, unknown>).select('id').single();

        if (logErr) {
          console.error('BOM reversal log failed (non-fatal):', logErr);
        } else if (reversalLog) {
          voidLogIds.push((reversalLog as Record<string, unknown>).id as string);
        }
      }
    }

    // ─── 3. Cancel patient packages + delete payments ────────
    if (saleItemIds.length > 0) {
      const { data: packages, error: pkgErr } = await adminClient
        .from('patient_packages')
        .select('id, status, downpayment, total_paid')
        .in('sale_item_id', saleItemIds);

      if (pkgErr) {
        await rollbackVoid();
        return NextResponse.json({
          error: `Failed to read packages: ${pkgErr.message}. Sale NOT voided.`
        }, { status: 500 });
      }

      const packageRecords = (packages || []) as Record<string, unknown>[];
      const packageIds = packageRecords.map(p => p.id as string);

      if (packageIds.length > 0) {
        // Fetch and store full package_payment rows BEFORE deletion (for rollback)
        const { data: existingPayments, error: ppFetchErr } = await adminClient
          .from('package_payments')
          .select('*')
          .in('package_id', packageIds);

        if (ppFetchErr) {
          await rollbackVoid();
          return NextResponse.json({
            error: `Failed to read package payments: ${ppFetchErr.message}. Sale NOT voided.`
          }, { status: 500 });
        }

        savedPackagePayments = (existingPayments || []) as Record<string, unknown>[];

        // Delete package_payments first (FK constraint)
        const { error: ppDelErr } = await adminClient
          .from('package_payments')
          .delete()
          .in('package_id', packageIds);

        if (ppDelErr) {
          // package_payments not deleted yet, just reset savedPackagePayments and rollback
          savedPackagePayments = [];
          await rollbackVoid();
          return NextResponse.json({
            error: `Failed to delete package payments: ${ppDelErr.message}. Sale NOT voided.`
          }, { status: 500 });
        }

        // Cancel the packages and reset paid amounts (store previous values for rollback)
        for (const pkg of packageRecords) {
          const previousStatus = pkg.status as string;
          const previousDownpayment = (pkg.downpayment as number) || 0;
          const previousTotalPaid = (pkg.total_paid as number) || 0;

          const { error: pkgCancelErr } = await adminClient
            .from('patient_packages')
            .update({ status: 'cancelled', downpayment: 0, total_paid: 0 } as Record<string, unknown>)
            .eq('id', pkg.id as string);

          if (pkgCancelErr) {
            await rollbackVoid();
            return NextResponse.json({
              error: `Failed to cancel package ${pkg.id}: ${pkgCancelErr.message}. Sale NOT voided.`
            }, { status: 500 });
          }

          cancelledPackages.push({ id: pkg.id as string, previousStatus, previousDownpayment, previousTotalPaid });
        }
      }
    }

    // ─── 4. Delete doctor commissions ────────────────────────
    if (saleItemIds.length > 0) {
      // Fetch and store full commission rows BEFORE deletion (for rollback)
      const { data: existingCommissions, error: commFetchErr } = await adminClient
        .from('doctor_commissions')
        .select('*')
        .in('sale_item_id', saleItemIds);

      if (commFetchErr) {
        await rollbackVoid();
        return NextResponse.json({
          error: `Failed to read commissions: ${commFetchErr.message}. Sale NOT voided.`
        }, { status: 500 });
      }

      savedCommissions = (existingCommissions || []) as Record<string, unknown>[];

      const { error: commDelErr } = await adminClient
        .from('doctor_commissions')
        .delete()
        .in('sale_item_id', saleItemIds);

      if (commDelErr) {
        // Commissions not deleted yet, reset savedCommissions and rollback
        savedCommissions = [];
        await rollbackVoid();
        return NextResponse.json({
          error: `Failed to delete commissions: ${commDelErr.message}. Sale NOT voided.`
        }, { status: 500 });
      }
    }

    // ─── 5. Mark sale as voided (LAST) ──────────────────────
    //   All reversals succeeded. Now it is safe to flip the status.
    const { error: voidError } = await adminClient
      .from('sales')
      .update({
        status: 'voided',
        ...(approvedByAuditorId ? { void_approved_by: approvedByAuditorId, void_approved_at: new Date().toISOString() } : {}),
      } as Record<string, unknown>)
      .eq('id', saleId);

    if (voidError) {
      await rollbackVoid();
      return NextResponse.json({
        error: `All reversals succeeded but failed to mark sale as voided: ${voidError.message}. ` +
               'Void rolled back. Contact support.'
      }, { status: 500 });
    }

    // ─── Audit Log ──────────────────────────────────────────
    await adminClient.from('audit_logs').insert({
      user_id: currentUser.id,
      branch_id: sale.branch_id as string,
      action_type: 'SALE_VOIDED',
      entity_type: 'sale',
      entity_id: saleId,
      description: `Sale ${sale.receipt_number as string} voided — reason: ${reason}${approvedByAuditorId ? ' (auditor approved)' : ' (owner authority)'}`,
      metadata: {
        receipt_number: sale.receipt_number,
        reason,
        total: sale.total,
        products_restored: productSaleItems.length,
        bom_logs_reversed: (bomLogs || []).length,
        packages_cancelled: cancelledPackages.length,
        approved_by: approvedByAuditorId,
      },
    } as Record<string, unknown>);

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('POST /api/sales/[id]/void error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
