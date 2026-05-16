-- ============================================================
-- 013_lockdown_rpc_permissions.sql
-- Lock SECURITY DEFINER RPCs to service_role only.
--
-- These RPCs must only be called by the Next.js admin client
-- (which uses the service_role key). Direct calls from
-- anon or authenticated clients are blocked.
-- ============================================================

-- ─── record_package_visit ────────────────────────────────────
REVOKE EXECUTE ON FUNCTION record_package_visit(
  UUID, UUID, UUID, UUID, INT, TEXT,
  NUMERIC, payment_method, VARCHAR, TEXT, UUID, TEXT
) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION record_package_visit(
  UUID, UUID, UUID, UUID, INT, TEXT,
  NUMERIC, payment_method, VARCHAR, TEXT, UUID, TEXT
) FROM anon;

REVOKE EXECUTE ON FUNCTION record_package_visit(
  UUID, UUID, UUID, UUID, INT, TEXT,
  NUMERIC, payment_method, VARCHAR, TEXT, UUID, TEXT
) FROM authenticated;

GRANT EXECUTE ON FUNCTION record_package_visit(
  UUID, UUID, UUID, UUID, INT, TEXT,
  NUMERIC, payment_method, VARCHAR, TEXT, UUID, TEXT
) TO service_role;

-- ─── consume_package_session ─────────────────────────────────
REVOKE EXECUTE ON FUNCTION consume_package_session(
  UUID, UUID, UUID, UUID, INT, TEXT
) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION consume_package_session(
  UUID, UUID, UUID, UUID, INT, TEXT
) FROM anon;

REVOKE EXECUTE ON FUNCTION consume_package_session(
  UUID, UUID, UUID, UUID, INT, TEXT
) FROM authenticated;

GRANT EXECUTE ON FUNCTION consume_package_session(
  UUID, UUID, UUID, UUID, INT, TEXT
) TO service_role;

-- ─── generate_receipt_number ─────────────────────────────────
REVOKE EXECUTE ON FUNCTION generate_receipt_number(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION generate_receipt_number(TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION generate_receipt_number(TEXT) FROM authenticated;

GRANT EXECUTE ON FUNCTION generate_receipt_number(TEXT) TO service_role;

-- ============================================================
-- End of 013_lockdown_rpc_permissions.sql
-- ============================================================
