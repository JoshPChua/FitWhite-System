import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Profile } from '@/types/database';

/**
 * PATCH /api/branches/[id] — Update branch
 * DELETE /api/branches/[id] — Deactivate branch (soft delete)
 */

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: rawProfile } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    const caller = rawProfile as Profile | null;
    if (!caller || caller.role !== 'owner') {
      return NextResponse.json({ error: 'Owner access required' }, { status: 403 });
    }

    const body = await request.json();
    const { name, code, type, address, phone, email, is_active, reporting_restricted } = body as {
      name?: string; code?: string; type?: string;
      address?: string | null; phone?: string | null; email?: string | null;
      is_active?: boolean; reporting_restricted?: boolean;
    };

    const adminClient = createAdminClient();

    // Check existing
    const { data: existing } = await adminClient.from('branches').select('*').eq('id', id).single();
    if (!existing) return NextResponse.json({ error: 'Branch not found' }, { status: 404 });

    // Check code uniqueness if changing
    if (code && code !== (existing as Record<string, unknown>).code) {
      const { data: codeConflict } = await adminClient
        .from('branches').select('id').ilike('code', code).neq('id', id).single();
      if (codeConflict) {
        return NextResponse.json({ error: `Branch code "${code}" already exists` }, { status: 400 });
      }
    }

    const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (name !== undefined) updatePayload.name = name.trim();
    if (code !== undefined) updatePayload.code = code.trim().toUpperCase();
    if (type !== undefined) updatePayload.type = type;
    if (address !== undefined) updatePayload.address = address?.trim() || null;
    if (phone !== undefined) updatePayload.phone = phone?.trim() || null;
    if (email !== undefined) updatePayload.email = email?.trim() || null;
    if (is_active !== undefined) updatePayload.is_active = is_active;
    if (reporting_restricted !== undefined) updatePayload.reporting_restricted = reporting_restricted;

    const { data: updated, error } = await adminClient
      .from('branches').update(updatePayload).eq('id', id).select('*').single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await adminClient.from('audit_logs').insert({
      user_id: user.id,
      action_type: 'BRANCH_UPDATED',
      entity_type: 'branch',
      entity_id: id,
      description: `Branch "${(existing as Record<string, unknown>).name}" updated`,
      metadata: updatePayload,
    } as Record<string, unknown>);

    return NextResponse.json({ branch: updated });
  } catch (err) {
    console.error('PATCH /api/branches/[id] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: rawProfile } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    const caller = rawProfile as Profile | null;
    if (!caller || caller.role !== 'owner') {
      return NextResponse.json({ error: 'Owner access required' }, { status: 403 });
    }

    const adminClient = createAdminClient();
    const { data: existing } = await adminClient.from('branches').select('*').eq('id', id).single();
    if (!existing) return NextResponse.json({ error: 'Branch not found' }, { status: 404 });

    // Soft delete — deactivate only
    await adminClient.from('branches')
      .update({ is_active: false } as Record<string, unknown>).eq('id', id);

    await adminClient.from('audit_logs').insert({
      user_id: user.id,
      action_type: 'BRANCH_DEACTIVATED',
      entity_type: 'branch',
      entity_id: id,
      description: `Branch "${(existing as Record<string, unknown>).name}" deactivated`,
    } as Record<string, unknown>);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/branches/[id] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
