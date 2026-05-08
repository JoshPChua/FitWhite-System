import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  requireActiveProfile, enforceImusOnly, assertBranchAccess,
  isErrorResponse, jsonError,
} from '@/lib/api-helpers';
import { IMUS_ONLY, IMUS_BRANCH_CODE } from '@/lib/feature-flags';
import type { Profile } from '@/types/database';

/**
 * GET /api/packages?customer_id=X&status=active&branch_id=X
 *
 * Lists patient packages with optional filters.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const auth = await requireActiveProfile(supabase);
    if (isErrorResponse(auth)) return auth;
    const { profile: caller } = auth;

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

    // Branch isolation; IMUS_ONLY always forces Imus (ignores query param)
    if (IMUS_ONLY) {
      const { data: imusBranch } = await adminClient
        .from('branches').select('id').eq('code', IMUS_BRANCH_CODE).single();
      if (!imusBranch) return jsonError('Imus branch not found', 500);
      query = query.eq('branch_id', (imusBranch as Record<string, unknown>).id as string);
    } else if (caller.role !== 'owner') {
      query = query.eq('branch_id', caller.branch_id!);
    } else if (branchId) {
      query = query.eq('branch_id', branchId);
    }

    if (customerId) query = query.eq('customer_id', customerId);
    if (status) query = query.eq('status', status);

    const { data, error } = await query.limit(100);

    if (error) {
      return jsonError(error.message, 500);
    }

    return NextResponse.json({ data: data || [] });
  } catch (error) {
    console.error('GET /api/packages error:', error);
    return jsonError('Internal server error', 500);
  }
}

/**
 * POST /api/packages
 *
 * Creates a new patient package with strict validation and atomic downpayment.
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
    const auth = await requireActiveProfile(supabase);
    if (isErrorResponse(auth)) return auth;
    const { userId, profile: caller } = auth;

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

    // ─── Strict validation ───────────────────────────────────

    if (!branch_id || !customer_id || !service_id) {
      return jsonError('Required: branch_id, customer_id, service_id', 400);
    }

    if (typeof total_price !== 'number' || !Number.isFinite(total_price) || total_price <= 0) {
      return jsonError('total_price must be a finite number > 0', 400);
    }

    if (typeof downpayment !== 'number' || !Number.isFinite(downpayment) || downpayment < 0) {
      return jsonError('downpayment must be a finite number >= 0', 400);
    }

    if (downpayment > total_price) {
      return jsonError('downpayment cannot exceed total_price', 400);
    }

    if (typeof total_sessions !== 'number' || !Number.isInteger(total_sessions) || total_sessions < 1) {
      return jsonError('total_sessions must be an integer >= 1', 400);
    }

    // ─── Branch isolation ────────────────────────────────────

    const branchErr = assertBranchAccess(caller, branch_id, 'create packages');
    if (branchErr) return branchErr;

    const adminClient = createAdminClient();

    // Imus-only enforcement
    const imusGuard = await enforceImusOnly(adminClient, branch_id);
    if (imusGuard) return imusGuard;

    // ─── Validate service belongs to branch ──────────────────

    const { data: svcData } = await adminClient
      .from('services')
      .select('id')
      .eq('id', service_id)
      .eq('branch_id', branch_id)
      .eq('is_active', true)
      .single();

    if (!svcData) {
      return jsonError('Service not found, inactive, or not in this branch', 400);
    }

    // ─── Validate customer belongs to branch ─────────────────

    const { data: custData } = await adminClient
      .from('customers')
      .select('id')
      .eq('id', customer_id)
      .eq('branch_id', branch_id)
      .single();

    if (!custData) {
      return jsonError('Customer not found or not in this branch', 400);
    }

    // ─── Validate attending doctor if provided ───────────────

    if (attending_doctor_id) {
      const { data: docData } = await adminClient
        .from('doctors')
        .select('id, is_active, branch_id')
        .eq('id', attending_doctor_id)
        .single();

      if (!docData) {
        return jsonError('Attending doctor not found', 400);
      }
      const doc = docData as Record<string, unknown>;
      if (!(doc.is_active as boolean)) {
        return jsonError('Attending doctor is inactive', 400);
      }
      if (doc.branch_id !== branch_id) {
        return jsonError('Attending doctor does not belong to this branch', 400);
      }
    }

    // ─── Create the package ──────────────────────────────────

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
      return jsonError(pkgError.message, 500);
    }

    const pkgData = pkg as Record<string, unknown>;
    const pkgId = pkgData.id as string;

    // ─── Atomic downpayment: if insert fails, rollback package ──

    if (downpayment > 0) {
      const { error: ppError } = await adminClient.from('package_payments').insert({
        package_id: pkgId,
        branch_id,
        received_by: userId,
        amount: downpayment,
        method: 'cash', // default — the actual payment method is tracked in the sales.payments table
        notes: 'Initial downpayment at checkout',
      } as Record<string, unknown>);

      if (ppError) {
        // Rollback: delete the orphaned package
        console.error('package_payments insert failed, rolling back package:', ppError.message);
        await adminClient.from('patient_packages').delete().eq('id', pkgId);
        return jsonError(
          `Package payment recording failed: ${ppError.message}. Package was not created.`,
          500,
        );
      }
    }

    // Audit log (non-critical)
    await adminClient.from('audit_logs').insert({
      user_id: userId,
      branch_id,
      action_type: 'PACKAGE_CREATED',
      entity_type: 'patient_package',
      entity_id: pkgId,
      description: `Package created — ${total_sessions} sessions, total ₱${total_price}, downpayment ₱${downpayment}`,
      metadata: { service_id, customer_id, total_price, downpayment, total_sessions },
    } as Record<string, unknown>);

    return NextResponse.json({ data: pkg }, { status: 201 });
  } catch (error) {
    console.error('POST /api/packages error:', error);
    return jsonError('Internal server error', 500);
  }
}
