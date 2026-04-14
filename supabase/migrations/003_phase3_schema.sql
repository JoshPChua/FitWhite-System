-- ============================================================
-- FitWhite Aesthetics POS — Phase 3 Schema Migration
-- 003_phase3_schema.sql
--
-- ADDITIVE ONLY — no existing tables are dropped or altered
-- destructively. Safe to run on a live Supabase project.
--
-- New additions:
--   ENUMs: package_status, shift_status, cash_movement_type,
--          inv_log_source
--   COLUMNS: services.default_session_count
--            profiles.is_doctor, profiles.default_commission_rate
--            sales.shift_id, sales.attending_doctor_id,
--            sales.payment_type
--   TABLES: service_consumables, patient_packages,
--           package_payments, package_sessions,
--           doctor_commissions, shifts, cash_movements,
--           inventory_logs
--   TRIGGERS: sync_package_total_paid,
--             sync_package_sessions_used,
--             guard_package_overpayment,
--             guard_commission_amount
-- ============================================================

-- ─── ENUMS ──────────────────────────────────────────────────

CREATE TYPE package_status AS ENUM (
  'active',
  'completed',
  'expired',
  'cancelled'
);

CREATE TYPE shift_status AS ENUM (
  'open',
  'closed'
);

CREATE TYPE cash_movement_type AS ENUM (
  'petty_cash_out',   -- expenses paid from the drawer
  'bank_deposit',     -- cash removed and taken to bank
  'cash_in',          -- miscellaneous cash receipt
  'opening_float'     -- starting float added when shift opens
);

CREATE TYPE inv_log_source AS ENUM (
  'service_bom',      -- auto-deducted by service BOM at checkout
  'addon_manual',     -- cashier used "Extra Consumables" button
  'sale_product',     -- product sold directly through POS
  'refund_return',    -- stock returned on refund
  'manual_adjust',    -- manager/owner manual correction
  'initial_stock',    -- opening balance entry
  'bulk_upload'       -- CSV import
);

-- ─── HELPER: updated_at already defined in 001_schema.sql ───
--   (set_updated_at function is reused below via CREATE TRIGGER)

-- ============================================================
-- ALTER: services — add default session count
-- ============================================================

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS default_session_count INT NOT NULL DEFAULT 1
    CHECK (default_session_count > 0);

COMMENT ON COLUMN services.default_session_count IS
  'Number of sessions a single purchase of this service entitles.
   1 = walk-in / single session (legacy default).
   >1 = package service (e.g. 10-session program).';

-- ============================================================
-- ALTER: profiles — doctor flag & default commission rate
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_doctor BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS default_commission_rate DECIMAL(5,4)
    CHECK (default_commission_rate IS NULL OR
           (default_commission_rate >= 0 AND default_commission_rate <= 1));

COMMENT ON COLUMN profiles.is_doctor IS
  'TRUE when this staff member also acts as an attending doctor.
   Does not change the user_role — an owner/manager can be is_doctor = TRUE.';

COMMENT ON COLUMN profiles.default_commission_rate IS
  'Default fraction of service gross owed to this doctor (e.g. 0.15 = 15%).
   NULL = no default; commission must be entered manually per transaction.
   Cap enforced: 0–1 inclusive.';

-- ============================================================
-- ALTER: sales — link to shift & attending doctor
-- ============================================================

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS shift_id             UUID
    REFERENCES shifts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS attending_doctor_id  UUID
    REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_type         VARCHAR(20)
    NOT NULL DEFAULT 'full'
    CHECK (payment_type IN ('full', 'installment', 'package_use'));

COMMENT ON COLUMN sales.payment_type IS
  'full        = paid in full at time of sale
   installment = downpayment taken; balance tracked in patient_packages
   package_use = session deducted from an existing patient_package';

-- ============================================================
-- SERVICE CONSUMABLES (BOM)
-- ============================================================
-- Links inventory products to services as required consumables.
-- On each service execution, all linked products are deducted
-- from inventory atomically by the API / checkout function.
-- ============================================================

CREATE TABLE service_consumables (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id  UUID NOT NULL REFERENCES services(id)  ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES products(id)  ON DELETE RESTRICT,
  quantity    INT  NOT NULL DEFAULT 1                 CHECK (quantity > 0),
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One product can only appear once per service BOM
  UNIQUE(service_id, product_id)
);

CREATE INDEX idx_svc_consumables_service ON service_consumables(service_id);
CREATE INDEX idx_svc_consumables_product ON service_consumables(product_id);

CREATE TRIGGER service_consumables_updated_at
  BEFORE UPDATE ON service_consumables
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE service_consumables IS
  'Bill of Materials: inventory products automatically consumed
   when a service is performed. Deducted atomically at checkout.';

-- ============================================================
-- SHIFTS (Cash Drawer)
-- ============================================================
-- One shift = one cashier/manager session at the drawer.
-- Only one shift may be OPEN per branch at a time.
-- ============================================================

CREATE TABLE shifts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id     UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  opened_by     UUID NOT NULL REFERENCES profiles(id),
  closed_by     UUID           REFERENCES profiles(id) ON DELETE SET NULL,

  opening_cash  DECIMAL(10,2) NOT NULL DEFAULT 0
                  CHECK (opening_cash >= 0),
  closing_cash  DECIMAL(10,2)
                  CHECK (closing_cash IS NULL OR closing_cash >= 0),
  expected_cash DECIMAL(10,2),  -- set by the API when closing the shift

  -- Computed variance: actual vs expected (populated on close)
  variance      DECIMAL(10,2)
    GENERATED ALWAYS AS (
      CASE
        WHEN closing_cash IS NOT NULL AND expected_cash IS NOT NULL
        THEN closing_cash - expected_cash
        ELSE NULL
      END
    ) STORED,

  status        shift_status NOT NULL DEFAULT 'open',
  notes         TEXT,
  opened_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  closed_at     TIMESTAMPTZ
);

CREATE INDEX idx_shifts_branch     ON shifts(branch_id, opened_at);
CREATE INDEX idx_shifts_status     ON shifts(status);
CREATE INDEX idx_shifts_opened_by  ON shifts(opened_by);

-- CRITICAL: only ONE open shift allowed per branch at a time
CREATE UNIQUE INDEX idx_shifts_one_open_per_branch
  ON shifts(branch_id)
  WHERE status = 'open';

COMMENT ON TABLE shifts IS
  'Cash drawer sessions. The partial unique index enforces that a branch
   cannot have two concurrent open shifts. Close the current shift before
   opening a new one.';

-- ============================================================
-- CASH MOVEMENTS (Petty Cash / Bank Deposits)
-- ============================================================
-- Append-only ledger of all money moving in/out of the drawer
-- outside of normal sales. No UPDATE or DELETE allowed (see RLS).
-- ============================================================

CREATE TABLE cash_movements (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id     UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  shift_id      UUID           REFERENCES shifts(id)  ON DELETE SET NULL,
  performed_by  UUID NOT NULL REFERENCES profiles(id),

  movement_type cash_movement_type NOT NULL,
  amount        DECIMAL(10,2) NOT NULL CHECK (amount > 0),
  description   TEXT NOT NULL,
  reference     VARCHAR(100),   -- receipt / bank reference number
  approved_by   UUID           REFERENCES profiles(id) ON DELETE SET NULL,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cash_mvmt_branch ON cash_movements(branch_id, created_at);
CREATE INDEX idx_cash_mvmt_shift  ON cash_movements(shift_id);
CREATE INDEX idx_cash_mvmt_type   ON cash_movements(movement_type);

COMMENT ON TABLE cash_movements IS
  'Append-only petty cash / bank deposit ledger. Every ₱ entering or leaving
   the drawer outside of a sale is recorded here. No edits permitted.';

-- ============================================================
-- PATIENT PACKAGES (Session Tracking + A/R)
-- ============================================================
-- One row per package purchased by a customer.
-- total_paid and sessions_used are maintained by triggers
-- on package_payments and package_sessions respectively.
-- remaining_balance and sessions_remaining are computed columns.
-- ============================================================

CREATE TABLE patient_packages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id         UUID NOT NULL REFERENCES branches(id)  ON DELETE CASCADE,
  customer_id       UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  sale_item_id      UUID           REFERENCES sale_items(id) ON DELETE SET NULL,
  service_id        UUID NOT NULL REFERENCES services(id)  ON DELETE RESTRICT,
  attending_doctor_id UUID         REFERENCES profiles(id) ON DELETE SET NULL,

  -- ── Financials (Accounts Receivable) ──
  total_price       DECIMAL(10,2) NOT NULL CHECK (total_price > 0),
  downpayment       DECIMAL(10,2) NOT NULL DEFAULT 0
                      CHECK (downpayment >= 0),
  total_paid        DECIMAL(10,2) NOT NULL DEFAULT 0
                      CHECK (total_paid >= 0),

  -- Computed: automatically derived, never manually set
  remaining_balance DECIMAL(10,2)
    GENERATED ALWAYS AS (total_price - total_paid) STORED,

  -- ── Sessions ──
  total_sessions    INT NOT NULL DEFAULT 1 CHECK (total_sessions > 0),
  sessions_used     INT NOT NULL DEFAULT 0 CHECK (sessions_used >= 0),

  sessions_remaining INT
    GENERATED ALWAYS AS (total_sessions - sessions_used) STORED,

  -- ── Status & Metadata ──
  status            package_status NOT NULL DEFAULT 'active',
  notes             TEXT,
  expires_at        TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Invariant: downpayment never exceeds total price
  CONSTRAINT pkg_downpayment_valid   CHECK (downpayment <= total_price),
  -- Invariant: total paid never exceeds total price (belt + suspenders;
  --            the trigger below is the primary enforcement mechanism)
  CONSTRAINT pkg_total_paid_valid    CHECK (total_paid <= total_price),
  -- Invariant: sessions used never exceed total sessions
  CONSTRAINT pkg_sessions_valid      CHECK (sessions_used <= total_sessions)
);

CREATE INDEX idx_pkg_branch    ON patient_packages(branch_id);
CREATE INDEX idx_pkg_customer  ON patient_packages(customer_id);
CREATE INDEX idx_pkg_service   ON patient_packages(service_id);
CREATE INDEX idx_pkg_status    ON patient_packages(status);
CREATE INDEX idx_pkg_doctor    ON patient_packages(attending_doctor_id);
CREATE INDEX idx_pkg_balance   ON patient_packages(branch_id, remaining_balance)
  WHERE remaining_balance > 0;  -- fast lookup for outstanding A/R

CREATE TRIGGER patient_packages_updated_at
  BEFORE UPDATE ON patient_packages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE patient_packages IS
  'One row per service package sold to a customer. Tracks both A/R
   (installment payments) and session consumption in a single record.
   remaining_balance and sessions_remaining are computed — never edited directly.';

-- ============================================================
-- PACKAGE PAYMENTS (A/R Payment Ledger)
-- ============================================================
-- Append-only. Each row = one installment / payment event.
-- A trigger keeps patient_packages.total_paid in sync.
-- ============================================================

CREATE TABLE package_payments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id       UUID NOT NULL REFERENCES patient_packages(id) ON DELETE CASCADE,
  branch_id        UUID NOT NULL REFERENCES branches(id),
  received_by      UUID NOT NULL REFERENCES profiles(id),

  amount           DECIMAL(10,2) NOT NULL CHECK (amount > 0),
  method           payment_method NOT NULL,
  reference_number VARCHAR(100),
  notes            TEXT,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pkg_pmts_package  ON package_payments(package_id);
CREATE INDEX idx_pkg_pmts_branch   ON package_payments(branch_id, created_at);
CREATE INDEX idx_pkg_pmts_received ON package_payments(received_by);

COMMENT ON TABLE package_payments IS
  'Append-only installment ledger. Each row is an individual payment
   towards a patient_package. The trigger sync_package_total_paid
   keeps patient_packages.total_paid current after every insert.';

-- ── Trigger: keep patient_packages.total_paid in sync ───────

CREATE OR REPLACE FUNCTION sync_package_total_paid()
RETURNS TRIGGER AS $$
DECLARE
  v_total_price   DECIMAL(10,2);
  v_new_total_paid DECIMAL(10,2);
BEGIN
  -- Sum all payments for this package
  SELECT COALESCE(SUM(amount), 0)
  INTO v_new_total_paid
  FROM package_payments
  WHERE package_id = NEW.package_id;

  -- Read total_price to enforce cap
  SELECT total_price INTO v_total_price
  FROM patient_packages
  WHERE id = NEW.package_id;

  IF v_new_total_paid > v_total_price THEN
    RAISE EXCEPTION
      'Payment rejected: total payments (₱%) would exceed package total price (₱%) for package %',
      v_new_total_paid, v_total_price, NEW.package_id
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE patient_packages
  SET total_paid  = v_new_total_paid,
      updated_at  = NOW()
  WHERE id = NEW.package_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER pkg_payments_sync
  AFTER INSERT ON package_payments
  FOR EACH ROW EXECUTE FUNCTION sync_package_total_paid();

COMMENT ON FUNCTION sync_package_total_paid() IS
  'Maintains patient_packages.total_paid after every package_payments insert.
   Raises check_violation if total payments would exceed total_price —
   this is the primary DB-level over-payment guard.';

-- ============================================================
-- PACKAGE SESSIONS (Per-visit session consumption log)
-- ============================================================
-- Append-only. Each row = one treatment visit that deducts
-- sessions from the package. A trigger keeps sessions_used in sync.
-- ============================================================

CREATE TABLE package_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id      UUID NOT NULL REFERENCES patient_packages(id) ON DELETE CASCADE,
  branch_id       UUID NOT NULL REFERENCES branches(id),
  performed_by    UUID NOT NULL REFERENCES profiles(id),
  doctor_id       UUID           REFERENCES profiles(id) ON DELETE SET NULL,

  sessions_count  INT NOT NULL DEFAULT 1 CHECK (sessions_count > 0),
  notes           TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pkg_sessions_package ON package_sessions(package_id);
CREATE INDEX idx_pkg_sessions_branch  ON package_sessions(branch_id, created_at);
CREATE INDEX idx_pkg_sessions_doctor  ON package_sessions(doctor_id);

COMMENT ON TABLE package_sessions IS
  'Per-visit session consumption log. Each row = one clinic visit
   that uses N sessions from the linked package. The trigger
   sync_package_sessions_used keeps sessions_used current and enforces
   that sessions cannot be used beyond total_sessions.';

-- ── Trigger: keep sessions_used in sync & enforce cap ───────

CREATE OR REPLACE FUNCTION sync_package_sessions_used()
RETURNS TRIGGER AS $$
DECLARE
  v_total_sessions  INT;
  v_new_sessions_used INT;
BEGIN
  -- Sum all sessions used for this package
  SELECT COALESCE(SUM(sessions_count), 0)
  INTO v_new_sessions_used
  FROM package_sessions
  WHERE package_id = NEW.package_id;

  -- Read total_sessions to enforce cap
  SELECT total_sessions INTO v_total_sessions
  FROM patient_packages
  WHERE id = NEW.package_id;

  IF v_new_sessions_used > v_total_sessions THEN
    RAISE EXCEPTION
      'Session rejected: sessions used (%) would exceed total sessions (%) for package %',
      v_new_sessions_used, v_total_sessions, NEW.package_id
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE patient_packages
  SET sessions_used  = v_new_sessions_used,
      updated_at     = NOW()
  WHERE id = NEW.package_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER pkg_sessions_sync
  AFTER INSERT ON package_sessions
  FOR EACH ROW EXECUTE FUNCTION sync_package_sessions_used();

COMMENT ON FUNCTION sync_package_sessions_used() IS
  'Maintains patient_packages.sessions_used after every package_sessions insert.
   Raises check_violation if sessions_used would exceed total_sessions.';

-- ============================================================
-- DOCTOR COMMISSIONS
-- ============================================================
-- Tracks the commission owed to a doctor per service session or sale.
-- Either commission_rate or commission_amount can be overridden by the POS.
-- A trigger validates the commission is within a legal range.
-- ============================================================

CREATE TABLE doctor_commissions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id           UUID NOT NULL REFERENCES branches(id),
  doctor_id           UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  package_session_id  UUID           REFERENCES package_sessions(id) ON DELETE SET NULL,
  sale_item_id        UUID           REFERENCES sale_items(id)       ON DELETE SET NULL,

  gross_amount        DECIMAL(10,2) NOT NULL CHECK (gross_amount > 0),
  commission_rate     DECIMAL(5,4)  -- fraction, e.g. 0.1500 = 15%
                        CHECK (commission_rate IS NULL OR
                               (commission_rate >= 0 AND commission_rate <= 1)),
  commission_amount   DECIMAL(10,2) NOT NULL CHECK (commission_amount >= 0),
  net_branch_amount   DECIMAL(10,2)
    GENERATED ALWAYS AS (gross_amount - commission_amount) STORED,

  -- Commission cannot exceed gross amount
  CONSTRAINT commission_not_over_gross
    CHECK (commission_amount <= gross_amount),

  is_paid             BOOLEAN     NOT NULL DEFAULT FALSE,
  paid_at             TIMESTAMPTZ,
  override_reason     TEXT,  -- Required if commission differs from default rate
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Must reference at least one source (session or direct sale item)
  CONSTRAINT commission_has_ref
    CHECK (package_session_id IS NOT NULL OR sale_item_id IS NOT NULL)
);

CREATE INDEX idx_comm_branch   ON doctor_commissions(branch_id, created_at);
CREATE INDEX idx_comm_doctor   ON doctor_commissions(doctor_id, is_paid);
CREATE INDEX idx_comm_session  ON doctor_commissions(package_session_id);
CREATE INDEX idx_comm_sale_itm ON doctor_commissions(sale_item_id);
CREATE INDEX idx_comm_unpaid   ON doctor_commissions(doctor_id, branch_id)
  WHERE is_paid = FALSE;

CREATE TRIGGER doctor_commissions_updated_at
  BEFORE UPDATE ON doctor_commissions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE doctor_commissions IS
  'Commission ledger per doctor, per session or sale.
   commission_rate is a fraction (0–1). commission_amount is the ₱ value.
   Either can be overridden by the POS (requires override_reason).
   net_branch_amount is the remainder after commission — computed column.';

-- ── Trigger: validate commission amount against gross ────────
-- Secondary guard (belt-and-suspenders on top of the CHECK constraint).
-- Also enforces that override_reason is present when the commission
-- deviates from profiles.default_commission_rate by more than 5%.

CREATE OR REPLACE FUNCTION guard_commission_amount()
RETURNS TRIGGER AS $$
DECLARE
  v_default_rate     DECIMAL(5,4);
  v_effective_rate   DECIMAL(5,4);
BEGIN
  -- Ensure doctor has is_doctor = TRUE
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = NEW.doctor_id AND is_doctor = TRUE
  ) THEN
    RAISE EXCEPTION
      'Commission rejected: profile % is not flagged as a doctor (is_doctor = FALSE)',
      NEW.doctor_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  -- If commission_amount > gross_amount, reject hard
  IF NEW.commission_amount > NEW.gross_amount THEN
    RAISE EXCEPTION
      'Commission rejected: commission_amount (₱%) exceeds gross_amount (₱%)',
      NEW.commission_amount, NEW.gross_amount
      USING ERRCODE = 'check_violation';
  END IF;

  -- Compute effective rate for override detection
  IF NEW.gross_amount > 0 THEN
    v_effective_rate := NEW.commission_amount / NEW.gross_amount;
  ELSE
    v_effective_rate := 0;
  END IF;

  -- Check override: if effective rate deviates > 5% from default, require reason
  SELECT default_commission_rate
  INTO v_default_rate
  FROM profiles
  WHERE id = NEW.doctor_id;

  IF v_default_rate IS NOT NULL
     AND ABS(v_effective_rate - v_default_rate) > 0.05
     AND (NEW.override_reason IS NULL OR TRIM(NEW.override_reason) = '')
  THEN
    RAISE EXCEPTION
      'Commission override requires override_reason: effective rate (%) deviates > 5%% from default rate (%) for doctor %',
      v_effective_rate, v_default_rate, NEW.doctor_id
      USING ERRCODE = 'not_null_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER commission_guard
  BEFORE INSERT OR UPDATE ON doctor_commissions
  FOR EACH ROW EXECUTE FUNCTION guard_commission_amount();

COMMENT ON FUNCTION guard_commission_amount() IS
  'Validates every doctor commission row:
   1. Confirms doctor has is_doctor = TRUE.
   2. Rejects commission_amount > gross_amount.
   3. Requires override_reason if effective rate deviates > 5% from
      the doctor''s default_commission_rate.';

-- ============================================================
-- INVENTORY LOGS (Canonical Source-Aware Stock Log)
-- ============================================================
-- Replaces the thin stock_adjustments table as the canonical
-- inventory event log. stock_adjustments is NOT dropped for
-- backward compatibility with existing API code.
-- This table is append-only (no UPDATE/DELETE RLS policies).
-- ============================================================

CREATE TABLE inventory_logs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id       UUID NOT NULL REFERENCES inventory(id)  ON DELETE CASCADE,
  product_id         UUID NOT NULL REFERENCES products(id),
  branch_id          UUID NOT NULL REFERENCES branches(id),
  performed_by       UUID NOT NULL REFERENCES profiles(id),

  source             inv_log_source NOT NULL,
  quantity_delta     INT NOT NULL,   -- negative = deduction, positive = addition
  quantity_before    INT NOT NULL,   -- snapshot BEFORE the change
  quantity_after     INT NOT NULL,   -- snapshot AFTER the change

  -- Source cross-references (at most one will be set per row)
  sale_id            UUID REFERENCES sales(id)            ON DELETE SET NULL,
  sale_item_id       UUID REFERENCES sale_items(id)       ON DELETE SET NULL,
  package_session_id UUID REFERENCES package_sessions(id) ON DELETE SET NULL,
  shift_id           UUID REFERENCES shifts(id)           ON DELETE SET NULL,

  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Integrity: quantity_after must equal quantity_before + quantity_delta
  CONSTRAINT inv_log_math_check
    CHECK (quantity_after = quantity_before + quantity_delta),

  -- Inventory can never go negative (after the change)
  CONSTRAINT inv_log_no_negative
    CHECK (quantity_after >= 0)
);

CREATE INDEX idx_inv_log_inventory ON inventory_logs(inventory_id);
CREATE INDEX idx_inv_log_branch    ON inventory_logs(branch_id, created_at);
CREATE INDEX idx_inv_log_product   ON inventory_logs(product_id);
CREATE INDEX idx_inv_log_source    ON inventory_logs(source);
CREATE INDEX idx_inv_log_sale      ON inventory_logs(sale_id);
CREATE INDEX idx_inv_log_session   ON inventory_logs(package_session_id);

COMMENT ON TABLE inventory_logs IS
  'Canonical, append-only inventory event log with source attribution.
   Supersedes stock_adjustments (which is kept for backward compat).
   quantity_after = quantity_before + quantity_delta is enforced by constraint.
   quantity_after >= 0 prevents stock from going negative.
   No UPDATE or DELETE is permitted (enforced via RLS in 004_phase3_rls.sql).';

-- ============================================================
-- REALTIME: add new key tables to Supabase realtime publication
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE patient_packages;
ALTER PUBLICATION supabase_realtime ADD TABLE shifts;
ALTER PUBLICATION supabase_realtime ADD TABLE package_payments;

-- ============================================================
-- End of 003_phase3_schema.sql
-- ============================================================
