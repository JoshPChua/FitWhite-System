import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  requireActiveProfile, enforceImusOnly, isErrorResponse, jsonError,
} from '@/lib/api-helpers';
import { IMUS_ONLY } from '@/lib/feature-flags';
import type { Profile } from '@/types/database';

/**
 * PATCH /api/customers/[id] — Update customer profile
 * Requires: owner or manager role
 * Managers can only update customers in their own branch.
 * No branch reassignment in IMUS_ONLY mode.
 *
 * Hardened: Imus-only guard — owners cannot access non-Imus customers via direct URL.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: customerId } = await params;
    const supabase = await createClient();
    const auth = await requireActiveProfile(supabase);
    if (isErrorResponse(auth)) return auth;
    const { userId, profile: caller } = auth;

    if (caller.role !== 'owner' && caller.role !== 'manager') {
      return jsonError('Forbidden: owner or manager required', 403);
    }

    const adminClient = createAdminClient();

    // Fetch existing customer to check branch ownership
    const { data: rawCustomer } = await adminClient
      .from('customers').select('*').eq('id', customerId).single();

    if (!rawCustomer) {
      return jsonError('Customer not found', 404);
    }

    const existingCustomer = rawCustomer as Record<string, unknown>;

    // Imus-only guard: cannot access customers outside Imus branch
    const imusGuard = await enforceImusOnly(adminClient, existingCustomer.branch_id as string);
    if (imusGuard) return imusGuard;

    // Manager can only modify customers in their own branch
    if (caller.role === 'manager' && existingCustomer.branch_id !== caller.branch_id) {
      return jsonError('Cannot modify customers outside your branch', 403);
    }

    const body = await request.json();
    const updateData: Record<string, unknown> = {};

    if (body.first_name !== undefined) updateData.first_name = body.first_name.trim();
    if (body.last_name !== undefined) updateData.last_name = body.last_name.trim();
    if (body.email !== undefined) updateData.email = body.email?.trim() || null;
    if (body.phone !== undefined) updateData.phone = body.phone?.trim() || null;
    if (body.allergies !== undefined) updateData.allergies = body.allergies?.trim() || null;
    if (body.notes !== undefined) updateData.notes = body.notes?.trim() || null;
    if (body.source !== undefined) updateData.source = body.source;
    if (body.referred_by !== undefined) updateData.referred_by = body.referred_by || null;

    // Prevent branch reassignment in IMUS_ONLY
    if (body.branch_id !== undefined && !IMUS_ONLY) {
      // In multi-branch, owner can reassign; manager cannot
      if (caller.role === 'manager' && body.branch_id !== caller.branch_id) {
        return jsonError('Managers cannot transfer customers to other branches', 403);
      }
      updateData.branch_id = body.branch_id;
    }

    if (Object.keys(updateData).length === 0) {
      return jsonError('No fields to update', 400);
    }

    const { data: updated, error: updateError } = await adminClient
      .from('customers')
      .update(updateData)
      .eq('id', customerId)
      .select('id, first_name, last_name')
      .single();

    // Fallback: if source/referred_by columns don't exist yet (migration 010 not applied)
    if (updateError && updateError.message?.includes('column')) {
      const { source: _s, referred_by: _r, ...fallbackData } = updateData;
      if (Object.keys(fallbackData).length === 0) {
        return jsonError('No fields to update (source/referred_by not yet available)', 400);
      }
      const result2 = await adminClient
        .from('customers')
        .update(fallbackData)
        .eq('id', customerId)
        .select('id, first_name, last_name')
        .single();
      if (result2.error) {
        return jsonError(result2.error.message, 500);
      }
      // Continue with result2 data
      const updated2 = result2.data;
      await adminClient.from('audit_logs').insert({
        user_id: userId,
        branch_id: existingCustomer.branch_id as string,
        action_type: 'UPDATE_CUSTOMER',
        entity_type: 'customer',
        entity_id: customerId,
        description: `Updated patient ${(updated2 as Record<string, unknown>).first_name} ${(updated2 as Record<string, unknown>).last_name}`,
        metadata: { changes: fallbackData },
      } as Record<string, unknown>);
      return NextResponse.json({ success: true, customer: updated2 });
    }

    if (updateError) {
      return jsonError(updateError.message, 500);
    }

    // Audit log
    await adminClient.from('audit_logs').insert({
      user_id: userId,
      branch_id: existingCustomer.branch_id as string,
      action_type: 'UPDATE_CUSTOMER',
      entity_type: 'customer',
      entity_id: customerId,
      description: `Updated patient ${(updated as Record<string, unknown>).first_name} ${(updated as Record<string, unknown>).last_name}`,
      metadata: { changes: updateData },
    } as Record<string, unknown>);

    return NextResponse.json({ success: true, customer: updated });
  } catch (error) {
    console.error('PATCH /api/customers/[id] error:', error);
    return jsonError('Internal server error', 500);
  }
}

/**
 * DELETE /api/customers/[id] — Delete a customer
 * Requires: owner role only
 *
 * Hardened: Imus-only guard.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: customerId } = await params;
    const supabase = await createClient();
    const auth = await requireActiveProfile(supabase);
    if (isErrorResponse(auth)) return auth;
    const { userId, profile: caller } = auth;

    if (caller.role !== 'owner') {
      return jsonError('Only owners can delete customers', 403);
    }

    const adminClient = createAdminClient();

    // Get customer for audit log and branch check
    const { data: rawCustomer } = await adminClient
      .from('customers').select('*').eq('id', customerId).single();

    if (!rawCustomer) {
      return jsonError('Customer not found', 404);
    }

    const customer = rawCustomer as Record<string, unknown>;

    // Imus-only guard
    const imusGuard = await enforceImusOnly(adminClient, customer.branch_id as string);
    if (imusGuard) return imusGuard;

    const { error: deleteError } = await adminClient
      .from('customers').delete().eq('id', customerId);

    if (deleteError) {
      return jsonError(deleteError.message, 500);
    }

    // Audit log
    await adminClient.from('audit_logs').insert({
      user_id: userId,
      branch_id: customer.branch_id as string,
      action_type: 'DELETE_CUSTOMER',
      entity_type: 'customer',
      entity_id: customerId,
      description: `Deleted patient ${customer.first_name} ${customer.last_name}`,
      metadata: { deleted_customer: customer },
    } as Record<string, unknown>);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/customers/[id] error:', error);
    return jsonError('Internal server error', 500);
  }
}
