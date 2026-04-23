import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { IMUS_ONLY } from '@/lib/feature-flags';
import type { Profile } from '@/types/database';

/**
 * PATCH /api/customers/[id] — Update customer profile
 * Requires: owner or manager role
 * Managers can only update customers in their own branch.
 * No branch reassignment in IMUS_ONLY mode.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: customerId } = await params;
    const supabase = await createClient();
    const { data: { user: currentUser } } = await supabase.auth.getUser();

    if (!currentUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: rawCaller } = await supabase
      .from('profiles').select('*').eq('id', currentUser.id).single();
    const callerProfile = rawCaller as Profile | null;

    if (!callerProfile || (callerProfile.role !== 'owner' && callerProfile.role !== 'manager')) {
      return NextResponse.json({ error: 'Forbidden: owner or manager required' }, { status: 403 });
    }

    const adminClient = createAdminClient();

    // Fetch existing customer to check branch ownership
    const { data: rawCustomer } = await adminClient
      .from('customers').select('*').eq('id', customerId).single();

    if (!rawCustomer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }

    const existingCustomer = rawCustomer as Record<string, unknown>;

    // Manager can only modify customers in their own branch
    if (callerProfile.role === 'manager' && existingCustomer.branch_id !== callerProfile.branch_id) {
      return NextResponse.json(
        { error: 'Cannot modify customers outside your branch' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const updateData: Record<string, unknown> = {};

    if (body.first_name !== undefined) updateData.first_name = body.first_name.trim();
    if (body.last_name !== undefined) updateData.last_name = body.last_name.trim();
    if (body.email !== undefined) updateData.email = body.email?.trim() || null;
    if (body.phone !== undefined) updateData.phone = body.phone?.trim() || null;
    if (body.allergies !== undefined) updateData.allergies = body.allergies?.trim() || null;
    if (body.notes !== undefined) updateData.notes = body.notes?.trim() || null;

    // Prevent branch reassignment in IMUS_ONLY
    if (body.branch_id !== undefined && !IMUS_ONLY) {
      // In multi-branch, owner can reassign; manager cannot
      if (callerProfile.role === 'manager' && body.branch_id !== callerProfile.branch_id) {
        return NextResponse.json(
          { error: 'Managers cannot transfer customers to other branches' },
          { status: 403 }
        );
      }
      updateData.branch_id = body.branch_id;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const { data: updated, error: updateError } = await adminClient
      .from('customers')
      .update(updateData)
      .eq('id', customerId)
      .select('id, first_name, last_name')
      .single();

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    // Audit log
    await adminClient.from('audit_logs').insert({
      user_id: currentUser.id,
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
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/customers/[id] — Delete a customer
 * Requires: owner role only
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: customerId } = await params;
    const supabase = await createClient();
    const { data: { user: currentUser } } = await supabase.auth.getUser();

    if (!currentUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: rawCaller } = await supabase
      .from('profiles').select('*').eq('id', currentUser.id).single();
    const callerProfile = rawCaller as Profile | null;

    if (!callerProfile || callerProfile.role !== 'owner') {
      return NextResponse.json({ error: 'Only owners can delete customers' }, { status: 403 });
    }

    const adminClient = createAdminClient();

    // Get customer for audit log
    const { data: rawCustomer } = await adminClient
      .from('customers').select('*').eq('id', customerId).single();

    if (!rawCustomer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }

    const customer = rawCustomer as Record<string, unknown>;

    const { error: deleteError } = await adminClient
      .from('customers').delete().eq('id', customerId);

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    // Audit log
    await adminClient.from('audit_logs').insert({
      user_id: currentUser.id,
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
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
