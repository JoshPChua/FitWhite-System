-- ============================================================
-- 008_doctor_branch_guard.sql
-- Tighten doctor_commissions trigger: branch-match enforcement
-- ============================================================

-- Rewrite guard_commission_amount() to use a local doctor record
-- and enforce branch-level integrity alongside the existing checks.

CREATE OR REPLACE FUNCTION guard_commission_amount()
RETURNS TRIGGER AS $$
DECLARE
  v_doc RECORD;
BEGIN
  -- Fetch the doctor record
  SELECT id, branch_id, is_active INTO v_doc
    FROM doctors WHERE id = NEW.doctor_id;

  -- Doctor must exist
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Commission rejected: doctor % not found in doctors table',
      NEW.doctor_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  -- Doctor must be active
  IF NOT v_doc.is_active THEN
    RAISE EXCEPTION
      'Commission rejected: doctor % is inactive',
      NEW.doctor_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  -- Doctor branch must match commission branch
  IF v_doc.branch_id != NEW.branch_id THEN
    RAISE EXCEPTION
      'Commission rejected: doctor branch (%) does not match commission branch (%)',
      v_doc.branch_id, NEW.branch_id
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

-- ============================================================
-- End of 008_doctor_branch_guard.sql
-- ============================================================
