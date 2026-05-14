import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyPin, isValidPinFormat, MAX_PIN_ATTEMPTS, PIN_LOCKOUT_MINUTES } from '@/lib/auditor-pin';

/**
 * POST /api/auth/validate-auditor-pin
 *
 * Validates a 6-digit auditor PIN for void/refund approval.
 * Returns the auditor's ID and name on success.
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

    if (!pin || !isValidPinFormat(pin)) {
      return NextResponse.json({ valid: false, error: 'PIN must be exactly 6 digits' }, { status: 400 });
    }

    const adminClient = createAdminClient();

    // Fetch all active auditor profiles with PINs
    const { data: auditors, error: fetchErr } = await adminClient
      .from('profiles')
      .select('id, first_name, last_name, auditor_pin, pin_failed_attempts, pin_locked_until')
      .eq('role', 'auditor')
      .eq('is_active', true)
      .not('auditor_pin', 'is', null);

    if (fetchErr || !auditors || auditors.length === 0) {
      return NextResponse.json({ valid: false, error: 'No active auditors configured. Contact the owner.' }, { status: 400 });
    }

    const now = new Date();

    // Try each auditor's PIN
    for (const auditor of auditors as Record<string, unknown>[]) {
      const storedPin = auditor.auditor_pin as string;
      const failedAttempts = (auditor.pin_failed_attempts as number) || 0;
      const lockedUntil = auditor.pin_locked_until ? new Date(auditor.pin_locked_until as string) : null;

      // Check lockout
      if (lockedUntil && lockedUntil > now) {
        const remainingMins = Math.ceil((lockedUntil.getTime() - now.getTime()) / 60000);
        continue; // Skip this auditor, they're locked out — try others
      }

      // Reset lockout if expired
      if (lockedUntil && lockedUntil <= now && failedAttempts >= MAX_PIN_ATTEMPTS) {
        await adminClient
          .from('profiles')
          .update({ pin_failed_attempts: 0, pin_locked_until: null } as Record<string, unknown>)
          .eq('id', auditor.id as string);
      }

      const isValid = await verifyPin(pin, storedPin);

      if (isValid) {
        // Reset failed attempts on success
        if (failedAttempts > 0) {
          await adminClient
            .from('profiles')
            .update({ pin_failed_attempts: 0, pin_locked_until: null } as Record<string, unknown>)
            .eq('id', auditor.id as string);
        }

        return NextResponse.json({
          valid: true,
          auditor_id: auditor.id as string,
          auditor_name: `${auditor.first_name} ${auditor.last_name}`,
        });
      }
    }

    // PIN didn't match any auditor — increment failed attempts on ALL auditors
    // (We don't know which auditor's PIN was attempted)
    for (const auditor of auditors as Record<string, unknown>[]) {
      const failedAttempts = ((auditor.pin_failed_attempts as number) || 0) + 1;
      const updateData: Record<string, unknown> = { pin_failed_attempts: failedAttempts };

      if (failedAttempts >= MAX_PIN_ATTEMPTS) {
        const lockUntil = new Date(now.getTime() + PIN_LOCKOUT_MINUTES * 60 * 1000);
        updateData.pin_locked_until = lockUntil.toISOString();
      }

      await adminClient
        .from('profiles')
        .update(updateData)
        .eq('id', auditor.id as string);
    }

    // Check if all auditors are now locked
    const allLocked = (auditors as Record<string, unknown>[]).every(a => {
      const attempts = ((a.pin_failed_attempts as number) || 0) + 1;
      return attempts >= MAX_PIN_ATTEMPTS;
    });

    if (allLocked) {
      return NextResponse.json({
        valid: false,
        error: `Too many failed attempts. PIN is locked for ${PIN_LOCKOUT_MINUTES} minutes. Contact the owner to reset.`,
        locked: true,
      }, { status: 429 });
    }

    const firstAuditor = auditors[0] as Record<string, unknown>;
    const remaining = MAX_PIN_ATTEMPTS - (((firstAuditor.pin_failed_attempts as number) || 0) + 1);

    return NextResponse.json({
      valid: false,
      error: remaining > 0
        ? `Invalid PIN. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining before lockout.`
        : `Too many failed attempts. PIN locked for ${PIN_LOCKOUT_MINUTES} minutes.`,
      locked: remaining <= 0,
    });

  } catch (error) {
    console.error('POST /api/auth/validate-auditor-pin error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
