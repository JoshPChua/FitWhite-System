import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertImusOnlyBranch, IMUS_ONLY, IMUS_BRANCH_CODE } from '@/lib/feature-flags';
import type { Profile } from '@/types/database';

/**
 * POST /api/inventory/extra-consumable
 *
 * Deducts a manual "extra consumable" from inventory during a transaction.
 * Logs as `addon_manual` source in inventory_logs. Does NOT charge the customer.
 *
 * Body: { product_id, branch_id, quantity, sale_id?, notes? }
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

    // Auditor is view-only — cannot deduct consumables
    if (caller.role === 'auditor') {
      return NextResponse.json({ error: 'Auditors cannot deduct consumables' }, { status: 403 });
    }

    const body = await request.json();
    const { product_id, branch_id, quantity = 1, sale_id = null, notes = '' } = body as {
      product_id: string;
      branch_id: string;
      quantity?: number;
      sale_id?: string | null;
      notes?: string;
    };

    if (!product_id || !branch_id) {
      return NextResponse.json({ error: 'product_id and branch_id are required' }, { status: 400 });
    }
    if (!Number.isInteger(quantity) || quantity < 1) {
      return NextResponse.json({ error: 'Quantity must be a whole number ≥ 1' }, { status: 400 });
    }

    // Branch isolation for non-owners
    if ((caller.role === 'manager' || caller.role === 'cashier') && caller.branch_id !== branch_id) {
      return NextResponse.json({ error: 'Cannot adjust inventory in a different branch' }, { status: 403 });
    }

    const adminClient = createAdminClient();

    // Imus-only guard
    if (IMUS_ONLY) {
      const { data: imusBranch } = await adminClient
        .from('branches').select('id').eq('code', IMUS_BRANCH_CODE).single();
      const imusBranchId = imusBranch ? (imusBranch as Record<string, unknown>).id as string : null;
      try {
        assertImusOnlyBranch(branch_id, imusBranchId);
      } catch {
        return NextResponse.json({ error: 'This installation is restricted to the Imus branch' }, { status: 403 });
      }
    }

    // Get product name
    const { data: product } = await adminClient
      .from('products').select('name').eq('id', product_id).single();
    const productName = product ? (product as Record<string, unknown>).name as string : product_id;

    // Get current inventory
    const { data: inv } = await adminClient
      .from('inventory')
      .select('id, quantity')
      .eq('product_id', product_id)
      .eq('branch_id', branch_id)
      .single();

    if (!inv) {
      return NextResponse.json({ error: `No inventory record for "${productName}" in this branch` }, { status: 400 });
    }

    const invRecord = inv as Record<string, unknown>;
    const oldQty = invRecord.quantity as number;
    if (oldQty < quantity) {
      return NextResponse.json({
        error: `Insufficient stock for "${productName}". Available: ${oldQty}, Requested: ${quantity}`
      }, { status: 400 });
    }

    const newQty = oldQty - quantity;

    // Update inventory (error-checked)
    const { error: updateErr } = await adminClient.from('inventory')
      .update({ quantity: newQty } as Record<string, unknown>)
      .eq('id', invRecord.id as string);

    if (updateErr) {
      return NextResponse.json({
        error: `Inventory update failed for "${productName}": ${updateErr.message}`
      }, { status: 500 });
    }

    // Write inventory log with addon_manual source (error-checked with rollback)
    const { error: logErr } = await adminClient.from('inventory_logs').insert({
      inventory_id: invRecord.id as string,
      product_id,
      branch_id,
      performed_by: currentUser.id,
      source: 'addon_manual',
      quantity_delta: -quantity,
      quantity_before: oldQty,
      quantity_after: newQty,
      sale_id: sale_id || null,
      notes: notes || `Extra consumable: "${productName}" ×${quantity}`,
    } as Record<string, unknown>);

    if (logErr) {
      // Restore inventory to previous quantity since log failed
      await adminClient.from('inventory')
        .update({ quantity: oldQty } as Record<string, unknown>)
        .eq('id', invRecord.id as string);
      return NextResponse.json({
        error: `Inventory log failed for "${productName}": ${logErr.message}. Stock restored.`
      }, { status: 500 });
    }

    // Audit log
    await adminClient.from('audit_logs').insert({
      user_id: currentUser.id,
      branch_id,
      action_type: 'EXTRA_CONSUMABLE',
      entity_type: 'inventory',
      entity_id: invRecord.id as string,
      description: `Extra consumable deducted: "${productName}" ×${quantity} (no charge)`,
      metadata: { product_id, branch_id, quantity, sale_id, notes },
    } as Record<string, unknown>);

    return NextResponse.json({
      success: true,
      product_name: productName,
      quantity_deducted: quantity,
      new_quantity: newQty,
    });
  } catch (error) {
    console.error('POST /api/inventory/extra-consumable error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
