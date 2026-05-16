/**
 * Shared Auditor PIN Verification
 *
 * Extracted from validate-auditor-pin, void, and refund routes
 * to eliminate duplicated PIN validation logic.
 *
 * Handles:
 *   - PIN format validation
 *   - Lockout checking & expiry
 *   - Hash-based PIN comparison
 *   - Failed attempt tracking + lockout enforcement
 *   - Success: reset failed attempts, return auditor info
 */
import { SupabaseClient } from '@supabase/supabase-js';
import { verifyPin, isValidPinFormat, MAX_PIN_ATTEMPTS, PIN_LOCKOUT_MINUTES } from '@/lib/auditor-pin';

export interface AuditorPinResult {
  valid: boolean;
  auditor_id?: string;
  auditor_name?: string;
  error?: string;
  locked?: boolean;
  /** HTTP status to return when invalid */
  status?: number;
}

/**
 * Verifies an auditor PIN against active auditors in the database.
 *
 * @param adminClient - Supabase admin client (service_role)
 * @param pin - The 6-digit PIN to verify
 * @param branchId - Optional branch to scope auditor lookup.
 *                   When provided, only auditors in that branch are checked.
 *                   When omitted, all active auditors are checked (Imus-only safe).
 * @returns AuditorPinResult with validation outcome
 */
export async function verifyAuditorPin(
  adminClient: SupabaseClient,
  pin: string,
  branchId?: string,
): Promise<AuditorPinResult> {
  // 1. Format check
  if (!pin || !isValidPinFormat(pin)) {
    return { valid: false, error: 'PIN must be exactly 6 digits', status: 400 };
  }

  // 2. Fetch active auditors with PINs (optionally scoped to branch)
  let query = adminClient
    .from('profiles')
    .select('id, first_name, last_name, auditor_pin, pin_failed_attempts, pin_locked_until')
    .eq('role', 'auditor')
    .eq('is_active', true)
    .not('auditor_pin', 'is', null);

  if (branchId) {
    query = query.eq('branch_id', branchId);
  }

  const { data: auditors, error: fetchErr } = await query;

  if (fetchErr || !auditors || auditors.length === 0) {
    return {
      valid: false,
      error: 'No active auditors configured. Contact the owner.',
      status: 400,
    };
  }

  const now = new Date();

  // 3. Try each auditor's PIN (skip locked ones)
  for (const auditor of auditors as Record<string, unknown>[]) {
    const storedPin = auditor.auditor_pin as string;
    const failedAttempts = (auditor.pin_failed_attempts as number) || 0;
    const lockedUntil = auditor.pin_locked_until
      ? new Date(auditor.pin_locked_until as string)
      : null;

    // Skip locked auditor
    if (lockedUntil && lockedUntil > now) continue;

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

      return {
        valid: true,
        auditor_id: auditor.id as string,
        auditor_name: `${auditor.first_name} ${auditor.last_name}`,
      };
    }
  }

  // 4. PIN didn't match — increment failed attempts on all non-locked auditors
  for (const auditor of auditors as Record<string, unknown>[]) {
    const lockedUntil = auditor.pin_locked_until
      ? new Date(auditor.pin_locked_until as string)
      : null;
    if (lockedUntil && lockedUntil > now) continue; // don't increment locked auditors

    const failed = ((auditor.pin_failed_attempts as number) || 0) + 1;
    const update: Record<string, unknown> = { pin_failed_attempts: failed };

    if (failed >= MAX_PIN_ATTEMPTS) {
      update.pin_locked_until = new Date(
        now.getTime() + PIN_LOCKOUT_MINUTES * 60 * 1000,
      ).toISOString();
    }

    await adminClient
      .from('profiles')
      .update(update)
      .eq('id', auditor.id as string);
  }

  // 5. Check if all are now locked
  const allLocked = (auditors as Record<string, unknown>[]).every(a => {
    const attempts = ((a.pin_failed_attempts as number) || 0) + 1;
    return attempts >= MAX_PIN_ATTEMPTS;
  });

  if (allLocked) {
    return {
      valid: false,
      error: `Too many failed attempts. PIN is locked for ${PIN_LOCKOUT_MINUTES} minutes. Contact the owner to reset.`,
      locked: true,
      status: 429,
    };
  }

  const firstAuditor = auditors[0] as Record<string, unknown>;
  const remaining = MAX_PIN_ATTEMPTS - (((firstAuditor.pin_failed_attempts as number) || 0) + 1);

  return {
    valid: false,
    error:
      remaining > 0
        ? `Invalid PIN. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining before lockout.`
        : `Too many failed attempts. PIN locked for ${PIN_LOCKOUT_MINUTES} minutes.`,
    locked: remaining <= 0,
    status: 403,
  };
}
