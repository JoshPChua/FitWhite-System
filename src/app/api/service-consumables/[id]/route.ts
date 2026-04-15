import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Profile } from '@/types/database';

/**
 * PATCH /api/service-consumables/[id]
 *
 * Updates a BOM entry (quantity or notes).
 * Requires manager or owner role.
 *
 * Body: { quantity?, notes? }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: rawProfile } = await supabase
      .from('profiles').select('*').eq('id', user.id).single();
    const caller = rawProfile as Profile | null;

    if (!caller || !caller.is_active || (caller.role !== 'owner' && caller.role !== 'manager')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const body = await request.json();
    const updates: Record<string, unknown> = {};
    if (body.quantity !== undefined) {
      if (body.quantity < 1) return NextResponse.json({ error: 'quantity must be >= 1' }, { status: 400 });
      updates.quantity = body.quantity;
    }
    if (body.notes !== undefined) updates.notes = body.notes || null;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const adminClient = createAdminClient();

    const { data, error } = await adminClient
      .from('service_consumables')
      .update(updates)
      .eq('id', id)
      .select('id, service_id, product_id, quantity, notes')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'BOM entry not found' }, { status: 404 });
    }

    return NextResponse.json({ data });
  } catch (error) {
    console.error('PATCH /api/service-consumables/[id] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/service-consumables/[id]
 *
 * Removes a product from a service's BOM.
 * Requires manager or owner role.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: rawProfile } = await supabase
      .from('profiles').select('*').eq('id', user.id).single();
    const caller = rawProfile as Profile | null;

    if (!caller || !caller.is_active || (caller.role !== 'owner' && caller.role !== 'manager')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const adminClient = createAdminClient();

    const { error } = await adminClient
      .from('service_consumables')
      .delete()
      .eq('id', id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/service-consumables/[id] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
