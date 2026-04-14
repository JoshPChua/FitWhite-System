-- ============================================================
-- FitWhite Aesthetics POS — Phase 3 Row Level Security
-- 004_phase3_rls.sql
--
-- Covers all tables added in 003_phase3_schema.sql:
--   service_consumables, shifts, cash_movements,
--   patient_packages, package_payments, package_sessions,
--   doctor_commissions, inventory_logs
--
-- Also adds the Imus-only branch-restriction helper function.
--
-- Security model (consistent with 002_rls_policies.sql):
--   owner      → full access to everything
--   manager    → branch-scoped read + most writes
--   cashier    → branch-scoped read + limited writes
--   service_role (API) → bypasses RLS (used for triggers/admin ops)
--
-- Append-only tables (no UPDATE / DELETE for anyone):
--   package_payments, package_sessions, cash_movements,
--   inventory_logs
-- ============================================================

-- ─── HELPER: Imus-only branch restriction ───────────────────
-- Returns the UUID of the Imus branch (code = 'IMS').
-- Returns NULL if the Imus branch does not exist.
-- Used in RLS policies as an extra guard when the API flag is set.

CREATE OR REPLACE FUNCTION get_imus_branch_id()
RETURNS UUID AS $$
  SELECT id FROM branches WHERE code = 'IMS' LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

COMMENT ON FUNCTION get_imus_branch_id() IS
  'Returns the UUID of the Imus branch (code = ''IMS'') for use in
   Imus-only mode RLS enforcement. Returns NULL if branch not found.';

-- ─── HELPER: is_branch_staff ────────────────────────────────
-- TRUE if the current user belongs to the given branch_id.
-- Shorthand used throughout Phase 3 policies.

CREATE OR REPLACE FUNCTION is_branch_staff(p_branch_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND branch_id = p_branch_id
      AND is_active = TRUE
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

COMMENT ON FUNCTION is_branch_staff(UUID) IS
  'Returns TRUE if the calling user belongs to the specified branch
   and has an active profile.';

-- ─── HELPER: is_manager_or_owner ────────────────────────────

CREATE OR REPLACE FUNCTION is_manager_or_owner()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND role IN ('manager', 'owner')
      AND is_active = TRUE
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================
-- SERVICE_CONSUMABLES (Bill of Materials)
-- SELECT:  all branch staff
-- INSERT:  manager or owner only (same branch)
-- UPDATE:  manager or owner only (same branch)
-- DELETE:  manager or owner only (same branch)
-- ============================================================

ALTER TABLE service_consumables ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated staff on the same branch as the service
CREATE POLICY "svc_consumables_select" ON service_consumables
  FOR SELECT TO authenticated
  USING (
    is_owner()
    OR EXISTS (
      SELECT 1 FROM services s
      WHERE s.id = service_consumables.service_id
        AND s.branch_id = get_user_branch_id()
    )
  );

-- Insert/update/delete: manager or owner on the same branch
CREATE POLICY "svc_consumables_insert" ON service_consumables
  FOR INSERT TO authenticated
  WITH CHECK (
    is_owner()
    OR (
      is_manager_or_owner()
      AND EXISTS (
        SELECT 1 FROM services s
        WHERE s.id = service_consumables.service_id
          AND s.branch_id = get_user_branch_id()
      )
    )
  );

CREATE POLICY "svc_consumables_update" ON service_consumables
  FOR UPDATE TO authenticated
  USING (
    is_owner()
    OR (
      is_manager_or_owner()
      AND EXISTS (
        SELECT 1 FROM services s
        WHERE s.id = service_consumables.service_id
          AND s.branch_id = get_user_branch_id()
      )
    )
  )
  WITH CHECK (
    is_owner()
    OR (
      is_manager_or_owner()
      AND EXISTS (
        SELECT 1 FROM services s
        WHERE s.id = service_consumables.service_id
          AND s.branch_id = get_user_branch_id()
      )
    )
  );

CREATE POLICY "svc_consumables_delete" ON service_consumables
  FOR DELETE TO authenticated
  USING (
    is_owner()
    OR (
      is_manager_or_owner()
      AND EXISTS (
        SELECT 1 FROM services s
        WHERE s.id = service_consumables.service_id
          AND s.branch_id = get_user_branch_id()
      )
    )
  );

-- ============================================================
-- SHIFTS (Cash Drawer)
-- SELECT:  all branch staff (read own branch shifts)
-- INSERT:  manager or owner only
-- UPDATE:  manager or owner only (e.g., close shift, add notes)
-- DELETE:  owner only
-- ============================================================

ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shifts_select" ON shifts
  FOR SELECT TO authenticated
  USING (
    is_owner()
    OR branch_id = get_user_branch_id()
  );

CREATE POLICY "shifts_insert" ON shifts
  FOR INSERT TO authenticated
  WITH CHECK (
    is_owner()
    OR (is_manager_or_owner() AND branch_id = get_user_branch_id())
  );

CREATE POLICY "shifts_update" ON shifts
  FOR UPDATE TO authenticated
  USING (
    is_owner()
    OR (is_manager_or_owner() AND branch_id = get_user_branch_id())
  )
  WITH CHECK (
    is_owner()
    OR (is_manager_or_owner() AND branch_id = get_user_branch_id())
  );

CREATE POLICY "shifts_delete" ON shifts
  FOR DELETE TO authenticated
  USING (is_owner());

-- ============================================================
-- CASH_MOVEMENTS (Petty Cash / Bank Deposit Ledger)
-- APPEND-ONLY: no UPDATE or DELETE policies.
-- SELECT:  all branch staff
-- INSERT:  manager or owner only
-- ============================================================

ALTER TABLE cash_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cash_movements_select" ON cash_movements
  FOR SELECT TO authenticated
  USING (
    is_owner()
    OR branch_id = get_user_branch_id()
  );

-- Only manager/owner can record cash movements
CREATE POLICY "cash_movements_insert" ON cash_movements
  FOR INSERT TO authenticated
  WITH CHECK (
    is_owner()
    OR (is_manager_or_owner() AND branch_id = get_user_branch_id())
  );

-- NO UPDATE policy — cash_movements is append-only (immutable ledger).
-- NO DELETE policy — only the Postgres service_role can delete (emergencies).

-- ============================================================
-- PATIENT_PACKAGES (Session Tracking + A/R)
-- SELECT:  all branch staff
-- INSERT:  all branch staff (cashiers create packages at POS)
-- UPDATE:  manager or owner only (status changes, expiry, notes)
-- DELETE:  owner only
-- ============================================================

ALTER TABLE patient_packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "patient_packages_select" ON patient_packages
  FOR SELECT TO authenticated
  USING (
    is_owner()
    OR branch_id = get_user_branch_id()
  );

CREATE POLICY "patient_packages_insert" ON patient_packages
  FOR INSERT TO authenticated
  WITH CHECK (
    is_owner()
    OR branch_id = get_user_branch_id()
  );

-- Only managers/owners can update a package (status, expiry, attending doctor, notes)
CREATE POLICY "patient_packages_update" ON patient_packages
  FOR UPDATE TO authenticated
  USING (
    is_owner()
    OR (is_manager_or_owner() AND branch_id = get_user_branch_id())
  )
  WITH CHECK (
    is_owner()
    OR (is_manager_or_owner() AND branch_id = get_user_branch_id())
  );

CREATE POLICY "patient_packages_delete" ON patient_packages
  FOR DELETE TO authenticated
  USING (is_owner());

-- ============================================================
-- PACKAGE_PAYMENTS (A/R Payment Ledger)
-- APPEND-ONLY: no UPDATE or DELETE policies.
-- SELECT:  all branch staff
-- INSERT:  all branch staff (cashiers collect installments)
-- ============================================================

ALTER TABLE package_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pkg_payments_select" ON package_payments
  FOR SELECT TO authenticated
  USING (
    is_owner()
    OR branch_id = get_user_branch_id()
  );

CREATE POLICY "pkg_payments_insert" ON package_payments
  FOR INSERT TO authenticated
  WITH CHECK (
    is_owner()
    OR branch_id = get_user_branch_id()
  );

-- NO UPDATE policy — financial ledger is immutable.
-- NO DELETE policy — owner-level deletions must go through service_role.

-- ============================================================
-- PACKAGE_SESSIONS (Per-visit session log)
-- APPEND-ONLY: no UPDATE or DELETE policies.
-- SELECT:  all branch staff
-- INSERT:  all branch staff (cashier/doctor records the session)
-- ============================================================

ALTER TABLE package_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pkg_sessions_select" ON package_sessions
  FOR SELECT TO authenticated
  USING (
    is_owner()
    OR branch_id = get_user_branch_id()
  );

CREATE POLICY "pkg_sessions_insert" ON package_sessions
  FOR INSERT TO authenticated
  WITH CHECK (
    is_owner()
    OR branch_id = get_user_branch_id()
  );

-- NO UPDATE policy — session log is append-only.
-- NO DELETE policy — corrections via compensating insert.

-- ============================================================
-- DOCTOR_COMMISSIONS
-- SELECT:  manager or owner only (pay-sensitive data)
-- INSERT:  manager or owner only
-- UPDATE:  manager or owner only (mark as paid, add notes)
-- DELETE:  owner only
-- ============================================================

ALTER TABLE doctor_commissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dr_commissions_select" ON doctor_commissions
  FOR SELECT TO authenticated
  USING (
    is_owner()
    OR (is_manager_or_owner() AND branch_id = get_user_branch_id())
  );

CREATE POLICY "dr_commissions_insert" ON doctor_commissions
  FOR INSERT TO authenticated
  WITH CHECK (
    is_owner()
    OR (is_manager_or_owner() AND branch_id = get_user_branch_id())
  );

CREATE POLICY "dr_commissions_update" ON doctor_commissions
  FOR UPDATE TO authenticated
  USING (
    is_owner()
    OR (is_manager_or_owner() AND branch_id = get_user_branch_id())
  )
  WITH CHECK (
    is_owner()
    OR (is_manager_or_owner() AND branch_id = get_user_branch_id())
  );

CREATE POLICY "dr_commissions_delete" ON doctor_commissions
  FOR DELETE TO authenticated
  USING (is_owner());

-- ============================================================
-- INVENTORY_LOGS (Canonical Stock Event Log)
-- APPEND-ONLY: no UPDATE or DELETE policies (ever).
-- SELECT:  all branch staff
-- INSERT:  service_role only (written by API server, never by client)
-- ============================================================

ALTER TABLE inventory_logs ENABLE ROW LEVEL SECURITY;

-- All branch staff can read the inventory log for their branch.
-- Owners see all branches.
CREATE POLICY "inv_logs_select" ON inventory_logs
  FOR SELECT TO authenticated
  USING (
    is_owner()
    OR branch_id = get_user_branch_id()
  );

-- INSERT is intentionally denied to all authenticated users.
-- The API server uses the service_role key (which bypasses RLS)
-- to write inventory log entries atomically with inventory updates.
-- This prevents clients from fabricating log entries.
--
-- If you need to allow a specific DB function to write logs as
-- a SECURITY DEFINER function, that function already bypasses RLS.

-- NO UPDATE policy — inventory log is permanently immutable.
-- NO DELETE policy — inventory log is permanently immutable.

-- ============================================================
-- End of 004_phase3_rls.sql
-- ============================================================
