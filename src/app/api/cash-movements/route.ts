import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Profile } from '@/types/database';

/**
 * GET /api/cash-movements?shift_id=X&branch_id=X
 *
 * Lists cash movements. Filterable by shift or branch.
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

    const shiftId = request.nextUrl.searchParams.get('shift_id');
    const adminClient = createAdminClient();

    const branchId = caller.role === 'owner'
      ? (request.nextUrl.searchParams.get('branch_id') || caller.branch_id)
      : caller.branch_id;

    let query = adminClient
      .from('cash_movements')
      .select(`
        *,
        performer:performed_by (first_name, last_name),
        approver:approved_by (first_name, last_name)
      `)
      .order('created_at', { ascending: false })
      .limit(50);

    if (branchId) query = query.eq('branch_id', branchId);
    if (shiftId) query = query.eq('shift_id', shiftId);

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data: data || [] });
  } catch (error) {
    console.error('GET /api/cash-movements error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/cash-movements
 *
 * Records a cash movement (petty cash expense, bank deposit, cash in).
 *
 * Body: { branch_id, movement_type, amount, description, reference?, shift_id? }
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
      movement_type,
      amount,
      description,
      reference = null,
      shift_id = null,
    } = body as {
      branch_id: string;
      movement_type: string;
      amount: number;
      description: string;
      reference?: string | null;
      shift_id?: string | null;
    };

    if (!branch_id || !movement_type || !amount || !description) {
      return NextResponse.json({
        error: 'Required: branch_id, movement_type, amount, description'
      }, { status: 400 });
    }
    if (amount <= 0) {
      return NextResponse.json({ error: 'amount must be > 0' }, { status: 400 });
    }

    // Branch isolation
    if (caller.role !== 'owner' && caller.branch_id !== branch_id) {
      return NextResponse.json({ error: 'Cannot record movements for another branch' }, { status: 403 });
    }

    const adminClient = createAdminClient();

    const { data: movement, error: mvError } = await adminClient
      .from('cash_movements')
      .insert({
        branch_id,
        shift_id: shift_id || null,
        performed_by: user.id,
        movement_type,
        amount,
        description,
        reference: reference || null,
        approved_by: user.id, // auto-approved by the manager/owner who creates it
      } as Record<string, unknown>)
      .select('*')
      .single();

    if (mvError) {
      return NextResponse.json({ error: mvError.message }, { status: 500 });
    }

    // Audit log
    await adminClient.from('audit_logs').insert({
      user_id: user.id,
      branch_id,
      action_type: 'CASH_MOVEMENT',
      entity_type: 'cash_movement',
      entity_id: (movement as Record<string, unknown>).id as string,
      description: `${movement_type}: ₱${amount.toFixed(2)} — ${description}`,
      metadata: { movement_type, amount, description, reference, shift_id },
    } as Record<string, unknown>);

    return NextResponse.json({ data: movement }, { status: 201 });
  } catch (error) {
    console.error('POST /api/cash-movements error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
