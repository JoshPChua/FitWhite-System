import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  requireActiveProfile, enforceImusOnly, assertBranchAccess,
  isErrorResponse, jsonError,
} from '@/lib/api-helpers';

/**
 * POST /api/inventory/adjust — Manual stock adjustment
 * Supports: manual_add, manual_remove, initial, bulk_upload
 * Requires: owner or manager role
 *
 * Hardened:
 *   - quantity_change validated as finite integer, non-zero
 *   - low_stock_threshold validated as integer >= 0
 *   - All write errors checked
 *   - If stock_adjustments or inventory_logs write fails, restore previous inventory qty
 *   - Imus-only branch guard
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const auth = await requireActiveProfile(supabase);
    if (isErrorResponse(auth)) return auth;
    const { userId, profile: caller } = auth;

    if (caller.role !== 'owner' && caller.role !== 'manager') {
      return jsonError('Forbidden: insufficient permissions', 403);
    }

    const body = await request.json();
    const { product_id, branch_id, quantity_change, adjustment_type, reason, low_stock_threshold } = body as {
      product_id: string;
      branch_id: string;
      quantity_change: number;
      adjustment_type: 'manual_add' | 'manual_remove' | 'initial' | 'bulk_upload';
      reason?: string;
      low_stock_threshold?: number;
    };

    if (!product_id || !branch_id || !adjustment_type) {
      return jsonError('Required fields: product_id, branch_id, quantity_change, adjustment_type', 400);
    }

    // ─── Strict validation ───────────────────────────────────
    if (typeof quantity_change !== 'number' || !Number.isFinite(quantity_change) || !Number.isInteger(quantity_change)) {
      return jsonError('quantity_change must be a finite integer', 400);
    }
    if (quantity_change === 0) {
      return jsonError('quantity_change must not be zero', 400);
    }

    if (low_stock_threshold !== undefined) {
      if (typeof low_stock_threshold !== 'number' || !Number.isInteger(low_stock_threshold) || low_stock_threshold < 0) {
        return jsonError('low_stock_threshold must be an integer >= 0', 400);
      }
    }

    // Branch isolation
    const branchErr = assertBranchAccess(caller, branch_id, 'adjust inventory');
    if (branchErr) return branchErr;

    const adminClient = createAdminClient();

    // Imus-only guard
    const imusGuard = await enforceImusOnly(adminClient, branch_id);
    if (imusGuard) return imusGuard;

    // Get current inventory record
    const { data: currentInventory } = await adminClient
      .from('inventory')
      .select('*')
      .eq('product_id', product_id)
      .eq('branch_id', branch_id)
      .single();

    const currentQty = currentInventory ? (currentInventory as Record<string, unknown>).quantity as number : 0;

    // For removals, reject if stock would go negative
    if (quantity_change < 0 && Math.abs(quantity_change) > currentQty) {
      return jsonError(
        `Insufficient stock. Requested removal: ${Math.abs(quantity_change)}, current quantity: ${currentQty}`,
        400,
      );
    }

    const newQty = currentQty + quantity_change;

    let inventoryId: string;

    if (currentInventory) {
      // Update existing
      const updatePayload: Record<string, unknown> = { quantity: newQty };
      if (low_stock_threshold !== undefined) updatePayload.low_stock_threshold = low_stock_threshold;

      const { error: updateErr } = await adminClient
        .from('inventory')
        .update(updatePayload)
        .eq('id', (currentInventory as Record<string, unknown>).id as string);

      if (updateErr) {
        return jsonError(`Inventory update failed: ${updateErr.message}`, 500);
      }

      inventoryId = (currentInventory as Record<string, unknown>).id as string;
    } else {
      // Create new inventory record
      const { data: newInventory, error: insertError } = await adminClient
        .from('inventory')
        .insert({
          product_id,
          branch_id,
          quantity: newQty,
          low_stock_threshold: low_stock_threshold ?? 10,
        })
        .select('id')
        .single();

      if (insertError) return jsonError(insertError.message, 500);
      inventoryId = (newInventory as { id: string }).id;
    }

    // ─── Record stock adjustment (error-checked with rollback) ──

    const { error: adjError } = await adminClient.from('stock_adjustments').insert({
      inventory_id: inventoryId,
      branch_id,
      user_id: userId,
      adjustment_type,
      quantity_change,
      reason: reason || null,
    });

    if (adjError) {
      // Rollback: restore previous inventory quantity
      console.error('stock_adjustments write failed, rolling back inventory:', adjError.message);
      if (currentInventory) {
        await adminClient.from('inventory')
          .update({ quantity: currentQty } as Record<string, unknown>)
          .eq('id', inventoryId);
      } else {
        await adminClient.from('inventory').delete().eq('id', inventoryId);
      }
      return jsonError(`Stock adjustment log failed: ${adjError.message}. Inventory change rolled back.`, 500);
    }

    // ─── Canonical inventory_logs (error-checked with rollback) ──

    const sourceMap: Record<string, string> = {
      manual_add: 'manual_adjust',
      manual_remove: 'manual_adjust',
      initial: 'manual_adjust',
      bulk_upload: 'manual_adjust',
    };

    const { error: logErr } = await adminClient.from('inventory_logs').insert({
      inventory_id: inventoryId,
      product_id,
      branch_id,
      performed_by: userId,
      source: sourceMap[adjustment_type] || 'manual_adjust',
      quantity_delta: quantity_change,
      quantity_before: currentQty,
      quantity_after: newQty,
      notes: reason || `${adjustment_type.replace('_', ' ')}`,
    } as Record<string, unknown>);

    if (logErr) {
      // Rollback: restore previous inventory quantity and remove stock_adjustment
      console.error('inventory_logs write failed, rolling back:', logErr.message);
      if (currentInventory) {
        await adminClient.from('inventory')
          .update({ quantity: currentQty } as Record<string, unknown>)
          .eq('id', inventoryId);
      } else {
        await adminClient.from('inventory').delete().eq('id', inventoryId);
      }
      // Also clean up the stock_adjustment we just wrote
      await adminClient.from('stock_adjustments').delete()
        .eq('inventory_id', inventoryId)
        .eq('quantity_change', quantity_change)
        .eq('user_id', userId);
      return jsonError(`Inventory log failed: ${logErr.message}. Inventory change rolled back.`, 500);
    }

    // Fetch product name for audit log
    const { data: product } = await adminClient
      .from('products').select('name').eq('id', product_id).single();
    const productName = product ? (product as Record<string, unknown>).name as string : product_id;

    // Audit log (non-critical)
    await adminClient.from('audit_logs').insert({
      user_id: userId,
      branch_id,
      action_type: adjustment_type === 'manual_add' ? 'STOCK_ADD' :
                   adjustment_type === 'manual_remove' ? 'STOCK_REMOVE' :
                   adjustment_type === 'bulk_upload' ? 'BULK_UPLOAD' : 'STOCK_ADD',
      entity_type: 'inventory',
      entity_id: inventoryId,
      description: `${adjustment_type.replace('_', ' ')} for "${productName}": ${quantity_change > 0 ? '+' : ''}${quantity_change} (now: ${newQty})`,
      metadata: { product_id, branch_id, quantity_change, newQty, adjustment_type, reason },
    });

    return NextResponse.json({
      success: true,
      new_quantity: newQty,
      inventory_id: inventoryId,
    });
  } catch (error) {
    console.error('POST /api/inventory/adjust error:', error);
    return jsonError('Internal server error', 500);
  }
}
