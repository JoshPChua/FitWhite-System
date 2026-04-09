-- ============================================================
-- FitWhite Aesthetics POS - Seed Data
-- SAFE TO RE-RUN: uses ON CONFLICT DO NOTHING throughout
-- Run this AFTER the auth users have been seeded via the script
-- ============================================================

-- ─── BRANCHES ───────────────────────────────────────────────

INSERT INTO branches (id, name, code, type, is_active, reporting_restricted) VALUES
  ('b0000001-0000-0000-0000-000000000001', 'Imus',         'IMS', 'owned',   TRUE, FALSE),
  ('b0000001-0000-0000-0000-000000000002', 'Pasay',        'PSY', 'owned',   TRUE, FALSE),
  ('b0000001-0000-0000-0000-000000000003', 'Manila',       'MNL', 'owned',   TRUE, FALSE),
  ('b0000001-0000-0000-0000-000000000004', 'Makati',       'MKT', 'owned',   TRUE, FALSE),
  ('b0000001-0000-0000-0000-000000000005', 'Iloilo',       'ILO', 'owned',   TRUE, FALSE),
  ('b0000001-0000-0000-0000-000000000006', 'Bacolod',      'BCL', 'owned',   TRUE, FALSE),
  ('b0000001-0000-0000-0000-000000000007', 'Davao',        'DVO', 'owned',   TRUE, FALSE),
  ('b0000001-0000-0000-0000-000000000008', 'Calamba',      'CLB', 'managed', TRUE, TRUE),
  ('b0000001-0000-0000-0000-000000000009', 'Paranaque',    'PRQ', 'managed', TRUE, TRUE),
  ('b0000001-0000-0000-0000-000000000010', 'Quezon City',  'QC',  'managed', TRUE, TRUE),
  ('b0000001-0000-0000-0000-000000000011', 'Baclaran',     'BCR', 'managed', TRUE, TRUE)
ON CONFLICT (id) DO NOTHING;

-- ─── SERVICES (from actual FitWhite menu) ───────────────────
-- Safe to re-run: skips branch if it already has services

DO $$
DECLARE
  branch_rec RECORD;
  svc_count  INT;
BEGIN
  FOR branch_rec IN SELECT id FROM branches LOOP

    -- Skip this branch if services are already seeded
    SELECT COUNT(*) INTO svc_count FROM services WHERE branch_id = branch_rec.id;
    CONTINUE WHEN svc_count > 0;

    -- IV Treatments
    INSERT INTO services (branch_id, name, category, price, duration_minutes) VALUES
      (branch_rec.id, 'Fat Melting IV Push', 'IV Treatments', 3500, 30),
      (branch_rec.id, 'Beautigenesis Glow IV Push', 'IV Treatments', 3000, 30),
      (branch_rec.id, 'Hangover Cocktail Drip', 'IV Treatments', 4000, 45),
      (branch_rec.id, 'Empress Advance Drip', 'IV Treatments', 5000, 60),
      (branch_rec.id, 'Premier Royalty Drip', 'IV Treatments', 6000, 60),
      (branch_rec.id, 'Melasma & Scar Remover Drip', 'IV Treatments', 5500, 60),
      (branch_rec.id, 'Fit & White Duo Drip', 'IV Treatments', 4500, 60),
      (branch_rec.id, 'Celestial Youth Drip', 'IV Treatments', 7000, 60),
      (branch_rec.id, 'Aphrodite Luxe Drip', 'IV Treatments', 8000, 60),
      (branch_rec.id, 'Fit White Elite Drip (All In)', 'IV Treatments', 10000, 90);

    -- Lipolysis
    INSERT INTO services (branch_id, name, category, price, duration_minutes) VALUES
      (branch_rec.id, 'Lipolysis Face', 'Lipolysis', 3000, 30),
      (branch_rec.id, 'Lipolysis Body', 'Lipolysis', 5000, 45),
      (branch_rec.id, 'Lemon Face', 'Lipolysis', 2500, 30),
      (branch_rec.id, 'Lemon Body', 'Lipolysis', 4000, 45);

    -- HIFU
    INSERT INTO services (branch_id, name, category, price, duration_minutes) VALUES
      (branch_rec.id, 'HIFU Arms + RF + Lemon Body', 'HIFU', 8000, 60),
      (branch_rec.id, 'HIFU Tummy + RF + Lemon Body', 'HIFU', 10000, 90),
      (branch_rec.id, 'HIFU Face + RF + Lemon Face', 'HIFU', 8000, 60),
      (branch_rec.id, 'HIFU Face & Neck', 'HIFU', 12000, 90),
      (branch_rec.id, 'HIFU Arms', 'HIFU', 6000, 45),
      (branch_rec.id, 'HIFU Tummy', 'HIFU', 8000, 60);

    -- Nose Treatments
    INSERT INTO services (branch_id, name, category, price, duration_minutes) VALUES
      (branch_rec.id, 'Nose Sculpt', 'Nose Treatments', 5000, 30),
      (branch_rec.id, 'Naso Form', 'Nose Treatments', 6000, 45),
      (branch_rec.id, 'Rhinolift', 'Nose Treatments', 8000, 45),
      (branch_rec.id, 'Pixie Tip', 'Nose Treatments', 7000, 30);

    -- Botox
    INSERT INTO services (branch_id, name, category, price, duration_minutes) VALUES
      (branch_rec.id, 'Upper / Lower Botox', 'Botox', 6000, 30),
      (branch_rec.id, 'Arms / Shoulder Botox', 'Botox', 8000, 30),
      (branch_rec.id, 'Palm / Sweatox Botox', 'Botox', 8000, 30),
      (branch_rec.id, 'Calves Botox', 'Botox', 10000, 30);

    -- Facials
    INSERT INTO services (branch_id, name, category, price, duration_minutes) VALUES
      (branch_rec.id, 'Student Facial', 'Facials', 500, 30),
      (branch_rec.id, 'Classic Facial', 'Facials', 800, 45),
      (branch_rec.id, 'FW Signature Facial', 'Facials', 1500, 60),
      (branch_rec.id, 'Diamond Peel', 'Facials', 1000, 30),
      (branch_rec.id, 'Diamond Peel 10 in 1', 'Facials', 2000, 45),
      (branch_rec.id, 'Hydra Facial', 'Facials', 2500, 60),
      (branch_rec.id, 'Hydra Beauty', 'Facials', 3000, 60),
      (branch_rec.id, 'Carbon Facial', 'Facials', 2500, 45),
      (branch_rec.id, 'CO2 Facial', 'Facials', 2000, 45),
      (branch_rec.id, 'Vampire Facial', 'Facials', 5000, 60),
      (branch_rec.id, 'Vivace Facial', 'Facials', 8000, 60),
      (branch_rec.id, 'Cleansing Facial', 'Facials', 600, 30),
      (branch_rec.id, 'Crystal Glow Facial', 'Facials', 1800, 45),
      (branch_rec.id, 'Organique Facial', 'Facials', 1500, 45),
      (branch_rec.id, 'Acne Treatment Facial', 'Facials', 1200, 45),
      (branch_rec.id, 'Glycolic Facial', 'Facials', 1500, 45),
      (branch_rec.id, 'Madona Gold Facial', 'Facials', 3500, 60),
      (branch_rec.id, 'Baby Face Booster', 'Facials', 2500, 45);

    -- Acne Treatments
    INSERT INTO services (branch_id, name, category, price, duration_minutes) VALUES
      (branch_rec.id, 'Acne Injection', 'Acne Treatments', 500, 15),
      (branch_rec.id, 'Acne Mild', 'Acne Treatments', 1500, 30),
      (branch_rec.id, 'Acne Moderate', 'Acne Treatments', 2500, 45),
      (branch_rec.id, 'Acne Severe', 'Acne Treatments', 3500, 60),
      (branch_rec.id, 'Back Acne Mild', 'Acne Treatments', 2000, 30),
      (branch_rec.id, 'Back Acne Moderate', 'Acne Treatments', 3000, 45),
      (branch_rec.id, 'Back Acne Severe', 'Acne Treatments', 4000, 60);

    -- Underarm Treatments
    INSERT INTO services (branch_id, name, category, price, duration_minutes) VALUES
      (branch_rec.id, 'Carbon Laser w/ Whitening - UA Treatment', 'Underarm', 2000, 30),
      (branch_rec.id, 'Diamond w/ Whitening - UA Treatment', 'Underarm', 1500, 30),
      (branch_rec.id, 'Waxing - UA Treatment', 'Underarm', 500, 15),
      (branch_rec.id, 'Threading Underarm', 'Underarm', 300, 15);

    -- Fillers
    INSERT INTO services (branch_id, name, category, price, duration_minutes) VALUES
      (branch_rec.id, 'Lips Fillers', 'Fillers', 8000, 30),
      (branch_rec.id, 'Chin Fillers', 'Fillers', 10000, 30),
      (branch_rec.id, 'Cheek Fillers', 'Fillers', 12000, 30),
      (branch_rec.id, 'Wrinkle Fillers', 'Fillers', 8000, 30),
      (branch_rec.id, 'Laugh Line Fillers', 'Fillers', 10000, 30),
      (branch_rec.id, 'Under Eye Fillers', 'Fillers', 10000, 30),
      (branch_rec.id, 'Forehead Fillers', 'Fillers', 12000, 30),
      (branch_rec.id, 'Body Fillers - Butt', 'Fillers', 25000, 60),
      (branch_rec.id, 'Body Fillers - Breast', 'Fillers', 25000, 60),
      (branch_rec.id, 'Body Fillers - Hips', 'Fillers', 20000, 60);

    -- Removal Treatments
    INSERT INTO services (branch_id, name, category, price, duration_minutes) VALUES
      (branch_rec.id, 'Milia / Warts / Syringoma - Per Piece', 'Removal', 200, 10),
      (branch_rec.id, 'Milia / Warts / Syringoma - Unli Face / Neck', 'Removal', 3000, 45),
      (branch_rec.id, 'Milia / Warts / Syringoma - Unli Face & Neck', 'Removal', 4000, 60),
      (branch_rec.id, 'Milia / Warts / Syringoma - Unli Back / Tummy', 'Removal', 3500, 45),
      (branch_rec.id, 'Milia / Warts / Syringoma - Unli Back & Tummy', 'Removal', 5000, 60),
      (branch_rec.id, 'Milia / Warts / Syringoma - Whole Body Mild', 'Removal', 5000, 60),
      (branch_rec.id, 'Milia / Warts / Syringoma - Whole Body Moderate', 'Removal', 7000, 90),
      (branch_rec.id, 'Milia / Warts / Syringoma - Whole Body Severe', 'Removal', 10000, 120),
      (branch_rec.id, 'Tattoo Removal', 'Removal', 3000, 30);

    -- Brows & Lashes
    INSERT INTO services (branch_id, name, category, price, duration_minutes) VALUES
      (branch_rec.id, 'Microblading', 'Brows & Lashes', 5000, 120),
      (branch_rec.id, 'Ombre Brows', 'Brows & Lashes', 6000, 120),
      (branch_rec.id, 'Hybrid Brows', 'Brows & Lashes', 5500, 120),
      (branch_rec.id, 'Men''s Brows', 'Brows & Lashes', 4000, 90),
      (branch_rec.id, 'Lamination / Tint', 'Brows & Lashes', 1500, 45),
      (branch_rec.id, 'Brow Threading', 'Brows & Lashes', 200, 15),
      (branch_rec.id, 'Classic Eyelash Extension', 'Brows & Lashes', 1500, 60),
      (branch_rec.id, 'Glamourous Eyelash Extension', 'Brows & Lashes', 2500, 90),
      (branch_rec.id, 'Customized Eyelash Extension', 'Brows & Lashes', 3000, 90),
      (branch_rec.id, 'Classic Eyelash', 'Brows & Lashes', 1200, 60),
      (branch_rec.id, 'Hybrid Eyelash', 'Brows & Lashes', 1800, 60),
      (branch_rec.id, 'Volume Eyelash', 'Brows & Lashes', 2200, 75),
      (branch_rec.id, 'Barbie Doll Eyelash', 'Brows & Lashes', 2800, 90),
      (branch_rec.id, 'Lash Lift w/ Tint', 'Brows & Lashes', 1500, 45),
      (branch_rec.id, 'Lash Lift w/o Tint', 'Brows & Lashes', 1200, 45),
      (branch_rec.id, 'Eyelash Removal', 'Brows & Lashes', 500, 15),
      (branch_rec.id, 'Lash Removal', 'Brows & Lashes', 500, 15);

    -- Tattoo Makeup
    INSERT INTO services (branch_id, name, category, price, duration_minutes) VALUES
      (branch_rec.id, 'Top Eyeliner - Tattoo Makeup', 'Tattoo Makeup', 4000, 60),
      (branch_rec.id, 'Lip Blush - Tattoo Makeup', 'Tattoo Makeup', 5000, 90),
      (branch_rec.id, 'BB Foundation', 'Tattoo Makeup', 8000, 120),
      (branch_rec.id, 'BB Blush', 'Tattoo Makeup', 6000, 90);

    -- Body Contouring
    INSERT INTO services (branch_id, name, category, price, duration_minutes) VALUES
      (branch_rec.id, 'Emslim', 'Body Contouring', 3000, 30),
      (branch_rec.id, 'Cryotherapy', 'Body Contouring', 5000, 45),
      (branch_rec.id, 'Cavitation', 'Body Contouring', 3000, 30),
      (branch_rec.id, 'RF Face (10 mins)', 'Body Contouring', 1500, 10),
      (branch_rec.id, 'RF Body (10 mins)', 'Body Contouring', 2000, 10),
      (branch_rec.id, 'Slimfinity', 'Body Contouring', 5000, 60);

    -- IPL / Laser
    INSERT INTO services (branch_id, name, category, price, duration_minutes) VALUES
      (branch_rec.id, 'Upper & Lower Lip - IPL Treatment', 'IPL / Laser', 1000, 15),
      (branch_rec.id, 'Full Face - IPL Treatment', 'IPL / Laser', 3000, 30),
      (branch_rec.id, 'Underarm - IPL Treatment', 'IPL / Laser', 1500, 15),
      (branch_rec.id, 'Arms / Legs - IPL Treatment', 'IPL / Laser', 3000, 30),
      (branch_rec.id, 'Brazilian - IPL Treatment', 'IPL / Laser', 3000, 30),
      (branch_rec.id, 'Upper & Lower Lip - Diode / OPT', 'IPL / Laser', 1500, 15),
      (branch_rec.id, 'Underarm - Diode / OPT', 'IPL / Laser', 2000, 15),
      (branch_rec.id, 'Arms / Legs - Diode / OPT', 'IPL / Laser', 4000, 30),
      (branch_rec.id, 'Brazilian - Diode / OPT', 'IPL / Laser', 4000, 30);

    -- Pico Treatments
    INSERT INTO services (branch_id, name, category, price, duration_minutes) VALUES
      (branch_rec.id, 'Pico Mela', 'Pico', 3000, 30),
      (branch_rec.id, 'Pico Full Face', 'Pico', 5000, 45),
      (branch_rec.id, 'Underarm - Pico Treatment', 'Pico', 2000, 15),
      (branch_rec.id, 'Brazilian / Butt / Bikini - Pico', 'Pico', 5000, 30);

    -- Waxing
    INSERT INTO services (branch_id, name, category, price, duration_minutes) VALUES
      (branch_rec.id, 'Arms / Legs Waxing', 'Waxing', 1000, 30),
      (branch_rec.id, 'Brazilian Waxing', 'Waxing', 1500, 30),
      (branch_rec.id, 'Brow Waxing', 'Waxing', 300, 10);

    -- Threading
    INSERT INTO services (branch_id, name, category, price, duration_minutes) VALUES
      (branch_rec.id, 'Threading Eyebrow', 'Threading', 200, 10),
      (branch_rec.id, 'Threading Upper Lip', 'Threading', 150, 10),
      (branch_rec.id, 'Threading Full Face', 'Threading', 500, 20);

    -- Threads
    INSERT INTO services (branch_id, name, category, price, duration_minutes) VALUES
      (branch_rec.id, 'Mono Threads', 'Threads', 5000, 45),
      (branch_rec.id, 'Cog Threads', 'Threads', 15000, 60),
      (branch_rec.id, 'Skin Booster', 'Threads', 5000, 30);

    -- Programs
    INSERT INTO services (branch_id, name, category, price, duration_minutes) VALUES
      (branch_rec.id, 'Fit & White Program', 'Programs', 15000, 120),
      (branch_rec.id, 'Aphrodite Glow Up', 'Programs', 20000, 120),
      (branch_rec.id, 'Advance Acne Clear', 'Programs', 12000, 90),
      (branch_rec.id, 'Advanced Scar Therapy', 'Programs', 10000, 90),
      (branch_rec.id, 'Advanced Power Shape Body', 'Programs', 15000, 120),
      (branch_rec.id, 'Advanced Power Shape Face & Neck', 'Programs', 12000, 90),
      (branch_rec.id, '7D V Shape Face', 'Programs', 15000, 90),
      (branch_rec.id, 'Glam Makeover', 'Programs', 5000, 60);

    -- Specialty
    INSERT INTO services (branch_id, name, category, price, duration_minutes) VALUES
      (branch_rec.id, 'Fem Tightening', 'Specialty', 5000, 30),
      (branch_rec.id, 'Headspa Treatment', 'Specialty', 2000, 45),
      (branch_rec.id, 'Sclerotherapy', 'Specialty', 5000, 30),
      (branch_rec.id, 'Hair Restoration', 'Specialty', 8000, 60);

    -- Rhinoplasty / Surgical
    INSERT INTO services (branch_id, name, category, price, duration_minutes) VALUES
      (branch_rec.id, 'Rhinoplasty - Alartrim', 'Surgical', 25000, 120),
      (branch_rec.id, 'Rhinoplasty - Alartrim + Lift', 'Surgical', 35000, 150),
      (branch_rec.id, 'Rhinoplasty - Tipplasty Ear Cartilage', 'Surgical', 45000, 180),
      (branch_rec.id, 'Rhinoplasty - Alartrim + Tipplasty', 'Surgical', 50000, 180),
      (branch_rec.id, 'Rhinoplasty - Virgin Nose Silicone', 'Surgical', 55000, 180),
      (branch_rec.id, 'Rhinoplasty - Virgin Nose Goretex', 'Surgical', 65000, 180),
      (branch_rec.id, 'Rhinoplasty - Virgin Nose Ear Cartilage', 'Surgical', 70000, 240),
      (branch_rec.id, 'Rhinoplasty - Virgin Nose Rib Cartilage', 'Surgical', 85000, 240),
      (branch_rec.id, 'Rhinoplasty - Revision to Silicone', 'Surgical', 65000, 240),
      (branch_rec.id, 'Rhinoplasty - Revision to Goretex', 'Surgical', 75000, 240),
      (branch_rec.id, 'Rhinoplasty - Revision Ear Cartilage', 'Surgical', 80000, 240),
      (branch_rec.id, 'Rhinoplasty - Revision Rib Cartilage', 'Surgical', 95000, 300),
      (branch_rec.id, 'Rhinofixed (Rhinolift + Alar Trim)', 'Surgical', 30000, 150),
      (branch_rec.id, 'Buccal Fat Removal', 'Surgical', 35000, 120),
      (branch_rec.id, 'Chin Augmentation', 'Surgical', 30000, 120),
      (branch_rec.id, 'Dimple Creation', 'Surgical', 15000, 60),
      (branch_rec.id, 'Facelift (Full)', 'Surgical', 120000, 300),
      (branch_rec.id, 'Facelift (Mini)', 'Surgical', 70000, 180),
      (branch_rec.id, 'Otoplasty', 'Surgical', 40000, 120),
      (branch_rec.id, 'Vaginoplasty', 'Surgical', 80000, 240),
      (branch_rec.id, 'Labiaplasty', 'Surgical', 50000, 180);

    -- Liposuction
    INSERT INTO services (branch_id, name, category, price, duration_minutes) VALUES
      (branch_rec.id, 'Liposuction - Abdomen', 'Liposuction', 60000, 180),
      (branch_rec.id, 'Liposuction - Arms', 'Liposuction', 40000, 120),
      (branch_rec.id, 'Liposuction - Back', 'Liposuction', 50000, 150),
      (branch_rec.id, 'Liposuction - Thighs', 'Liposuction', 55000, 150),
      (branch_rec.id, 'Liposuction - Submental / Chin', 'Liposuction', 35000, 90),
      (branch_rec.id, 'Liposuction - Tummy Tuck', 'Liposuction', 80000, 240),
      (branch_rec.id, 'Liposuction - Mini Tuck', 'Liposuction', 50000, 180),
      (branch_rec.id, 'Liposuction - Brazilian Butt Lift (BBL)', 'Liposuction', 100000, 300);

    -- Eyelid / Lip Augmentation
    INSERT INTO services (branch_id, name, category, price, duration_minutes) VALUES
      (branch_rec.id, 'Upper Blep', 'Eyelid Surgery', 25000, 90),
      (branch_rec.id, 'Lower Blep', 'Eyelid Surgery', 25000, 90),
      (branch_rec.id, 'Upper + Lower Blep', 'Eyelid Surgery', 45000, 150),
      (branch_rec.id, 'Double Eyelid Creation', 'Eyelid Surgery', 20000, 90),
      (branch_rec.id, 'Lip Augmentation - Upper Lip Reshaping', 'Lip Augmentation', 15000, 60),
      (branch_rec.id, 'Lip Augmentation - Upper + Lower Lip Reshaping', 'Lip Augmentation', 25000, 90),
      (branch_rec.id, 'Lip Augmentation - Lip Lift Surgery', 'Lip Augmentation', 30000, 90);

    -- Breast Augmentation
    INSERT INTO services (branch_id, name, category, price, duration_minutes) VALUES
      (branch_rec.id, 'Breast Augmentation - Under Skin', 'Breast Surgery', 120000, 240),
      (branch_rec.id, 'Breast Augmentation - Under Muscle', 'Breast Surgery', 140000, 300),
      (branch_rec.id, 'Breast Augmentation - Revision', 'Breast Surgery', 150000, 300);

    -- Nails
    INSERT INTO services (branch_id, name, category, price, duration_minutes) VALUES
      (branch_rec.id, 'Manicure Cleaning', 'Nails', 200, 30),
      (branch_rec.id, 'Pedicure Cleaning', 'Nails', 250, 45),
      (branch_rec.id, 'Gel Manicure', 'Nails', 500, 45),
      (branch_rec.id, 'Gel Pedicure', 'Nails', 600, 60),
      (branch_rec.id, 'Footspa', 'Nails', 500, 45),
      (branch_rec.id, 'Gel Remover', 'Nails', 200, 15),
      (branch_rec.id, 'Softgel Extension w/ Colors', 'Nails', 1000, 60),
      (branch_rec.id, 'Polygel Extension w/ Colors', 'Nails', 1200, 90);

    -- Hair
    INSERT INTO services (branch_id, name, category, price, duration_minutes) VALUES
      (branch_rec.id, 'Haircut Men', 'Hair', 200, 30),
      (branch_rec.id, 'Haircut Women', 'Hair', 350, 45),
      (branch_rec.id, 'Hair Color Full', 'Hair', 2000, 120),
      (branch_rec.id, 'Highlights', 'Hair', 2500, 120),
      (branch_rec.id, 'Roots Retouch', 'Hair', 1000, 60),
      (branch_rec.id, 'Lightening & Bleach', 'Hair', 3000, 120),
      (branch_rec.id, 'Rebond Yuko Japanese', 'Hair', 3500, 180),
      (branch_rec.id, 'Rebond Volume', 'Hair', 3000, 180),
      (branch_rec.id, 'Relax', 'Hair', 2000, 120),
      (branch_rec.id, 'Rebond Retouch', 'Hair', 2000, 120),
      (branch_rec.id, 'Hair Spa', 'Hair', 800, 45),
      (branch_rec.id, 'Organic Collagen', 'Hair', 1500, 60),
      (branch_rec.id, 'Dry Scalp Treatment', 'Hair', 1000, 45),
      (branch_rec.id, 'Anti Hairloss Treatment', 'Hair', 2000, 60),
      (branch_rec.id, 'Stemcell Therapy', 'Hair', 3000, 60),
      (branch_rec.id, 'Hair & Makeup', 'Hair', 3000, 90),
      (branch_rec.id, 'Shampoo & Blowdry', 'Hair', 300, 30),
      (branch_rec.id, 'Shampoo, Blowdry & Iron', 'Hair', 500, 45),
      (branch_rec.id, 'Straight / Beach Wave', 'Hair', 1500, 60),
      (branch_rec.id, 'Up Style / Hairdo', 'Hair', 1500, 60),
      (branch_rec.id, 'Keratin Smoothing', 'Hair', 3000, 120),
      (branch_rec.id, 'Straight Therapy', 'Hair', 2500, 120);

  END LOOP;
END $$;

-- ─── PRODUCTS & INVENTORY (from actual FitWhite catalog) ────
-- Safe to re-run: skips branch if products already exist

DO $$
DECLARE
  branch_rec RECORD;
  prod_id    UUID;
  prod_count INT;
BEGIN
  FOR branch_rec IN SELECT id FROM branches LOOP

    -- Skip this branch if products are already seeded
    SELECT COUNT(*) INTO prod_count FROM products WHERE branch_id = branch_rec.id;
    CONTINUE WHEN prod_count > 0;

    -- IV Boosters
    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Stemcell Booster', 'IV Boosters', 500, 'vial') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 200, 20);

    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Whitening Booster', 'IV Boosters', 500, 'vial') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 200, 20);

    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Placenta Booster', 'IV Boosters', 500, 'vial') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 200, 20);

    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Collagen Booster', 'IV Boosters', 500, 'vial') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 200, 20);

    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Vitamin C Booster', 'IV Boosters', 300, 'vial') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 300, 30);

    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Vitamin B Complex Booster', 'IV Boosters', 300, 'vial') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 300, 30);

    -- Soaps
    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Calamansi Soap', 'Skincare Products', 150, 'pcs') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 100, 10);

    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Carrot Soap', 'Skincare Products', 150, 'pcs') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 100, 10);

    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Collagen Soap', 'Skincare Products', 180, 'pcs') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 100, 10);

    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Glutathione Soap', 'Skincare Products', 200, 'pcs') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 100, 10);

    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Kojic Soap', 'Skincare Products', 150, 'pcs') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 100, 10);

    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Lemon Soap', 'Skincare Products', 150, 'pcs') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 100, 10);

    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Oatmeal Soap', 'Skincare Products', 150, 'pcs') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 100, 10);

    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Placenta Soap', 'Skincare Products', 150, 'pcs') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 100, 10);

    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Tomato Soap', 'Skincare Products', 150, 'pcs') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 100, 10);

    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Glutamansi Soap', 'Skincare Products', 180, 'pcs') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 100, 10);

    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Niacinamide Soap', 'Skincare Products', 180, 'pcs') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 100, 10);

    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Sugarcane Soap', 'Skincare Products', 150, 'pcs') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 100, 10);

    -- Creams
    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Collagen Elastin Cream', 'Skincare Products', 350, 'pcs') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 50, 5);

    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Mela White Cream', 'Skincare Products', 400, 'pcs') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 50, 5);

    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Stretchmark Cream', 'Skincare Products', 450, 'pcs') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 50, 5);

    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Sunblock Beige Cream', 'Skincare Products', 350, 'pcs') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 80, 10);

    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Underarm Cream', 'Skincare Products', 300, 'pcs') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 80, 10);

    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Sunblock Gel', 'Skincare Products', 350, 'pcs') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 80, 10);

    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Antibacterial Cream', 'Skincare Products', 200, 'tube') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 80, 10);

    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'CO2 Cream', 'Medical', 250, 'tube') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 60, 5);

    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Hydrocortisone Cream', 'Medical', 180, 'tube') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 80, 10);

    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Skin Defender', 'Medical', 300, 'bottle') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 60, 5);

    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Eyelift Cream', 'Skincare Products', 500, 'pcs') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 50, 5);

    -- Solutions & Toners
    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Acne Toner', 'Skincare Products', 250, 'bottle') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 80, 10);

    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Clarifying Solution (Big)', 'Skincare Products', 400, 'bottle') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 50, 5);

    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Clarifying Solution (Small)', 'Skincare Products', 250, 'bottle') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 80, 10);

    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Mela Clear Solution (Big)', 'Skincare Products', 400, 'bottle') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 50, 5);

    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Mela Clear Solution (Small)', 'Skincare Products', 250, 'bottle') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 80, 10);

    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Intensive', 'Skincare Products', 350, 'bottle') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 60, 5);

    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Glass Skin Serum', 'Skincare Products', 600, 'pcs') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 50, 5);

    -- Lotions
    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Instant White', 'Skincare Products', 250, 'pcs') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 80, 10);

    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Sunblock SPF 70', 'Skincare Products', 350, 'pcs') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 80, 10);

    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Hand Lotion', 'Skincare Products', 200, 'pcs') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 100, 10);

    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Skin Moisturizing Lotion', 'Skincare Products', 250, 'pcs') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 100, 10);

    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Niacinamide Lotion', 'Skincare Products', 300, 'pcs') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 80, 10);

    -- Supplements & Kits
    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Glass Skin Set', 'Kits & Supplements', 2000, 'set') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 30, 5);

    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Whitening Tea', 'Kits & Supplements', 350, 'box') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 50, 5);

    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Medical Kit (Complete)', 'Kits & Supplements', 500, 'kit') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 50, 5);

    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Medical Kit (Mupirocin & Antibiotics)', 'Kits & Supplements', 350, 'kit') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 60, 5);

    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Medical Kit (Antibiotics & Mefenamic)', 'Kits & Supplements', 300, 'kit') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 60, 5);

    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Aphrodite Softgel', 'Kits & Supplements', 800, 'bottle') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 40, 5);

    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Vitamin C Orals', 'Kits & Supplements', 250, 'bottle') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 80, 10);

    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Vitamin B Orals', 'Kits & Supplements', 250, 'bottle') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 80, 10);

    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Vitamin E Orals', 'Kits & Supplements', 250, 'bottle') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 80, 10);

    -- Medical
    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Tea Tree Soothing Gel', 'Medical', 200, 'tube') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 80, 10);

    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Mupirocin', 'Medical', 150, 'tube') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 100, 10);

    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Etherium', 'Medical', 250, 'pcs') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 60, 5);

    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Fougera', 'Medical', 200, 'pcs') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 60, 5);

    INSERT INTO products (id, branch_id, name, category, price, unit) VALUES (gen_random_uuid(), branch_rec.id, 'Binder Corset', 'Medical', 1500, 'pcs') RETURNING id INTO prod_id;
    INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold) VALUES (prod_id, branch_rec.id, 20, 3);

  END LOOP;
END $$;
