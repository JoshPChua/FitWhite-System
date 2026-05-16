import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  requireActiveProfile, enforceImusOnly, isErrorResponse, jsonError,
} from '@/lib/api-helpers';

/**
 * POST /api/packages/[id]/sessions
 *
 * Combined "Record Visit" endpoint:
 *   1. Consumes session(s) from a patient package via atomic Postgres RPC
 *   2. Optionally records an installment payment (if payment_amount > 0)
 *      - Creates a proper sale record with receipt number (visible in Sales page)
 *      - Creates sale_items entry for the service
 *      - Creates payment entry
 *      - Updates package_payments ledger + package totals
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

    if (sessions_count < 1) {
      return jsonError('sessions_count must be >= 1', 400);
    }

    const adminClient = createAdminClient();

    // Fetch the package with full details for payment processing
    const { data: pkg } = await adminClient
      .from('patient_packages')
      .select('*, services:service_id(name), customers:customer_id(first_name, last_name)')
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

    // Branch isolation
    if (caller.role !== 'owner' && caller.branch_id !== branchId) {
      return jsonError('Cannot consume sessions for another branch', 403);
    }

    // ─── 1. Consume Session(s) via Atomic RPC ───────────────────
    const { data: result, error: rpcError } = await adminClient
      .rpc('consume_package_session', {
        p_package_id: packageId,
        p_branch_id: branchId,
        p_performed_by: userId,
        p_doctor_id: doctor_id || null,
        p_sessions_count: sessions_count,
        p_notes: notes || null,
      });

    if (rpcError) {
      return jsonError(rpcError.message, 500);
    }

    const rpcResult = result as Record<string, unknown>;
    let saleRecord: Record<string, unknown> | null = null;

    // ─── 2. Installment Payment (if amount > 0) ────────────────
    if (payment_amount > 0) {
      const serviceName = (pkgData.services as Record<string, unknown>)?.name as string || 'Package Service';
      const customerName = pkgData.customers
        ? `${(pkgData.customers as Record<string, unknown>).first_name} ${(pkgData.customers as Record<string, unknown>).last_name}`
        : 'Walk-in';

      // Generate receipt number
      const { data: branchInfo } = await adminClient
        .from('branches').select('code').eq('id', branchId).single();
      const branchCode = branchInfo ? (branchInfo as Record<string, unknown>).code as string : 'FW';

      let receiptNumber = '';
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

      // Create sale record (visible in Sales page + Reports)
      const { data: saleData, error: saleError } = await adminClient
        .from('sales')
        .insert({
          receipt_number: receiptNumber,
          branch_id: branchId,
          user_id: userId,
          customer_id: pkgData.customer_id || null,
          subtotal: payment_amount,
          discount: 0,
          tax: 0,
          total: payment_amount,
          status: 'completed',
          payment_type: 'full',
          notes: `Installment payment — ${serviceName} (${customerName})`,
        } as Record<string, unknown>)
        .select('id, receipt_number')
        .single();

      if (saleError) {
        console.error('Installment sale creation error:', saleError);
        // Session was already consumed — log the error but don't fail completely
        // The payment can be recorded separately
      } else {
        saleRecord = saleData as Record<string, unknown>;
        const saleId = saleRecord.id as string;

        // Create sale_items entry
        await adminClient.from('sale_items').insert({
          sale_id: saleId,
          item_type: 'service',
          item_id: pkgData.service_id,
          name: `${serviceName} — Installment Payment`,
          quantity: 1,
          unit_price: payment_amount,
          total_price: payment_amount,
        } as Record<string, unknown>);

        // Create payment entry
        await adminClient.from('payments').insert({
          sale_id: saleId,
          method: payment_method,
          amount: payment_amount,
          reference_number: reference_number || null,
        } as Record<string, unknown>);
      }

      // Record in package_payments ledger (ALWAYS — even if sale failed)
      const { error: ppError } = await adminClient.from('package_payments').insert({
        package_id: packageId,
        branch_id: branchId,
        received_by: userId,
        amount: payment_amount,
        method: payment_method,
        reference_number: reference_number || null,
        notes: saleRecord
          ? `Installment payment — Receipt ${(saleRecord as Record<string, unknown>).receipt_number}`
          : `Installment payment`,
      } as Record<string, unknown>);

      if (ppError) {
        console.error('Package payment ledger error:', ppError);
      }

      // Update package totals
      const newTotalPaid = Number(pkgData.total_paid) + payment_amount;
      const newBalance = Math.max(0, Number(pkgData.total_price) - newTotalPaid);
      await adminClient.from('patient_packages').update({
        total_paid: newTotalPaid,
        remaining_balance: newBalance,
      } as Record<string, unknown>).eq('id', packageId);
    }

    // ─── 3. Audit Log ──────────────────────────────────────────
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
        sale_id: saleRecord ? (saleRecord as Record<string, unknown>).id : undefined,
        receipt_number: saleRecord ? (saleRecord as Record<string, unknown>).receipt_number : undefined,
      },
    } as Record<string, unknown>);

    return NextResponse.json({
      data: {
        ...rpcResult,
        payment_recorded: payment_amount > 0,
        receipt_number: saleRecord ? (saleRecord as Record<string, unknown>).receipt_number : null,
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
