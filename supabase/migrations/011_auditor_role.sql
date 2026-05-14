-- Migration: 011_auditor_role.sql
-- Adds the auditor role, PIN field, and approval tracking columns

-- 1. Extend role constraint to include 'auditor'
ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('owner', 'manager', 'cashier', 'auditor'));

-- 2. Auditor PIN (hashed, only used for auditor accounts)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS auditor_pin TEXT DEFAULT NULL;

-- 3. PIN lockout tracking
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS pin_failed_attempts INT DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS pin_locked_until TIMESTAMPTZ DEFAULT NULL;

-- 4. Approval tracking on sales (for voids)
ALTER TABLE sales ADD COLUMN IF NOT EXISTS void_approved_by UUID REFERENCES profiles(id) DEFAULT NULL;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS void_approved_at TIMESTAMPTZ DEFAULT NULL;

-- 5. Approval tracking on refunds
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES profiles(id) DEFAULT NULL;
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ DEFAULT NULL;
