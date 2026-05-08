import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  requireActiveProfile, enforceImusOnly, assertBranchAccess,
  isErrorResponse, jsonError,
} from '@/lib/api-helpers';
import { IMUS_ONLY, IMUS_BRANCH_CODE } from '@/lib/feature-flags';

/**
 * GET /api/shifts?branch_id=X&status=open|closed
 *
 * Lists shifts for a branch.
 *
 * Hardened: Imus-only forces Imus branch (ignores query param).
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const auth = await requireActiveProfile(supabase);
    if (isErrorResponse(auth)) return auth;
    const { profile: caller } = auth;

    const status = request.nextUrl.searchParams.get('status');
    const adminClient = createAdminClient();

    // Determine effective branch — Imus-only forces Imus
    let branchId: string | null;
    if (IMUS_ONLY) {
      const { data: imusBranch } = await adminClient
        .from('branches').select('id').eq('code', IMUS_BRANCH_CODE).single();
      if (!imusBranch) return jsonError('Imus branch not found', 500);
      branchId = (imusBranch as Record<string, unknown>).id as string;
    } else {
      branchId = caller.role === 'owner'
        ? (request.nextUrl.searchParams.get('branch_id') || caller.branch_id)
        : caller.branch_id;
    }

    let query = adminClient
      .from('shifts')
      .select(`
        *,
        opener:opened_by (first_name, last_name),
        closer:closed_by (first_name, last_name)
      `)
      .order('opened_at', { ascending: false })
      .limit(20);

    if (branchId) query = query.eq('branch_id', branchId);
    if (status) query = query.eq('status', status);

    const { data, error } = await query;

    if (error) {
      return jsonError(error.message, 500);
    }

    return NextResponse.json({ data: data || [] });
  } catch (error) {
    console.error('GET /api/shifts error:', error);
    return jsonError('Internal server error', 500);
  }
}

/**
 * POST /api/shifts
 *
 * Opens a new shift. The DB partial unique index ensures only one open shift per branch.
 *
 * Body: { branch_id, opening_cash }
 *
 * Hardened: Imus-only guard on branch_id.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const auth = await requireActiveProfile(supabase);
    if (isErrorResponse(auth)) return auth;
    const { userId, profile: caller } = auth;

    if (caller.role !== 'owner' && caller.role !== 'manager') {
      return jsonError('Manager or owner required to open shifts', 403);
    }

    const body = await request.json();
    const { branch_id, opening_cash = 0 } = body as {
      branch_id: string;
      opening_cash?: number;
    };

    if (!branch_id) {
      return jsonError('branch_id is required', 400);
    }

    // Branch isolation
    const branchErr = assertBranchAccess(caller, branch_id, 'open shifts');
    if (branchErr) return branchErr;

    const adminClient = createAdminClient();

    // Imus-only guard
    const imusGuard = await enforceImusOnly(adminClient, branch_id);
    if (imusGuard) return imusGuard;

    const { data: shift, error: shiftError } = await adminClient
      .from('shifts')
      .insert({
        branch_id,
        opened_by: userId,
        opening_cash,
        status: 'open',
      } as Record<string, unknown>)
      .select('*')
      .single();

    if (shiftError) {
      // Unique index violation — already an open shift
      if (shiftError.code === '23505') {
        return jsonError(
          'A shift is already open for this branch. Close the current shift first.',
          409,
        );
      }
      return jsonError(shiftError.message, 500);
    }

    // Audit log
    await adminClient.from('audit_logs').insert({
      user_id: userId,
      branch_id,
      action_type: 'SHIFT_OPENED',
      entity_type: 'shift',
      entity_id: (shift as Record<string, unknown>).id as string,
      description: `Shift opened with ₱${opening_cash.toFixed(2)} opening cash`,
      metadata: { opening_cash },
    } as Record<string, unknown>);

    return NextResponse.json({ data: shift }, { status: 201 });
  } catch (error) {
    console.error('POST /api/shifts error:', error);
    return jsonError('Internal server error', 500);
  }
}
