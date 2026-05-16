-- ============================================================
-- 017_void_cascade_treatment_history.sql
--
-- 1. Add sale_id FK to package_sessions (links session → sale)
-- 2. Update record_package_visit RPC to:
--    a. Store sale_id on the package_sessions row
--    b. INSERT into treatment_history for every visit
-- 3. Create void_package_session RPC for atomic cascade void:
--    - Soft-void the session
--    - Void the linked sale
--    - Delete the linked package_payment (trigger recalcs total_paid)
--    - Reverse BOM inventory deductions
--    - Insert audit_log
-- 4. Lock new RPC to service_role only
-- ============================================================


-- ════════════════════════════════════════════════════════════════
-- 1. ADD sale_id FK TO package_sessions
-- ════════════════════════════════════════════════════════════════

ALTER TABLE package_sessions
  ADD COLUMN IF NOT EXISTS sale_id UUID REFERENCES sales(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pkg_sessions_sale
  ON package_sessions(sale_id)
  WHERE sale_id IS NOT NULL;


-- ════════════════════════════════════════════════════════════════
-- 2. UPDATE record_package_visit RPC
--    Now stores sale_id on session + writes treatment_history
-- ════════════════════════════════════════════════════════════════

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

    IF p_receipt_number IS NULL OR TRIM(p_receipt_number) = '' THEN
      RAISE EXCEPTION 'receipt_number is required when payment_amount > 0';
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
  -- 7. DOCTOR COMMISSION
  -- ══════════════════════════════════════════════════════════

  IF p_doctor_id IS NOT NULL THEN
    SELECT * INTO v_doc FROM doctors WHERE id = p_doctor_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Doctor % not found in doctors table', p_doctor_id;
    END IF;
    IF NOT v_doc.is_active THEN
      RAISE EXCEPTION 'Doctor % is inactive', p_doctor_id;
    END IF;

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


-- ════════════════════════════════════════════════════════════════
-- 3. VOID_PACKAGE_SESSION RPC — atomic cascade void
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION void_package_session(
  p_session_id      UUID,
  p_package_id      UUID,
  p_voided_by       UUID,
  p_void_reason     TEXT,
  p_branch_id       UUID
) RETURNS JSONB AS $$
DECLARE
  v_session          RECORD;
  v_sale_id          UUID;
  v_pkg_payment_id   UUID;
  v_bom              RECORD;
  v_inv              RECORD;
  v_new_qty          INT;
  v_sessions_used_before INT;
  v_sessions_used_after  INT;
  v_total_paid_before    NUMERIC(10,2);
  v_total_paid_after     NUMERIC(10,2);
  v_pkg              RECORD;
BEGIN
  -- Lock and fetch session
  SELECT * INTO v_session
    FROM package_sessions
    WHERE id = p_session_id AND package_id = p_package_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session not found in this package'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_session.is_voided THEN
    RAISE EXCEPTION 'Session is already voided';
  END IF;

  -- Snapshot before values
  SELECT sessions_used, total_paid INTO v_sessions_used_before, v_total_paid_before
    FROM patient_packages WHERE id = p_package_id;

  v_sale_id := v_session.sale_id;

  -- ── 1. Soft-void the session (trigger recalculates sessions_used) ──
  UPDATE package_sessions SET
    is_voided = TRUE,
    voided_by = p_voided_by,
    voided_at = NOW(),
    void_reason = p_void_reason
  WHERE id = p_session_id;

  -- ── 2. Void the linked sale (if any) ──
  IF v_sale_id IS NOT NULL THEN
    UPDATE sales SET
      status = 'voided',
      void_approved_by = p_voided_by,
      void_approved_at = NOW()
    WHERE id = v_sale_id;
  END IF;

  -- ── 3. Delete linked package_payment (trigger recalcs total_paid) ──
  -- Find the payment by matching the receipt number from the sale
  IF v_sale_id IS NOT NULL THEN
    -- Find package_payment that matches this sale's receipt
    DELETE FROM package_payments
    WHERE package_id = p_package_id
      AND id IN (
        SELECT pp.id FROM package_payments pp
        JOIN sales s ON s.id = v_sale_id
        WHERE pp.package_id = p_package_id
          AND pp.notes LIKE '%' || s.receipt_number || '%'
        LIMIT 1
      );
  END IF;

  -- ── 4. Reverse BOM inventory deductions ──
  FOR v_bom IN
    SELECT il.product_id, il.quantity_delta, il.inventory_id
    FROM inventory_logs il
    WHERE il.package_session_id = p_session_id
      AND il.source = 'service_bom'
  LOOP
    SELECT * INTO v_inv FROM inventory
      WHERE id = v_bom.inventory_id
      FOR UPDATE;

    IF FOUND THEN
      v_new_qty := v_inv.quantity + ABS(v_bom.quantity_delta);
      UPDATE inventory SET quantity = v_new_qty WHERE id = v_inv.id;

      -- Log the reversal
      INSERT INTO inventory_logs (
        inventory_id, product_id, branch_id, performed_by,
        source, quantity_delta, quantity_before, quantity_after,
        package_session_id, notes
      ) VALUES (
        v_inv.id, v_bom.product_id, p_branch_id, p_voided_by,
        'void_reversal', ABS(v_bom.quantity_delta), v_inv.quantity, v_new_qty,
        p_session_id,
        'BOM reversal — void of session ' || p_session_id
      );
    END IF;
  END LOOP;

  -- ── 5. If package was auto-completed, reactivate it ──
  SELECT * INTO v_pkg FROM patient_packages WHERE id = p_package_id;

  IF v_pkg.status = 'completed' THEN
    -- Check if still fully consumed after void
    SELECT COALESCE(SUM(sessions_count), 0) INTO v_sessions_used_after
      FROM package_sessions
      WHERE package_id = p_package_id AND NOT is_voided;

    IF v_sessions_used_after < v_pkg.total_sessions THEN
      UPDATE patient_packages SET status = 'active' WHERE id = p_package_id;
    END IF;
  END IF;

  -- Snapshot after values
  SELECT sessions_used, total_paid INTO v_sessions_used_after, v_total_paid_after
    FROM patient_packages WHERE id = p_package_id;

  -- ── 6. Audit log ──
  INSERT INTO audit_logs (
    user_id, branch_id, action_type, entity_type, entity_id,
    description, metadata
  ) VALUES (
    p_voided_by, p_branch_id, 'VOID_SESSION', 'package_session', p_session_id,
    'Voided session ' || p_session_id || ' from package ' || p_package_id || '. Reason: ' || p_void_reason,
    jsonb_build_object(
      'package_id', p_package_id,
      'session_id', p_session_id,
      'sale_id', v_sale_id,
      'sessions_count', v_session.sessions_count,
      'sessions_used_before', v_sessions_used_before,
      'sessions_used_after', v_sessions_used_after,
      'total_paid_before', v_total_paid_before,
      'total_paid_after', v_total_paid_after,
      'reason', p_void_reason
    )
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'session_id', p_session_id,
    'sale_id', v_sale_id,
    'sessions_used_before', v_sessions_used_before,
    'sessions_used_after', v_sessions_used_after,
    'total_paid_before', v_total_paid_before,
    'total_paid_after', v_total_paid_after
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ════════════════════════════════════════════════════════════════
-- 4. LOCK NEW RPC TO service_role ONLY
-- ════════════════════════════════════════════════════════════════

REVOKE EXECUTE ON FUNCTION void_package_session(UUID, UUID, UUID, TEXT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION void_package_session(UUID, UUID, UUID, TEXT, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION void_package_session(UUID, UUID, UUID, TEXT, UUID) FROM authenticated;
GRANT  EXECUTE ON FUNCTION void_package_session(UUID, UUID, UUID, TEXT, UUID) TO service_role;

-- Also re-lock the updated record_package_visit
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
-- End of 017_void_cascade_treatment_history.sql
-- ============================================================
