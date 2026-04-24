-- ============================================================
-- 006_doctors_table.sql
-- Phase 5: Standalone doctors table (no auth account required)
-- ============================================================

-- 1. Create doctors table
CREATE TABLE IF NOT EXISTS doctors (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  specialty TEXT,
  default_commission_type TEXT CHECK (default_commission_type IN ('percent', 'fixed')) DEFAULT 'percent',
  default_commission_value NUMERIC(12,4) DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL, -- optional future linkage
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for branch-scoped queries
CREATE INDEX IF NOT EXISTS idx_doctors_branch ON doctors(branch_id);
CREATE INDEX IF NOT EXISTS idx_doctors_active ON doctors(branch_id, is_active);

-- Auto-update updated_at (create helper function if it doesn't exist)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER set_doctors_updated_at
  BEFORE UPDATE ON doctors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 2. Backfill from existing profiles.is_doctor = true
INSERT INTO doctors (branch_id, full_name, default_commission_type, default_commission_value, is_active, profile_id)
SELECT
  p.branch_id,
  CONCAT(p.first_name, ' ', p.last_name),
  'percent',
  COALESCE(p.default_commission_rate, 0),
  p.is_active,
  p.id
FROM profiles p
WHERE p.is_doctor = true
  AND p.branch_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- 3. RLS Policies
ALTER TABLE doctors ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read doctors in their branch (or owners read all)
CREATE POLICY doctors_select ON doctors FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'owner')
    OR branch_id = (SELECT branch_id FROM profiles WHERE profiles.id = auth.uid())
  );

-- Owners and managers can insert/update doctors
CREATE POLICY doctors_insert ON doctors FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND (profiles.role = 'owner' OR (profiles.role = 'manager' AND profiles.branch_id = doctors.branch_id))
    )
  );

CREATE POLICY doctors_update ON doctors FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND (profiles.role = 'owner' OR (profiles.role = 'manager' AND profiles.branch_id = doctors.branch_id))
    )
  );

CREATE POLICY doctors_delete ON doctors FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'owner')
  );

-- 4. Add commission_override fields to sales table for per-sale commission tracking
ALTER TABLE sales ADD COLUMN IF NOT EXISTS commission_mode TEXT CHECK (commission_mode IN ('default', 'percent', 'fixed'));
ALTER TABLE sales ADD COLUMN IF NOT EXISTS commission_value NUMERIC(12,4);

-- 5. Note: attending_doctor_id on sales currently references profiles(id).
--    For backward compatibility we keep that FK as-is. New code will store
--    doctors.id there. Since both are UUIDs with no enforced FK to profiles
--    (the schema uses Record<string,unknown> casts), this works safely.
--    In a future migration, the FK can be formally re-pointed to doctors(id).
