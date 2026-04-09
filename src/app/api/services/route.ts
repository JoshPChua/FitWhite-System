import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Profile } from '@/types/database';

/**
 * GET /api/services — list services (server-side, used for bulk/admin ops)
 * Normal reads go through Supabase client directly (RLS handles isolation)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    if (!currentUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get('branch_id');

    let query = supabase.from('services').select('*').order('name');
    if (branchId) query = query.eq('branch_id', branchId);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ services: data });
  } catch (error) {
    console.error('GET /api/services error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/services — Create a new service
 * Requires: owner or manager role
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    if (!currentUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: rawCaller } = await supabase
      .from('profiles').select('*').eq('id', currentUser.id).single();
    const caller = rawCaller as Profile | null;

    if (!caller || (caller.role !== 'owner' && caller.role !== 'manager')) {
      return NextResponse.json({ error: 'Forbidden: insufficient permissions' }, { status: 403 });
    }

    const body = await request.json();
    const { branch_id, name, description, price, duration_minutes, category } = body;

    if (!branch_id || !name || price === undefined) {
      return NextResponse.json(
        { error: 'Required fields: branch_id, name, price' },
        { status: 400 }
      );
    }

    // Manager can only create in their own branch
    if (caller.role === 'manager' && branch_id !== caller.branch_id) {
      return NextResponse.json({ error: 'Managers can only create services in their own branch' }, { status: 403 });
    }

    const adminClient = createAdminClient();
    const { data: service, error } = await adminClient
      .from('services')
      .insert({ branch_id, name, description: description || null, price, duration_minutes: duration_minutes || null, category: category || null })
      .select('*')
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await adminClient.from('audit_logs').insert({
      user_id: currentUser.id,
      branch_id,
      action_type: 'CREATE_SERVICE',
      entity_type: 'service',
      entity_id: (service as { id: string }).id,
      description: `Created service "${name}"`,
      metadata: { name, price, category },
    });

    return NextResponse.json({ success: true, service });
  } catch (error) {
    console.error('POST /api/services error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
