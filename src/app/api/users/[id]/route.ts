import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Profile } from '@/types/database';

/**
 * PATCH /api/users/[id] — Update a user's profile
 * Requires: owner or manager role
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: userId } = await params;
    const supabase = await createClient();
    const { data: { user: currentUser } } = await supabase.auth.getUser();

    if (!currentUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: rawCaller } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', currentUser.id)
      .single();

    const callerProfile = rawCaller as Profile | null;

    if (!callerProfile || (callerProfile.role !== 'owner' && callerProfile.role !== 'manager')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { first_name, last_name, role, branch_id, is_active } = body;

    // Managers can only update staff in their branch
    if (callerProfile.role === 'manager') {
      const { data: rawTarget } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      const targetProfile = rawTarget as Profile | null;

      if (!targetProfile || targetProfile.branch_id !== callerProfile.branch_id) {
        return NextResponse.json({ error: 'Cannot modify users outside your branch' }, { status: 403 });
      }

      if (role && role !== 'cashier') {
        return NextResponse.json({ error: 'Managers can only assign cashier role' }, { status: 403 });
      }

      if (branch_id && branch_id !== callerProfile.branch_id) {
        return NextResponse.json({ error: 'Managers cannot transfer staff to other branches' }, { status: 403 });
      }
    }

    // Prevent self-demotion for owner
    if (currentUser.id === userId && callerProfile.role === 'owner' && role && role !== 'owner') {
      return NextResponse.json({ error: 'Cannot demote yourself from owner role' }, { status: 400 });
    }

    const updateData: Record<string, unknown> = {};
    if (first_name !== undefined) updateData.first_name = first_name;
    if (last_name !== undefined) updateData.last_name = last_name;
    if (role !== undefined) updateData.role = role;
    if (branch_id !== undefined) updateData.branch_id = branch_id;
    if (is_active !== undefined) updateData.is_active = is_active;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const adminClient = createAdminClient();

    const { data: rawUpdated, error: updateError } = await adminClient
      .from('profiles')
      .update(updateData)
      .eq('id', userId)
      .select('*')
      .single();

    if (updateError) {
      console.error('Profile update error:', updateError);
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    const updatedProfile = rawUpdated as Profile | null;

    // Log the action
    await adminClient.from('audit_logs').insert({
      user_id: currentUser.id,
      branch_id: updatedProfile?.branch_id || null,
      action_type: 'UPDATE_USER',
      entity_type: 'user',
      entity_id: userId,
      description: `Updated user ${updatedProfile?.first_name || ''} ${updatedProfile?.last_name || ''}`,
      metadata: { changes: updateData },
    });

    return NextResponse.json({ success: true, user: updatedProfile });
  } catch (error) {
    console.error('User update error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/users/[id] — Delete a user (deactivate auth + profile)
 * Requires: owner role only
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: userId } = await params;
    const supabase = await createClient();
    const { data: { user: currentUser } } = await supabase.auth.getUser();

    if (!currentUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: rawCaller } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', currentUser.id)
      .single();

    const callerProfile = rawCaller as Profile | null;

    if (!callerProfile || callerProfile.role !== 'owner') {
      return NextResponse.json({ error: 'Only owners can delete users' }, { status: 403 });
    }

    // Prevent self-deletion
    if (currentUser.id === userId) {
      return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 });
    }

    const adminClient = createAdminClient();

    // Get user info before deletion for audit log
    const { data: rawTarget } = await adminClient
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    const targetProfile = rawTarget as Profile | null;

    // Delete auth user (cascade deletes profile due to FK)
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);

    if (deleteError) {
      console.error('User deletion error:', deleteError);
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    // Log the action (use admin client since target user is already deleted)
    await adminClient.from('audit_logs').insert({
      user_id: currentUser.id,
      branch_id: targetProfile?.branch_id || null,
      action_type: 'DELETE_USER',
      entity_type: 'user',
      entity_id: userId,
      description: `Deleted user ${targetProfile?.first_name || ''} ${targetProfile?.last_name || ''} (${targetProfile?.email || ''})`,
      metadata: { deleted_user: targetProfile },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('User deletion error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
