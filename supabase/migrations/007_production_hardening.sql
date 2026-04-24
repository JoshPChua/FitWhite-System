-- ============================================================
-- 007_production_hardening.sql
-- P1 Fixes: commission trigger, atomic receipts, atomic sessions
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. REWRITE guard_commission_amount() trigger
--    Source of truth: doctors table (not profiles.is_doctor)
--    Removes legacy override_reason enforcement
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION guard_commission_amount()
RETURNS TRIGGER AS $$
BEGIN
  -- Validate doctor exists in standalone doctors table and is active
  IF NOT EXISTS (
    SELECT 1 FROM doctors WHERE id = NEW.doctor_id AND is_active = true
  ) THEN
    RAISE EXCEPTION
      'Commission rejected: doctor % not found or inactive in doctors table',
      NEW.doctor_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  -- commission_amount must not exceed gross_amount
  IF NEW.commission_amount > NEW.gross_amount THEN
    RAISE EXCEPTION
      'Commission rejected: commission_amount (%) exceeds gross_amount (%)',
      NEW.commission_amount, NEW.gross_amount
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────
-- 2. ATOMIC RECEIPT COUNTER
--    Replaces the race-prone MAX(...)+1 approach
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS receipt_counters (
  branch_code TEXT    NOT NULL,
  receipt_date DATE   NOT NULL,
  last_seq     INT    NOT NULL DEFAULT 0,
  PRIMARY KEY (branch_code, receipt_date)
);

-- Seed from existing sales so the counter starts above existing receipts
-- Handles format: {code}-{YYYYMMDD}-{NNNN}
INSERT INTO receipt_counters (branch_code, receipt_date, last_seq)
SELECT
  SUBSTRING(receipt_number FROM 1 FOR LENGTH(receipt_number) - 14),
  TO_DATE(SUBSTRING(receipt_number FROM LENGTH(receipt_number) - 12 FOR 8), 'YYYYMMDD'),
  MAX(CAST(SUBSTRING(receipt_number FROM LENGTH(receipt_number) - 3) AS INT))
FROM sales
WHERE receipt_number IS NOT NULL
  AND LENGTH(receipt_number) > 14
GROUP BY 1, 2
ON CONFLICT (branch_code, receipt_date) DO UPDATE
  SET last_seq = GREATEST(receipt_counters.last_seq, EXCLUDED.last_seq);

-- Rewrite the function to use atomic INSERT ON CONFLICT
CREATE OR REPLACE FUNCTION generate_receipt_number(branch_code TEXT)
RETURNS TEXT AS $$
DECLARE seq_val INT;
BEGIN
  INSERT INTO receipt_counters (branch_code, receipt_date, last_seq)
  VALUES (branch_code, CURRENT_DATE, 1)
  ON CONFLICT (branch_code, receipt_date)
  DO UPDATE SET last_seq = receipt_counters.last_seq + 1
  RETURNING last_seq INTO seq_val;

  RETURN branch_code || '-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD')
         || '-' || LPAD(seq_val::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────
-- 3. ATOMIC SESSION RPC: consume_package_session()
--    One Postgres transaction for: session + BOM + commission
--    Any failure → automatic full rollback
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION consume_package_session(
  p_package_id   UUID,
  p_branch_id    UUID,
  p_performed_by UUID,
  p_doctor_id    UUID    DEFAULT NULL,
  p_sessions_count INT   DEFAULT 1,
  p_notes        TEXT    DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_pkg              RECORD;
  v_service_id       UUID;
  v_sessions_remaining INT;
  v_bom              RECORD;
  v_inv              RECORD;
  v_new_qty          INT;
  v_session_id       UUID;
  v_doc              RECORD;
  v_gross_amount     NUMERIC(10,2);
  v_comm_amount      NUMERIC(10,2);
  v_comm_rate        NUMERIC(5,4);
BEGIN
  -- ── 1. Lock + validate package ────────────────────────────
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

  v_sessions_remaining := v_pkg.total_sessions - v_pkg.sessions_used;
  IF p_sessions_count > v_sessions_remaining THEN
    RAISE EXCEPTION 'Insufficient sessions. Remaining: %, Requested: %',
      v_sessions_remaining, p_sessions_count;
  END IF;

  v_service_id := v_pkg.service_id;

  -- ── 2. Pre-validate ALL BOM stock (before any mutation) ───
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

  -- ── 3. Insert session (DB trigger updates sessions_used) ──
  INSERT INTO package_sessions (
    package_id, branch_id, performed_by,
    doctor_id, sessions_count, notes
  ) VALUES (
    p_package_id, p_branch_id, p_performed_by,
    p_doctor_id, p_sessions_count, p_notes
  ) RETURNING id INTO v_session_id;

  -- ── 4. Deduct BOM + write inventory_logs (atomically) ─────
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

  -- ── 5. Doctor commission (REQUIRED if doctor specified) ────
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

  -- ── 6. Auto-complete if fully consumed ────────────────────
  IF (v_pkg.sessions_used + p_sessions_count) >= v_pkg.total_sessions THEN
    UPDATE patient_packages SET status = 'completed'
      WHERE id = p_package_id;
  END IF;

  -- ── Return ────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'session_id', v_session_id,
    'sessions_remaining', v_sessions_remaining - p_sessions_count,
    'auto_completed', (v_pkg.sessions_used + p_sessions_count) >= v_pkg.total_sessions
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- End of 007_production_hardening.sql
-- ============================================================
