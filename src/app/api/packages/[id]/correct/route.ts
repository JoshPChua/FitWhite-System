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
 * 1. Void a session: { action: 'void_session', session_id, reason, auditor_pin? }
 *    - Calls void_package_session RPC (atomic cascade: session + sale + payment + BOM)
 *    - Owner can void without PIN
 *    - Manager/cashier must provide auditor_pin (verified against profiles.auditor_pin)
 *
 * 2. Adjust total sessions: { action: 'adjust_total', new_total, reason }
 *    - Validates new_total >= current non-voided sessions_used
 *    - Updates patient_packages.total_sessions
 *    - Owner/manager only
 *
 * Auditors blocked.
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

    // Auditors cannot correct
    if (caller.role === 'auditor') {
      return jsonError('Auditors cannot make corrections', 403);
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
    if (caller.role === 'cashier' && caller.branch_id !== branchId) {
      return jsonError('Cannot correct packages from a different branch', 403);
    }

    const body = await request.json();
    const { action, session_id, new_total, reason, auditor_pin } = body as {
      action: 'void_session' | 'adjust_total';
      session_id?: string;
      new_total?: number;
      reason?: string;
      auditor_pin?: string;
    };

    if (!reason?.trim()) {
      return jsonError('A reason is required for all corrections', 400);
    }

    // ─── Action: Void Session ─────────────────────────────
    if (action === 'void_session') {
      if (!session_id) {
        return jsonError('session_id is required for void_session', 400);
      }

      // PIN verification for non-owners
      if (caller.role !== 'owner') {
        if (!auditor_pin) {
          return jsonError('Auditor PIN is required for void approval', 400);
        }

        // Find any auditor in this branch and verify their PIN
        const { data: auditors } = await adminClient
          .from('profiles')
          .select('id, auditor_pin')
          .eq('role', 'auditor')
          .not('auditor_pin', 'is', null);

        const pinMatch = (auditors || []).some(
          (a: Record<string, unknown>) => a.auditor_pin === auditor_pin
        );

        if (!pinMatch) {
          return jsonError('Invalid auditor PIN', 403);
        }
      }

      // Call the atomic void RPC
      const { data: rpcResult, error: rpcError } = await adminClient
        .rpc('void_package_session', {
          p_session_id: session_id,
          p_package_id: packageId,
          p_voided_by: userId,
          p_void_reason: reason.trim(),
          p_branch_id: branchId,
        });

      if (rpcError) {
        console.error('void_package_session RPC error:', rpcError);
        return jsonError(rpcError.message || 'Failed to void session', 500);
      }

      return new Response(
        JSON.stringify(rpcResult || { success: true }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ─── Action: Adjust Total Sessions ────────────────────
    if (action === 'adjust_total') {
      // Only owner/manager can adjust totals
      if (caller.role !== 'owner' && caller.role !== 'manager') {
        return jsonError('Only owners and managers can adjust total sessions', 403);
      }

      if (typeof new_total !== 'number' || !Number.isFinite(new_total) || new_total < 1) {
        return jsonError('new_total must be a positive integer', 400);
      }

      // Recalculate current non-voided sessions_used from DB
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
