import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Profile } from '@/types/database';

/**
 * GET /api/shifts?branch_id=X&status=open|closed
 *
 * Lists shifts for a branch.
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

    const status = request.nextUrl.searchParams.get('status');
    const adminClient = createAdminClient();

    const branchId = caller.role === 'owner'
      ? (request.nextUrl.searchParams.get('branch_id') || caller.branch_id)
      : caller.branch_id;

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
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data: data || [] });
  } catch (error) {
    console.error('GET /api/shifts error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/shifts
 *
 * Opens a new shift. The DB partial unique index ensures only one open shift per branch.
 *
 * Body: { branch_id, opening_cash }
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
      return NextResponse.json({ error: 'Manager or owner required to open shifts' }, { status: 403 });
    }

    const body = await request.json();
    const { branch_id, opening_cash = 0 } = body as {
      branch_id: string;
      opening_cash?: number;
    };

    if (!branch_id) {
      return NextResponse.json({ error: 'branch_id is required' }, { status: 400 });
    }

    // Branch isolation
    if (caller.role !== 'owner' && caller.branch_id !== branch_id) {
      return NextResponse.json({ error: 'Cannot open shifts for another branch' }, { status: 403 });
    }

    const adminClient = createAdminClient();

    const { data: shift, error: shiftError } = await adminClient
      .from('shifts')
      .insert({
        branch_id,
        opened_by: user.id,
        opening_cash,
        status: 'open',
      } as Record<string, unknown>)
      .select('*')
      .single();

    if (shiftError) {
      // Unique index violation — already an open shift
      if (shiftError.code === '23505') {
        return NextResponse.json({
          error: 'A shift is already open for this branch. Close the current shift first.'
        }, { status: 409 });
      }
      return NextResponse.json({ error: shiftError.message }, { status: 500 });
    }

    // Audit log
    await adminClient.from('audit_logs').insert({
      user_id: user.id,
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
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
