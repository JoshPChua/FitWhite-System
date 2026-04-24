import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Profile } from '@/types/database';

/**
 * POST /api/packages/[id]/sessions
 *
 * Consumes session(s) from a patient package via atomic Postgres RPC.
 * All writes (session, BOM deduction, inventory_logs, commission) happen
 * inside a single transaction. Any failure → automatic full rollback.
 *
 * Body: { sessions_count?, doctor_id?, notes? }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: packageId } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: rawProfile } = await supabase
      .from('profiles').select('*').eq('id', user.id).single();
    const caller = rawProfile as Profile | null;
    if (!caller || !caller.is_active) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const {
      sessions_count = 1,
      doctor_id = null,
      notes = null,
    } = body as {
      sessions_count?: number;
      doctor_id?: string | null;
      notes?: string | null;
    };

    if (sessions_count < 1) {
      return NextResponse.json({ error: 'sessions_count must be >= 1' }, { status: 400 });
    }

    const adminClient = createAdminClient();

    // Fetch the package for branch isolation check
    const { data: pkg } = await adminClient
      .from('patient_packages')
      .select('branch_id')
      .eq('id', packageId)
      .single();

    if (!pkg) {
      return NextResponse.json({ error: 'Package not found' }, { status: 404 });
    }

    const branchId = (pkg as Record<string, unknown>).branch_id as string;

    // Branch isolation
    if (caller.role !== 'owner' && caller.branch_id !== branchId) {
      return NextResponse.json({ error: 'Cannot consume sessions for another branch' }, { status: 403 });
    }

    // ─── Atomic RPC: session + BOM + commission in one transaction ───
    const { data: result, error: rpcError } = await adminClient
      .rpc('consume_package_session', {
        p_package_id: packageId,
        p_branch_id: branchId,
        p_performed_by: user.id,
        p_doctor_id: doctor_id || null,
        p_sessions_count: sessions_count,
        p_notes: notes || null,
      });

    if (rpcError) {
      // Surface the Postgres error message directly
      return NextResponse.json({ error: rpcError.message }, { status: 500 });
    }

    const rpcResult = result as Record<string, unknown>;

    // Audit log (non-critical, outside transaction)
    await adminClient.from('audit_logs').insert({
      user_id: user.id,
      branch_id: branchId,
      action_type: 'SESSION_CONSUMED',
      entity_type: 'package_session',
      entity_id: rpcResult.session_id as string,
      description: `${sessions_count} session(s) consumed from package. ${rpcResult.sessions_remaining} remaining.${rpcResult.auto_completed ? ' Package auto-completed.' : ''}`,
      metadata: { package_id: packageId, sessions_count, doctor_id },
    } as Record<string, unknown>);

    return NextResponse.json({ data: rpcResult }, { status: 201 });
  } catch (error) {
    console.error('POST /api/packages/[id]/sessions error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * GET /api/packages/[id]/sessions
 *
 * Lists all session records for a given package.
 * Requires caller profile lookup + branch isolation.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: packageId } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Caller profile + active check
    const { data: rawProfile } = await supabase
      .from('profiles').select('*').eq('id', user.id).single();
    const caller = rawProfile as Profile | null;
    if (!caller || !caller.is_active) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const adminClient = createAdminClient();

    // Fetch package for branch isolation
    const { data: pkg } = await adminClient
      .from('patient_packages')
      .select('branch_id')
      .eq('id', packageId)
      .single();

    if (!pkg) {
      return NextResponse.json({ error: 'Package not found' }, { status: 404 });
    }

    const pkgBranch = (pkg as Record<string, unknown>).branch_id as string;

    // Branch isolation: non-owners can only see their own branch
    if (caller.role !== 'owner' && caller.branch_id !== pkgBranch) {
      return NextResponse.json({ error: 'Access denied: package belongs to another branch' }, { status: 403 });
    }

    const { data, error } = await adminClient
      .from('package_sessions')
      .select(`
        *,
        performer:performed_by (first_name, last_name),
        doctor:doctor_id (full_name)
      `)
      .eq('package_id', packageId)
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data: data || [] });
  } catch (error) {
    console.error('GET /api/packages/[id]/sessions error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
