import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  requireActiveProfile, enforceImusOnly, isErrorResponse, jsonError,
} from '@/lib/api-helpers';

/**
 * PATCH /api/packages/[id]/complete
 *
 * Manually completes a package early (e.g., customer no longer needs sessions).
 * Only owner/manager can complete. Sets status to 'completed'.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: packageId } = await params;
    const supabase = await createClient();
    const auth = await requireActiveProfile(supabase);
    if (isErrorResponse(auth)) return auth;
    const { userId, profile: caller } = auth;

    if (caller.role !== 'owner' && caller.role !== 'manager') {
      return jsonError('Only owners and managers can complete packages', 403);
    }

    const body = await request.json().catch(() => ({}));
    const notes = (body as Record<string, unknown>).notes as string || null;

    const adminClient = createAdminClient();

    // Fetch the package
    const { data: pkg } = await adminClient
      .from('patient_packages')
      .select('id, branch_id, status, customer_id, total_sessions, sessions_used')
      .eq('id', packageId)
      .single();

    if (!pkg) {
      return jsonError('Package not found', 404);
    }

    const pkgData = pkg as Record<string, unknown>;

    if (pkgData.status !== 'active') {
      return jsonError('Only active packages can be completed', 400);
    }

    const branchId = pkgData.branch_id as string;

    // Imus-only guard
    const imusGuard = await enforceImusOnly(adminClient, branchId);
    if (imusGuard) return imusGuard;

    // Branch isolation
    if (caller.role !== 'owner' && caller.branch_id !== branchId) {
      return jsonError('Cannot complete packages for another branch', 403);
    }

    // Update package status to completed
    const { error: updateError } = await adminClient
      .from('patient_packages')
      .update({
        status: 'completed',
        notes: notes
          ? `${pkgData.notes || ''}\n[Early completion] ${notes}`.trim()
          : `${pkgData.notes || ''}\n[Completed early by staff]`.trim(),
      } as Record<string, unknown>)
      .eq('id', packageId);

    if (updateError) {
      return jsonError(updateError.message, 500);
    }

    // Audit log
    await adminClient.from('audit_logs').insert({
      user_id: userId,
      branch_id: branchId,
      action_type: 'PACKAGE_COMPLETED',
      entity_type: 'patient_package',
      entity_id: packageId,
      description: `Package completed early. Used ${pkgData.sessions_used}/${pkgData.total_sessions} sessions.${notes ? ` Reason: ${notes}` : ''}`,
      metadata: { sessions_used: pkgData.sessions_used, total_sessions: pkgData.total_sessions },
    } as Record<string, unknown>);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('PATCH /api/packages/[id]/complete error:', error);
    return jsonError('Internal server error', 500);
  }
}
