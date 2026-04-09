import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Profile } from '@/types/database';

/**
 * POST /api/products — Create a new product
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
    const { branch_id, name, description, sku, price, category, unit } = body;

    if (!branch_id || !name || price === undefined) {
      return NextResponse.json(
        { error: 'Required fields: branch_id, name, price' },
        { status: 400 }
      );
    }

    if (caller.role === 'manager' && branch_id !== caller.branch_id) {
      return NextResponse.json({ error: 'Managers can only create products in their own branch' }, { status: 403 });
    }

    const adminClient = createAdminClient();

    // Check for duplicate SKU in same branch
    if (sku) {
      const { data: skuCheck } = await adminClient
        .from('products')
        .select('id')
        .eq('branch_id', branch_id)
        .eq('sku', sku)
        .single();
      if (skuCheck) {
        return NextResponse.json({ error: `SKU "${sku}" already exists in this branch` }, { status: 409 });
      }
    }

    const { data: product, error } = await adminClient
      .from('products')
      .insert({
        branch_id,
        name,
        description: description || null,
        sku: sku || null,
        price,
        category: category || null,
        unit: unit || 'pcs',
      })
      .select('*')
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Auto-create inventory record for this branch with 0 quantity
    await adminClient.from('inventory').insert({
      product_id: (product as { id: string }).id,
      branch_id,
      quantity: 0,
      low_stock_threshold: 10,
    });

    await adminClient.from('audit_logs').insert({
      user_id: currentUser.id,
      branch_id,
      action_type: 'CREATE_PRODUCT',
      entity_type: 'product',
      entity_id: (product as { id: string }).id,
      description: `Created product "${name}"${sku ? ` (SKU: ${sku})` : ''}`,
      metadata: { name, sku, price, category, unit },
    });

    return NextResponse.json({ success: true, product });
  } catch (error) {
    console.error('POST /api/products error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
