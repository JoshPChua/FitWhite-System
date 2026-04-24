import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Profile } from '@/types/database';

/**
 * POST /api/packages/[id]/sessions
 *
 * Consumes session(s) from a patient package.
 * Auto-deducts service BOM consumables from inventory.
 * Auto-creates doctor commission if attending doctor is specified.
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

    if (pkgData.status !== 'active') {
      return NextResponse.json({ error: `Package is ${pkgData.status} — cannot consume sessions` }, { status: 400 });
    }

    const branchId = pkgData.branch_id as string;

    // Branch isolation
    if (caller.role !== 'owner' && caller.branch_id !== branchId) {
      return NextResponse.json({ error: 'Cannot consume sessions for another branch' }, { status: 403 });
    }

    const sessionsRemaining = (pkgData.total_sessions as number) - (pkgData.sessions_used as number);
    if (sessions_count > sessionsRemaining) {
      return NextResponse.json({
        error: `Insufficient sessions. Remaining: ${sessionsRemaining}, Requested: ${sessions_count}`
      }, { status: 400 });
    }

    // Insert session record (trigger sync_package_sessions_used will update the package)
    const { data: session, error: sessionError } = await adminClient
      .from('package_sessions')
      .insert({
        package_id: packageId,
        branch_id: branchId,
        performed_by: user.id,
        doctor_id: doctor_id || null,
        sessions_count,
        notes: notes || null,
      } as Record<string, unknown>)
      .select('*')
      .single();

    if (sessionError) {
      return NextResponse.json({ error: sessionError.message }, { status: 500 });
    }

    const sessionData = session as Record<string, unknown>;
    const serviceId = pkgData.service_id as string;

    // ── BOM deduction: auto-deduct consumables for this service ──
    const { data: bomItems } = await adminClient
      .from('service_consumables')
      .select('product_id, quantity')
      .eq('service_id', serviceId);

    if (bomItems && bomItems.length > 0) {
      for (const bomItem of bomItems as Record<string, unknown>[]) {
        const productId = bomItem.product_id as string;
        const bomQty = (bomItem.quantity as number) * sessions_count;

        // Get current inventory
        const { data: inv } = await adminClient
          .from('inventory')
          .select('id, quantity')
          .eq('product_id', productId)
          .eq('branch_id', branchId)
          .single();

        if (inv) {
          const invData = inv as Record<string, unknown>;
          const currentQty = invData.quantity as number;
          const newQty = Math.max(0, currentQty - bomQty);

          // Update inventory
          await adminClient
            .from('inventory')
            .update({ quantity: newQty } as Record<string, unknown>)
            .eq('id', invData.id as string);

          // Write inventory_logs
          await adminClient.from('inventory_logs').insert({
            inventory_id: invData.id as string,
            product_id: productId,
            branch_id: branchId,
            performed_by: user.id,
            source: 'service_bom',
            quantity_delta: -bomQty,
            quantity_before: currentQty,
            quantity_after: newQty,
            package_session_id: sessionData.id as string,
            notes: `BOM deduction for session on package ${packageId}`,
          } as Record<string, unknown>);
        }
      }
    }

    // ── Doctor commission (Phase 5: use standalone doctors table) ──
    if (doctor_id) {
      const { data: doctorRecord } = await adminClient
        .from('doctors')
        .select('id, full_name, default_commission_type, default_commission_value')
        .eq('id', doctor_id)
        .single();

      if (doctorRecord) {
        const doc = doctorRecord as Record<string, unknown>;
        const grossAmount = Number(pkgData.total_price) / Number(pkgData.total_sessions) * sessions_count;
        const defType = doc.default_commission_type as string;
        const defVal = Number(doc.default_commission_value) || 0;
        let commAmount = 0;
        let commRate: number | null = null;

        if (defType === 'fixed') {
          commAmount = defVal;
        } else {
          commRate = defVal;
          commAmount = grossAmount * defVal;
        }

        if (commAmount > 0) {
          const { error: commError } = await adminClient.from('doctor_commissions').insert({
            branch_id: branchId,
            doctor_id,
            package_session_id: sessionData.id as string,
            gross_amount: grossAmount,
            commission_rate: commRate,
            commission_amount: Math.round(commAmount * 100) / 100,
          } as Record<string, unknown>);
          if (commError) {
            console.error('Session commission insert error:', commError.message);
          }
        }
      }
    }

    // Check if all sessions consumed — auto-complete
    const newSessionsUsed = (pkgData.sessions_used as number) + sessions_count;
    if (newSessionsUsed >= (pkgData.total_sessions as number)) {
      await adminClient
        .from('patient_packages')
        .update({ status: 'completed' } as Record<string, unknown>)
        .eq('id', packageId);
    }

    // Audit log
    await adminClient.from('audit_logs').insert({
      user_id: user.id,
      branch_id: branchId,
      action_type: 'SESSION_CONSUMED',
      entity_type: 'package_session',
      entity_id: sessionData.id as string,
      description: `${sessions_count} session(s) consumed from package. ${sessionsRemaining - sessions_count} remaining.`,
      metadata: { package_id: packageId, sessions_count, doctor_id },
    } as Record<string, unknown>);

    return NextResponse.json({ data: session }, { status: 201 });
  } catch (error) {
    console.error('POST /api/packages/[id]/sessions error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * GET /api/packages/[id]/sessions
 *
 * Lists all session records for a given package.
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
