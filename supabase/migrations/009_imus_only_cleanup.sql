-- ============================================================
-- 009_imus_only_cleanup.sql
-- Remove all non-Imus branch data for Imus-only deployment
--
-- SAFE: Uses the existing ON DELETE CASCADE foreign keys.
-- Tables with CASCADE from branches: services, products, inventory,
--   customers, sales (→ sale_items, payments), bundles (→ bundle_items),
--   patient_packages (→ package_payments, package_sessions),
--   shifts (→ cash_movements), doctors, treatment_history
--
-- Tables with SET NULL from branches: profiles.branch_id, audit_logs.branch_id
-- Tables with RESTRICT from branches: refunds.branch_id, stock_adjustments.branch_id,
--   doctor_commissions.branch_id, inventory_logs.branch_id
--
-- Order: clean RESTRICT tables first, then delete branches (CASCADE handles the rest)
-- ============================================================

DO $$
DECLARE
  v_imus_id UUID := 'b0000001-0000-0000-0000-000000000001';
  v_count   INT;
BEGIN
  -- Safety check: Imus branch must exist
  IF NOT EXISTS (SELECT 1 FROM branches WHERE id = v_imus_id) THEN
    RAISE EXCEPTION 'Imus branch not found. Aborting cleanup.';
  END IF;

  -- ── 1. Clean tables with ON DELETE RESTRICT references to branches ──
  --    These would block branch deletion if not cleaned first.

  -- doctor_commissions → branch_id (RESTRICT via doctors → branch_id CASCADE, but direct ref is plain NOT NULL)
  DELETE FROM doctor_commissions WHERE branch_id != v_imus_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Deleted % doctor_commissions rows', v_count;

  -- inventory_logs → branch_id
  DELETE FROM inventory_logs WHERE branch_id != v_imus_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Deleted % inventory_logs rows', v_count;

  -- stock_adjustments → inventory_id (CASCADE from inventory) + branch_id
  DELETE FROM stock_adjustments WHERE branch_id != v_imus_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Deleted % stock_adjustments rows', v_count;

  -- refunds → branch_id (no CASCADE)
  DELETE FROM refunds WHERE branch_id != v_imus_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Deleted % refunds rows', v_count;

  -- refund_items referencing sale_items from non-Imus sales (CASCADE from refunds should handle,
  -- but clean explicitly to be safe)
  DELETE FROM refund_items WHERE refund_id NOT IN (SELECT id FROM refunds);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Deleted % orphaned refund_items rows', v_count;

  -- cash_movements → branch_id + shift_id (SET NULL on shift delete, but branch_id is NOT NULL)
  DELETE FROM cash_movements WHERE branch_id != v_imus_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Deleted % cash_movements rows', v_count;

  -- treatment_history → branch_id
  DELETE FROM treatment_history WHERE branch_id != v_imus_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Deleted % treatment_history rows', v_count;

  -- audit_logs → branch_id (SET NULL, won't block, but clean for consistency)
  DELETE FROM audit_logs WHERE branch_id IS NOT NULL AND branch_id != v_imus_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Deleted % audit_logs rows', v_count;

  -- receipt_counters (if exists) → clean non-Imus counters
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'receipt_counters') THEN
    DELETE FROM receipt_counters WHERE branch_code != 'IMS';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'Deleted % receipt_counters rows', v_count;
  END IF;

  -- ── 2. Delete non-Imus branches (CASCADE handles the rest) ──
  --    This will automatically delete: services, products, inventory,
  --    customers, sales, sale_items, payments, bundles, bundle_items,
  --    patient_packages, package_payments, package_sessions,
  --    shifts, doctors

  DELETE FROM branches WHERE id != v_imus_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Deleted % non-Imus branches (CASCADE cleaned dependent rows)', v_count;

  -- ── 3. Reassign any orphaned profiles to Imus ──
  --    profiles.branch_id is ON DELETE SET NULL, so non-Imus staff
  --    now have NULL branch_id. Reassign them to Imus.
  UPDATE profiles SET branch_id = v_imus_id WHERE branch_id IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Reassigned % profiles to Imus branch', v_count;

  RAISE NOTICE '✅ Cleanup complete. Only Imus branch data remains.';
END $$;
