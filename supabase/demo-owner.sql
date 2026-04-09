-- ============================================================
-- FitWhite Aesthetics POS - Demo Owner Account
-- 
-- Run this in Supabase > SQL Editor AFTER seed.sql
-- This creates a clean demo account for client presentations.
--
-- Login:    demo@fitwhite.ph
-- Password: FitWhite2024!
-- ============================================================

-- Step 1: Create the auth user
-- NOTE: Supabase does not allow creating auth.users directly via SQL.
-- You must create the user via the Supabase Dashboard:
--   Auth > Users > Add User
--   Email:    demo@fitwhite.ph
--   Password: FitWhite2024!
--
-- After creating the user in Auth, copy the generated UUID and
-- replace 'PASTE-USER-UUID-HERE' below, then run this script.

-- Step 2: Create the profile for the demo user
-- Replace the UUID below with the one from Supabase Auth dashboard
INSERT INTO profiles (
  id,
  email,
  first_name,
  last_name,
  role,
  branch_id,
  is_active
)
VALUES (
  'PASTE-USER-UUID-HERE',   -- ← Replace this with the UUID from Auth dashboard
  'demo@fitwhite.ph',
  'Demo',
  'Owner',
  'owner',
  NULL,                     -- owner has no fixed branch
  TRUE
)
ON CONFLICT (id) DO UPDATE SET
  first_name = 'Demo',
  last_name  = 'Owner',
  role       = 'owner',
  is_active  = TRUE;

-- Done! The demo account can now log in at the system URL.
-- To delete the demo account later:
--   1. Delete from profiles WHERE email = 'demo@fitwhite.ph';
--   2. Delete from Supabase Auth > Users dashboard

