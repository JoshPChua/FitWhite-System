import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Profile } from '@/types/database';

/**
 * GET /api/branches — List all branches (owner only)
 * POST /api/branches — Create a new branch (owner only)
 */

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: rawProfile } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    const caller = rawProfile as Profile | null;
    if (!caller || caller.role !== 'owner') {
      return NextResponse.json({ error: 'Owner access required' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const includeInactive = searchParams.get('includeInactive') === 'true';

    const adminClient = createAdminClient();
    let query = adminClient.from('branches').select('*').order('name');
    if (!includeInactive) {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ branches: data });
  } catch (err) {
    console.error('GET /api/branches error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: rawProfile } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    const caller = rawProfile as Profile | null;
    if (!caller || caller.role !== 'owner') {
      return NextResponse.json({ error: 'Owner access required' }, { status: 403 });
    }

    const body = await request.json();
    const { name, code, type = 'owned', address, phone, email } = body as {
      name: string; code: string; type?: string;
      address?: string; phone?: string; email?: string;
    };

    if (!name?.trim()) return NextResponse.json({ error: 'Branch name is required' }, { status: 400 });
    if (!code?.trim()) return NextResponse.json({ error: 'Branch code is required' }, { status: 400 });

    const adminClient = createAdminClient();

    // Check code uniqueness
    const { data: existing } = await adminClient
      .from('branches').select('id').ilike('code', code.trim()).single();
    if (existing) return NextResponse.json({ error: `Branch code "${code}" already exists` }, { status: 400 });

    const { data: newBranch, error: insertError } = await adminClient
      .from('branches')
      .insert({
        name: name.trim(),
        code: code.trim().toUpperCase(),
        type,
        address: address?.trim() || null,
        phone: phone?.trim() || null,
        email: email?.trim() || null,
      } as Record<string, unknown>)
      .select('*')
      .single();

    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

    await adminClient.from('audit_logs').insert({
      user_id: user.id,
      action_type: 'BRANCH_CREATED',
      entity_type: 'branch',
      entity_id: (newBranch as Record<string, unknown>).id as string,
      description: `Branch "${name}" created`,
      metadata: { name, code, type },
    } as Record<string, unknown>);

    return NextResponse.json({ branch: newBranch }, { status: 201 });
  } catch (err) {
    console.error('POST /api/branches error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
