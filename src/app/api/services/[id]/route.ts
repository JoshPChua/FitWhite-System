import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Profile } from '@/types/database';

/**
 * PATCH /api/services/[id] — Update a service
 * Requires: owner or manager (in their branch)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: serviceId } = await params;
    const supabase = await createClient();
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    if (!currentUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: rawCaller } = await supabase
      .from('profiles').select('*').eq('id', currentUser.id).single();
    const caller = rawCaller as Profile | null;

    if (!caller || (caller.role !== 'owner' && caller.role !== 'manager')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Fetch the service to validate branch ownership
    const { data: existingService } = await supabase
      .from('services').select('*').eq('id', serviceId).single();

    if (!existingService) {
      return NextResponse.json({ error: 'Service not found' }, { status: 404 });
    }

    if (caller.role === 'manager' && (existingService as Record<string, unknown>).branch_id !== caller.branch_id) {
      return NextResponse.json({ error: 'Cannot modify services outside your branch' }, { status: 403 });
    }

    const body = await request.json();
    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.price !== undefined) updateData.price = body.price;
    if (body.duration_minutes !== undefined) updateData.duration_minutes = body.duration_minutes;
    if (body.category !== undefined) updateData.category = body.category;
    if (body.is_active !== undefined) updateData.is_active = body.is_active;
    if (body.default_session_count !== undefined) updateData.default_session_count = parseInt(body.default_session_count) || 1;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const adminClient = createAdminClient();
    const { data: updated, error } = await adminClient
      .from('services').update(updateData).eq('id', serviceId).select('*').single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await adminClient.from('audit_logs').insert({
      user_id: currentUser.id,
      branch_id: (existingService as Record<string, unknown>).branch_id as string,
      action_type: 'UPDATE_SERVICE',
      entity_type: 'service',
      entity_id: serviceId,
      description: `Updated service "${(existingService as Record<string, unknown>).name}"`,
      metadata: { changes: updateData },
    });

    return NextResponse.json({ success: true, service: updated });
  } catch (error) {
    console.error('PATCH /api/services/[id] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/services/[id] — Soft delete (set is_active = false) or hard delete
 * Requires: owner or manager (in their branch)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: serviceId } = await params;
    const supabase = await createClient();
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    if (!currentUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: rawCaller } = await supabase
      .from('profiles').select('*').eq('id', currentUser.id).single();
    const caller = rawCaller as Profile | null;

    if (!caller || (caller.role !== 'owner' && caller.role !== 'manager')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { data: existingService } = await supabase
      .from('services').select('*').eq('id', serviceId).single();

    if (!existingService) {
      return NextResponse.json({ error: 'Service not found' }, { status: 404 });
    }

    if (caller.role === 'manager' && (existingService as Record<string, unknown>).branch_id !== caller.branch_id) {
      return NextResponse.json({ error: 'Cannot delete services outside your branch' }, { status: 403 });
    }

    const adminClient = createAdminClient();

    // Check if service has been used in any sale — soft delete if so
    const { count: usageCount } = await adminClient
      .from('sale_items')
      .select('id', { count: 'exact', head: true })
      .eq('service_id', serviceId);

    if ((usageCount || 0) > 0) {
      // Soft delete
      await adminClient.from('services').update({ is_active: false }).eq('id', serviceId);
    } else {
      // Hard delete
      const { error } = await adminClient.from('services').delete().eq('id', serviceId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await adminClient.from('audit_logs').insert({
      user_id: currentUser.id,
      branch_id: (existingService as Record<string, unknown>).branch_id as string,
      action_type: 'DELETE_SERVICE',
      entity_type: 'service',
      entity_id: serviceId,
      description: `Deleted service "${(existingService as Record<string, unknown>).name}"${(usageCount || 0) > 0 ? ' (soft delete — has sale history)' : ''}`,
      metadata: { service: existingService, soft_delete: (usageCount || 0) > 0 },
    });

    return NextResponse.json({ success: true, soft_deleted: (usageCount || 0) > 0 });
  } catch (error) {
    console.error('DELETE /api/services/[id] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
