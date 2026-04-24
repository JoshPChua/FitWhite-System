import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Profile } from '@/types/database';

/**
 * GET /api/commissions?doctor_id=X&status=unpaid|paid&from=DATE&to=DATE
 *
 * Lists doctor commissions (manager/owner only).
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: rawProfile } = await supabase
      .from('profiles').select('*').eq('id', user.id).single();
    const caller = rawProfile as Profile | null;
    if (!caller || !caller.is_active || (caller.role !== 'owner' && caller.role !== 'manager')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const doctorId = request.nextUrl.searchParams.get('doctor_id');
    const paidStatus = request.nextUrl.searchParams.get('status'); // 'paid' | 'unpaid'
    const dateFrom = request.nextUrl.searchParams.get('from');
    const dateTo = request.nextUrl.searchParams.get('to');

    const adminClient = createAdminClient();

    let query = adminClient
      .from('doctor_commissions')
      .select(`
        *,
        doctor:doctor_id (id, full_name, default_commission_type, default_commission_value),
        session:package_session_id (id, created_at, package_id),
        sale_item:sale_item_id (id, name, sale_id)
      `)
      .order('created_at', { ascending: false });

    // Branch isolation
    if (caller.role !== 'owner') {
      query = query.eq('branch_id', caller.branch_id!);
    }

    if (doctorId) query = query.eq('doctor_id', doctorId);
    if (paidStatus === 'paid') query = query.eq('is_paid', true);
    if (paidStatus === 'unpaid') query = query.eq('is_paid', false);
    if (dateFrom) query = query.gte('created_at', dateFrom);
    if (dateTo) query = query.lte('created_at', dateTo);

    const { data, error } = await query.limit(200);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data: data || [] });
  } catch (error) {
    console.error('GET /api/commissions error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PATCH /api/commissions
 *
 * Marks commissions as paid (bulk or single).
 *
 * Body: { ids: string[] }
 */
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: rawProfile } = await supabase
      .from('profiles').select('*').eq('id', user.id).single();
    const caller = rawProfile as Profile | null;
    if (!caller || !caller.is_active || (caller.role !== 'owner' && caller.role !== 'manager')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const body = await request.json();
    const { ids } = body as { ids: string[] };

    if (!ids || ids.length === 0) {
      return NextResponse.json({ error: 'ids array is required' }, { status: 400 });
    }

    const adminClient = createAdminClient();

    const { error } = await adminClient
      .from('doctor_commissions')
      .update({
        is_paid: true,
        paid_at: new Date().toISOString(),
      } as Record<string, unknown>)
      .in('id', ids);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Audit log
    await adminClient.from('audit_logs').insert({
      user_id: user.id,
      branch_id: caller.branch_id,
      action_type: 'COMMISSIONS_PAID',
      entity_type: 'doctor_commission',
      description: `Marked ${ids.length} commission(s) as paid`,
      metadata: { commission_ids: ids },
    } as Record<string, unknown>);

    return NextResponse.json({ success: true, count: ids.length });
  } catch (error) {
    console.error('PATCH /api/commissions error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
