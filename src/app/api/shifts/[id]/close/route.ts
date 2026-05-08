import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  requireActiveProfile, enforceImusOnly, isErrorResponse, jsonError,
} from '@/lib/api-helpers';

/**
 * POST /api/shifts/[id]/close
 *
 * Closes an open shift. Accepts closing_cash, computes expected_cash from
 * sales + cash movements during that shift, and records the variance.
 *
 * Body: { closing_cash, notes? }
 *
 * Hardened:
 *   - Imus-only guard on the shift's branch
 *   - Uses shared api-helpers for auth and error responses
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: shiftId } = await params;
    const supabase = await createClient();
    const auth = await requireActiveProfile(supabase);
    if (isErrorResponse(auth)) return auth;
    const { userId, profile: caller } = auth;

    if (caller.role !== 'owner' && caller.role !== 'manager') {
      return jsonError('Manager or owner required to close shifts', 403);
    }

    const body = await request.json();
    const { closing_cash, notes = null } = body as {
      closing_cash: number;
      notes?: string | null;
    };

    if (closing_cash === undefined || closing_cash < 0) {
      return jsonError('closing_cash is required and must be >= 0', 400);
    }

    const adminClient = createAdminClient();

    // Fetch the shift
    const { data: shift } = await adminClient
      .from('shifts')
      .select('*')
      .eq('id', shiftId)
      .eq('status', 'open')
      .single();

    if (!shift) {
      return jsonError('Open shift not found', 404);
    }

    const shiftData = shift as Record<string, unknown>;
    const branchId = shiftData.branch_id as string;
    const openingCash = shiftData.opening_cash as number;

    // Imus-only guard on the shift's branch
    const imusGuard = await enforceImusOnly(adminClient, branchId);
    if (imusGuard) return imusGuard;

    // Branch isolation for managers
    if (caller.role === 'manager' && caller.branch_id !== branchId) {
      return jsonError('Cannot close shifts for another branch', 403);
    }

    // Compute expected cash: fetch sales linked to this shift, then their cash payments
    const { data: shiftSales } = await adminClient
      .from('sales')
      .select('id, total')
      .eq('shift_id', shiftId)
      .in('status', ['completed', 'partial_refund']);

    const saleIds = (shiftSales || []).map((s: Record<string, unknown>) => s.id as string);

    let totalCashIn = 0;
    if (saleIds.length > 0) {
      const { data: payments } = await adminClient
        .from('payments')
        .select('amount, change_amount')
        .eq('method', 'cash')
        .in('sale_id', saleIds);

      totalCashIn = (payments || []).reduce((sum: number, p: Record<string, unknown>) => {
        return sum + Number(p.amount) - Number(p.change_amount || 0);
      }, 0);
    }

    // Cash movements during this shift
    const { data: movements } = await adminClient
      .from('cash_movements')
      .select('movement_type, amount')
      .eq('shift_id', shiftId);

    let movementNet = 0;
    for (const mv of (movements || []) as Record<string, unknown>[]) {
      const type = mv.movement_type as string;
      const amt = Number(mv.amount);
      if (type === 'cash_in' || type === 'opening_float') {
        movementNet += amt;
      } else {
        movementNet -= amt; // petty_cash_out, bank_deposit
      }
    }

    const expectedCash = openingCash + totalCashIn + movementNet;

    // Close the shift
    const { data: closedShift, error: closeError } = await adminClient
      .from('shifts')
      .update({
        closing_cash: closing_cash,
        expected_cash: expectedCash,
        closed_by: userId,
        status: 'closed',
        notes: notes || null,
        closed_at: new Date().toISOString(),
      } as Record<string, unknown>)
      .eq('id', shiftId)
      .select('*')
      .single();

    if (closeError) {
      return jsonError(closeError.message, 500);
    }

    // Audit log
    const variance = closing_cash - expectedCash;
    await adminClient.from('audit_logs').insert({
      user_id: userId,
      branch_id: branchId,
      action_type: 'SHIFT_CLOSED',
      entity_type: 'shift',
      entity_id: shiftId,
      description: `Shift closed. Expected: ₱${expectedCash.toFixed(2)}, Actual: ₱${closing_cash.toFixed(2)}, Variance: ₱${variance.toFixed(2)}`,
      metadata: { expected_cash: expectedCash, closing_cash, variance },
    } as Record<string, unknown>);

    return NextResponse.json({ data: closedShift });
  } catch (error) {
    console.error('POST /api/shifts/[id]/close error:', error);
    return jsonError('Internal server error', 500);
  }
}
