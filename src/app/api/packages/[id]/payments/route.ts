import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Profile } from '@/types/database';

/**
 * POST /api/packages/[id]/payments
 *
 * Records an installment payment towards a patient package.
 * The DB trigger sync_package_total_paid enforces the over-payment guard.
 *
 * Body: { amount, method, reference_number?, notes? }
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
      amount,
      method = 'cash',
      reference_number = null,
      notes = null,
    } = body as {
      amount: number;
      method?: string;
      reference_number?: string | null;
      notes?: string | null;
    };

    if (!amount || amount <= 0) {
      return NextResponse.json({ error: 'amount must be > 0' }, { status: 400 });
    }

    const adminClient = createAdminClient();

    // Fetch the package
    const { data: pkg } = await adminClient
      .from('patient_packages')
      .select('*')
      .eq('id', packageId)
      .single();

    if (!pkg) {
      return NextResponse.json({ error: 'Package not found' }, { status: 404 });
    }

    const pkgData = pkg as Record<string, unknown>;
    const branchId = pkgData.branch_id as string;

    if (pkgData.status !== 'active') {
      return NextResponse.json({ error: `Package is ${pkgData.status} — cannot accept payments` }, { status: 400 });
    }

    // Branch isolation
    if (caller.role !== 'owner' && caller.branch_id !== branchId) {
      return NextResponse.json({ error: 'Cannot make payments for another branch' }, { status: 403 });
    }

    // App-level check before the trigger does its enforcement
    const remainingBalance = (pkgData.total_price as number) - (pkgData.total_paid as number);
    if (amount > remainingBalance + 0.01) {
      return NextResponse.json({
        error: `Payment exceeds remaining balance. Balance: ₱${remainingBalance.toFixed(2)}, Payment: ₱${amount.toFixed(2)}`
      }, { status: 400 });
    }

    // Insert payment (DB trigger updates total_paid & enforces over-payment guard)
    const { data: payment, error: paymentError } = await adminClient
      .from('package_payments')
      .insert({
        package_id: packageId,
        branch_id: branchId,
        received_by: user.id,
        amount,
        method,
        reference_number: reference_number || null,
        notes: notes || null,
      } as Record<string, unknown>)
      .select('*')
      .single();

    if (paymentError) {
      // Check for the over-payment trigger error
      if (paymentError.message.includes('Payment rejected') || paymentError.code === '23514') {
        return NextResponse.json({
          error: 'Payment rejected: total payments would exceed the package total price.'
        }, { status: 400 });
      }
      return NextResponse.json({ error: paymentError.message }, { status: 500 });
    }

    // Audit log
    await adminClient.from('audit_logs').insert({
      user_id: user.id,
      branch_id: branchId,
      action_type: 'PACKAGE_PAYMENT',
      entity_type: 'package_payment',
      entity_id: (payment as Record<string, unknown>).id as string,
      description: `Payment of ₱${amount.toFixed(2)} received via ${method} for package ${packageId}`,
      metadata: { package_id: packageId, amount, method, reference_number },
    } as Record<string, unknown>);

    return NextResponse.json({ data: payment }, { status: 201 });
  } catch (error) {
    console.error('POST /api/packages/[id]/payments error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * GET /api/packages/[id]/payments
 *
 * Lists all payment records for a given package.
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

    const adminClient = createAdminClient();

    const { data, error } = await adminClient
      .from('package_payments')
      .select(`
        *,
        receiver:received_by (first_name, last_name)
      `)
      .eq('package_id', packageId)
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data: data || [] });
  } catch (error) {
    console.error('GET /api/packages/[id]/payments error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
