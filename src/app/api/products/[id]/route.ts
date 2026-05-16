import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  requireActiveProfile, enforceImusOnly, isErrorResponse, jsonError,
} from '@/lib/api-helpers';

/**
 * PATCH /api/products/[id] — Update a product
 * Requires: owner or manager (in their branch)
 *
 * Hardened:
 *   - price validated as finite >= 0
 *   - name/sku trimmed
 *   - Imus-only branch guard
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: productId } = await params;
    const supabase = await createClient();
    const auth = await requireActiveProfile(supabase);
    if (isErrorResponse(auth)) return auth;
    const { userId, profile: caller } = auth;

    if (caller.role !== 'owner' && caller.role !== 'manager') {
      return jsonError('Forbidden', 403);
    }

    const adminClient = createAdminClient();

    const { data: existingProduct } = await adminClient
      .from('products').select('*').eq('id', productId).single();

    if (!existingProduct) {
      return jsonError('Product not found', 404);
    }

    const existing = existingProduct as Record<string, unknown>;

    // Imus-only guard on the product's branch
    const imusGuard = await enforceImusOnly(adminClient, existing.branch_id as string);
    if (imusGuard) return imusGuard;

    if (caller.role === 'manager' && existing.branch_id !== caller.branch_id) {
      return jsonError('Cannot modify products outside your branch', 403);
    }

    const body = await request.json();
    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = String(body.name).trim();
    if (body.description !== undefined) updateData.description = body.description?.trim() || null;
    if (body.sku !== undefined) updateData.sku = body.sku?.trim() || null;
    if (body.category !== undefined) updateData.category = body.category?.trim() || null;
    if (body.unit !== undefined) updateData.unit = body.unit?.trim() || null;
    if (body.is_active !== undefined) updateData.is_active = !!body.is_active;

    // Strict price validation
    if (body.price !== undefined) {
      const p = Number(body.price);
      if (!Number.isFinite(p) || p < 0) {
        return jsonError('price must be a finite number >= 0', 400);
      }
      updateData.price = p;
    }

    if (Object.keys(updateData).length === 0) {
      return jsonError('No fields to update', 400);
    }

    // Check for duplicate SKU if updating SKU
    if (updateData.sku && updateData.sku !== existing.sku) {
      const { data: skuCheck } = await adminClient
        .from('products')
        .select('id')
        .eq('branch_id', existing.branch_id as string)
        .eq('sku', updateData.sku as string)
        .neq('id', productId)
        .single();
      if (skuCheck) {
        return jsonError(`SKU "${updateData.sku}" already exists in this branch`, 409);
      }
    }

    const { data: updated, error } = await adminClient
      .from('products').update(updateData).eq('id', productId).select('*').single();

    if (error) return jsonError(error.message, 500);

    await adminClient.from('audit_logs').insert({
      user_id: userId,
      branch_id: existing.branch_id as string,
      action_type: 'UPDATE_PRODUCT',
      entity_type: 'product',
      entity_id: productId,
      description: `Updated product "${existing.name}"`,
      metadata: { changes: updateData },
    });

    return NextResponse.json({ success: true, product: updated });
  } catch (error) {
    console.error('PATCH /api/products/[id] error:', error);
    return jsonError('Internal server error', 500);
  }
}

/**
 * DELETE /api/products/[id] — Soft or hard delete a product
 * Soft delete if product has been sold; hard delete if never used
 * Requires: owner or manager (in their branch)
 *
 * Hardened:
 *   - Imus-only branch guard
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: productId } = await params;
    const supabase = await createClient();
    const auth = await requireActiveProfile(supabase);
    if (isErrorResponse(auth)) return auth;
    const { userId, profile: caller } = auth;

    if (caller.role !== 'owner' && caller.role !== 'manager') {
      return jsonError('Forbidden', 403);
    }

    const adminClient = createAdminClient();

    const { data: existingProduct } = await adminClient
      .from('products').select('*').eq('id', productId).single();

    if (!existingProduct) {
      return jsonError('Product not found', 404);
    }

    const existing = existingProduct as Record<string, unknown>;

    // Imus-only guard
    const imusGuard = await enforceImusOnly(adminClient, existing.branch_id as string);
    if (imusGuard) return imusGuard;

    if (caller.role === 'manager' && existing.branch_id !== caller.branch_id) {
      return jsonError('Cannot delete products outside your branch', 403);
    }

    const { count: usageCount } = await adminClient
      .from('sale_items')
      .select('id', { count: 'exact', head: true })
      .eq('product_id', productId);

    if ((usageCount || 0) > 0) {
      const { error: softDeleteErr } = await adminClient.from('products').update({ is_active: false }).eq('id', productId);
      if (softDeleteErr) return jsonError(`Soft delete failed: ${softDeleteErr.message}`, 500);
    } else {
      const { error } = await adminClient.from('products').delete().eq('id', productId);
      if (error) return jsonError(error.message, 500);
    }

    await adminClient.from('audit_logs').insert({
      user_id: userId,
      branch_id: existing.branch_id as string,
      action_type: 'DELETE_PRODUCT',
      entity_type: 'product',
      entity_id: productId,
      description: `Deleted product "${existing.name}"${(usageCount || 0) > 0 ? ' (soft delete — has sale history)' : ''}`,
      metadata: { product: existingProduct, soft_delete: (usageCount || 0) > 0 },
    });

    return NextResponse.json({ success: true, soft_deleted: (usageCount || 0) > 0 });
  } catch (error) {
    console.error('DELETE /api/products/[id] error:', error);
    return jsonError('Internal server error', 500);
  }
}
