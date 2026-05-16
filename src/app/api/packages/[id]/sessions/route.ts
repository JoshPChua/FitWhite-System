import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  requireActiveProfile, enforceImusOnly, isErrorResponse, jsonError,
} from '@/lib/api-helpers';

const VALID_PAYMENT_METHODS = ['cash', 'gcash', 'card', 'bank_transfer'] as const;

/**
 * POST /api/packages/[id]/sessions
 *
 * Combined "Record Visit" endpoint — **fully atomic**.
 *
 * ALL writes (session, BOM, commission, sale, sale_items, payment,
 * package_payment) happen inside a single Postgres RPC transaction
 * (`record_package_visit`). If any step fails, the entire transaction
 * rolls back — no session is consumed, no payment is recorded.
 *
 * The RPC validates everything before writing:
 *   - Package status must be 'active'
 *   - Branch must match
 *   - Sufficient sessions remaining
 *   - Sufficient BOM stock
 *   - Payment does not exceed remaining balance
 *
 * remaining_balance is a GENERATED ALWAYS column and is never manually updated.
 * total_paid is synced by the package_payments insert trigger inside the RPC.
 *
 * Body: {
 *   sessions_count?: number,       // default 1
 *   doctor_id?: string | null,
 *   notes?: string | null,
 *   payment_amount?: number,       // 0 = session only, >0 = session + payment
 *   payment_method?: string,       // 'cash' | 'gcash' | 'card' | 'bank_transfer'
 *   reference_number?: string,     // optional payment reference
 * }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: packageId } = await params;
    const supabase = await createClient();
    const auth = await requireActiveProfile(supabase);
    if (isErrorResponse(auth)) return auth;
    const { userId, profile: caller } = auth;

    // Auditor is view-only — cannot record visits
    if (caller.role === 'auditor') {
      return jsonError('Auditors cannot record package visits', 403);
    }

    const body = await request.json();
    const {
      sessions_count = 1,
      doctor_id = null,
      notes = null,
      payment_amount = 0,
      payment_method = 'cash',
      reference_number = null,
    } = body as {
      sessions_count?: number;
      doctor_id?: string | null;
      notes?: string | null;
      payment_amount?: number;
      payment_method?: string;
      reference_number?: string | null;
    };

    // ─── Input validation (app-level, before hitting DB) ─────
    if (typeof sessions_count !== 'number' || !Number.isFinite(sessions_count) || !Number.isInteger(sessions_count) || sessions_count < 1) {
      return jsonError('sessions_count must be a finite integer >= 1', 400);
    }

    if (typeof payment_amount !== 'number' || !Number.isFinite(payment_amount) || payment_amount < 0) {
      return jsonError('payment_amount must be a finite number >= 0', 400);
    }

    if (payment_amount > 0 && !VALID_PAYMENT_METHODS.includes(payment_method as typeof VALID_PAYMENT_METHODS[number])) {
      return jsonError(`payment_method must be one of: ${VALID_PAYMENT_METHODS.join(', ')}`, 400);
    }

    const adminClient = createAdminClient();

    // ─── Fetch package for branch guard + service name ────────
    const { data: pkg } = await adminClient
      .from('patient_packages')
      .select('branch_id, customer_id, services:service_id(name), customers:customer_id(first_name, last_name)')
      .eq('id', packageId)
      .single();

    if (!pkg) {
      return jsonError('Package not found', 404);
    }

    const pkgData = pkg as Record<string, unknown>;
    const branchId = pkgData.branch_id as string;

    // Imus-only guard
    const imusGuard = await enforceImusOnly(adminClient, branchId);
    if (imusGuard) return imusGuard;

    // Branch isolation (app-level, RPC also validates)
    if (caller.role !== 'owner' && caller.branch_id !== branchId) {
      return jsonError('Cannot consume sessions for another branch', 403);
    }

    // ─── Generate receipt number (if payment) ────────────────
    let receiptNumber: string | null = null;

    if (payment_amount > 0) {
      const { data: branchInfo } = await adminClient
        .from('branches').select('code').eq('id', branchId).single();
      const branchCode = branchInfo ? (branchInfo as Record<string, unknown>).code as string : 'FW';

      const { data: receiptData, error: receiptErr } = await adminClient
        .rpc('generate_receipt_number', { branch_code: branchCode });

      if (receiptErr || !receiptData) {
        const now = new Date();
        const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
        const rand = String(Math.floor(Math.random() * 9000) + 1000);
        receiptNumber = `${branchCode}-${dateStr}-${rand}`;
      } else {
        receiptNumber = receiptData as string;
      }
    }

    // ─── Derive service name + customer name for sale record ──
    const serviceName = (pkgData.services as Record<string, unknown>)?.name as string || 'Package Service';
    const customerName = pkgData.customers
      ? `${(pkgData.customers as Record<string, unknown>).first_name} ${(pkgData.customers as Record<string, unknown>).last_name}`
      : 'Walk-in';

    // ─── Call atomic RPC ─────────────────────────────────────
    // Everything (session, BOM, commission, sale, payment, package_payment)
    // is handled in ONE Postgres transaction. Any failure = full rollback.
    const { data: result, error: rpcError } = await adminClient
      .rpc('record_package_visit', {
        p_package_id:       packageId,
        p_branch_id:        branchId,
        p_performed_by:     userId,
        p_doctor_id:        doctor_id || null,
        p_sessions_count:   sessions_count,
        p_notes:            notes || null,
        p_payment_amount:   payment_amount,
        p_payment_method:   payment_method,
        p_reference_number: reference_number || null,
        p_receipt_number:   receiptNumber,
        p_customer_id:      pkgData.customer_id || null,
        p_service_name:     `${serviceName} (${customerName})`,
      });

    if (rpcError) {
      // Map known RPC errors to user-friendly responses
      const msg = rpcError.message;
      if (msg.includes('Package not found'))       return jsonError('Package not found', 404);
      if (msg.includes('cannot consume sessions')) return jsonError(msg, 400);
      if (msg.includes('Branch mismatch'))         return jsonError('Branch mismatch', 403);
      if (msg.includes('Insufficient sessions'))   return jsonError(msg, 400);
      if (msg.includes('Insufficient stock'))      return jsonError(msg, 400);
      if (msg.includes('exceeds remaining'))       return jsonError(msg, 400);
      if (msg.includes('Payment rejected'))        return jsonError(msg, 400);
      if (msg.includes('Doctor'))                  return jsonError(msg, 400);
      console.error('record_package_visit RPC error:', rpcError);
      return jsonError(msg, 500);
    }

    const rpcResult = result as Record<string, unknown>;

    // ─── Audit Log (non-critical, outside the transaction) ───
    const auditDesc = payment_amount > 0
      ? `${sessions_count} session(s) consumed + ₱${payment_amount.toFixed(2)} installment payment. ${rpcResult.sessions_remaining} sessions remaining.${rpcResult.auto_completed ? ' Package auto-completed.' : ''}`
      : `${sessions_count} session(s) consumed from package. ${rpcResult.sessions_remaining} remaining.${rpcResult.auto_completed ? ' Package auto-completed.' : ''}`;

    await adminClient.from('audit_logs').insert({
      user_id: userId,
      branch_id: branchId,
      action_type: payment_amount > 0 ? 'SESSION_AND_PAYMENT' : 'SESSION_CONSUMED',
      entity_type: 'package_session',
      entity_id: rpcResult.session_id as string,
      description: auditDesc,
      metadata: {
        package_id: packageId,
        sessions_count,
        doctor_id,
        payment_amount: payment_amount > 0 ? payment_amount : undefined,
        sale_id: rpcResult.sale_id || undefined,
        receipt_number: rpcResult.receipt_number || undefined,
      },
    } as Record<string, unknown>);

    return NextResponse.json({
      data: {
        session_id: rpcResult.session_id,
        sessions_remaining: rpcResult.sessions_remaining,
        auto_completed: rpcResult.auto_completed,
        payment_recorded: rpcResult.payment_recorded,
        receipt_number: rpcResult.receipt_number || null,
      },
    }, { status: 201 });
  } catch (error) {
    console.error('POST /api/packages/[id]/sessions error:', error);
    return jsonError('Internal server error', 500);
  }
}

/**
 * GET /api/packages/[id]/sessions
 *
 * Lists all session records for a given package.
 * Requires caller profile lookup + branch isolation.
 *
 * Hardened: Imus-only guard.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: packageId } = await params;
    const supabase = await createClient();
    const auth = await requireActiveProfile(supabase);
    if (isErrorResponse(auth)) return auth;
    const { profile: caller } = auth;

    const adminClient = createAdminClient();

    // Fetch package for branch isolation
    const { data: pkg } = await adminClient
      .from('patient_packages')
      .select('branch_id')
      .eq('id', packageId)
      .single();

    if (!pkg) {
      return jsonError('Package not found', 404);
    }

    const pkgBranch = (pkg as Record<string, unknown>).branch_id as string;

    // Imus-only guard
    const imusGuard = await enforceImusOnly(adminClient, pkgBranch);
    if (imusGuard) return imusGuard;

    // Branch isolation: non-owners can only see their own branch
    if (caller.role !== 'owner' && caller.branch_id !== pkgBranch) {
      return jsonError('Access denied: package belongs to another branch', 403);
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
      return jsonError(error.message, 500);
    }

    return NextResponse.json({ data: data || [] });
  } catch (error) {
    console.error('GET /api/packages/[id]/sessions error:', error);
    return jsonError('Internal server error', 500);
  }
}
