-- ============================================================
-- FitWhite — Create Demo Owner Profile
--
-- BEFORE running this, you must:
-- 1. Go to Supabase Dashboard > Authentication > Users
-- 2. Find "demo@fitwhite.ph" in the user list
-- 3. Click on that user
-- 4. Copy the UUID shown (looks like: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
-- 5. Paste that UUID below replacing PASTE-UUID-HERE
-- 6. Then run this in SQL Editor
-- ============================================================

INSERT INTO profiles (id, email, first_name, last_name, role, branch_id, is_active)
VALUES (
  'PASTE-UUID-HERE',    -- ← Replace this with the UUID from Auth dashboard
  'demo@fitwhite.ph',
  'Demo',
  'Owner',
  'owner',
  NULL,
  TRUE
)
ON CONFLICT (id) DO UPDATE SET
  email      = 'demo@fitwhite.ph',
  first_name = 'Demo',
  last_name  = 'Owner',
  role       = 'owner',
  is_active  = TRUE;

-- After running: login at your system URL with
--   Email:    demo@fitwhite.ph
--   Password: FitWhite2024!
