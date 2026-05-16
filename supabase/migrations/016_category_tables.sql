-- ============================================================
-- 016_category_tables.sql
--
-- Introduces normalised category tables for services and products.
--
-- • service_categories + product_categories tables
-- • Expression unique index: (branch_id, lower(name))
-- • Old text columns preserved for backward compatibility
-- • RLS: branch-scoped, owner/manager write access
-- ============================================================


-- ════════════════════════════════════════════════════════════════
-- SERVICE CATEGORIES
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS service_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id   UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  name        VARCHAR(100) NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Case-insensitive uniqueness per branch
CREATE UNIQUE INDEX IF NOT EXISTS service_categories_branch_lower_name_uq
  ON service_categories (branch_id, lower(name));

CREATE INDEX IF NOT EXISTS idx_svc_cat_branch
  ON service_categories(branch_id, sort_order);

CREATE TRIGGER service_categories_updated_at
  BEFORE UPDATE ON service_categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── RLS ──
ALTER TABLE service_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "svc_cat_select" ON service_categories
  FOR SELECT TO authenticated
  USING (is_owner() OR branch_id = get_user_branch_id());

CREATE POLICY "svc_cat_insert" ON service_categories
  FOR INSERT TO authenticated
  WITH CHECK (
    is_not_auditor()
    AND (is_owner() OR (get_user_role() = 'manager' AND branch_id = get_user_branch_id()))
  );

CREATE POLICY "svc_cat_update" ON service_categories
  FOR UPDATE TO authenticated
  USING (
    is_not_auditor()
    AND (is_owner() OR (get_user_role() = 'manager' AND branch_id = get_user_branch_id()))
  )
  WITH CHECK (
    is_not_auditor()
    AND (is_owner() OR (get_user_role() = 'manager' AND branch_id = get_user_branch_id()))
  );

CREATE POLICY "svc_cat_delete" ON service_categories
  FOR DELETE TO authenticated
  USING (
    is_not_auditor()
    AND (is_owner() OR (get_user_role() = 'manager' AND branch_id = get_user_branch_id()))
  );


-- ════════════════════════════════════════════════════════════════
-- PRODUCT CATEGORIES
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS product_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id   UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  name        VARCHAR(100) NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Case-insensitive uniqueness per branch
CREATE UNIQUE INDEX IF NOT EXISTS product_categories_branch_lower_name_uq
  ON product_categories (branch_id, lower(name));

CREATE INDEX IF NOT EXISTS idx_prod_cat_branch
  ON product_categories(branch_id, sort_order);

CREATE TRIGGER product_categories_updated_at
  BEFORE UPDATE ON product_categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── RLS ──
ALTER TABLE product_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prod_cat_select" ON product_categories
  FOR SELECT TO authenticated
  USING (is_owner() OR branch_id = get_user_branch_id());

CREATE POLICY "prod_cat_insert" ON product_categories
  FOR INSERT TO authenticated
  WITH CHECK (
    is_not_auditor()
    AND (is_owner() OR (get_user_role() = 'manager' AND branch_id = get_user_branch_id()))
  );

CREATE POLICY "prod_cat_update" ON product_categories
  FOR UPDATE TO authenticated
  USING (
    is_not_auditor()
    AND (is_owner() OR (get_user_role() = 'manager' AND branch_id = get_user_branch_id()))
  )
  WITH CHECK (
    is_not_auditor()
    AND (is_owner() OR (get_user_role() = 'manager' AND branch_id = get_user_branch_id()))
  );

CREATE POLICY "prod_cat_delete" ON product_categories
  FOR DELETE TO authenticated
  USING (
    is_not_auditor()
    AND (is_owner() OR (get_user_role() = 'manager' AND branch_id = get_user_branch_id()))
  );


-- ════════════════════════════════════════════════════════════════
-- FK COLUMNS (optional — services / products can link to categories)
-- ════════════════════════════════════════════════════════════════
-- NOTE: The old text `category` column is intentionally kept for now.
-- Once the UI switches to using category_id, the old column can be
-- dropped in a future migration.

ALTER TABLE services  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES service_categories(id) ON DELETE SET NULL;
ALTER TABLE products  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES product_categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_services_category_id  ON services(category_id);
CREATE INDEX IF NOT EXISTS idx_products_category_id  ON products(category_id);


-- ════════════════════════════════════════════════════════════════
-- SEED: Backfill categories from existing text columns
-- ════════════════════════════════════════════════════════════════
-- Creates one category row for each distinct (branch_id, category) and
-- links the service/product back via category_id.

INSERT INTO service_categories (branch_id, name)
SELECT DISTINCT s.branch_id, s.category
FROM services s
WHERE s.category IS NOT NULL AND TRIM(s.category) != ''
ON CONFLICT DO NOTHING;

UPDATE services s
SET category_id = sc.id
FROM service_categories sc
WHERE sc.branch_id = s.branch_id
  AND lower(sc.name) = lower(s.category)
  AND s.category IS NOT NULL;

INSERT INTO product_categories (branch_id, name)
SELECT DISTINCT p.branch_id, p.category
FROM products p
WHERE p.category IS NOT NULL AND TRIM(p.category) != ''
ON CONFLICT DO NOTHING;

UPDATE products p
SET category_id = pc.id
FROM product_categories pc
WHERE pc.branch_id = p.branch_id
  AND lower(pc.name) = lower(p.category)
  AND p.category IS NOT NULL;


-- ============================================================
-- End of 016_category_tables.sql
-- ============================================================
