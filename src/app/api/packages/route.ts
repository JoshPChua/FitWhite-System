import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertImusOnlyBranch, IMUS_ONLY, IMUS_BRANCH_CODE } from '@/lib/feature-flags';
import type { Profile } from '@/types/database';

/**
 * GET /api/packages?customer_id=X&status=active&branch_id=X
 *
 * Lists patient packages with optional filters.
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

    const customerId = request.nextUrl.searchParams.get('customer_id');
    const status = request.nextUrl.searchParams.get('status');
    const branchId = request.nextUrl.searchParams.get('branch_id');

    const adminClient = createAdminClient();

    let query = adminClient
      .from('patient_packages')
      .select(`
        *,
        customers:customer_id (id, first_name, last_name, phone),
        services:service_id (id, name, price, category),
        doctors:attending_doctor_id (id, full_name)
      `)
      .order('created_at', { ascending: false });

    // Branch isolation for non-owners
    if (caller.role !== 'owner') {
      query = query.eq('branch_id', caller.branch_id!);
    } else if (branchId) {
      query = query.eq('branch_id', branchId);
    }

    if (customerId) query = query.eq('customer_id', customerId);
    if (status) query = query.eq('status', status);

    const { data, error } = await query.limit(100);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data: data || [] });
  } catch (error) {
    console.error('GET /api/packages error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/packages
 *
 * Creates a new patient package (used during checkout for installment sales).
 *
 * Body: {
 *   branch_id, customer_id, service_id, sale_item_id?,
 *   total_price, downpayment, total_sessions,
 *   attending_doctor_id?, notes?
 * }
 */
export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const {
      branch_id,
      customer_id,
      service_id,
      sale_item_id = null,
      total_price,
      downpayment = 0,
      total_sessions,
      attending_doctor_id = null,
      notes = null,
    } = body as {
      branch_id: string;
      customer_id: string;
      service_id: string;
      sale_item_id?: string | null;
      total_price: number;
      downpayment?: number;
      total_sessions: number;
      attending_doctor_id?: string | null;
      notes?: string | null;
    };

    if (!branch_id || !customer_id || !service_id || !total_price || !total_sessions) {
      return NextResponse.json({
        error: 'Required: branch_id, customer_id, service_id, total_price, total_sessions'
      }, { status: 400 });
    }

    // Branch isolation
    if (caller.role !== 'owner' && caller.branch_id !== branch_id) {
      return NextResponse.json({ error: 'Cannot create packages for another branch' }, { status: 403 });
    }

    const adminClient = createAdminClient();

    // Imus-only enforcement
    if (IMUS_ONLY) {
      const { data: imusBranch } = await adminClient
        .from('branches').select('id').eq('code', IMUS_BRANCH_CODE).single();
      const imusBranchId = imusBranch ? (imusBranch as Record<string, unknown>).id as string : null;
      assertImusOnlyBranch(branch_id, imusBranchId);
    }

    // Create the package. total_paid starts at the downpayment amount.
    const { data: pkg, error: pkgError } = await adminClient
      .from('patient_packages')
      .insert({
        branch_id,
        customer_id,
        service_id,
        sale_item_id,
        total_price,
        downpayment,
        total_paid: downpayment,
        total_sessions,
        attending_doctor_id,
        notes,
        status: 'active',
      } as Record<string, unknown>)
      .select('*')
      .single();

    if (pkgError) {
      return NextResponse.json({ error: pkgError.message }, { status: 500 });
    }

    const pkgData = pkg as Record<string, unknown>;

    // If there's a downpayment > 0, record it in the package_payments ledger
    if (downpayment > 0) {
      await adminClient.from('package_payments').insert({
        package_id: pkgData.id as string,
        branch_id,
        received_by: user.id,
        amount: downpayment,
        method: 'cash', // default — the actual payment method is tracked in the sales.payments table
        notes: 'Initial downpayment at checkout',
      } as Record<string, unknown>);
    }

    // Audit log
    await adminClient.from('audit_logs').insert({
      user_id: user.id,
      branch_id,
      action_type: 'PACKAGE_CREATED',
      entity_type: 'patient_package',
      entity_id: pkgData.id as string,
      description: `Package created — ${total_sessions} sessions, total ₱${total_price}, downpayment ₱${downpayment}`,
      metadata: { service_id, customer_id, total_price, downpayment, total_sessions },
    } as Record<string, unknown>);

    return NextResponse.json({ data: pkg }, { status: 201 });
  } catch (error: unknown) {
    if ((error as { name?: string }).name === 'ImusOnlyError') {
      return NextResponse.json({ error: (error as Error).message }, { status: 403 });
    }
    console.error('POST /api/packages error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
