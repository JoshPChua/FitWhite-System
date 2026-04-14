/**
 * FitWhite Feature Flags
 *
 * Controls feature visibility and branch restrictions via environment variables.
 * Set NEXT_PUBLIC_IMUS_ONLY=true in .env.local to enable Imus-only mode.
 *
 * NOTE: NEXT_PUBLIC_ variables are embedded at build time and visible in the
 * browser bundle. They control UI behaviour only. True data isolation is
 * enforced server-side via RLS and API-level branch checks.
 */

// ─── Imus-Only Mode ──────────────────────────────────────────

/**
 * When TRUE, the application restricts all UI and API operations to the
 * Imus branch. Branch selectors are hidden, navigation is simplified, and
 * API routes reject requests that target any other branch.
 */
export const IMUS_ONLY = process.env.NEXT_PUBLIC_IMUS_ONLY === 'true';

/**
 * The canonical branch code for the Imus clinic.
 * Must match the `code` column in the `branches` table.
 */
export const IMUS_BRANCH_CODE = 'IMS';

/**
 * Returns true if the given branch_id matches the Imus branch.
 * Used in components and API routes to guard Imus-only operations.
 *
 * @param branchId - The branch UUID to check
 * @param imusBranchId - The resolved UUID of the IMS branch (from DB lookup)
 */
export function isImusBranch(branchId: string, imusBranchId: string): boolean {
  return branchId === imusBranchId;
}

/**
 * Server-side guard: throws a 403-compatible error object if IMUS_ONLY mode
 * is active and the requested branch does not match the Imus branch.
 *
 * Use this inside API route handlers (Next.js Route Handlers / pages/api).
 *
 * @example
 * assertImusOnlyBranch(requestBranchId, resolvedImusBranchId);
 */
export function assertImusOnlyBranch(
  requestedBranchId: string,
  imusBranchId: string | null,
): void {
  if (!IMUS_ONLY) return; // No restriction in multi-branch mode

  if (!imusBranchId) {
    throw new ImusOnlyError(
      'Imus branch not found in the database. Please contact your system administrator.',
    );
  }

  if (requestedBranchId !== imusBranchId) {
    throw new ImusOnlyError(
      'This installation is restricted to the Imus branch. Access to other branches is not permitted.',
    );
  }
}

/**
 * Structured error thrown by assertImusOnlyBranch.
 * API routes should catch this and return a 403 response.
 */
export class ImusOnlyError extends Error {
  readonly statusCode = 403;

  constructor(message: string) {
    super(message);
    this.name = 'ImusOnlyError';
  }
}

// ─── Phase 3 Feature Flags ───────────────────────────────────

/**
 * Enable the Patient Package / Session tracking module.
 * Defaults to TRUE — Phase 3 is on by default once the migration is applied.
 */
export const ENABLE_PATIENT_PACKAGES =
  process.env.NEXT_PUBLIC_ENABLE_PATIENT_PACKAGES !== 'false';

/**
 * Enable the Shift / Cash Drawer management module.
 */
export const ENABLE_SHIFTS =
  process.env.NEXT_PUBLIC_ENABLE_SHIFTS !== 'false';

/**
 * Enable the Doctor Commission tracking module.
 */
export const ENABLE_DOCTOR_COMMISSIONS =
  process.env.NEXT_PUBLIC_ENABLE_DOCTOR_COMMISSIONS !== 'false';

/**
 * Enable the Service BOM (Bill of Materials) consumable deduction at checkout.
 */
export const ENABLE_SERVICE_BOM =
  process.env.NEXT_PUBLIC_ENABLE_SERVICE_BOM !== 'false';
