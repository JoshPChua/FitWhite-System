-- Migration: Add 'void_reversal' to inv_log_source enum
-- 
-- Required for the void reversal feature which logs BOM inventory restorations
-- with a distinct source type for audit clarity.
--
-- Safe to run multiple times (IF NOT EXISTS).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inv_log_source') THEN
    -- ALTER TYPE ... ADD VALUE is idempotent with IF NOT EXISTS (PG 9.3+)
    ALTER TYPE inv_log_source ADD VALUE IF NOT EXISTS 'void_reversal';
  END IF;
END $$;
