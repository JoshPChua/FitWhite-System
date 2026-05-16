-- ============================================================
-- 015_customer_lifecycle_session_accuracy.sql
--
-- Part A: Customer lifecycle tracking
--   • last_contact_at column on customers
--   • Trigger: package_sessions INSERT → update last_contact_at
--   • Trigger: package_payments INSERT → update last_transaction_at
--   • Backfill from existing data
--
-- Part B: Session accuracy / soft-void support
--   • is_voided, voided_by, voided_at, void_reason on package_sessions
--   • Upgraded sync_package_sessions_used trigger → handles INSERT + UPDATE
--   • Excludes voided sessions from SUM
-- ============================================================


-- ════════════════════════════════════════════════════════════════
-- PART A: CUSTOMER LIFECYCLE
-- ════════════════════════════════════════════════════════════════

-- ─── New column: last_contact_at ─────────────────────────────
ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_contact_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_customers_last_contact ON customers(last_contact_at);

-- ─── Trigger: package_payments → update last_transaction_at ──
-- Joins through patient_packages to resolve customer_id.
CREATE OR REPLACE FUNCTION update_customer_last_tx_from_package_payment()
RETURNS TRIGGER AS $$
DECLARE
  v_customer_id UUID;
BEGIN
  SELECT customer_id INTO v_customer_id
  FROM patient_packages
  WHERE id = NEW.package_id;

  IF v_customer_id IS NOT NULL THEN
    UPDATE customers
    SET last_transaction_at = NEW.created_at
    WHERE id = v_customer_id
      AND (last_transaction_at IS NULL OR last_transaction_at < NEW.created_at);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_update_customer_last_tx_from_pkg_pmt ON package_payments;
CREATE TRIGGER trg_update_customer_last_tx_from_pkg_pmt
  AFTER INSERT ON package_payments
  FOR EACH ROW
  EXECUTE FUNCTION update_customer_last_tx_from_package_payment();

-- ─── Trigger: package_sessions → update last_contact_at ──────
-- Joins through patient_packages to resolve customer_id.
CREATE OR REPLACE FUNCTION update_customer_last_contact_from_session()
RETURNS TRIGGER AS $$
DECLARE
  v_customer_id UUID;
BEGIN
  -- Only update for non-voided sessions
  IF NEW.is_voided IS NOT NULL AND NEW.is_voided = TRUE THEN
    RETURN NEW;
  END IF;

  SELECT customer_id INTO v_customer_id
  FROM patient_packages
  WHERE id = NEW.package_id;

  IF v_customer_id IS NOT NULL THEN
    UPDATE customers
    SET last_contact_at = NEW.created_at
    WHERE id = v_customer_id
      AND (last_contact_at IS NULL OR last_contact_at < NEW.created_at);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_update_customer_last_contact_from_session ON package_sessions;
CREATE TRIGGER trg_update_customer_last_contact_from_session
  AFTER INSERT ON package_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_customer_last_contact_from_session();

-- ─── Backfill last_contact_at from existing package_sessions ─
UPDATE customers c
SET last_contact_at = sub.last_dt
FROM (
  SELECT pp.customer_id, MAX(ps.created_at) AS last_dt
  FROM package_sessions ps
  JOIN patient_packages pp ON pp.id = ps.package_id
  GROUP BY pp.customer_id
) sub
WHERE c.id = sub.customer_id
  AND (c.last_contact_at IS NULL OR c.last_contact_at < sub.last_dt);

-- ─── Backfill last_transaction_at from existing package_payments ─
UPDATE customers c
SET last_transaction_at = sub.last_dt
FROM (
  SELECT pp.customer_id, MAX(ppmt.created_at) AS last_dt
  FROM package_payments ppmt
  JOIN patient_packages pp ON pp.id = ppmt.package_id
  GROUP BY pp.customer_id
) sub
WHERE c.id = sub.customer_id
  AND (c.last_transaction_at IS NULL OR c.last_transaction_at < sub.last_dt);


-- ════════════════════════════════════════════════════════════════
-- PART B: SESSION ACCURACY — SOFT-VOID SUPPORT
-- ════════════════════════════════════════════════════════════════

-- ─── Add void columns to package_sessions ────────────────────
ALTER TABLE package_sessions
  ADD COLUMN IF NOT EXISTS is_voided   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS voided_by   UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS voided_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS void_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_pkg_sessions_voided
  ON package_sessions(package_id)
  WHERE NOT is_voided;

-- ─── Upgrade sync_package_sessions_used trigger function ─────
-- Now:
--  • Fires on INSERT and UPDATE (to handle void toggling)
--  • Excludes voided sessions from the SUM
--  • Recalculates from scratch (not incremental)

CREATE OR REPLACE FUNCTION sync_package_sessions_used()
RETURNS TRIGGER AS $$
DECLARE
  v_total_sessions    INT;
  v_new_sessions_used INT;
  v_package_id        UUID;
BEGIN
  -- Determine which package to recalculate
  IF TG_OP = 'DELETE' THEN
    v_package_id := OLD.package_id;
  ELSE
    v_package_id := NEW.package_id;
  END IF;

  -- Sum all non-voided sessions for this package
  SELECT COALESCE(SUM(sessions_count), 0)
  INTO v_new_sessions_used
  FROM package_sessions
  WHERE package_id = v_package_id
    AND NOT is_voided;

  -- Read total_sessions to enforce cap
  SELECT total_sessions INTO v_total_sessions
  FROM patient_packages
  WHERE id = v_package_id;

  IF v_new_sessions_used > v_total_sessions THEN
    RAISE EXCEPTION
      'Session rejected: sessions used (%) would exceed total sessions (%) for package %',
      v_new_sessions_used, v_total_sessions, v_package_id
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE patient_packages
  SET sessions_used  = v_new_sessions_used,
      updated_at     = NOW()
  WHERE id = v_package_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop the old INSERT-only trigger and recreate for INSERT + UPDATE + DELETE
DROP TRIGGER IF EXISTS pkg_sessions_sync ON package_sessions;
CREATE TRIGGER pkg_sessions_sync
  AFTER INSERT OR UPDATE OR DELETE ON package_sessions
  FOR EACH ROW EXECUTE FUNCTION sync_package_sessions_used();

COMMENT ON FUNCTION sync_package_sessions_used() IS
  'Maintains patient_packages.sessions_used from SUM of non-voided sessions.
   Fires on INSERT, UPDATE, and DELETE. Enforces sessions_used <= total_sessions.
   Recalculates from scratch (not incremental) to stay correct after void toggling.';


-- ─── Update record_package_visit RPC to exclude voided sessions ─
-- The RPC calculates remaining sessions. It must exclude voided rows.
-- We replace the relevant check with a voided-aware query.
-- Note: The RPC uses the inline var v_sessions_remaining.
-- Updating the full function is required since PL/pgSQL doesn't support
-- partial patches. See 012_record_visit_rpc.sql for the full original.

-- This is handled by the upgraded trigger above — the trigger now
-- excludes voided sessions, so sessions_used on patient_packages
-- is always the correct non-voided count. The RPC reads sessions_remaining
-- from patient_packages (which is GENERATED AS total_sessions - sessions_used),
-- so it's automatically correct.


-- ============================================================
-- End of 015_customer_lifecycle_session_accuracy.sql
-- ============================================================
