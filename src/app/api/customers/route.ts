import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { IMUS_ONLY, IMUS_BRANCH_CODE } from '@/lib/feature-flags';
import type { Profile } from '@/types/database';

/**
 * POST /api/customers — Create a new customer/patient
 * Requires: owner or manager role
 *
 * Branch enforcement:
 *   - IMUS_ONLY mode: ignores client branch_id, resolves Imus branch server-side
 *   - Multi-branch: validates branch_id exists and is active
 *   - Managers: can only create customers in their own branch
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user: currentUser } } = await supabase.auth.getUser();

    if (!currentUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: rawCaller } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', currentUser.id)
      .single();

    const callerProfile = rawCaller as Profile | null;

    if (!callerProfile || (callerProfile.role !== 'owner' && callerProfile.role !== 'manager')) {
      return NextResponse.json({ error: 'Forbidden: owner or manager required' }, { status: 403 });
    }

    const body = await request.json();
    const {
      branch_id: clientBranchId,
      first_name,
      last_name,
      email = null,
      phone = null,
      allergies = null,
      notes = null,
    } = body as {
      branch_id?: string;
      first_name: string;
      last_name: string;
      email?: string | null;
      phone?: string | null;
      allergies?: string | null;
      notes?: string | null;
    };

    // Validate required fields
    if (!first_name?.trim() || !last_name?.trim()) {
      return NextResponse.json(
        { error: 'First name and last name are required' },
        { status: 400 }
      );
    }

    const adminClient = createAdminClient();

    // ─── Resolve branch_id ──────────────────────────────────
    let resolvedBranchId: string;

    if (IMUS_ONLY) {
      // Imus-only: ignore client branch_id, resolve server-side
      const { data: imusBranch } = await adminClient
        .from('branches').select('id').eq('code', IMUS_BRANCH_CODE).single();
      if (!imusBranch) {
        return NextResponse.json(
          { error: 'Imus branch not found in database' },
          { status: 500 }
        );
      }
      resolvedBranchId = (imusBranch as Record<string, unknown>).id as string;
    } else {
      // Multi-branch mode
      if (!clientBranchId) {
        return NextResponse.json(
          { error: 'branch_id is required' },
          { status: 400 }
        );
      }

      // Validate branch exists and is active
      const { data: branch } = await adminClient
        .from('branches').select('id, is_active').eq('id', clientBranchId).single();
      if (!branch || !(branch as Record<string, unknown>).is_active) {
        return NextResponse.json(
          { error: 'Invalid or inactive branch' },
          { status: 400 }
        );
      }

      // Manager restriction: can only create in their own branch
      if (callerProfile.role === 'manager' && clientBranchId !== callerProfile.branch_id) {
        return NextResponse.json(
          { error: 'Managers can only create customers in their own branch' },
          { status: 403 }
        );
      }

      resolvedBranchId = clientBranchId;
    }

    // ─── Insert customer ────────────────────────────────────
    const { data: customer, error: insertError } = await adminClient
      .from('customers')
      .insert({
        branch_id: resolvedBranchId,
        first_name: first_name.trim(),
        last_name: last_name.trim(),
        email: email?.trim() || null,
        phone: phone?.trim() || null,
        allergies: allergies?.trim() || null,
        notes: notes?.trim() || null,
      } as Record<string, unknown>)
      .select('id, first_name, last_name')
      .single();

    if (insertError) {
      console.error('Customer creation error:', insertError);
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    // Audit log
    await adminClient.from('audit_logs').insert({
      user_id: currentUser.id,
      branch_id: resolvedBranchId,
      action_type: 'CREATE_CUSTOMER',
      entity_type: 'customer',
      entity_id: (customer as Record<string, unknown>).id as string,
      description: `Registered patient ${first_name.trim()} ${last_name.trim()}`,
      metadata: { branch_id: resolvedBranchId },
    } as Record<string, unknown>);

    return NextResponse.json({
      success: true,
      customer,
    });
  } catch (error) {
    console.error('POST /api/customers error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
