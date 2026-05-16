-- ============================================================
-- 014_auditor_rls_hardening.sql
-- Restrict auditor to SELECT-only at the database level.
--
-- Auditor must not be able to INSERT, UPDATE, or DELETE on
-- mutation-critical tables even if they bypass the API layer
-- (e.g. direct Supabase client calls).
--
-- Tables hardened:
--   sales, sale_items, payments — exclude auditor from INSERT
--   customers — exclude auditor from INSERT/UPDATE/DELETE
--   inventory — exclude auditor from UPDATE
--   stock_adjustments — exclude auditor from INSERT
--   treatment_history — exclude auditor from INSERT/UPDATE/DELETE
--   audit_logs SELECT — expand to include auditor (branch-scoped)
-- ============================================================

-- ─── Helper: check if current user is NOT an auditor ─────────
-- Used in WITH CHECK clauses to exclude auditor from writes.

CREATE OR REPLACE FUNCTION is_not_auditor()
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (SELECT role FROM profiles WHERE id = auth.uid()) != 'auditor',
    FALSE
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ═══════════════════════════════════════════════════════════════
-- SALES — exclude auditor from INSERT
-- ═══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "sales_insert" ON sales;
CREATE POLICY "sales_insert" ON sales
  FOR INSERT TO authenticated
  WITH CHECK (
    is_not_auditor()
    AND (is_owner() OR branch_id = get_user_branch_id())
  );

-- ═══════════════════════════════════════════════════════════════
-- SALE ITEMS — exclude auditor from INSERT
-- ═══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "sale_items_insert" ON sale_items;
CREATE POLICY "sale_items_insert" ON sale_items
  FOR INSERT TO authenticated
  WITH CHECK (
    is_not_auditor()
    AND EXISTS (
      SELECT 1 FROM sales s
      WHERE s.id = sale_items.sale_id
      AND (is_owner() OR s.branch_id = get_user_branch_id())
    )
  );

-- ═══════════════════════════════════════════════════════════════
-- PAYMENTS — exclude auditor from INSERT
-- ═══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "payments_insert" ON payments;
CREATE POLICY "payments_insert" ON payments
  FOR INSERT TO authenticated
  WITH CHECK (
    is_not_auditor()
    AND EXISTS (
      SELECT 1 FROM sales s
      WHERE s.id = payments.sale_id
      AND (is_owner() OR s.branch_id = get_user_branch_id())
    )
  );

-- ═══════════════════════════════════════════════════════════════
-- CUSTOMERS — exclude auditor from INSERT/UPDATE/DELETE
-- ═══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "customers_insert" ON customers;
CREATE POLICY "customers_insert" ON customers
  FOR INSERT TO authenticated
  WITH CHECK (
    is_not_auditor()
    AND (is_owner() OR branch_id = get_user_branch_id())
  );

DROP POLICY IF EXISTS "customers_update" ON customers;
CREATE POLICY "customers_update" ON customers
  FOR UPDATE TO authenticated
  USING (
    is_not_auditor()
    AND (is_owner() OR branch_id = get_user_branch_id())
  )
  WITH CHECK (
    is_not_auditor()
    AND (is_owner() OR branch_id = get_user_branch_id())
  );

DROP POLICY IF EXISTS "customers_delete" ON customers;
CREATE POLICY "customers_delete" ON customers
  FOR DELETE TO authenticated
  USING (
    is_not_auditor()
    AND (is_owner() OR (get_user_role() = 'manager' AND branch_id = get_user_branch_id()))
  );

-- ═══════════════════════════════════════════════════════════════
-- INVENTORY — exclude auditor from UPDATE
-- ═══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "inventory_update" ON inventory;
CREATE POLICY "inventory_update" ON inventory
  FOR UPDATE TO authenticated
  USING (
    is_not_auditor()
    AND (is_owner() OR (get_user_role() IN ('manager', 'cashier') AND branch_id = get_user_branch_id()))
  )
  WITH CHECK (
    is_not_auditor()
    AND (is_owner() OR (get_user_role() IN ('manager', 'cashier') AND branch_id = get_user_branch_id()))
  );

-- ═══════════════════════════════════════════════════════════════
-- STOCK ADJUSTMENTS — exclude auditor from INSERT
-- ═══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "stock_adj_insert" ON stock_adjustments;
CREATE POLICY "stock_adj_insert" ON stock_adjustments
  FOR INSERT TO authenticated
  WITH CHECK (
    is_not_auditor()
    AND (is_owner() OR branch_id = get_user_branch_id())
  );

-- ═══════════════════════════════════════════════════════════════
-- TREATMENT HISTORY — exclude auditor from INSERT/UPDATE/DELETE
-- ═══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "treatment_insert" ON treatment_history;
CREATE POLICY "treatment_insert" ON treatment_history
  FOR INSERT TO authenticated
  WITH CHECK (
    is_not_auditor()
    AND (is_owner() OR branch_id = get_user_branch_id())
  );

DROP POLICY IF EXISTS "treatment_update" ON treatment_history;
CREATE POLICY "treatment_update" ON treatment_history
  FOR UPDATE TO authenticated
  USING (
    is_not_auditor()
    AND (is_owner() OR (get_user_role() IN ('manager', 'cashier') AND branch_id = get_user_branch_id()))
  )
  WITH CHECK (
    is_not_auditor()
    AND (is_owner() OR (get_user_role() IN ('manager', 'cashier') AND branch_id = get_user_branch_id()))
  );

DROP POLICY IF EXISTS "treatment_delete" ON treatment_history;
CREATE POLICY "treatment_delete" ON treatment_history
  FOR DELETE TO authenticated
  USING (
    is_not_auditor()
    AND (is_owner() OR (get_user_role() = 'manager' AND branch_id = get_user_branch_id()))
  );

-- ═══════════════════════════════════════════════════════════════
-- AUDIT LOGS — expand SELECT to include auditor (branch-scoped)
-- ═══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "audit_select" ON audit_logs;
CREATE POLICY "audit_select" ON audit_logs
  FOR SELECT TO authenticated
  USING (
    is_owner()
    OR (get_user_role() IN ('manager', 'auditor') AND branch_id = get_user_branch_id())
  );

-- ============================================================
-- End of 014_auditor_rls_hardening.sql
-- ============================================================
