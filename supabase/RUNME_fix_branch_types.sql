-- ============================================================
-- FitWhite — Fix Branch Types
-- Run this in Supabase > SQL Editor
-- 
-- This corrects the branch "type" column for managed branches.
-- The first seed run may have set all branches to 'owned'.
-- This fixes Calamba, Paranaque, Quezon City, and Baclaran
-- to their correct type: 'managed'.
-- ============================================================

UPDATE branches SET type = 'owned'   WHERE name IN ('Imus', 'Pasay', 'Manila', 'Makati', 'Iloilo', 'Bacolod', 'Davao');
UPDATE branches SET type = 'managed' WHERE name IN ('Calamba', 'Paranaque', 'Quezon City', 'Baclaran');

-- Verify the fix:
SELECT name, type, is_active FROM branches ORDER BY name;
