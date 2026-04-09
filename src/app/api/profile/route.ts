import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * PATCH /api/profile — Update own profile (name, avatar_url)
 * Any authenticated user can update their own profile.
 */
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { first_name, last_name, avatar_url } = body as {
      first_name?: string;
      last_name?: string;
      avatar_url?: string | null;
    };

    if (first_name !== undefined && !first_name.trim()) {
      return NextResponse.json({ error: 'First name cannot be empty' }, { status: 400 });
    }
    if (last_name !== undefined && !last_name.trim()) {
      return NextResponse.json({ error: 'Last name cannot be empty' }, { status: 400 });
    }

    const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (first_name !== undefined) updatePayload.first_name = first_name.trim();
    if (last_name !== undefined) updatePayload.last_name = last_name.trim();
    if (avatar_url !== undefined) updatePayload.avatar_url = avatar_url;

    const adminClient = createAdminClient();
    const { data: updated, error } = await adminClient
      .from('profiles').update(updatePayload).eq('id', user.id).select('*').single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await adminClient.from('audit_logs').insert({
      user_id: user.id,
      action_type: 'PROFILE_UPDATED',
      entity_type: 'profile',
      entity_id: user.id,
      description: `Profile updated`,
    } as Record<string, unknown>);

    return NextResponse.json({ profile: updated });
  } catch (err) {
    console.error('PATCH /api/profile error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/profile/change-password — Change own password
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { password } = body as { password: string };

    if (!password || password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    const adminClient = createAdminClient();
    const { error } = await adminClient.auth.admin.updateUserById(user.id, { password });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await adminClient.from('audit_logs').insert({
      user_id: user.id,
      action_type: 'PASSWORD_CHANGED',
      entity_type: 'profile',
      entity_id: user.id,
      description: 'Password changed',
    } as Record<string, unknown>);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('POST /api/profile error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
