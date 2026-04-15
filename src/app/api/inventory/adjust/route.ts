import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Profile } from '@/types/database';

/**
 * POST /api/inventory/adjust — Manual stock adjustment
 * Supports: manual_add, manual_remove, initial, bulk_upload
 * Requires: owner or manager role
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    if (!currentUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: rawCaller } = await supabase
      .from('profiles').select('*').eq('id', currentUser.id).single();
    const caller = rawCaller as Profile | null;

    if (!caller || (caller.role !== 'owner' && caller.role !== 'manager')) {
      return NextResponse.json({ error: 'Forbidden: insufficient permissions' }, { status: 403 });
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

    if (!product_id || !branch_id || quantity_change === undefined || !adjustment_type) {
      return NextResponse.json(
        { error: 'Required fields: product_id, branch_id, quantity_change, adjustment_type' },
        { status: 400 }
      );
    }

    // Manager can only adjust their own branch's inventory
    if (caller.role === 'manager' && branch_id !== caller.branch_id) {
      return NextResponse.json({ error: 'Managers can only adjust inventory in their own branch' }, { status: 403 });
    }

    const adminClient = createAdminClient();

    // Get current inventory record
    const { data: currentInventory } = await adminClient
      .from('inventory')
      .select('*')
      .eq('product_id', product_id)
      .eq('branch_id', branch_id)
      .single();

    const currentQty = currentInventory ? (currentInventory as Record<string, unknown>).quantity as number : 0;

    // ─── [P2 FIX] Never silently clamp — surface the error ──
    // For removals, reject if stock would go negative. This prevents the audit
    // log from recording a quantity_change that wasn't actually honoured.
    const isRemoval = quantity_change < 0;
    if (isRemoval && Math.abs(quantity_change) > currentQty) {
      return NextResponse.json({
        error: `Insufficient stock. Requested removal: ${Math.abs(quantity_change)}, ` +
               `current quantity: ${currentQty}`
      }, { status: 400 });
    }

    const newQty = currentQty + quantity_change; // quantity_change is negative for removals


    let inventoryId: string;

    if (currentInventory) {
      // Update existing
      const updatePayload: Record<string, unknown> = { quantity: newQty };
      if (low_stock_threshold !== undefined) updatePayload.low_stock_threshold = low_stock_threshold;

      await adminClient
        .from('inventory')
        .update(updatePayload)
        .eq('id', (currentInventory as Record<string, unknown>).id as string);

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

      if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
      inventoryId = (newInventory as { id: string }).id;
    }

    // Record stock adjustment (legacy — backward compat)
    const { error: adjError } = await adminClient.from('stock_adjustments').insert({
      inventory_id: inventoryId,
      branch_id,
      user_id: currentUser.id,
      adjustment_type,
      quantity_change,
      reason: reason || null,
    });

    if (adjError) console.error('Stock adjustment log error:', adjError);

    // Dual-write to inventory_logs (new canonical log)
    const sourceMap: Record<string, string> = {
      manual_add: 'manual_adjust',
      manual_remove: 'manual_adjust',
      initial: 'manual_adjust',
      bulk_upload: 'manual_adjust',
    };
    await adminClient.from('inventory_logs').insert({
      inventory_id: inventoryId,
      product_id,
      branch_id,
      performed_by: currentUser.id,
      source: sourceMap[adjustment_type] || 'manual_adjust',
      quantity_delta: quantity_change,
      quantity_before: currentQty,
      quantity_after: newQty,
      notes: reason || `${adjustment_type.replace('_', ' ')}`,
    } as Record<string, unknown>).then(({ error: logErr }) => {
      if (logErr) console.error('inventory_logs write error:', logErr);
    });

    // Fetch product name for audit log
    const { data: product } = await adminClient
      .from('products').select('name').eq('id', product_id).single();
    const productName = product ? (product as Record<string, unknown>).name as string : product_id;

    // Audit log
    await adminClient.from('audit_logs').insert({
      user_id: currentUser.id,
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
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
