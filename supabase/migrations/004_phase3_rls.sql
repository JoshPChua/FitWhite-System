-- ============================================================
-- FitWhite Aesthetics POS — Phase 3 Row Level Security
-- 004_phase3_rls.sql
--
-- Run AFTER: 001_schema.sql, 002_rls_policies.sql,
--            003_phase3_schema.sql
--
-- Covers all new tables from 003_phase3_schema.sql:
--   service_consumables, shifts, cash_movements,
--   patient_packages, package_payments, package_sessions,
--   doctor_commissions, inventory_logs
--
-- Security model (consistent with 002_rls_policies.sql):
--   owner        full access to all branches
--   manager      branch-scoped read + most writes
--   cashier      branch-scoped read + limited writes
--   service_role bypasses RLS (used by API server for system ops)
--
-- Append-only tables (NO UPDATE / DELETE for anyone via RLS):
--   package_payments, package_sessions, cash_movements,
--   inventory_logs
-- ============================================================

-- ─── NEW HELPER FUNCTIONS ────────────────────────────────────
-- NOTE: is_owner(), get_user_role(), get_user_branch_id() are
-- already defined in 002_rls_policies.sql and reused here.
-- The following are NEW helpers added for Phase 3.

-- Returns the UUID of the Imus branch (code = 'IMS').
-- Returns NULL if the branch does not exist in the DB.
CREATE OR REPLACE FUNCTION get_imus_branch_id()
RETURNS UUID AS $$
  SELECT id FROM branches WHERE code = 'IMS' LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

COMMENT ON FUNCTION get_imus_branch_id() IS
  'Returns the UUID of the Imus branch (code = ''IMS'') for Imus-only
   RLS enforcement. Returns NULL if the branch is not found.';

-- Returns TRUE if the calling user belongs to the given branch_id
-- and has an active profile.
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

-- Returns TRUE if the calling user is a manager or owner.
CREATE OR REPLACE FUNCTION is_manager_or_owner()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND role IN ('manager', 'owner')
      AND is_active = TRUE
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

COMMENT ON FUNCTION is_manager_or_owner() IS
  'Returns TRUE if the calling user has role manager or owner.';

-- ============================================================
-- SERVICE_CONSUMABLES (Bill of Materials)
-- SELECT:  all branch staff  (read: anyone in same branch)
-- INSERT:  manager or owner  (same branch)
-- UPDATE:  manager or owner  (same branch)
-- DELETE:  manager or owner  (same branch)
-- ============================================================

ALTER TABLE service_consumables ENABLE ROW LEVEL SECURITY;

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
-- SHIFTS
-- SELECT:  all branch staff
-- INSERT:  manager or owner only
-- UPDATE:  manager or owner only  (e.g. close shift, add notes)
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
-- CASH_MOVEMENTS  (Append-only ledger)
-- SELECT:  all branch staff
-- INSERT:  manager or owner only
-- NO UPDATE / NO DELETE policies (immutable record)
-- ============================================================

ALTER TABLE cash_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cash_movements_select" ON cash_movements
  FOR SELECT TO authenticated
  USING (
    is_owner()
    OR branch_id = get_user_branch_id()
  );

CREATE POLICY "cash_movements_insert" ON cash_movements
  FOR INSERT TO authenticated
  WITH CHECK (
    is_owner()
    OR (is_manager_or_owner() AND branch_id = get_user_branch_id())
  );

-- No UPDATE policy — cash_movements is append-only.
-- No DELETE policy — only the Postgres service_role can delete in emergencies.

-- ============================================================
-- PATIENT_PACKAGES
-- SELECT:  all branch staff
-- INSERT:  all branch staff  (cashiers create packages at POS)
-- UPDATE:  manager or owner  (status changes, expiry, notes)
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
-- PACKAGE_PAYMENTS  (Append-only ledger)
-- SELECT:  all branch staff
-- INSERT:  all branch staff  (cashiers collect installments)
-- NO UPDATE / NO DELETE policies (financial record — immutable)
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

-- No UPDATE policy — financial ledger is immutable.
-- No DELETE policy — corrections via compensating entries only.

-- ============================================================
-- PACKAGE_SESSIONS  (Append-only log)
-- SELECT:  all branch staff
-- INSERT:  all branch staff  (doctor/cashier records session)
-- NO UPDATE / NO DELETE policies (clinical record — immutable)
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

-- No UPDATE policy — session log is append-only.
-- No DELETE policy — corrections via compensating insert.

-- ============================================================
-- DOCTOR_COMMISSIONS
-- SELECT:  manager or owner only  (pay-sensitive data)
-- INSERT:  manager or owner only
-- UPDATE:  manager or owner only  (mark as paid, add notes)
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
-- INVENTORY_LOGS  (Permanently append-only — never writable by clients)
-- SELECT:  all branch staff
-- INSERT:  intentionally denied to all authenticated users.
--          The API server writes these rows using the service_role
--          key which bypasses RLS. This prevents clients from
--          fabricating inventory log entries.
-- NO UPDATE / NO DELETE policies (ever)
-- ============================================================

ALTER TABLE inventory_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inv_logs_select" ON inventory_logs
  FOR SELECT TO authenticated
  USING (
    is_owner()
    OR branch_id = get_user_branch_id()
  );

-- No INSERT policy for authenticated users — service_role only.
-- No UPDATE policy — permanently immutable.
-- No DELETE policy — permanently immutable.

-- ============================================================
-- End of 004_phase3_rls.sql
-- ============================================================
