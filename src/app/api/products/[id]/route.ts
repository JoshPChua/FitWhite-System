import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Profile } from '@/types/database';

/**
 * PATCH /api/products/[id] — Update a product
 * Requires: owner or manager (in their branch)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: productId } = await params;
    const supabase = await createClient();
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    if (!currentUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: rawCaller } = await supabase
      .from('profiles').select('*').eq('id', currentUser.id).single();
    const caller = rawCaller as Profile | null;

    if (!caller || (caller.role !== 'owner' && caller.role !== 'manager')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { data: existingProduct } = await supabase
      .from('products').select('*').eq('id', productId).single();

    if (!existingProduct) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    if (caller.role === 'manager' && (existingProduct as Record<string, unknown>).branch_id !== caller.branch_id) {
      return NextResponse.json({ error: 'Cannot modify products outside your branch' }, { status: 403 });
    }

    const body = await request.json();
    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.sku !== undefined) updateData.sku = body.sku;
    if (body.price !== undefined) updateData.price = body.price;
    if (body.category !== undefined) updateData.category = body.category;
    if (body.unit !== undefined) updateData.unit = body.unit;
    if (body.is_active !== undefined) updateData.is_active = body.is_active;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const adminClient = createAdminClient();

    // Check for duplicate SKU if updating SKU
    if (body.sku && body.sku !== (existingProduct as Record<string, unknown>).sku) {
      const { data: skuCheck } = await adminClient
        .from('products')
        .select('id')
        .eq('branch_id', (existingProduct as Record<string, unknown>).branch_id as string)
        .eq('sku', body.sku)
        .neq('id', productId)
        .single();
      if (skuCheck) {
        return NextResponse.json({ error: `SKU "${body.sku}" already exists in this branch` }, { status: 409 });
      }
    }

    const { data: updated, error } = await adminClient
      .from('products').update(updateData).eq('id', productId).select('*').single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await adminClient.from('audit_logs').insert({
      user_id: currentUser.id,
      branch_id: (existingProduct as Record<string, unknown>).branch_id as string,
      action_type: 'UPDATE_PRODUCT',
      entity_type: 'product',
      entity_id: productId,
      description: `Updated product "${(existingProduct as Record<string, unknown>).name}"`,
      metadata: { changes: updateData },
    });

    return NextResponse.json({ success: true, product: updated });
  } catch (error) {
    console.error('PATCH /api/products/[id] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/products/[id] — Soft or hard delete a product
 * Soft delete if product has been sold; hard delete if never used
 * Requires: owner or manager (in their branch)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: productId } = await params;
    const supabase = await createClient();
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    if (!currentUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: rawCaller } = await supabase
      .from('profiles').select('*').eq('id', currentUser.id).single();
    const caller = rawCaller as Profile | null;

    if (!caller || (caller.role !== 'owner' && caller.role !== 'manager')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { data: existingProduct } = await supabase
      .from('products').select('*').eq('id', productId).single();

    if (!existingProduct) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    if (caller.role === 'manager' && (existingProduct as Record<string, unknown>).branch_id !== caller.branch_id) {
      return NextResponse.json({ error: 'Cannot delete products outside your branch' }, { status: 403 });
    }

    const adminClient = createAdminClient();

    const { count: usageCount } = await adminClient
      .from('sale_items')
      .select('id', { count: 'exact', head: true })
      .eq('product_id', productId);

    if ((usageCount || 0) > 0) {
      await adminClient.from('products').update({ is_active: false }).eq('id', productId);
    } else {
      const { error } = await adminClient.from('products').delete().eq('id', productId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await adminClient.from('audit_logs').insert({
      user_id: currentUser.id,
      branch_id: (existingProduct as Record<string, unknown>).branch_id as string,
      action_type: 'DELETE_PRODUCT',
      entity_type: 'product',
      entity_id: productId,
      description: `Deleted product "${(existingProduct as Record<string, unknown>).name}"${(usageCount || 0) > 0 ? ' (soft delete — has sale history)' : ''}`,
      metadata: { product: existingProduct, soft_delete: (usageCount || 0) > 0 },
    });

    return NextResponse.json({ success: true, soft_deleted: (usageCount || 0) > 0 });
  } catch (error) {
    console.error('DELETE /api/products/[id] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
