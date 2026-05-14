/**
 * Auditor PIN Utility
 *
 * Provides hashing and comparison for 6-digit auditor PINs.
 * Uses Web Crypto API (available in both Node.js 18+ and browser).
 * 
 * NOTE: We use SHA-256 with a fixed salt prefix rather than bcrypt
 * because the PIN space is small (6 digits) and rate-limiting at
 * the API layer provides the primary brute-force protection.
 */

const PIN_SALT = 'fitwhite-auditor-pin-v1:';

/**
 * Hash a 6-digit PIN for storage.
 */
export async function hashPin(pin: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(PIN_SALT + pin);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Compare a plaintext PIN against a stored hash.
 */
export async function verifyPin(pin: string, storedHash: string): Promise<boolean> {
  const hash = await hashPin(pin);
  return hash === storedHash;
}

/**
 * Validate PIN format: exactly 6 digits.
 */
export function isValidPinFormat(pin: string): boolean {
  return /^\d{6}$/.test(pin);
}

/** Max failed PIN attempts before lockout */
export const MAX_PIN_ATTEMPTS = 5;

/** Lockout duration in minutes */
export const PIN_LOCKOUT_MINUTES = 15;
