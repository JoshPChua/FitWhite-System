/**
 * Shared server-side API route helpers.
 *
 * Reduces boilerplate for auth checks, Imus-only branch resolution,
 * branch-access guards, and JSON error responses across all API routes.
 *
 * IMPORTANT: These helpers are server-only. Do NOT import from client components.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { IMUS_ONLY, IMUS_BRANCH_CODE } from '@/lib/feature-flags';
import type { Profile } from '@/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';

// ─── JSON Error Shorthand ────────────────────────────────────

/**
 * Returns a NextResponse JSON error with the given status code.
 */
export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

// ─── Auth + Profile ──────────────────────────────────────────

export interface ActiveCaller {
  userId: string;
  profile: Profile;
}

/**
 * Verifies the request is authenticated and the profile is active.
 * Returns { userId, profile } on success, or a NextResponse error on failure.
 */
export async function requireActiveProfile(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<ActiveCaller | NextResponse> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError('Unauthorized', 401);

  const { data: rawProfile } = await supabase
    .from('profiles').select('*').eq('id', user.id).single();
  const profile = rawProfile as Profile | null;

  if (!profile || !profile.is_active) return jsonError('Forbidden', 403);

  return { userId: user.id, profile };
}

// ─── Imus-Only Branch Resolution ─────────────────────────────

/**
 * Resolves the Imus branch UUID from the database.
 * Returns the UUID string, or a NextResponse error if not found.
 *
 * When IMUS_ONLY is false, returns null (no restriction).
 */
export async function resolveImusBranchId(
  adminClient: ReturnType<typeof createAdminClient>,
): Promise<string | null | NextResponse> {
  if (!IMUS_ONLY) return null;

  const { data: imusBranch } = await adminClient
    .from('branches').select('id').eq('code', IMUS_BRANCH_CODE).single();

  if (!imusBranch) return jsonError('Imus branch not found', 500);
  return (imusBranch as Record<string, unknown>).id as string;
}

/**
 * Enforces Imus-only mode on a given branch_id.
 * If IMUS_ONLY is true and branch_id doesn't match Imus, returns an error response.
 * Otherwise returns null (no error).
 */
export async function enforceImusOnly(
  adminClient: ReturnType<typeof createAdminClient>,
  branchId: string,
): Promise<NextResponse | null> {
  const result = await resolveImusBranchId(adminClient);
  if (result instanceof NextResponse) return result;
  if (result === null) return null; // IMUS_ONLY is false

  if (branchId !== result) {
    return jsonError('This installation is restricted to the Imus branch', 403);
  }
  return null;
}

// ─── Branch Access ───────────────────────────────────────────

/**
 * Checks that a non-owner caller has access to the given branch.
 * Returns a NextResponse error if access is denied, or null if allowed.
 */
export function assertBranchAccess(
  profile: Profile,
  branchId: string,
  action = 'perform this action',
): NextResponse | null {
  if (profile.role === 'owner') return null;
  if (profile.branch_id === branchId) return null;
  return jsonError(`Cannot ${action} for a different branch`, 403);
}

/**
 * Helper type guard: checks if a value is a NextResponse (error).
 */
export function isErrorResponse(value: unknown): value is NextResponse {
  return value instanceof NextResponse;
}
