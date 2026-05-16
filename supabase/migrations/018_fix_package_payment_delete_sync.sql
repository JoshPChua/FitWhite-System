-- ============================================================
-- 018_fix_package_payment_delete_sync.sql
--
-- P1-1: Fix sync_package_total_paid trigger
--   • Support INSERT, UPDATE, and DELETE on package_payments
--   • Use TG_OP to resolve package_id from NEW or OLD
--   • Recalculate total_paid from SUM(amount)
--   • Overpayment guard only on INSERT/UPDATE
--   • Ensures void_package_session (which DELETEs package_payments)
--     correctly decreases total_paid and remaining_balance
--
-- P2-1: Harden auditor RLS for package tables
--   • patient_packages INSERT/UPDATE — exclude auditor
--   • package_payments INSERT — exclude auditor
--   • package_sessions INSERT — exclude auditor
--   • Auditor retains SELECT on all (branch-scoped)
--
-- P2-2: Harden record_package_visit RPC input validation
--   • p_sessions_count must be integer >= 1
--   • p_payment_amount must be >= 0
--   • receipt_number required when payment_amount > 0
--   • Doctor must exist, be active, and belong to p_branch_id
-- ============================================================


-- ═══════════════════════════════════════════════════════════════
-- P1-1: REPLACE sync_package_total_paid TRIGGER
-- ═══════════════════════════════════════════════════════════════

-- Drop old trigger first (INSERT-only)
DROP TRIGGER IF EXISTS pkg_payments_sync ON package_payments;

CREATE OR REPLACE FUNCTION sync_package_total_paid()
RETURNS TRIGGER AS $$
DECLARE
  v_package_id     UUID;
  v_total_price    DECIMAL(10,2);
  v_new_total_paid DECIMAL(10,2);
BEGIN
  -- Determine which package to recalculate
  IF TG_OP = 'DELETE' THEN
    v_package_id := OLD.package_id;
  ELSE
    v_package_id := NEW.package_id;
  END IF;

  -- Sum all payments for this package
  SELECT COALESCE(SUM(amount), 0)
  INTO v_new_total_paid
  FROM package_payments
  WHERE package_id = v_package_id;

  -- Read total_price to enforce cap (INSERT/UPDATE only)
  IF TG_OP != 'DELETE' THEN
    SELECT total_price INTO v_total_price
    FROM patient_packages
    WHERE id = v_package_id;

    IF v_new_total_paid > v_total_price THEN
      RAISE EXCEPTION
        'Payment rejected: total payments (%) would exceed package total price (%) for package %',
        v_new_total_paid, v_total_price, v_package_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Update patient_packages.total_paid
  -- (remaining_balance is GENERATED ALWAYS AS total_price - total_paid)
  UPDATE patient_packages
  SET total_paid  = v_new_total_paid,
      updated_at  = NOW()
  WHERE id = v_package_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate trigger for INSERT + UPDATE + DELETE
CREATE TRIGGER pkg_payments_sync
  AFTER INSERT OR UPDATE OR DELETE ON package_payments
  FOR EACH ROW EXECUTE FUNCTION sync_package_total_paid();

COMMENT ON FUNCTION sync_package_total_paid() IS
  'Maintains patient_packages.total_paid from SUM(package_payments.amount).
   Fires on INSERT, UPDATE, and DELETE. Enforces total_paid <= total_price
   on INSERT/UPDATE (overpayment guard). On DELETE (e.g. void cascade),
   recalculates total_paid downward without the overpayment check.
   remaining_balance updates automatically as a GENERATED column.';


-- ═══════════════════════════════════════════════════════════════
-- P2-1: AUDITOR RLS — EXCLUDE FROM PACKAGE WRITES
-- ═══════════════════════════════════════════════════════════════
-- is_not_auditor() already exists from 014_auditor_rls_hardening.sql.

-- ─── patient_packages INSERT ─────────────────────────────────
DROP POLICY IF EXISTS "patient_packages_insert" ON patient_packages;
CREATE POLICY "patient_packages_insert" ON patient_packages
  FOR INSERT TO authenticated
  WITH CHECK (
    is_not_auditor()
    AND (is_owner() OR branch_id = get_user_branch_id())
  );

-- ─── patient_packages UPDATE ─────────────────────────────────
DROP POLICY IF EXISTS "patient_packages_update" ON patient_packages;
CREATE POLICY "patient_packages_update" ON patient_packages
  FOR UPDATE TO authenticated
  USING (
    is_not_auditor()
    AND (is_owner() OR (is_manager_or_owner() AND branch_id = get_user_branch_id()))
  )
  WITH CHECK (
    is_not_auditor()
    AND (is_owner() OR (is_manager_or_owner() AND branch_id = get_user_branch_id()))
  );

-- ─── package_payments INSERT ─────────────────────────────────
DROP POLICY IF EXISTS "pkg_payments_insert" ON package_payments;
CREATE POLICY "pkg_payments_insert" ON package_payments
  FOR INSERT TO authenticated
  WITH CHECK (
    is_not_auditor()
    AND (is_owner() OR branch_id = get_user_branch_id())
  );

-- ─── package_sessions INSERT ─────────────────────────────────
DROP POLICY IF EXISTS "pkg_sessions_insert" ON package_sessions;
CREATE POLICY "pkg_sessions_insert" ON package_sessions
  FOR INSERT TO authenticated
  WITH CHECK (
    is_not_auditor()
    AND (is_owner() OR branch_id = get_user_branch_id())
  );


-- ═══════════════════════════════════════════════════════════════
-- P2-2: HARDEN record_package_visit RPC INPUT VALIDATION
-- ═══════════════════════════════════════════════════════════════
-- Full replace of the RPC. All existing logic is preserved;
-- hardened input checks are added at the top, and the doctor
-- block now validates branch_id match.

CREATE OR REPLACE FUNCTION record_package_visit(
  p_package_id       UUID,
  p_branch_id        UUID,
  p_performed_by     UUID,
  p_doctor_id        UUID       DEFAULT NULL,
  p_sessions_count   INT        DEFAULT 1,
  p_notes            TEXT       DEFAULT NULL,
  p_payment_amount   NUMERIC(10,2)  DEFAULT 0,
  p_payment_method   payment_method DEFAULT 'cash',
  p_reference_number VARCHAR(100)   DEFAULT NULL,
  p_receipt_number   TEXT       DEFAULT NULL,
  p_customer_id      UUID       DEFAULT NULL,
  p_service_name     TEXT       DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_pkg              RECORD;
  v_service_id       UUID;
  v_sessions_remaining INT;
  v_remaining_balance NUMERIC(10,2);
  v_bom              RECORD;
  v_inv              RECORD;
  v_new_qty          INT;
  v_session_id       UUID;
  v_sale_id          UUID;
  v_sale_item_id     UUID;
  v_payment_id       UUID;
  v_pkg_payment_id   UUID;
  v_doc              RECORD;
  v_gross_amount     NUMERIC(10,2);
  v_comm_amount      NUMERIC(10,2);
  v_comm_rate        NUMERIC(5,4);
  v_auto_completed   BOOLEAN := FALSE;
  v_customer_id      UUID;
BEGIN
  -- ══════════════════════════════════════════════════════════
  -- 0. INPUT VALIDATION (fail-fast before any reads/writes)
  -- ══════════════════════════════════════════════════════════

  IF p_sessions_count IS NULL OR p_sessions_count < 1 THEN
    RAISE EXCEPTION 'p_sessions_count must be an integer >= 1, got %', p_sessions_count
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_payment_amount IS NULL OR p_payment_amount < 0 THEN
    RAISE EXCEPTION 'p_payment_amount must be >= 0, got %', p_payment_amount
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_payment_amount > 0 THEN
    IF p_receipt_number IS NULL OR TRIM(p_receipt_number) = '' THEN
      RAISE EXCEPTION 'receipt_number is required when payment_amount > 0'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
  END IF;

  -- Doctor validation (must exist, be active, and belong to this branch)
  IF p_doctor_id IS NOT NULL THEN
    SELECT * INTO v_doc FROM doctors WHERE id = p_doctor_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Doctor % not found in doctors table', p_doctor_id
        USING ERRCODE = 'P0002';
    END IF;
    IF NOT v_doc.is_active THEN
      RAISE EXCEPTION 'Doctor % is inactive — cannot assign to session', p_doctor_id;
    END IF;
    IF v_doc.branch_id != p_branch_id THEN
      RAISE EXCEPTION 'Doctor % belongs to a different branch — cannot assign to session in branch %',
        p_doctor_id, p_branch_id;
    END IF;
  END IF;

  -- ══════════════════════════════════════════════════════════
  -- 1. LOCK + VALIDATE PACKAGE
  -- ══════════════════════════════════════════════════════════

  SELECT * INTO v_pkg
    FROM patient_packages
    WHERE id = p_package_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Package not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_pkg.status != 'active' THEN
    RAISE EXCEPTION 'Package is % — cannot consume sessions', v_pkg.status;
  END IF;

  IF v_pkg.branch_id != p_branch_id THEN
    RAISE EXCEPTION 'Branch mismatch'
      USING ERRCODE = '42501';
  END IF;

  v_service_id := v_pkg.service_id;
  v_customer_id := COALESCE(p_customer_id, v_pkg.customer_id);
  v_sessions_remaining := v_pkg.total_sessions - v_pkg.sessions_used;

  IF p_sessions_count > v_sessions_remaining THEN
    RAISE EXCEPTION 'Insufficient sessions. Remaining: %, Requested: %',
      v_sessions_remaining, p_sessions_count;
  END IF;

  -- ══════════════════════════════════════════════════════════
  -- 2. VALIDATE PAYMENT
  -- ══════════════════════════════════════════════════════════

  IF p_payment_amount > 0 THEN
    v_remaining_balance := v_pkg.total_price - v_pkg.total_paid;

    IF p_payment_amount > v_remaining_balance + 0.01 THEN
      RAISE EXCEPTION 'Payment exceeds remaining balance. Balance: %, Payment: %',
        v_remaining_balance, p_payment_amount;
    END IF;
  END IF;

  -- ══════════════════════════════════════════════════════════
  -- 3. PRE-VALIDATE BOM STOCK
  -- ══════════════════════════════════════════════════════════

  FOR v_bom IN
    SELECT sc.product_id,
           sc.quantity * p_sessions_count AS needed,
           p.name AS product_name
    FROM service_consumables sc
    JOIN products p ON p.id = sc.product_id
    WHERE sc.service_id = v_service_id
  LOOP
    SELECT * INTO v_inv
      FROM inventory
      WHERE product_id = v_bom.product_id
        AND branch_id  = p_branch_id
      FOR UPDATE;

    IF NOT FOUND OR v_inv.quantity < v_bom.needed THEN
      RAISE EXCEPTION 'Insufficient stock for "%": need %, have %',
        v_bom.product_name, v_bom.needed, COALESCE(v_inv.quantity, 0);
    END IF;
  END LOOP;

  -- ══════════════════════════════════════════════════════════
  -- ALL VALIDATIONS PASSED — begin mutations
  -- ══════════════════════════════════════════════════════════

  -- ══════════════════════════════════════════════════════════
  -- 4. PAYMENT WRITES (if payment_amount > 0)
  -- ══════════════════════════════════════════════════════════

  v_sale_id := NULL;

  IF p_payment_amount > 0 THEN
    INSERT INTO sales (
      receipt_number, branch_id, user_id, customer_id,
      subtotal, discount, tax, total,
      status, payment_type, notes
    ) VALUES (
      p_receipt_number, p_branch_id, p_performed_by, v_customer_id,
      p_payment_amount, 0, 0, p_payment_amount,
      'completed', 'installment',
      'Installment payment — ' || COALESCE(p_service_name, 'Package Service')
    ) RETURNING id INTO v_sale_id;

    INSERT INTO sale_items (
      sale_id, item_type, service_id, name,
      quantity, unit_price, total_price
    ) VALUES (
      v_sale_id, 'service', v_service_id,
      COALESCE(p_service_name, 'Package Service') || ' — Installment Payment',
      1, p_payment_amount, p_payment_amount
    ) RETURNING id INTO v_sale_item_id;

    INSERT INTO payments (
      sale_id, method, amount, reference_number
    ) VALUES (
      v_sale_id, p_payment_method, p_payment_amount, p_reference_number
    ) RETURNING id INTO v_payment_id;

    INSERT INTO package_payments (
      package_id, branch_id, received_by,
      amount, method, reference_number, notes
    ) VALUES (
      p_package_id, p_branch_id, p_performed_by,
      p_payment_amount, p_payment_method, p_reference_number,
      'Installment payment — Receipt ' || p_receipt_number
    ) RETURNING id INTO v_pkg_payment_id;
  END IF;

  -- ══════════════════════════════════════════════════════════
  -- 5. CONSUME SESSION (with sale_id link)
  -- ══════════════════════════════════════════════════════════

  INSERT INTO package_sessions (
    package_id, branch_id, performed_by,
    doctor_id, sessions_count, notes, sale_id
  ) VALUES (
    p_package_id, p_branch_id, p_performed_by,
    p_doctor_id, p_sessions_count, p_notes, v_sale_id
  ) RETURNING id INTO v_session_id;

  -- ══════════════════════════════════════════════════════════
  -- 5b. WRITE TREATMENT HISTORY for customer profile
  -- ══════════════════════════════════════════════════════════

  INSERT INTO treatment_history (
    customer_id, branch_id, service_name,
    notes, administered_by
  ) VALUES (
    v_customer_id, p_branch_id,
    COALESCE(p_service_name, 'Package Service') || ' (Session ' ||
      (v_pkg.sessions_used + p_sessions_count) || '/' || v_pkg.total_sessions || ')',
    COALESCE(p_notes, 'Package visit'),
    p_performed_by
  );

  -- ══════════════════════════════════════════════════════════
  -- 6. DEDUCT BOM + WRITE INVENTORY LOGS
  -- ══════════════════════════════════════════════════════════

  FOR v_bom IN
    SELECT sc.product_id,
           sc.quantity * p_sessions_count AS needed
    FROM service_consumables sc
    WHERE sc.service_id = v_service_id
  LOOP
    SELECT * INTO v_inv
      FROM inventory
      WHERE product_id = v_bom.product_id
        AND branch_id  = p_branch_id
      FOR UPDATE;

    v_new_qty := v_inv.quantity - v_bom.needed;
    UPDATE inventory SET quantity = v_new_qty WHERE id = v_inv.id;

    INSERT INTO inventory_logs (
      inventory_id, product_id, branch_id, performed_by,
      source, quantity_delta, quantity_before, quantity_after,
      package_session_id, notes
    ) VALUES (
      v_inv.id, v_bom.product_id, p_branch_id, p_performed_by,
      'service_bom', -v_bom.needed, v_inv.quantity, v_new_qty,
      v_session_id,
      'BOM deduction for session on package ' || p_package_id
    );
  END LOOP;

  -- ══════════════════════════════════════════════════════════
  -- 7. DOCTOR COMMISSION (doctor already validated at step 0)
  -- ══════════════════════════════════════════════════════════

  IF p_doctor_id IS NOT NULL THEN
    -- v_doc was already fetched and validated in step 0

    v_gross_amount := (v_pkg.total_price::NUMERIC / v_pkg.total_sessions) * p_sessions_count;
    v_comm_rate := NULL;
    v_comm_amount := 0;

    IF v_doc.default_commission_type = 'fixed' THEN
      v_comm_amount := COALESCE(v_doc.default_commission_value, 0);
    ELSE
      v_comm_rate := COALESCE(v_doc.default_commission_value, 0);
      v_comm_amount := v_gross_amount * v_comm_rate;
    END IF;

    IF v_comm_amount > 0 THEN
      INSERT INTO doctor_commissions (
        branch_id, doctor_id, package_session_id,
        gross_amount, commission_rate, commission_amount
      ) VALUES (
        p_branch_id, p_doctor_id, v_session_id,
        v_gross_amount, v_comm_rate, ROUND(v_comm_amount, 2)
      );
    END IF;
  END IF;

  -- ══════════════════════════════════════════════════════════
  -- 8. AUTO-COMPLETE IF FULLY CONSUMED
  -- ══════════════════════════════════════════════════════════

  v_auto_completed := (v_pkg.sessions_used + p_sessions_count) >= v_pkg.total_sessions;

  IF v_auto_completed THEN
    UPDATE patient_packages SET status = 'completed'
      WHERE id = p_package_id;
  END IF;

  -- ══════════════════════════════════════════════════════════
  -- RETURN
  -- ══════════════════════════════════════════════════════════

  RETURN jsonb_build_object(
    'session_id',          v_session_id,
    'sessions_remaining',  v_sessions_remaining - p_sessions_count,
    'auto_completed',      v_auto_completed,
    'sale_id',             v_sale_id,
    'receipt_number',      p_receipt_number,
    'package_payment_id',  v_pkg_payment_id,
    'payment_recorded',    p_payment_amount > 0
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-lock both RPCs to service_role only
REVOKE EXECUTE ON FUNCTION record_package_visit(
  UUID, UUID, UUID, UUID, INT, TEXT,
  NUMERIC, payment_method, VARCHAR, TEXT, UUID, TEXT
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION record_package_visit(
  UUID, UUID, UUID, UUID, INT, TEXT,
  NUMERIC, payment_method, VARCHAR, TEXT, UUID, TEXT
) FROM anon;
REVOKE EXECUTE ON FUNCTION record_package_visit(
  UUID, UUID, UUID, UUID, INT, TEXT,
  NUMERIC, payment_method, VARCHAR, TEXT, UUID, TEXT
) FROM authenticated;
GRANT EXECUTE ON FUNCTION record_package_visit(
  UUID, UUID, UUID, UUID, INT, TEXT,
  NUMERIC, payment_method, VARCHAR, TEXT, UUID, TEXT
) TO service_role;


-- ============================================================
-- End of 018_fix_package_payment_delete_sync.sql
-- ============================================================
