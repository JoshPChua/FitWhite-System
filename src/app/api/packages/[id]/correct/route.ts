import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  requireActiveProfile, enforceImusOnly, isErrorResponse, jsonError,
} from '@/lib/api-helpers';

/**
 * POST /api/packages/[id]/correct
 *
 * Two correction types:
 *
 * 1. Void a session: { action: 'void_session', session_id, reason }
 *    - Soft-voids a package_sessions row (is_voided = true)
 *    - The upgraded trigger recalculates sessions_used from SUM
 *    - Writes audit_log
 *
 * 2. Adjust total sessions: { action: 'adjust_total', new_total, reason }
 *    - Validates new_total >= current non-voided sessions_used
 *    - Updates patient_packages.total_sessions
 *    - Writes audit_log
 *
 * Owner/manager only. Auditors blocked.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: packageId } = await params;
    const supabase = await createClient();
    const auth = await requireActiveProfile(supabase);
    if (isErrorResponse(auth)) return auth;
    const { userId, profile: caller } = auth;

    // Only owner/manager can correct
    if (caller.role !== 'owner' && caller.role !== 'manager') {
      return jsonError('Only owners and managers can make corrections', 403);
    }

    const adminClient = createAdminClient();

    // Fetch the package
    const { data: pkg, error: pkgErr } = await adminClient
      .from('patient_packages')
      .select('id, branch_id, status, total_sessions, sessions_used, total_price, total_paid, customer_id')
      .eq('id', packageId)
      .single();

    if (pkgErr || !pkg) {
      return jsonError('Package not found', 404);
    }

    const pkgData = pkg as Record<string, unknown>;
    const branchId = pkgData.branch_id as string;

    // Imus-only guard
    const imusCheck = await enforceImusOnly(adminClient, branchId);
    if (isErrorResponse(imusCheck)) return imusCheck;

    // Branch access
    if (caller.role === 'manager' && caller.branch_id !== branchId) {
      return jsonError('Cannot correct packages from a different branch', 403);
    }

    const body = await request.json();
    const { action, session_id, new_total, reason } = body as {
      action: 'void_session' | 'adjust_total';
      session_id?: string;
      new_total?: number;
      reason?: string;
    };

    if (!reason?.trim()) {
      return jsonError('A reason is required for all corrections', 400);
    }

    // ─── Action: Void Session ─────────────────────────────
    if (action === 'void_session') {
      if (!session_id) {
        return jsonError('session_id is required for void_session', 400);
      }

      // Fetch the session
      const { data: session, error: sessErr } = await adminClient
        .from('package_sessions')
        .select('id, package_id, sessions_count, is_voided, created_at')
        .eq('id', session_id)
        .eq('package_id', packageId)
        .single();

      if (sessErr || !session) {
        return jsonError('Session not found in this package', 404);
      }

      const sessData = session as Record<string, unknown>;
      if (sessData.is_voided === true) {
        return jsonError('Session is already voided', 400);
      }

      // Soft-void the session (trigger will recalculate sessions_used)
      const { error: voidErr } = await adminClient
        .from('package_sessions')
        .update({
          is_voided: true,
          voided_by: userId,
          voided_at: new Date().toISOString(),
          void_reason: reason.trim(),
        } as Record<string, unknown>)
        .eq('id', session_id);

      if (voidErr) {
        return jsonError(`Failed to void session: ${voidErr.message}`, 500);
      }

      // Re-read updated sessions_used after trigger
      const { data: updatedPkg } = await adminClient
        .from('patient_packages')
        .select('sessions_used')
        .eq('id', packageId)
        .single();

      const newSessionsUsed = updatedPkg
        ? (updatedPkg as Record<string, unknown>).sessions_used as number
        : null;

      // Audit log
      await adminClient.from('audit_logs').insert({
        user_id: userId,
        branch_id: branchId,
        action_type: 'VOID_SESSION',
        entity_type: 'package_session',
        entity_id: session_id,
        description: `Voided session ${session_id} (${sessData.sessions_count} session(s)) from package ${packageId}. Reason: ${reason.trim()}`,
        metadata: {
          package_id: packageId,
          session_id,
          sessions_count: sessData.sessions_count,
          sessions_used_before: pkgData.sessions_used,
          sessions_used_after: newSessionsUsed,
          reason: reason.trim(),
        },
      } as Record<string, unknown>);

      return new Response(
        JSON.stringify({
          success: true,
          action: 'void_session',
          session_id,
          sessions_count: sessData.sessions_count,
          sessions_used_before: pkgData.sessions_used,
          sessions_used_after: newSessionsUsed,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ─── Action: Adjust Total Sessions ────────────────────
    if (action === 'adjust_total') {
      if (typeof new_total !== 'number' || !Number.isFinite(new_total) || new_total < 1) {
        return jsonError('new_total must be a positive integer', 400);
      }

      // Recalculate current non-voided sessions_used from DB (authoritative)
      const { data: sessionRows } = await adminClient
        .from('package_sessions')
        .select('sessions_count')
        .eq('package_id', packageId)
        .eq('is_voided', false);

      const currentUsed = (sessionRows || []).reduce(
        (sum: number, row: Record<string, unknown>) => sum + (row.sessions_count as number),
        0
      );

      if (new_total < currentUsed) {
        return jsonError(
          `Cannot set total_sessions to ${new_total} — there are ${currentUsed} non-voided sessions consumed`,
          400
        );
      }

      const oldTotal = pkgData.total_sessions as number;

      const { error: updateErr } = await adminClient
        .from('patient_packages')
        .update({ total_sessions: new_total } as Record<string, unknown>)
        .eq('id', packageId);

      if (updateErr) {
        return jsonError(`Failed to update total sessions: ${updateErr.message}`, 500);
      }

      // Audit log
      await adminClient.from('audit_logs').insert({
        user_id: userId,
        branch_id: branchId,
        action_type: 'ADJUST_TOTAL_SESSIONS',
        entity_type: 'patient_package',
        entity_id: packageId,
        description: `Adjusted total sessions from ${oldTotal} to ${new_total} for package ${packageId}. Reason: ${reason.trim()}`,
        metadata: {
          package_id: packageId,
          total_sessions_before: oldTotal,
          total_sessions_after: new_total,
          sessions_used: currentUsed,
          reason: reason.trim(),
        },
      } as Record<string, unknown>);

      return new Response(
        JSON.stringify({
          success: true,
          action: 'adjust_total',
          total_sessions_before: oldTotal,
          total_sessions_after: new_total,
          sessions_used: currentUsed,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }


    return jsonError(`Unknown action: ${action}`, 400);
  } catch (error) {
    console.error('POST /api/packages/[id]/correct error:', error);
    return jsonError('Internal server error', 500);
  }
}
