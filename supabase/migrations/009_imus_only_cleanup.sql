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
  v_imus_id UUID;
  v_count   INT;
BEGIN
  -- Look up Imus branch by code (works regardless of UUID format)
  SELECT id INTO v_imus_id FROM branches WHERE code = 'IMS' LIMIT 1;

  IF v_imus_id IS NULL THEN
    RAISE EXCEPTION 'Imus branch (code=IMS) not found. Aborting cleanup.';
  END IF;

  RAISE NOTICE 'Found Imus branch: %', v_imus_id;

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

  -- ── 4. Post-cleanup invariant checks ──────────────────────
  --    Raise an exception if ANY non-Imus data remains.

  -- branches
  SELECT COUNT(*) INTO v_count FROM branches WHERE code != 'IMS';
  IF v_count > 0 THEN RAISE EXCEPTION 'INVARIANT FAIL: % non-Imus branches remain', v_count; END IF;

  -- profiles
  SELECT COUNT(*) INTO v_count FROM profiles WHERE branch_id IS NULL;
  IF v_count > 0 THEN RAISE EXCEPTION 'INVARIANT FAIL: % profiles have NULL branch_id', v_count; END IF;

  SELECT COUNT(*) INTO v_count FROM profiles WHERE branch_id != v_imus_id;
  IF v_count > 0 THEN RAISE EXCEPTION 'INVARIANT FAIL: % profiles not on Imus', v_count; END IF;

  -- core branch-scoped tables
  SELECT COUNT(*) INTO v_count FROM services WHERE branch_id != v_imus_id;
  IF v_count > 0 THEN RAISE EXCEPTION 'INVARIANT FAIL: % non-Imus services', v_count; END IF;

  SELECT COUNT(*) INTO v_count FROM products WHERE branch_id != v_imus_id;
  IF v_count > 0 THEN RAISE EXCEPTION 'INVARIANT FAIL: % non-Imus products', v_count; END IF;

  SELECT COUNT(*) INTO v_count FROM inventory WHERE branch_id != v_imus_id;
  IF v_count > 0 THEN RAISE EXCEPTION 'INVARIANT FAIL: % non-Imus inventory', v_count; END IF;

  SELECT COUNT(*) INTO v_count FROM customers WHERE branch_id != v_imus_id;
  IF v_count > 0 THEN RAISE EXCEPTION 'INVARIANT FAIL: % non-Imus customers', v_count; END IF;

  SELECT COUNT(*) INTO v_count FROM sales WHERE branch_id != v_imus_id;
  IF v_count > 0 THEN RAISE EXCEPTION 'INVARIANT FAIL: % non-Imus sales', v_count; END IF;

  SELECT COUNT(*) INTO v_count FROM bundles WHERE branch_id != v_imus_id;
  IF v_count > 0 THEN RAISE EXCEPTION 'INVARIANT FAIL: % non-Imus bundles', v_count; END IF;

  SELECT COUNT(*) INTO v_count FROM patient_packages WHERE branch_id != v_imus_id;
  IF v_count > 0 THEN RAISE EXCEPTION 'INVARIANT FAIL: % non-Imus patient_packages', v_count; END IF;

  SELECT COUNT(*) INTO v_count FROM package_payments WHERE branch_id != v_imus_id;
  IF v_count > 0 THEN RAISE EXCEPTION 'INVARIANT FAIL: % non-Imus package_payments', v_count; END IF;

  SELECT COUNT(*) INTO v_count FROM package_sessions WHERE branch_id != v_imus_id;
  IF v_count > 0 THEN RAISE EXCEPTION 'INVARIANT FAIL: % non-Imus package_sessions', v_count; END IF;

  SELECT COUNT(*) INTO v_count FROM shifts WHERE branch_id != v_imus_id;
  IF v_count > 0 THEN RAISE EXCEPTION 'INVARIANT FAIL: % non-Imus shifts', v_count; END IF;

  SELECT COUNT(*) INTO v_count FROM doctors WHERE branch_id != v_imus_id;
  IF v_count > 0 THEN RAISE EXCEPTION 'INVARIANT FAIL: % non-Imus doctors', v_count; END IF;

  SELECT COUNT(*) INTO v_count FROM doctor_commissions WHERE branch_id != v_imus_id;
  IF v_count > 0 THEN RAISE EXCEPTION 'INVARIANT FAIL: % non-Imus doctor_commissions', v_count; END IF;

  SELECT COUNT(*) INTO v_count FROM inventory_logs WHERE branch_id != v_imus_id;
  IF v_count > 0 THEN RAISE EXCEPTION 'INVARIANT FAIL: % non-Imus inventory_logs', v_count; END IF;

  SELECT COUNT(*) INTO v_count FROM stock_adjustments WHERE branch_id != v_imus_id;
  IF v_count > 0 THEN RAISE EXCEPTION 'INVARIANT FAIL: % non-Imus stock_adjustments', v_count; END IF;

  SELECT COUNT(*) INTO v_count FROM refunds WHERE branch_id != v_imus_id;
  IF v_count > 0 THEN RAISE EXCEPTION 'INVARIANT FAIL: % non-Imus refunds', v_count; END IF;

  SELECT COUNT(*) INTO v_count FROM cash_movements WHERE branch_id != v_imus_id;
  IF v_count > 0 THEN RAISE EXCEPTION 'INVARIANT FAIL: % non-Imus cash_movements', v_count; END IF;

  SELECT COUNT(*) INTO v_count FROM treatment_history WHERE branch_id != v_imus_id;
  IF v_count > 0 THEN RAISE EXCEPTION 'INVARIANT FAIL: % non-Imus treatment_history', v_count; END IF;

  SELECT COUNT(*) INTO v_count FROM audit_logs WHERE branch_id IS NOT NULL AND branch_id != v_imus_id;
  IF v_count > 0 THEN RAISE EXCEPTION 'INVARIANT FAIL: % non-Imus audit_logs', v_count; END IF;

  RAISE NOTICE '✅ Cleanup complete. All invariants passed. Only Imus branch data remains.';
END $$;
