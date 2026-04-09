-- ============================================================
-- FitWhite Aesthetics POS - Database Schema
-- Phase 1: Core tables, enums, indexes, triggers
-- ============================================================

-- ─── ENUMS ──────────────────────────────────────────────────

CREATE TYPE user_role AS ENUM ('owner', 'manager', 'cashier');
CREATE TYPE branch_type AS ENUM ('owned', 'managed');
CREATE TYPE item_type AS ENUM ('service', 'product', 'bundle');
CREATE TYPE payment_method AS ENUM ('cash', 'gcash', 'card', 'bank_transfer');
CREATE TYPE sale_status AS ENUM ('completed', 'refunded', 'partial_refund', 'voided');
CREATE TYPE adjustment_type AS ENUM ('sale', 'refund', 'manual_add', 'manual_remove', 'initial', 'bulk_upload');
CREATE TYPE refund_type AS ENUM ('product', 'service', 'consumed');

-- ─── HELPER: updated_at trigger ─────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- BRANCHES
-- ============================================================

CREATE TABLE branches (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  code        VARCHAR(10) NOT NULL UNIQUE,
  type        branch_type NOT NULL DEFAULT 'owned',
  address     TEXT,
  phone       VARCHAR(20),
  email       VARCHAR(255),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  reporting_restricted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER branches_updated_at
  BEFORE UPDATE ON branches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- PROFILES (extends auth.users)
-- ============================================================

CREATE TABLE profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       VARCHAR(255) NOT NULL,
  first_name  VARCHAR(100) NOT NULL,
  last_name   VARCHAR(100) NOT NULL,
  role        user_role NOT NULL DEFAULT 'cashier',
  branch_id   UUID REFERENCES branches(id) ON DELETE SET NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_profiles_branch ON profiles(branch_id);
CREATE INDEX idx_profiles_role ON profiles(role);
CREATE INDEX idx_profiles_email ON profiles(email);

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- CUSTOMERS
-- ============================================================

CREATE TABLE customers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id   UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  first_name  VARCHAR(100) NOT NULL,
  last_name   VARCHAR(100) NOT NULL,
  email       VARCHAR(255),
  phone       VARCHAR(20),
  store_credit DECIMAL(10,2) NOT NULL DEFAULT 0,
  allergies   TEXT,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_customers_branch ON customers(branch_id);
CREATE INDEX idx_customers_branch_name ON customers(branch_id, last_name);

CREATE TRIGGER customers_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- SERVICES
-- ============================================================

CREATE TABLE services (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id        UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  name             VARCHAR(200) NOT NULL,
  description      TEXT,
  price            DECIMAL(10,2) NOT NULL,
  duration_minutes INT,
  category         VARCHAR(100),
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_services_branch ON services(branch_id);
CREATE INDEX idx_services_branch_category ON services(branch_id, category);

CREATE TRIGGER services_updated_at
  BEFORE UPDATE ON services
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- PRODUCTS
-- ============================================================

CREATE TABLE products (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id   UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  name        VARCHAR(200) NOT NULL,
  description TEXT,
  sku         VARCHAR(50),
  price       DECIMAL(10,2) NOT NULL,
  category    VARCHAR(100),
  unit        VARCHAR(20) NOT NULL DEFAULT 'pcs',
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_products_branch ON products(branch_id);
CREATE INDEX idx_products_branch_category ON products(branch_id, category);

CREATE TRIGGER products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- INVENTORY
-- ============================================================

CREATE TABLE inventory (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id          UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  branch_id           UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  quantity            INT NOT NULL DEFAULT 0,
  low_stock_threshold INT NOT NULL DEFAULT 10,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(branch_id, product_id)
);

CREATE INDEX idx_inventory_branch ON inventory(branch_id);
CREATE INDEX idx_inventory_product ON inventory(product_id);

CREATE TRIGGER inventory_updated_at
  BEFORE UPDATE ON inventory
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- BUNDLES
-- ============================================================

CREATE TABLE bundles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id   UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  name        VARCHAR(200) NOT NULL,
  description TEXT,
  price       DECIMAL(10,2) NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bundles_branch ON bundles(branch_id);

CREATE TRIGGER bundles_updated_at
  BEFORE UPDATE ON bundles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- BUNDLE ITEMS (M2M: bundles ↔ services/products)
-- ============================================================

CREATE TABLE bundle_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_id   UUID NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
  service_id  UUID REFERENCES services(id) ON DELETE SET NULL,
  product_id  UUID REFERENCES products(id) ON DELETE SET NULL,
  quantity    INT NOT NULL DEFAULT 1,

  CONSTRAINT bundle_item_has_ref CHECK (service_id IS NOT NULL OR product_id IS NOT NULL)
);

CREATE INDEX idx_bundle_items_bundle ON bundle_items(bundle_id);

-- ============================================================
-- SALES
-- ============================================================

CREATE TABLE sales (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number VARCHAR(50) NOT NULL UNIQUE,
  branch_id      UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES profiles(id),
  customer_id    UUID REFERENCES customers(id) ON DELETE SET NULL,
  subtotal       DECIMAL(10,2) NOT NULL,
  discount       DECIMAL(10,2) NOT NULL DEFAULT 0,
  tax            DECIMAL(10,2) NOT NULL DEFAULT 0,
  total          DECIMAL(10,2) NOT NULL,
  status         sale_status NOT NULL DEFAULT 'completed',
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sales_branch_date ON sales(branch_id, created_at);
CREATE INDEX idx_sales_user ON sales(user_id);
CREATE INDEX idx_sales_customer ON sales(customer_id);
CREATE INDEX idx_sales_receipt ON sales(receipt_number);
CREATE INDEX idx_sales_status ON sales(status);
CREATE INDEX idx_sales_created ON sales(created_at);

CREATE TRIGGER sales_updated_at
  BEFORE UPDATE ON sales
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- SALE ITEMS (line items)
-- ============================================================

CREATE TABLE sale_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id     UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  item_type   item_type NOT NULL,
  service_id  UUID REFERENCES services(id) ON DELETE SET NULL,
  product_id  UUID REFERENCES products(id) ON DELETE SET NULL,
  bundle_id   UUID REFERENCES bundles(id) ON DELETE SET NULL,
  name        VARCHAR(200) NOT NULL,
  quantity    INT NOT NULL,
  unit_price  DECIMAL(10,2) NOT NULL,
  total_price DECIMAL(10,2) NOT NULL
);

CREATE INDEX idx_sale_items_sale ON sale_items(sale_id);

-- ============================================================
-- PAYMENTS
-- ============================================================

CREATE TABLE payments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id          UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  method           payment_method NOT NULL,
  amount           DECIMAL(10,2) NOT NULL,
  change_amount    DECIMAL(10,2) NOT NULL DEFAULT 0,
  reference_number VARCHAR(100),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payments_sale ON payments(sale_id);

-- ============================================================
-- REFUNDS
-- ============================================================

CREATE TABLE refunds (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id          UUID NOT NULL REFERENCES sales(id),
  branch_id        UUID NOT NULL REFERENCES branches(id),
  user_id          UUID NOT NULL REFERENCES profiles(id),
  refund_type      refund_type NOT NULL,
  amount           DECIMAL(10,2) NOT NULL,
  reason           TEXT NOT NULL,
  notes            TEXT NOT NULL,
  return_inventory BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_refunds_sale ON refunds(sale_id);
CREATE INDEX idx_refunds_branch_date ON refunds(branch_id, created_at);

-- ============================================================
-- REFUND ITEMS (per-line-item tracking)
-- ============================================================

CREATE TABLE refund_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_id    UUID NOT NULL REFERENCES refunds(id) ON DELETE CASCADE,
  sale_item_id UUID NOT NULL REFERENCES sale_items(id),
  quantity     INT NOT NULL,
  amount       DECIMAL(10,2) NOT NULL
);

CREATE INDEX idx_refund_items_refund ON refund_items(refund_id);

-- ============================================================
-- STOCK ADJUSTMENTS
-- ============================================================

CREATE TABLE stock_adjustments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id    UUID NOT NULL REFERENCES inventory(id) ON DELETE CASCADE,
  branch_id       UUID NOT NULL REFERENCES branches(id),
  user_id         UUID NOT NULL REFERENCES profiles(id),
  adjustment_type adjustment_type NOT NULL,
  quantity_change INT NOT NULL,
  reason          TEXT,
  reference_id    UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_stock_adj_inventory ON stock_adjustments(inventory_id);
CREATE INDEX idx_stock_adj_branch_date ON stock_adjustments(branch_id, created_at);

-- ============================================================
-- TREATMENT HISTORY
-- ============================================================

CREATE TABLE treatment_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  branch_id       UUID NOT NULL REFERENCES branches(id),
  service_name    VARCHAR(200) NOT NULL,
  dosage          TEXT,
  notes           TEXT,
  administered_by UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_treatment_customer ON treatment_history(customer_id);
CREATE INDEX idx_treatment_branch_date ON treatment_history(branch_id, created_at);

-- ============================================================
-- AUDIT LOGS
-- ============================================================

CREATE TABLE audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES profiles(id),
  branch_id   UUID REFERENCES branches(id),
  action_type VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50),
  entity_id   UUID,
  description TEXT,
  metadata    JSONB,
  ip_address  VARCHAR(45),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_branch_date ON audit_logs(branch_id, created_at);
CREATE INDEX idx_audit_user_date ON audit_logs(user_id, created_at);
CREATE INDEX idx_audit_action ON audit_logs(action_type);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);

-- ============================================================
-- TRIGGER: Auto-create profile on auth.users insert
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, first_name, last_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'cashier')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- HELPER: Generate receipt numbers
-- ============================================================

CREATE OR REPLACE FUNCTION generate_receipt_number(branch_code TEXT)
RETURNS TEXT AS $$
DECLARE
  seq_val INT;
  today_str TEXT;
BEGIN
  today_str := TO_CHAR(NOW(), 'YYYYMMDD');
  SELECT COALESCE(MAX(
    CAST(SUBSTRING(receipt_number FROM LENGTH(branch_code) + 10) AS INT)
  ), 0) + 1
  INTO seq_val
  FROM sales
  WHERE receipt_number LIKE branch_code || '-' || today_str || '-%';

  RETURN branch_code || '-' || today_str || '-' || LPAD(seq_val::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;
