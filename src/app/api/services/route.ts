import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  requireActiveProfile, enforceImusOnly, assertBranchAccess,
  resolveImusBranchId, isErrorResponse, jsonError,
} from '@/lib/api-helpers';

/**
 * GET /api/services — list services
 *
 * Hardened:
 *   - Uses requireActiveProfile for proper auth + activity check
 *   - Imus-only: when enabled, forces query to IMS branch regardless of query param
 *   - Branch isolation: non-owners use their profile.branch_id
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const auth = await requireActiveProfile(supabase);
    if (isErrorResponse(auth)) return auth;
    const { profile: caller } = auth;

    const adminClient = createAdminClient();

    const { searchParams } = new URL(request.url);
    const requestedBranchId = searchParams.get('branch_id');

    // Determine effective branch_id
    let effectiveBranchId: string | null = null;

    // Imus-only: always force IMS branch
    const imusResult = await resolveImusBranchId(adminClient);
    if (imusResult instanceof NextResponse) return imusResult;

    if (imusResult !== null) {
      // IMUS_ONLY is true — force IMS branch, ignore query param
      effectiveBranchId = imusResult;
    } else {
      // Multi-branch mode
      if (caller.role === 'owner') {
        // Owners can query any branch or all
        effectiveBranchId = requestedBranchId;
      } else {
        // Non-owners must use their own branch
        effectiveBranchId = caller.branch_id;
      }
    }

    let query = adminClient.from('services').select('*').order('name');
    if (effectiveBranchId) query = query.eq('branch_id', effectiveBranchId);

    const { data, error } = await query;
    if (error) return jsonError(error.message, 500);

    return NextResponse.json({ services: data });
  } catch (error) {
    console.error('GET /api/services error:', error);
    return jsonError('Internal server error', 500);
  }
}

/**
 * POST /api/services — Create a new service
 * Requires: owner or manager role
 *
 * Hardened:
 *   - price validated as finite >= 0
 *   - default_session_count validated as integer >= 1 (no negative slip-through)
 *   - Imus-only branch guard
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const auth = await requireActiveProfile(supabase);
    if (isErrorResponse(auth)) return auth;
    const { userId, profile: caller } = auth;

    if (caller.role !== 'owner' && caller.role !== 'manager') {
      return jsonError('Forbidden: insufficient permissions', 403);
    }

    const body = await request.json();
    const { branch_id, name, description, price, duration_minutes, category, default_session_count } = body;

    if (!branch_id || !name?.trim()) {
      return jsonError('Required fields: branch_id, name', 400);
    }

    if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) {
      return jsonError('price must be a finite number >= 0', 400);
    }

    // Strict session count validation — no parseInt(x) || 1 which lets negatives slip through
    let sessionCount = 1;
    if (default_session_count !== undefined && default_session_count !== null) {
      const parsed = Number(default_session_count);
      if (!Number.isInteger(parsed) || parsed < 1) {
        return jsonError('default_session_count must be an integer >= 1', 400);
      }
      sessionCount = parsed;
    }

    // Branch isolation
    const branchErr = assertBranchAccess(caller, branch_id, 'create services');
    if (branchErr) return branchErr;

    const adminClient = createAdminClient();

    // Imus-only guard
    const imusGuard = await enforceImusOnly(adminClient, branch_id);
    if (imusGuard) return imusGuard;

    const { data: service, error } = await adminClient
      .from('services')
      .insert({
        branch_id,
        name: name.trim(),
        description: description?.trim() || null,
        price,
        duration_minutes: duration_minutes || null,
        category: category?.trim() || null,
        default_session_count: sessionCount,
      })
      .select('*')
      .single();

    if (error) return jsonError(error.message, 500);

    await adminClient.from('audit_logs').insert({
      user_id: userId,
      branch_id,
      action_type: 'CREATE_SERVICE',
      entity_type: 'service',
      entity_id: (service as { id: string }).id,
      description: `Created service "${name.trim()}"`,
      metadata: { name: name.trim(), price, category, default_session_count: sessionCount },
    });

    return NextResponse.json({ success: true, service });
  } catch (error) {
    console.error('POST /api/services error:', error);
    return jsonError('Internal server error', 500);
  }
}
