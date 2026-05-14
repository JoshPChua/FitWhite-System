-- ============================================================
-- 010: Customer Enhancements
--   • source tracking (walk_in, ads, referral, online)
--   • referred_by FK to customers
--   • last_transaction_at for activity tracking
--   • auto-update trigger on sales insert
-- ============================================================

-- ─── New columns ────────────────────────────────────────────

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'walk_in',
  ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_transaction_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_customers_source ON customers(source);
CREATE INDEX IF NOT EXISTS idx_customers_last_tx ON customers(last_transaction_at);

-- ─── Trigger: auto-update last_transaction_at on sale ────────

CREATE OR REPLACE FUNCTION update_customer_last_transaction()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.customer_id IS NOT NULL THEN
    UPDATE customers
    SET last_transaction_at = NEW.created_at
    WHERE id = NEW.customer_id
      AND (last_transaction_at IS NULL OR last_transaction_at < NEW.created_at);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_customer_last_tx ON sales;
CREATE TRIGGER trg_update_customer_last_tx
  AFTER INSERT ON sales
  FOR EACH ROW
  EXECUTE FUNCTION update_customer_last_transaction();

-- ─── Backfill last_transaction_at from existing sales ────────

UPDATE customers c
SET last_transaction_at = sub.last_tx
FROM (
  SELECT customer_id, MAX(created_at) AS last_tx
  FROM sales
  WHERE customer_id IS NOT NULL
    AND status IN ('completed', 'partial_refund')
  GROUP BY customer_id
) sub
WHERE c.id = sub.customer_id
  AND c.last_transaction_at IS NULL;
