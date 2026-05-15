-- ============================================================
-- FitWhite Combined Diagnostic (single result set)
-- Run this in Supabase SQL Editor
-- ============================================================

SELECT 'enum_roles' AS check_name, 
       enum_range(NULL::user_role)::text AS result
UNION ALL
-- Migration 010: customers columns
SELECT 'customers.' || column_name, data_type
FROM information_schema.columns
WHERE table_name = 'customers'
  AND column_name IN ('source', 'referred_by', 'last_transaction_at')
UNION ALL
-- Migration 011: profiles columns
SELECT 'profiles.' || column_name, data_type
FROM information_schema.columns
WHERE table_name = 'profiles'
  AND column_name IN ('auditor_pin', 'pin_failed_attempts', 'pin_locked_until')
UNION ALL
-- Migration 011: sales columns
SELECT 'sales.' || column_name, data_type
FROM information_schema.columns
WHERE table_name = 'sales'
  AND column_name IN ('void_approved_by', 'void_approved_at')
UNION ALL
-- Migration 011: refunds columns
SELECT 'refunds.' || column_name, data_type
FROM information_schema.columns
WHERE table_name = 'refunds'
  AND column_name IN ('approved_by', 'approved_at')
UNION ALL
-- Migration 010: trigger
SELECT 'trigger.' || trigger_name, event_manipulation
FROM information_schema.triggers
WHERE trigger_name = 'trg_update_customer_last_tx'
UNION ALL
-- Migration 010: indexes
SELECT 'index.' || indexname, 'exists'
FROM pg_indexes
WHERE tablename = 'customers'
  AND indexname IN ('idx_customers_source', 'idx_customers_last_tx')
ORDER BY check_name;
