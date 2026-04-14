-- ============================================================
-- FitWhite Aesthetics POS — Phase 3 Rollback
-- 005_rollback_phase3.sql
--
-- Run this ONLY if you need to undo 003 + 004 completely.
-- It is DESTRUCTIVE — all Phase 3 data will be permanently lost.
--
-- Safe execution order (reverse of 003):
--   1. Drop RLS policies from Phase 3 tables (before dropping tables)
--   2. Drop triggers and trigger functions
--   3. Drop tables (in reverse dependency order)
--   4. Remove columns added to existing tables
--   5. Drop new ENUMs
--   6. Drop new helper functions from 004
-- ============================================================

-- ─── SAFETY CHECK ───────────────────────────────────────────
-- Uncomment the line below to do a dry run (will raise an error at the end
-- and roll back everything, letting you verify the script runs cleanly):
-- BEGIN; ... ROLLBACK;  -- wrap in a transaction for testing

-- ============================================================
-- Step 1: Drop Phase 3 RLS policies
-- ============================================================

-- service_consumables
DROP POLICY IF EXISTS "svc_consumables_select" ON service_consumables;
DROP POLICY IF EXISTS "svc_consumables_insert" ON service_consumables;
DROP POLICY IF EXISTS "svc_consumables_update" ON service_consumables;
DROP POLICY IF EXISTS "svc_consumables_delete" ON service_consumables;

-- shifts
DROP POLICY IF EXISTS "shifts_select"  ON shifts;
DROP POLICY IF EXISTS "shifts_insert"  ON shifts;
DROP POLICY IF EXISTS "shifts_update"  ON shifts;
DROP POLICY IF EXISTS "shifts_delete"  ON shifts;

-- cash_movements
DROP POLICY IF EXISTS "cash_movements_select" ON cash_movements;
DROP POLICY IF EXISTS "cash_movements_insert" ON cash_movements;

-- patient_packages
DROP POLICY IF EXISTS "patient_packages_select" ON patient_packages;
DROP POLICY IF EXISTS "patient_packages_insert" ON patient_packages;
DROP POLICY IF EXISTS "patient_packages_update" ON patient_packages;
DROP POLICY IF EXISTS "patient_packages_delete" ON patient_packages;

-- package_payments
DROP POLICY IF EXISTS "pkg_payments_select" ON package_payments;
DROP POLICY IF EXISTS "pkg_payments_insert" ON package_payments;

-- package_sessions
DROP POLICY IF EXISTS "pkg_sessions_select" ON package_sessions;
DROP POLICY IF EXISTS "pkg_sessions_insert" ON package_sessions;

-- doctor_commissions
DROP POLICY IF EXISTS "dr_commissions_select" ON doctor_commissions;
DROP POLICY IF EXISTS "dr_commissions_insert" ON doctor_commissions;
DROP POLICY IF EXISTS "dr_commissions_update" ON doctor_commissions;
DROP POLICY IF EXISTS "dr_commissions_delete" ON doctor_commissions;

-- inventory_logs
DROP POLICY IF EXISTS "inv_logs_select" ON inventory_logs;

-- ============================================================
-- Step 2: Drop triggers and their functions
-- ============================================================

DROP TRIGGER IF EXISTS pkg_payments_sync        ON package_payments;
DROP TRIGGER IF EXISTS pkg_sessions_sync        ON package_sessions;
DROP TRIGGER IF EXISTS commission_guard         ON doctor_commissions;
DROP TRIGGER IF EXISTS service_consumables_updated_at ON service_consumables;
DROP TRIGGER IF EXISTS doctor_commissions_updated_at  ON doctor_commissions;
DROP TRIGGER IF EXISTS patient_packages_updated_at    ON patient_packages;

DROP FUNCTION IF EXISTS sync_package_total_paid();
DROP FUNCTION IF EXISTS sync_package_sessions_used();
DROP FUNCTION IF EXISTS guard_commission_amount();

-- ============================================================
-- Step 3: Drop Phase 3 tables (reverse dependency order)
-- ============================================================

DROP TABLE IF EXISTS inventory_logs      CASCADE;
DROP TABLE IF EXISTS doctor_commissions  CASCADE;
DROP TABLE IF EXISTS package_sessions    CASCADE;
DROP TABLE IF EXISTS package_payments    CASCADE;
DROP TABLE IF EXISTS patient_packages    CASCADE;
DROP TABLE IF EXISTS cash_movements      CASCADE;
DROP TABLE IF EXISTS service_consumables CASCADE;

-- shifts must be dropped AFTER sales.shift_id column is removed
-- (or after the ALTER TABLE below). CASCADE handles it.
DROP TABLE IF EXISTS shifts CASCADE;

-- ============================================================
-- Step 4: Remove columns added to existing tables
-- ============================================================

-- services
ALTER TABLE services
  DROP COLUMN IF EXISTS default_session_count;

-- profiles
ALTER TABLE profiles
  DROP COLUMN IF EXISTS is_doctor,
  DROP COLUMN IF EXISTS default_commission_rate;

-- sales  (shift_id FK was CASCADE-dropped with shifts above,
--         but the column itself may remain — drop it explicitly)
ALTER TABLE sales
  DROP COLUMN IF EXISTS shift_id,
  DROP COLUMN IF EXISTS attending_doctor_id,
  DROP COLUMN IF EXISTS payment_type;

-- ============================================================
-- Step 5: Drop Phase 3 ENUMs
-- ============================================================

DROP TYPE IF EXISTS package_status;
DROP TYPE IF EXISTS shift_status;
DROP TYPE IF EXISTS cash_movement_type;
DROP TYPE IF EXISTS inv_log_source;

-- ============================================================
-- Step 6: Drop Phase 3 helper functions (from 004_phase3_rls.sql)
-- ============================================================

DROP FUNCTION IF EXISTS get_imus_branch_id();
DROP FUNCTION IF EXISTS is_branch_staff(UUID);
DROP FUNCTION IF EXISTS is_manager_or_owner();

-- ============================================================
-- Done. All Phase 3 schema and data has been removed.
-- The system is back to the Phase 1/2 state (001 + 002 migrations).
-- ============================================================
