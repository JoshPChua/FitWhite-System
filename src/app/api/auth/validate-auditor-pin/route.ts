import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyAuditorPin } from '@/lib/verify-auditor-pin';

/**
 * POST /api/auth/validate-auditor-pin
 *
 * Validates a 6-digit auditor PIN for void/refund approval.
 * Returns the auditor's ID and name on success.
 *
 * Uses the shared verifyAuditorPin helper which handles:
 *   - PIN format validation
 *   - Lockout checking & expiry
 *   - Hash-based PIN comparison
 *   - Failed attempt tracking + lockout enforcement
 *
 * Rate-limited: 5 failed attempts → 15-minute lockout per auditor.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { pin } = body as { pin: string };

    const adminClient = createAdminClient();
    const result = await verifyAuditorPin(adminClient, pin);

    if (result.valid) {
      return NextResponse.json({
        valid: true,
        auditor_id: result.auditor_id,
        auditor_name: result.auditor_name,
      });
    }

    return NextResponse.json(
      {
        valid: false,
        error: result.error,
        locked: result.locked,
      },
      { status: result.status || 400 },
    );
  } catch (error) {
    console.error('POST /api/auth/validate-auditor-pin error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
