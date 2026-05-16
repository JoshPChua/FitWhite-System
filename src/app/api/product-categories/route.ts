import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  requireActiveProfile, enforceImusOnly, isErrorResponse, jsonError,
} from '@/lib/api-helpers';

/**
 * GET /api/product-categories?branch_id=X
 * Returns all active product categories for a branch.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const auth = await requireActiveProfile(supabase);
    if (isErrorResponse(auth)) return auth;
    const { profile: caller } = auth;

    const branchId = request.nextUrl.searchParams.get('branch_id')
      || (caller.role !== 'owner' ? caller.branch_id : null);

    if (!branchId) {
      return jsonError('branch_id is required', 400);
    }

    const adminClient = createAdminClient();

    const imusGuard = await enforceImusOnly(adminClient, branchId);
    if (isErrorResponse(imusGuard)) return imusGuard;

    const { data, error } = await adminClient
      .from('product_categories')
      .select('id, name, sort_order, is_active')
      .eq('branch_id', branchId)
      .eq('is_active', true)
      .order('sort_order')
      .order('name');

    if (error) return jsonError(error.message, 500);
    return NextResponse.json({ data: data || [] });
  } catch (error) {
    console.error('GET /api/product-categories error:', error);
    return jsonError('Internal server error', 500);
  }
}

/**
 * POST /api/product-categories
 * Body: { branch_id, name }
 * Owner/manager only.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const auth = await requireActiveProfile(supabase);
    if (isErrorResponse(auth)) return auth;
    const { profile: caller } = auth;

    if (caller.role !== 'owner' && caller.role !== 'manager') {
      return jsonError('Only owners and managers can manage categories', 403);
    }

    const body = await request.json();
    const { branch_id, name } = body as { branch_id?: string; name?: string };

    if (!name?.trim()) return jsonError('name is required', 400);

    const branchId = branch_id || caller.branch_id;
    if (!branchId) return jsonError('branch_id is required', 400);

    if (caller.role === 'manager' && caller.branch_id !== branchId) {
      return jsonError('Cannot create categories in another branch', 403);
    }

    const adminClient = createAdminClient();
    const imusGuard = await enforceImusOnly(adminClient, branchId);
    if (isErrorResponse(imusGuard)) return imusGuard;

    const { data, error } = await adminClient
      .from('product_categories')
      .insert({ branch_id: branchId, name: name.trim() } as Record<string, unknown>)
      .select('id, name')
      .single();

    if (error) {
      if (error.code === '23505') return jsonError('Category already exists', 409);
      return jsonError(error.message, 500);
    }

    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    console.error('POST /api/product-categories error:', error);
    return jsonError('Internal server error', 500);
  }
}
