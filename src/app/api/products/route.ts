import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  requireActiveProfile, enforceImusOnly, assertBranchAccess,
  isErrorResponse, jsonError,
} from '@/lib/api-helpers';

/**
 * POST /api/products — Create a new product
 * Requires: owner or manager role
 *
 * Hardened:
 *   - price validated as finite >= 0
 *   - name/sku trimmed
 *   - Inventory insert error-checked with product rollback
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
    const { branch_id, name, description, sku, price, category, unit } = body;

    if (!branch_id || !name?.trim()) {
      return jsonError('Required fields: branch_id, name', 400);
    }

    if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) {
      return jsonError('price must be a finite number >= 0', 400);
    }

    const trimmedName = name.trim();
    const trimmedSku = sku?.trim() || null;

    // Branch isolation
    const branchErr = assertBranchAccess(caller, branch_id, 'create products');
    if (branchErr) return branchErr;

    const adminClient = createAdminClient();

    // Imus-only guard
    const imusGuard = await enforceImusOnly(adminClient, branch_id);
    if (imusGuard) return imusGuard;

    // Check for duplicate SKU in same branch
    if (trimmedSku) {
      const { data: skuCheck } = await adminClient
        .from('products')
        .select('id')
        .eq('branch_id', branch_id)
        .eq('sku', trimmedSku)
        .single();
      if (skuCheck) {
        return jsonError(`SKU "${trimmedSku}" already exists in this branch`, 409);
      }
    }

    const { data: product, error } = await adminClient
      .from('products')
      .insert({
        branch_id,
        name: trimmedName,
        description: description?.trim() || null,
        sku: trimmedSku,
        price,
        category: category?.trim() || null,
        unit: unit?.trim() || 'pcs',
      })
      .select('*')
      .single();

    if (error) return jsonError(error.message, 500);

    const productId = (product as { id: string }).id;

    // Auto-create inventory record — error-checked with product rollback
    const { error: invError } = await adminClient.from('inventory').insert({
      product_id: productId,
      branch_id,
      quantity: 0,
      low_stock_threshold: 10,
    });

    if (invError) {
      console.error('Inventory auto-create failed, rolling back product:', invError.message);
      // Rollback: delete the orphaned product
      await adminClient.from('products').delete().eq('id', productId);
      return jsonError(
        `Product inventory setup failed: ${invError.message}. Product was not created.`,
        500,
      );
    }

    await adminClient.from('audit_logs').insert({
      user_id: userId,
      branch_id,
      action_type: 'CREATE_PRODUCT',
      entity_type: 'product',
      entity_id: productId,
      description: `Created product "${trimmedName}"${trimmedSku ? ` (SKU: ${trimmedSku})` : ''}`,
      metadata: { name: trimmedName, sku: trimmedSku, price, category, unit },
    });

    return NextResponse.json({ success: true, product });
  } catch (error) {
    console.error('POST /api/products error:', error);
    return jsonError('Internal server error', 500);
  }
}
