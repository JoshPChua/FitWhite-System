import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  requireActiveProfile, enforceImusOnly, isErrorResponse, jsonError,
} from '@/lib/api-helpers';

/**
 * PATCH /api/services/[id] — Update a service
 * Requires: owner or manager (in their branch)
 *
 * Hardened:
 *   - price validated as finite >= 0
 *   - default_session_count validated as integer >= 1
 *   - Imus-only branch guard
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: serviceId } = await params;
    const supabase = await createClient();
    const auth = await requireActiveProfile(supabase);
    if (isErrorResponse(auth)) return auth;
    const { userId, profile: caller } = auth;

    if (caller.role !== 'owner' && caller.role !== 'manager') {
      return jsonError('Forbidden', 403);
    }

    const adminClient = createAdminClient();

    // Fetch the service to validate branch ownership
    const { data: existingService } = await adminClient
      .from('services').select('*').eq('id', serviceId).single();

    if (!existingService) {
      return jsonError('Service not found', 404);
    }

    const existing = existingService as Record<string, unknown>;

    // Imus-only guard on the service's branch
    const imusGuard = await enforceImusOnly(adminClient, existing.branch_id as string);
    if (imusGuard) return imusGuard;

    if (caller.role === 'manager' && existing.branch_id !== caller.branch_id) {
      return jsonError('Cannot modify services outside your branch', 403);
    }

    const body = await request.json();
    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = String(body.name).trim();
    if (body.description !== undefined) updateData.description = body.description?.trim() || null;
    if (body.duration_minutes !== undefined) updateData.duration_minutes = body.duration_minutes;
    if (body.category !== undefined) updateData.category = body.category?.trim() || null;
    if (body.is_active !== undefined) updateData.is_active = !!body.is_active;

    // Strict price validation
    if (body.price !== undefined) {
      const p = Number(body.price);
      if (!Number.isFinite(p) || p < 0) {
        return jsonError('price must be a finite number >= 0', 400);
      }
      updateData.price = p;
    }

    // Strict session count validation — no parseInt(x) || 1
    if (body.default_session_count !== undefined) {
      const sc = Number(body.default_session_count);
      if (!Number.isInteger(sc) || sc < 1) {
        return jsonError('default_session_count must be an integer >= 1', 400);
      }
      updateData.default_session_count = sc;
    }

    if (Object.keys(updateData).length === 0) {
      return jsonError('No fields to update', 400);
    }

    const { data: updated, error } = await adminClient
      .from('services').update(updateData).eq('id', serviceId).select('*').single();

    if (error) return jsonError(error.message, 500);

    await adminClient.from('audit_logs').insert({
      user_id: userId,
      branch_id: existing.branch_id as string,
      action_type: 'UPDATE_SERVICE',
      entity_type: 'service',
      entity_id: serviceId,
      description: `Updated service "${existing.name}"`,
      metadata: { changes: updateData },
    });

    return NextResponse.json({ success: true, service: updated });
  } catch (error) {
    console.error('PATCH /api/services/[id] error:', error);
    return jsonError('Internal server error', 500);
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
    const auth = await requireActiveProfile(supabase);
    if (isErrorResponse(auth)) return auth;
    const { userId, profile: caller } = auth;

    if (caller.role !== 'owner' && caller.role !== 'manager') {
      return jsonError('Forbidden', 403);
    }

    const adminClient = createAdminClient();

    const { data: existingService } = await adminClient
      .from('services').select('*').eq('id', serviceId).single();

    if (!existingService) {
      return jsonError('Service not found', 404);
    }

    const existing = existingService as Record<string, unknown>;

    // Imus-only guard
    const imusGuard = await enforceImusOnly(adminClient, existing.branch_id as string);
    if (imusGuard) return imusGuard;

    if (caller.role === 'manager' && existing.branch_id !== caller.branch_id) {
      return jsonError('Cannot delete services outside your branch', 403);
    }

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
      if (error) return jsonError(error.message, 500);
    }

    await adminClient.from('audit_logs').insert({
      user_id: userId,
      branch_id: existing.branch_id as string,
      action_type: 'DELETE_SERVICE',
      entity_type: 'service',
      entity_id: serviceId,
      description: `Deleted service "${existing.name}"${(usageCount || 0) > 0 ? ' (soft delete — has sale history)' : ''}`,
      metadata: { service: existingService, soft_delete: (usageCount || 0) > 0 },
    });

    return NextResponse.json({ success: true, soft_deleted: (usageCount || 0) > 0 });
  } catch (error) {
    console.error('DELETE /api/services/[id] error:', error);
    return jsonError('Internal server error', 500);
  }
}
