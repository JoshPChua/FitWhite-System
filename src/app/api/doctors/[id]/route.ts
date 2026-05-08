import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  requireActiveProfile, enforceImusOnly, isErrorResponse, jsonError,
} from '@/lib/api-helpers';
import { IMUS_ONLY, IMUS_BRANCH_CODE } from '@/lib/feature-flags';

/**
 * PATCH /api/doctors/[id]
 * Update a doctor record.
 *
 * Hardened: Imus-only guard on the doctor's branch.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: doctorId } = await params;
    const supabase = await createClient();
    const auth = await requireActiveProfile(supabase);
    if (isErrorResponse(auth)) return auth;
    const { userId, profile: caller } = auth;

    if (caller.role !== 'owner' && caller.role !== 'manager') {
      return jsonError('Manager or owner required', 403);
    }

    const adminClient = createAdminClient();

    // Fetch existing doctor
    const { data: existing } = await adminClient
      .from('doctors').select('*').eq('id', doctorId).single();

    if (!existing) return jsonError('Doctor not found', 404);

    const doc = existing as Record<string, unknown>;

    // Imus-only: reject if doctor belongs to non-Imus branch
    const imusGuard = await enforceImusOnly(adminClient, doc.branch_id as string);
    if (imusGuard) return imusGuard;

    // Branch check for managers
    if (caller.role === 'manager' && doc.branch_id !== caller.branch_id) {
      return jsonError('Cannot modify doctors outside your branch', 403);
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
      return jsonError('No fields to update', 400);
    }

    const { data, error } = await adminClient
      .from('doctors')
      .update(updateData)
      .eq('id', doctorId)
      .select('*')
      .single();

    if (error) return jsonError(error.message, 500);
    if (!data) return jsonError('Doctor not found', 404);

    // Audit
    await adminClient.from('audit_logs').insert({
      user_id: userId,
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
    return jsonError('Internal server error', 500);
  }
}

/**
 * DELETE /api/doctors/[id]
 * Soft-delete (deactivate) a doctor. Owner only.
 *
 * Hardened: Imus-only guard.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: doctorId } = await params;
    const supabase = await createClient();
    const auth = await requireActiveProfile(supabase);
    if (isErrorResponse(auth)) return auth;
    const { userId, profile: caller } = auth;

    if (caller.role !== 'owner') {
      return jsonError('Owner only', 403);
    }

    const adminClient = createAdminClient();

    // Fetch doctor to check branch
    const { data: existing } = await adminClient
      .from('doctors').select('*').eq('id', doctorId).single();

    if (!existing) return jsonError('Doctor not found', 404);

    const doc = existing as Record<string, unknown>;

    // Imus-only guard
    const imusGuard = await enforceImusOnly(adminClient, doc.branch_id as string);
    if (imusGuard) return imusGuard;

    const { data, error } = await adminClient
      .from('doctors')
      .update({ is_active: false } as Record<string, unknown>)
      .eq('id', doctorId)
      .select('*')
      .single();

    if (error) return jsonError(error.message, 500);

    await adminClient.from('audit_logs').insert({
      user_id: userId,
      branch_id: (data as Record<string, unknown>).branch_id as string,
      action_type: 'DEACTIVATE_DOCTOR',
      entity_type: 'doctor',
      entity_id: doctorId,
      description: `Deactivated doctor: ${(data as Record<string, unknown>).full_name}`,
    } as Record<string, unknown>);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/doctors/[id] error:', error);
    return jsonError('Internal server error', 500);
  }
}
