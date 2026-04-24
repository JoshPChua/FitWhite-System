import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertImusOnlyBranch, IMUS_ONLY, IMUS_BRANCH_CODE } from '@/lib/feature-flags';
import type { Profile } from '@/types/database';

/**
 * GET /api/doctors?branch_id=X
 * Lists doctors. Branch-scoped for non-owners.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: rawProfile } = await supabase
      .from('profiles').select('*').eq('id', user.id).single();
    const caller = rawProfile as Profile | null;
    if (!caller || !caller.is_active) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const branchId = request.nextUrl.searchParams.get('branch_id')
      || (caller.role === 'owner' ? null : caller.branch_id);

    const adminClient = createAdminClient();
    let query = adminClient
      .from('doctors')
      .select('*')
      .order('full_name');

    if (branchId) query = query.eq('branch_id', branchId);

    const activeOnly = request.nextUrl.searchParams.get('active');
    if (activeOnly === 'true') query = query.eq('is_active', true);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ data });
  } catch (error) {
    console.error('GET /api/doctors error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/doctors
 * Create a new doctor (no auth account needed).
 * Body: { branch_id, full_name, specialty?, default_commission_type?, default_commission_value?, notes? }
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: rawProfile } = await supabase
      .from('profiles').select('*').eq('id', user.id).single();
    const caller = rawProfile as Profile | null;
    if (!caller || !caller.is_active || (caller.role !== 'owner' && caller.role !== 'manager')) {
      return NextResponse.json({ error: 'Manager or owner required' }, { status: 403 });
    }

    const body = await request.json();
    const {
      branch_id,
      full_name,
      specialty = null,
      default_commission_type = 'percent',
      default_commission_value = 0,
      notes = null,
    } = body as {
      branch_id: string;
      full_name: string;
      specialty?: string | null;
      default_commission_type?: 'percent' | 'fixed';
      default_commission_value?: number;
      notes?: string | null;
    };

    if (!branch_id || !full_name?.trim()) {
      return NextResponse.json({ error: 'branch_id and full_name are required' }, { status: 400 });
    }

    // Branch isolation for managers
    if (caller.role === 'manager' && caller.branch_id !== branch_id) {
      return NextResponse.json({ error: 'Cannot create doctors for other branches' }, { status: 403 });
    }

    const adminClient = createAdminClient();

    // Imus-only guard
    if (IMUS_ONLY) {
      const { data: imusBranch } = await adminClient
        .from('branches').select('id').eq('code', IMUS_BRANCH_CODE).single();
      const imusBranchId = imusBranch ? (imusBranch as Record<string, unknown>).id as string : null;
      try { assertImusOnlyBranch(branch_id, imusBranchId); } catch {
        return NextResponse.json({ error: 'Restricted to Imus branch' }, { status: 403 });
      }
    }

    // Normalize commission value: if percent type and value > 1, treat as percentage input
    let commValue = default_commission_value || 0;
    if (default_commission_type === 'percent' && commValue > 1) {
      commValue = commValue / 100;
    }

    const { data, error } = await adminClient
      .from('doctors')
      .insert({
        branch_id,
        full_name: full_name.trim(),
        specialty: specialty?.trim() || null,
        default_commission_type,
        default_commission_value: commValue,
        notes: notes?.trim() || null,
      } as Record<string, unknown>)
      .select('*')
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Audit log
    await adminClient.from('audit_logs').insert({
      user_id: user.id,
      branch_id,
      action_type: 'CREATE_DOCTOR',
      entity_type: 'doctor',
      entity_id: (data as Record<string, unknown>).id as string,
      description: `Created doctor: ${full_name}`,
      metadata: { full_name, specialty, default_commission_type, default_commission_value: commValue },
    } as Record<string, unknown>);

    return NextResponse.json({ data });
  } catch (error) {
    console.error('POST /api/doctors error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
