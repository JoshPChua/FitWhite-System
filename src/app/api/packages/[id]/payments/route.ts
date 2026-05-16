import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  requireActiveProfile, enforceImusOnly, isErrorResponse, jsonError,
} from '@/lib/api-helpers';

const VALID_PAYMENT_METHODS = ['cash', 'gcash', 'card', 'bank_transfer'] as const;

/**
 * POST /api/packages/[id]/payments
 *
 * Records an installment payment towards a patient package.
 * The DB trigger sync_package_total_paid enforces the over-payment guard.
 *
 * Body: { amount, method, reference_number?, notes? }
 *
 * Hardened: Imus-only guard on the package's branch.
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

    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      return jsonError('amount must be a finite number > 0', 400);
    }

    if (!VALID_PAYMENT_METHODS.includes(method as typeof VALID_PAYMENT_METHODS[number])) {
      return jsonError(`method must be one of: ${VALID_PAYMENT_METHODS.join(', ')}`, 400);
    }

    const adminClient = createAdminClient();

    // Fetch the package with service + customer info for receipt
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

    if (pkgData.status !== 'active') {
      return jsonError(`Package is ${pkgData.status} — cannot accept payments`, 400);
    }

    // Branch isolation
    if (caller.role !== 'owner' && caller.branch_id !== branchId) {
      return jsonError('Cannot make payments for another branch', 403);
    }

    // App-level check before the trigger does its enforcement
    const remainingBalance = (pkgData.total_price as number) - (pkgData.total_paid as number);
    if (amount > remainingBalance + 0.01) {
      return jsonError(
        `Payment exceeds remaining balance. Balance: ₱${remainingBalance.toFixed(2)}, Payment: ₱${amount.toFixed(2)}`,
        400,
      );
    }

    // ─── Create Sale + Receipt for audit trail ──────────────────
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

    // ── Rollback helper for payment sub-writes ──
    let createdSaleId: string | null = null;
    let createdSaleItemId: string | null = null;
    let createdPaymentId: string | null = null;

    const rollbackSale = async () => {
      try {
        if (createdPaymentId) await adminClient.from('payments').delete().eq('id', createdPaymentId);
        if (createdSaleItemId) await adminClient.from('sale_items').delete().eq('id', createdSaleItemId);
        if (createdSaleId) await adminClient.from('sales').delete().eq('id', createdSaleId);
      } catch (rbErr) {
        console.error('Sale rollback error (may be partially written):', rbErr);
      }
    };

    // Create sale record (visible in Sales page + Customer transactions + Reports)
    const { data: saleData, error: saleError } = await adminClient
      .from('sales')
      .insert({
        receipt_number: receiptNumber,
        branch_id: branchId,
        user_id: userId,
        customer_id: pkgData.customer_id || null,
        subtotal: amount,
        discount: 0,
        tax: 0,
        total: amount,
        status: 'completed',
        payment_type: 'installment',
        notes: `Installment payment — ${serviceName} (${customerName})`,
      } as Record<string, unknown>)
      .select('id, receipt_number')
      .single();

    if (saleError) {
      console.error('Installment sale creation error:', saleError);
      return jsonError(`Failed to create sale record: ${saleError.message}`, 500);
    }

    const saleRecord = saleData as Record<string, unknown>;
    createdSaleId = saleRecord.id as string;

    // Create sale_items entry
    const { data: saleItemData, error: saleItemError } = await adminClient.from('sale_items').insert({
      sale_id: createdSaleId,
      item_type: 'service',
      service_id: pkgData.service_id,
      name: `${serviceName} — Installment Payment`,
      quantity: 1,
      unit_price: amount,
      total_price: amount,
    } as Record<string, unknown>).select('id').single();

    if (saleItemError) {
      console.error('sale_items insert failed, rolling back sale:', saleItemError.message);
      await rollbackSale();
      return jsonError(`Failed to create sale item: ${saleItemError.message}`, 500);
    }
    createdSaleItemId = (saleItemData as Record<string, unknown>).id as string;

    // Create payment entry
    const { data: paymentInsertData, error: paymentInsertError } = await adminClient.from('payments').insert({
      sale_id: createdSaleId,
      method,
      amount,
      reference_number: reference_number || null,
    } as Record<string, unknown>).select('id').single();

    if (paymentInsertError) {
      console.error('payments insert failed, rolling back sale:', paymentInsertError.message);
      await rollbackSale();
      return jsonError(`Failed to create payment record: ${paymentInsertError.message}`, 500);
    }
    createdPaymentId = (paymentInsertData as Record<string, unknown>).id as string;

    // ─── Insert package payment (DB trigger updates total_paid) ──
    const { data: payment, error: paymentError } = await adminClient
      .from('package_payments')
      .insert({
        package_id: packageId,
        branch_id: branchId,
        received_by: userId,
        amount,
        method,
        reference_number: reference_number || null,
        notes: `Installment payment — Receipt ${saleRecord.receipt_number}`,
      } as Record<string, unknown>)
      .select('*')
      .single();

    if (paymentError) {
      // Rollback sale records since the ledger entry failed
      await rollbackSale();
      // Check for the over-payment trigger error
      if (paymentError.message.includes('Payment rejected') || paymentError.code === '23514') {
        return jsonError(
          'Payment rejected: total payments would exceed the package total price.',
          400,
        );
      }
      return jsonError(paymentError.message, 500);
    }

    // Audit log
    await adminClient.from('audit_logs').insert({
      user_id: userId,
      branch_id: branchId,
      action_type: 'PACKAGE_PAYMENT',
      entity_type: 'package_payment',
      entity_id: (payment as Record<string, unknown>).id as string,
      description: `Payment of ₱${amount.toFixed(2)} received via ${method} for package ${packageId} — Receipt ${saleRecord.receipt_number}`,
      metadata: { package_id: packageId, amount, method, reference_number, receipt_number: saleRecord.receipt_number },
    } as Record<string, unknown>);

    return NextResponse.json({ data: payment, receipt_number: saleRecord.receipt_number }, { status: 201 });
  } catch (error) {
    console.error('POST /api/packages/[id]/payments error:', error);
    return jsonError('Internal server error', 500);
  }
}


/**
 * GET /api/packages/[id]/payments
 *
 * Lists all payment records for a given package.
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
      .from('package_payments')
      .select(`
        *,
        receiver:received_by (first_name, last_name)
      `)
      .eq('package_id', packageId)
      .order('created_at', { ascending: false });

    if (error) {
      return jsonError(error.message, 500);
    }

    return NextResponse.json({ data: data || [] });
  } catch (error) {
    console.error('GET /api/packages/[id]/payments error:', error);
    return jsonError('Internal server error', 500);
  }
}
