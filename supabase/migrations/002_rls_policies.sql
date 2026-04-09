-- ============================================================
-- FitWhite Aesthetics POS - Row Level Security Policies
-- Enforces multi-tenant branch isolation at the database level
-- ============================================================

-- ─── HELPER FUNCTIONS ───────────────────────────────────────

CREATE OR REPLACE FUNCTION get_user_role()
RETURNS user_role AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION get_user_branch_id()
RETURNS UUID AS $$
  SELECT branch_id FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_owner()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================
-- BRANCHES
-- ============================================================
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;

-- Everyone can read branches (needed for UI branch selector)
CREATE POLICY "branches_select" ON branches
  FOR SELECT TO authenticated
  USING (TRUE);

-- Only owner can modify branches
CREATE POLICY "branches_insert" ON branches
  FOR INSERT TO authenticated
  WITH CHECK (is_owner());

CREATE POLICY "branches_update" ON branches
  FOR UPDATE TO authenticated
  USING (is_owner())
  WITH CHECK (is_owner());

CREATE POLICY "branches_delete" ON branches
  FOR DELETE TO authenticated
  USING (is_owner());

-- ============================================================
-- PROFILES
-- ============================================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile; owner reads all; manager reads branch staff
CREATE POLICY "profiles_select" ON profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR is_owner()
    OR (get_user_role() = 'manager' AND branch_id = get_user_branch_id())
  );

-- Owner can insert profiles (user management)
CREATE POLICY "profiles_insert" ON profiles
  FOR INSERT TO authenticated
  WITH CHECK (
    is_owner()
    OR (get_user_role() = 'manager' AND branch_id = get_user_branch_id())
  );

-- Owner can update any profile; managers can update branch staff; users can update own
CREATE POLICY "profiles_update" ON profiles
  FOR UPDATE TO authenticated
  USING (
    id = auth.uid()
    OR is_owner()
    OR (get_user_role() = 'manager' AND branch_id = get_user_branch_id())
  )
  WITH CHECK (
    id = auth.uid()
    OR is_owner()
    OR (get_user_role() = 'manager' AND branch_id = get_user_branch_id())
  );

-- Only owner can delete profiles
CREATE POLICY "profiles_delete" ON profiles
  FOR DELETE TO authenticated
  USING (is_owner());

-- ============================================================
-- CUSTOMERS
-- ============================================================
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "customers_select" ON customers
  FOR SELECT TO authenticated
  USING (is_owner() OR branch_id = get_user_branch_id());

CREATE POLICY "customers_insert" ON customers
  FOR INSERT TO authenticated
  WITH CHECK (is_owner() OR branch_id = get_user_branch_id());

CREATE POLICY "customers_update" ON customers
  FOR UPDATE TO authenticated
  USING (is_owner() OR branch_id = get_user_branch_id())
  WITH CHECK (is_owner() OR branch_id = get_user_branch_id());

CREATE POLICY "customers_delete" ON customers
  FOR DELETE TO authenticated
  USING (is_owner() OR (get_user_role() = 'manager' AND branch_id = get_user_branch_id()));

-- ============================================================
-- SERVICES
-- ============================================================
ALTER TABLE services ENABLE ROW LEVEL SECURITY;

CREATE POLICY "services_select" ON services
  FOR SELECT TO authenticated
  USING (is_owner() OR branch_id = get_user_branch_id());

CREATE POLICY "services_insert" ON services
  FOR INSERT TO authenticated
  WITH CHECK (
    is_owner()
    OR (get_user_role() = 'manager' AND branch_id = get_user_branch_id())
  );

CREATE POLICY "services_update" ON services
  FOR UPDATE TO authenticated
  USING (
    is_owner()
    OR (get_user_role() = 'manager' AND branch_id = get_user_branch_id())
  )
  WITH CHECK (
    is_owner()
    OR (get_user_role() = 'manager' AND branch_id = get_user_branch_id())
  );

CREATE POLICY "services_delete" ON services
  FOR DELETE TO authenticated
  USING (
    is_owner()
    OR (get_user_role() = 'manager' AND branch_id = get_user_branch_id())
  );

-- ============================================================
-- PRODUCTS
-- ============================================================
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "products_select" ON products
  FOR SELECT TO authenticated
  USING (is_owner() OR branch_id = get_user_branch_id());

CREATE POLICY "products_insert" ON products
  FOR INSERT TO authenticated
  WITH CHECK (
    is_owner()
    OR (get_user_role() = 'manager' AND branch_id = get_user_branch_id())
  );

CREATE POLICY "products_update" ON products
  FOR UPDATE TO authenticated
  USING (
    is_owner()
    OR (get_user_role() = 'manager' AND branch_id = get_user_branch_id())
  )
  WITH CHECK (
    is_owner()
    OR (get_user_role() = 'manager' AND branch_id = get_user_branch_id())
  );

CREATE POLICY "products_delete" ON products
  FOR DELETE TO authenticated
  USING (
    is_owner()
    OR (get_user_role() = 'manager' AND branch_id = get_user_branch_id())
  );

-- ============================================================
-- INVENTORY
-- ============================================================
ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inventory_select" ON inventory
  FOR SELECT TO authenticated
  USING (is_owner() OR branch_id = get_user_branch_id());

CREATE POLICY "inventory_insert" ON inventory
  FOR INSERT TO authenticated
  WITH CHECK (
    is_owner()
    OR (get_user_role() = 'manager' AND branch_id = get_user_branch_id())
  );

CREATE POLICY "inventory_update" ON inventory
  FOR UPDATE TO authenticated
  USING (
    is_owner()
    OR (get_user_role() IN ('manager', 'cashier') AND branch_id = get_user_branch_id())
  )
  WITH CHECK (
    is_owner()
    OR (get_user_role() IN ('manager', 'cashier') AND branch_id = get_user_branch_id())
  );

CREATE POLICY "inventory_delete" ON inventory
  FOR DELETE TO authenticated
  USING (
    is_owner()
    OR (get_user_role() = 'manager' AND branch_id = get_user_branch_id())
  );

-- ============================================================
-- BUNDLES
-- ============================================================
ALTER TABLE bundles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bundles_select" ON bundles
  FOR SELECT TO authenticated
  USING (is_owner() OR branch_id = get_user_branch_id());

CREATE POLICY "bundles_insert" ON bundles
  FOR INSERT TO authenticated
  WITH CHECK (
    is_owner()
    OR (get_user_role() = 'manager' AND branch_id = get_user_branch_id())
  );

CREATE POLICY "bundles_update" ON bundles
  FOR UPDATE TO authenticated
  USING (
    is_owner()
    OR (get_user_role() = 'manager' AND branch_id = get_user_branch_id())
  )
  WITH CHECK (
    is_owner()
    OR (get_user_role() = 'manager' AND branch_id = get_user_branch_id())
  );

CREATE POLICY "bundles_delete" ON bundles
  FOR DELETE TO authenticated
  USING (
    is_owner()
    OR (get_user_role() = 'manager' AND branch_id = get_user_branch_id())
  );

-- ============================================================
-- BUNDLE ITEMS
-- ============================================================
ALTER TABLE bundle_items ENABLE ROW LEVEL SECURITY;

-- Access through bundle ownership
CREATE POLICY "bundle_items_select" ON bundle_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM bundles b
      WHERE b.id = bundle_items.bundle_id
      AND (is_owner() OR b.branch_id = get_user_branch_id())
    )
  );

CREATE POLICY "bundle_items_insert" ON bundle_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM bundles b
      WHERE b.id = bundle_items.bundle_id
      AND (is_owner() OR (get_user_role() = 'manager' AND b.branch_id = get_user_branch_id()))
    )
  );

CREATE POLICY "bundle_items_update" ON bundle_items
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM bundles b
      WHERE b.id = bundle_items.bundle_id
      AND (is_owner() OR (get_user_role() = 'manager' AND b.branch_id = get_user_branch_id()))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM bundles b
      WHERE b.id = bundle_items.bundle_id
      AND (is_owner() OR (get_user_role() = 'manager' AND b.branch_id = get_user_branch_id()))
    )
  );

CREATE POLICY "bundle_items_delete" ON bundle_items
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM bundles b
      WHERE b.id = bundle_items.bundle_id
      AND (is_owner() OR (get_user_role() = 'manager' AND b.branch_id = get_user_branch_id()))
    )
  );

-- ============================================================
-- SALES
-- ============================================================
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sales_select" ON sales
  FOR SELECT TO authenticated
  USING (is_owner() OR branch_id = get_user_branch_id());

-- All authenticated branch users can create sales
CREATE POLICY "sales_insert" ON sales
  FOR INSERT TO authenticated
  WITH CHECK (is_owner() OR branch_id = get_user_branch_id());

-- Only owner/manager can update sales (status changes, refunds)
CREATE POLICY "sales_update" ON sales
  FOR UPDATE TO authenticated
  USING (
    is_owner()
    OR (get_user_role() = 'manager' AND branch_id = get_user_branch_id())
  )
  WITH CHECK (
    is_owner()
    OR (get_user_role() = 'manager' AND branch_id = get_user_branch_id())
  );

-- Only owner can delete sales
CREATE POLICY "sales_delete" ON sales
  FOR DELETE TO authenticated
  USING (is_owner());

-- ============================================================
-- SALE ITEMS
-- ============================================================
ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sale_items_select" ON sale_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM sales s
      WHERE s.id = sale_items.sale_id
      AND (is_owner() OR s.branch_id = get_user_branch_id())
    )
  );

CREATE POLICY "sale_items_insert" ON sale_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM sales s
      WHERE s.id = sale_items.sale_id
      AND (is_owner() OR s.branch_id = get_user_branch_id())
    )
  );

CREATE POLICY "sale_items_delete" ON sale_items
  FOR DELETE TO authenticated
  USING (is_owner());

-- ============================================================
-- PAYMENTS
-- ============================================================
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payments_select" ON payments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM sales s
      WHERE s.id = payments.sale_id
      AND (is_owner() OR s.branch_id = get_user_branch_id())
    )
  );

CREATE POLICY "payments_insert" ON payments
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM sales s
      WHERE s.id = payments.sale_id
      AND (is_owner() OR s.branch_id = get_user_branch_id())
    )
  );

CREATE POLICY "payments_delete" ON payments
  FOR DELETE TO authenticated
  USING (is_owner());

-- ============================================================
-- REFUNDS
-- ============================================================
ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "refunds_select" ON refunds
  FOR SELECT TO authenticated
  USING (is_owner() OR branch_id = get_user_branch_id());

-- Owner and manager can create refunds
CREATE POLICY "refunds_insert" ON refunds
  FOR INSERT TO authenticated
  WITH CHECK (
    is_owner()
    OR (get_user_role() = 'manager' AND branch_id = get_user_branch_id())
  );

CREATE POLICY "refunds_delete" ON refunds
  FOR DELETE TO authenticated
  USING (is_owner());

-- ============================================================
-- REFUND ITEMS
-- ============================================================
ALTER TABLE refund_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "refund_items_select" ON refund_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM refunds r
      WHERE r.id = refund_items.refund_id
      AND (is_owner() OR r.branch_id = get_user_branch_id())
    )
  );

CREATE POLICY "refund_items_insert" ON refund_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM refunds r
      WHERE r.id = refund_items.refund_id
      AND (is_owner() OR (get_user_role() = 'manager' AND r.branch_id = get_user_branch_id()))
    )
  );

CREATE POLICY "refund_items_delete" ON refund_items
  FOR DELETE TO authenticated
  USING (is_owner());

-- ============================================================
-- STOCK ADJUSTMENTS
-- ============================================================
ALTER TABLE stock_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stock_adj_select" ON stock_adjustments
  FOR SELECT TO authenticated
  USING (is_owner() OR branch_id = get_user_branch_id());

CREATE POLICY "stock_adj_insert" ON stock_adjustments
  FOR INSERT TO authenticated
  WITH CHECK (is_owner() OR branch_id = get_user_branch_id());

CREATE POLICY "stock_adj_delete" ON stock_adjustments
  FOR DELETE TO authenticated
  USING (is_owner());

-- ============================================================
-- TREATMENT HISTORY
-- ============================================================
ALTER TABLE treatment_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "treatment_select" ON treatment_history
  FOR SELECT TO authenticated
  USING (is_owner() OR branch_id = get_user_branch_id());

CREATE POLICY "treatment_insert" ON treatment_history
  FOR INSERT TO authenticated
  WITH CHECK (is_owner() OR branch_id = get_user_branch_id());

CREATE POLICY "treatment_update" ON treatment_history
  FOR UPDATE TO authenticated
  USING (
    is_owner()
    OR (get_user_role() IN ('manager', 'cashier') AND branch_id = get_user_branch_id())
  )
  WITH CHECK (
    is_owner()
    OR (get_user_role() IN ('manager', 'cashier') AND branch_id = get_user_branch_id())
  );

CREATE POLICY "treatment_delete" ON treatment_history
  FOR DELETE TO authenticated
  USING (
    is_owner()
    OR (get_user_role() = 'manager' AND branch_id = get_user_branch_id())
  );

-- ============================================================
-- AUDIT LOGS
-- ============================================================
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Owner sees all; manager/cashier see their branch logs
CREATE POLICY "audit_select" ON audit_logs
  FOR SELECT TO authenticated
  USING (
    is_owner()
    OR (get_user_role() = 'manager' AND branch_id = get_user_branch_id())
  );

-- All authenticated users can insert audit logs (logging is universal)
CREATE POLICY "audit_insert" ON audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (TRUE);

-- No one can update or delete audit logs (immutable)
-- (No UPDATE or DELETE policies = denied by default with RLS enabled)

-- ============================================================
-- Enable Realtime for key tables
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE sales;
ALTER PUBLICATION supabase_realtime ADD TABLE inventory;
ALTER PUBLICATION supabase_realtime ADD TABLE audit_logs;
ALTER PUBLICATION supabase_realtime ADD TABLE customers;
