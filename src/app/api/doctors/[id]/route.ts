import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Profile } from '@/types/database';

/**
 * PATCH /api/doctors/[id]
 * Update a doctor record.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: doctorId } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: rawProfile } = await supabase
      .from('profiles').select('*').eq('id', user.id).single();
    const caller = rawProfile as Profile | null;
    if (!caller || !caller.is_active || (caller.role !== 'owner' && caller.role !== 'manager')) {
      return NextResponse.json({ error: 'Manager or owner required' }, { status: 403 });
    }

    const body = await request.json();
    const updateData: Record<string, unknown> = {};

    if (body.full_name !== undefined) updateData.full_name = body.full_name.trim();
    if (body.specialty !== undefined) updateData.specialty = body.specialty?.trim() || null;
    if (body.is_active !== undefined) updateData.is_active = !!body.is_active;
    if (body.notes !== undefined) updateData.notes = body.notes?.trim() || null;
    if (body.default_commission_type !== undefined) updateData.default_commission_type = body.default_commission_type;
    if (body.default_commission_value !== undefined) {
      let val = Number(body.default_commission_value) || 0;
      if (body.default_commission_type === 'percent' && val > 1) val = val / 100;
      updateData.default_commission_value = val;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const adminClient = createAdminClient();

    // Branch check for managers
    if (caller.role === 'manager') {
      const { data: existing } = await adminClient
        .from('doctors').select('branch_id').eq('id', doctorId).single();
      if (!existing || (existing as Record<string, unknown>).branch_id !== caller.branch_id) {
        return NextResponse.json({ error: 'Cannot modify doctors outside your branch' }, { status: 403 });
      }
    }

    const { data, error } = await adminClient
      .from('doctors')
      .update(updateData)
      .eq('id', doctorId)
      .select('*')
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'Doctor not found' }, { status: 404 });

    // Audit
    await adminClient.from('audit_logs').insert({
      user_id: user.id,
      branch_id: (data as Record<string, unknown>).branch_id as string,
      action_type: 'UPDATE_DOCTOR',
      entity_type: 'doctor',
      entity_id: doctorId,
      description: `Updated doctor: ${(data as Record<string, unknown>).full_name}`,
      metadata: { changes: updateData },
    } as Record<string, unknown>);

    return NextResponse.json({ data });
  } catch (error) {
    console.error('PATCH /api/doctors/[id] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/doctors/[id]
 * Soft-delete (deactivate) a doctor. Owner only.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: doctorId } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: rawProfile } = await supabase
      .from('profiles').select('*').eq('id', user.id).single();
    const caller = rawProfile as Profile | null;
    if (!caller || caller.role !== 'owner') {
      return NextResponse.json({ error: 'Owner only' }, { status: 403 });
    }

    const adminClient = createAdminClient();
    const { data, error } = await adminClient
      .from('doctors')
      .update({ is_active: false } as Record<string, unknown>)
      .eq('id', doctorId)
      .select('*')
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await adminClient.from('audit_logs').insert({
      user_id: user.id,
      branch_id: (data as Record<string, unknown>).branch_id as string,
      action_type: 'DEACTIVATE_DOCTOR',
      entity_type: 'doctor',
      entity_id: doctorId,
      description: `Deactivated doctor: ${(data as Record<string, unknown>).full_name}`,
    } as Record<string, unknown>);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/doctors/[id] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
