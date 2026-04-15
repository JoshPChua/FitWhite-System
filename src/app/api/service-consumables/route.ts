import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertImusOnlyBranch, IMUS_ONLY, IMUS_BRANCH_CODE } from '@/lib/feature-flags';
import type { Profile } from '@/types/database';

/**
 * GET /api/service-consumables?service_id=UUID
 *
 * Lists all BOM entries for a given service.
 * Accessible to all authenticated users in the same branch.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const serviceId = request.nextUrl.searchParams.get('service_id');
    if (!serviceId) {
      return NextResponse.json({ error: 'service_id query parameter is required' }, { status: 400 });
    }

    const adminClient = createAdminClient();

    const { data, error } = await adminClient
      .from('service_consumables')
      .select(`
        id,
        service_id,
        product_id,
        quantity,
        notes,
        created_at,
        updated_at,
        products:product_id (id, name, price, unit, sku)
      `)
      .eq('service_id', serviceId)
      .order('created_at', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data: data || [] });
  } catch (error) {
    console.error('GET /api/service-consumables error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/service-consumables
 *
 * Creates a new BOM entry linking a product to a service.
 * Requires manager or owner role.
 *
 * Body: { service_id, product_id, quantity, notes? }
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: rawProfile } = await supabase
      .from('profiles').select('*').eq('id', user.id).single();
    const caller = rawProfile as Profile | null;

    if (!caller || !caller.is_active) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (caller.role !== 'owner' && caller.role !== 'manager') {
      return NextResponse.json({ error: 'Insufficient permissions: manager or owner required' }, { status: 403 });
    }

    const body = await request.json();
    const { service_id, product_id, quantity = 1, notes = null } = body as {
      service_id: string;
      product_id: string;
      quantity?: number;
      notes?: string | null;
    };

    if (!service_id || !product_id) {
      return NextResponse.json({ error: 'service_id and product_id are required' }, { status: 400 });
    }
    if (quantity < 1) {
      return NextResponse.json({ error: 'quantity must be >= 1' }, { status: 400 });
    }

    const adminClient = createAdminClient();

    // Verify service exists and belongs to caller's branch (or caller is owner)
    const { data: service } = await adminClient
      .from('services')
      .select('id, branch_id')
      .eq('id', service_id)
      .single();

    if (!service) {
      return NextResponse.json({ error: 'Service not found' }, { status: 404 });
    }

    const svcBranchId = (service as Record<string, unknown>).branch_id as string;

    // Imus-only enforcement
    if (IMUS_ONLY) {
      const { data: imusBranch } = await adminClient
        .from('branches').select('id').eq('code', IMUS_BRANCH_CODE).single();
      const imusBranchId = imusBranch ? (imusBranch as Record<string, unknown>).id as string : null;
      assertImusOnlyBranch(svcBranchId, imusBranchId);
    }

    // Branch isolation for non-owners
    if (caller.role !== 'owner' && caller.branch_id !== svcBranchId) {
      return NextResponse.json({ error: 'Cannot modify BOM for a service in another branch' }, { status: 403 });
    }

    // Verify product exists
    const { data: product } = await adminClient
      .from('products')
      .select('id, name')
      .eq('id', product_id)
      .single();

    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    // Insert BOM entry
    const { data: consumable, error: insertError } = await adminClient
      .from('service_consumables')
      .insert({
        service_id,
        product_id,
        quantity,
        notes: notes || null,
      } as Record<string, unknown>)
      .select('id, service_id, product_id, quantity, notes')
      .single();

    if (insertError) {
      // Handle unique constraint violation (duplicate product in BOM)
      if (insertError.code === '23505') {
        return NextResponse.json({
          error: 'This product is already linked to this service. Update the existing entry instead.'
        }, { status: 409 });
      }
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    // Audit log
    await adminClient.from('audit_logs').insert({
      user_id: user.id,
      branch_id: svcBranchId,
      action_type: 'BOM_ENTRY_ADDED',
      entity_type: 'service_consumable',
      entity_id: (consumable as Record<string, unknown>).id as string,
      description: `Added "${(product as Record<string, unknown>).name}" ×${quantity} to service BOM`,
      metadata: { service_id, product_id, quantity },
    } as Record<string, unknown>);

    return NextResponse.json({ data: consumable }, { status: 201 });
  } catch (error: unknown) {
    if ((error as { name?: string }).name === 'ImusOnlyError') {
      return NextResponse.json({ error: (error as Error).message }, { status: 403 });
    }
    console.error('POST /api/service-consumables error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
