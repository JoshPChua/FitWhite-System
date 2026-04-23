import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertImusOnlyBranch, IMUS_ONLY, IMUS_BRANCH_CODE } from '@/lib/feature-flags';
import type { Profile, UserRole } from '@/types/database';

/**
 * POST /api/users — Create a new staff user
 * Requires: owner or manager role
 * Uses service role to create auth.users entry, then updates the profile
 *
 * Phase 4 enhancements:
 *   - Imus-only branch guard
 *   - is_doctor / default_commission_rate support
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user: currentUser } } = await supabase.auth.getUser();

    if (!currentUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify caller is owner or manager
    const { data: rawCaller } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', currentUser.id)
      .single();

    const callerProfile = rawCaller as Profile | null;

    if (!callerProfile || (callerProfile.role !== 'owner' && callerProfile.role !== 'manager')) {
      return NextResponse.json({ error: 'Forbidden: insufficient permissions' }, { status: 403 });
    }

    const body = await request.json();
    const {
      email, password, first_name, last_name, role, branch_id,
      is_doctor = false, default_commission_rate = null,
    } = body as {
      email: string;
      password: string;
      first_name: string;
      last_name: string;
      role: UserRole;
      branch_id: string;
      is_doctor?: boolean;
      default_commission_rate?: number | null;
    };

    // Validate required fields
    if (!email || !password || !first_name || !last_name || !role || !branch_id) {
      return NextResponse.json(
        { error: 'All fields are required: email, password, first_name, last_name, role, branch_id' },
        { status: 400 }
      );
    }

    // ─── Imus-only branch guard ──────────────────────────────
    const adminClient = createAdminClient();

    if (IMUS_ONLY) {
      const { data: imusBranch } = await adminClient
        .from('branches').select('id').eq('code', IMUS_BRANCH_CODE).single();
      const imusBranchId = imusBranch ? (imusBranch as Record<string, unknown>).id as string : null;
      try {
        assertImusOnlyBranch(branch_id, imusBranchId);
      } catch {
        return NextResponse.json(
          { error: 'This installation is restricted to the Imus branch' },
          { status: 403 }
        );
      }
    }

    // Managers can only create cashiers in their own branch
    if (callerProfile.role === 'manager') {
      if (role !== 'cashier') {
        return NextResponse.json(
          { error: 'Managers can only create cashier/staff accounts' },
          { status: 403 }
        );
      }
      if (branch_id !== callerProfile.branch_id) {
        return NextResponse.json(
          { error: 'Managers can only create staff in their own branch' },
          { status: 403 }
        );
      }
    }

    // Use admin client to create auth user
    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        first_name,
        last_name,
        role,
      },
    });

    if (authError) {
      console.error('Auth user creation error:', authError);
      return NextResponse.json(
        { error: authError.message || 'Failed to create auth user' },
        { status: 400 }
      );
    }

    if (!authData.user) {
      return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
    }

    // Normalize commission rate: convert percentage (e.g. 30) to decimal (0.30)
    let commissionRate: number | null = null;
    if (is_doctor && default_commission_rate !== null && default_commission_rate !== undefined) {
      commissionRate = default_commission_rate > 1
        ? default_commission_rate / 100
        : default_commission_rate;
    }

    // Update the profile with branch, role, and doctor fields (trigger creates a basic profile)
    const { error: profileError } = await adminClient
      .from('profiles')
      .update({
        first_name,
        last_name,
        role,
        branch_id,
        is_active: true,
        is_doctor: !!is_doctor,
        default_commission_rate: commissionRate,
      })
      .eq('id', authData.user.id);

    if (profileError) {
      console.error('Profile update error:', profileError);
      // Try to clean up the auth user
      await adminClient.auth.admin.deleteUser(authData.user.id);
      return NextResponse.json(
        { error: 'Failed to configure user profile. User creation rolled back.' },
        { status: 500 }
      );
    }

    // Log the action
    await adminClient.from('audit_logs').insert({
      user_id: currentUser.id,
      branch_id,
      action_type: 'CREATE_USER',
      entity_type: 'user',
      entity_id: authData.user.id,
      description: `Created user ${first_name} ${last_name} (${role}${is_doctor ? ', doctor' : ''}) for branch`,
      metadata: { email, role, branch_id, is_doctor, default_commission_rate: commissionRate },
    });

    return NextResponse.json({
      success: true,
      user: {
        id: authData.user.id,
        email,
        first_name,
        last_name,
        role,
        branch_id,
        is_doctor: !!is_doctor,
        default_commission_rate: commissionRate,
      },
    });
  } catch (error) {
    console.error('User creation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
