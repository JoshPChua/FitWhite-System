/**
 * FitWhite — Apply missing unique constraint on services(branch_id, name)
 * and reseed all services for all branches.
 */
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

const { Client } = pg;

// ── Supabase client for services insertion ──
const SUPABASE_URL = 'https://cdtmufbsexzlgucmlols.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNkdG11ZmJzZXh6bGd1Y21sb2xzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTcyOTYxMSwiZXhwIjoyMDkxMzA1NjExfQ.rHSYEZsCwnga5A8orBuefuzbStJ_oEQAxio-IV2ArmM';
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ── Direct DB for DDL ──
const pgClient = new Client({
  host: 'db.cdtmufbsexzlgucmlols.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: 'Fitwhite2026!',
  ssl: { rejectUnauthorized: false },
});

const SERVICES = [
  // IV Therapy
  { name: 'Fat Melting IV Push',           category: 'IV Therapy',    price: 3500, duration_minutes: 30 },
  { name: 'Beautigenesis Glow IV Push',    category: 'IV Therapy',    price: 3000, duration_minutes: 30 },
  { name: 'Hangover Cocktail Drip',         category: 'IV Therapy',    price: 4000, duration_minutes: 45 },
  { name: 'Empress Advance Drip',           category: 'IV Therapy',    price: 5000, duration_minutes: 60 },
  { name: 'Premier Royalty Drip',           category: 'IV Therapy',    price: 6000, duration_minutes: 60 },
  { name: 'Melasma & Scar Remover Drip',   category: 'IV Therapy',    price: 5500, duration_minutes: 60 },
  { name: 'Fit & White Duo Drip',           category: 'IV Therapy',    price: 4500, duration_minutes: 60 },
  { name: 'Celestial Youth Drip',           category: 'IV Therapy',    price: 7000, duration_minutes: 60 },
  { name: 'Aphrodite Luxe Drip',            category: 'IV Therapy',    price: 8000, duration_minutes: 60 },
  { name: 'Fit White Elite Drip (All In)',  category: 'IV Therapy',    price: 10000, duration_minutes: 90 },
  { name: 'Stemcell Add-on',               category: 'Add-ons',       price: 500,  duration_minutes: 5 },
  { name: 'Whitening Booster',             category: 'Add-ons',       price: 500,  duration_minutes: 5 },
  { name: 'Placenta Add-on',               category: 'Add-ons',       price: 500,  duration_minutes: 5 },
  { name: 'Collagen Add-on',               category: 'Add-ons',       price: 500,  duration_minutes: 5 },
  { name: 'Vitamin C Add-on',              category: 'Add-ons',       price: 300,  duration_minutes: 5 },
  { name: 'Vitamin B Complex Add-on',      category: 'Add-ons',       price: 300,  duration_minutes: 5 },
  { name: 'Lipolysis Face',                category: 'Body Sculpting', price: 3000, duration_minutes: 30 },
  { name: 'Lipolysis Body',                category: 'Body Sculpting', price: 5000, duration_minutes: 45 },
  { name: 'Lemon Face',                    category: 'Body Sculpting', price: 2500, duration_minutes: 30 },
  { name: 'Lemon Body',                    category: 'Body Sculpting', price: 4000, duration_minutes: 45 },
  { name: 'HIFU Arms + RF + Lemon Body',   category: 'Body Sculpting', price: 8000, duration_minutes: 60 },
  { name: 'HIFU Tummy + RF + Lemon Body',  category: 'Body Sculpting', price: 10000, duration_minutes: 90 },
  { name: 'HIFU Face + RF + Lemon Face',   category: 'Body Sculpting', price: 8000, duration_minutes: 60 },
  { name: 'Emslim',                        category: 'Body Sculpting', price: 3000, duration_minutes: 30 },
  { name: 'Cryotherapy',                   category: 'Body Sculpting', price: 5000, duration_minutes: 45 },
  { name: 'RF Face (10 mins)',              category: 'Body Sculpting', price: 1500, duration_minutes: 10 },
  { name: 'RF Body (10 mins)',              category: 'Body Sculpting', price: 2000, duration_minutes: 10 },
  { name: 'Cavitation',                    category: 'Body Sculpting', price: 3000, duration_minutes: 30 },
  { name: 'Slimfinity',                    category: 'Body Sculpting', price: 5000, duration_minutes: 60 },
  { name: 'Face & Neck HIFU',              category: 'HIFU',           price: 12000, duration_minutes: 90 },
  { name: 'Arms HIFU',                     category: 'HIFU',           price: 6000,  duration_minutes: 45 },
  { name: 'Tummy HIFU',                    category: 'HIFU',           price: 8000,  duration_minutes: 60 },
  { name: 'Nose Sculpt',                   category: 'Nose Treatments', price: 5000, duration_minutes: 30 },
  { name: 'Naso Form',                     category: 'Nose Treatments', price: 6000, duration_minutes: 45 },
  { name: 'Rhinolift',                     category: 'Nose Treatments', price: 8000, duration_minutes: 45 },
  { name: 'Pixie Tip',                     category: 'Nose Treatments', price: 7000, duration_minutes: 30 },
  { name: 'Upper / Lower Botox',           category: 'Botox',          price: 6000, duration_minutes: 30 },
  { name: 'Arms / Shoulder Botox',         category: 'Botox',          price: 8000, duration_minutes: 30 },
  { name: 'Palm / Sweatox Botox',          category: 'Botox',          price: 8000, duration_minutes: 30 },
  { name: 'Calves Botox',                  category: 'Botox',          price: 10000, duration_minutes: 30 },
  { name: 'Student Facial',                category: 'Facials',        price: 500,  duration_minutes: 30 },
  { name: 'Classic Facial',                category: 'Facials',        price: 800,  duration_minutes: 45 },
  { name: 'FW Signature Facial',           category: 'Facials',        price: 1500, duration_minutes: 60 },
  { name: 'Diamond Peel',                  category: 'Facials',        price: 1000, duration_minutes: 30 },
  { name: 'Diamond Peel 10 in 1',          category: 'Facials',        price: 2000, duration_minutes: 45 },
  { name: 'Hydra Facial',                  category: 'Facials',        price: 2500, duration_minutes: 60 },
  { name: 'Hydra Beauty',                  category: 'Facials',        price: 3000, duration_minutes: 60 },
  { name: 'Carbon Facial',                 category: 'Facials',        price: 2500, duration_minutes: 45 },
  { name: 'CO2 Facial',                    category: 'Facials',        price: 2000, duration_minutes: 45 },
  { name: 'Vampire Facial',                category: 'Facials',        price: 5000, duration_minutes: 60 },
  { name: 'Vivace Facial',                 category: 'Facials',        price: 8000, duration_minutes: 60 },
  { name: 'Cleansing Facial',              category: 'Facials',        price: 600,  duration_minutes: 30 },
  { name: 'Crystal Glow Facial',           category: 'Facials',        price: 1800, duration_minutes: 45 },
  { name: 'Organique Facial',              category: 'Facials',        price: 1500, duration_minutes: 45 },
  { name: 'Acne Treatment Facial',         category: 'Facials',        price: 1200, duration_minutes: 45 },
  { name: 'Glycolic Facial',               category: 'Facials',        price: 1500, duration_minutes: 45 },
  { name: 'Madona Gold Facial',            category: 'Facials',        price: 3500, duration_minutes: 60 },
  { name: 'Baby Face Booster',             category: 'Facials',        price: 2500, duration_minutes: 45 },
  { name: 'Acne Injection',                category: 'Acne Treatments', price: 500,  duration_minutes: 15 },
  { name: 'Acne Mild',                     category: 'Acne Treatments', price: 1500, duration_minutes: 30 },
  { name: 'Acne Moderate',                 category: 'Acne Treatments', price: 2500, duration_minutes: 45 },
  { name: 'Acne Severe',                   category: 'Acne Treatments', price: 3500, duration_minutes: 60 },
  { name: 'Back Acne Mild',               category: 'Acne Treatments', price: 2000, duration_minutes: 30 },
  { name: 'Back Acne Moderate',           category: 'Acne Treatments', price: 3000, duration_minutes: 45 },
  { name: 'Back Acne Severe',             category: 'Acne Treatments', price: 4000, duration_minutes: 60 },
  { name: 'Advance Acne Clear',           category: 'Acne Treatments', price: 12000, duration_minutes: 90 },
  { name: 'Carbon Laser w/ Whitening - UA', category: 'Underarm',     price: 2000, duration_minutes: 30 },
  { name: 'Diamond w/ Whitening - UA',     category: 'Underarm',      price: 1500, duration_minutes: 30 },
  { name: 'Waxing - UA Treatment',         category: 'Underarm',      price: 500,  duration_minutes: 15 },
  { name: 'Threading Underarm',            category: 'Underarm',      price: 300,  duration_minutes: 15 },
  { name: 'Fem Tightening',               category: 'Specialty',      price: 5000, duration_minutes: 30 },
  { name: 'Headspa Treatment',             category: 'Specialty',      price: 2000, duration_minutes: 45 },
  { name: 'Tattoo Removal',               category: 'Specialty',      price: 3000, duration_minutes: 30 },
  { name: 'Sclerotherapy',                category: 'Specialty',      price: 5000, duration_minutes: 30 },
  { name: 'Hair Restoration',             category: 'Specialty',      price: 8000, duration_minutes: 60 },
  { name: 'Advanced Scar Therapy',        category: 'Specialty',      price: 10000, duration_minutes: 90 },
  { name: 'Fit & White Program',           category: 'Programs',       price: 15000, duration_minutes: 120 },
  { name: 'Aphrodite Glow Up',             category: 'Programs',       price: 20000, duration_minutes: 120 },
  { name: 'Advanced Power Shape Body',     category: 'Programs',       price: 15000, duration_minutes: 120 },
  { name: 'Advanced Power Shape F & N',    category: 'Programs',       price: 12000, duration_minutes: 90 },
  { name: 'Glam Makeover',                category: 'Programs',       price: 5000,  duration_minutes: 60 },
  { name: '7D V Shape Face',              category: 'Programs',       price: 15000, duration_minutes: 90 },
  { name: 'Lips Fillers',                  category: 'Fillers',        price: 8000, duration_minutes: 30 },
  { name: 'Chin Fillers',                  category: 'Fillers',        price: 10000, duration_minutes: 30 },
  { name: 'Cheek Fillers',                 category: 'Fillers',        price: 12000, duration_minutes: 30 },
  { name: 'Wrinkle Fillers',               category: 'Fillers',        price: 8000, duration_minutes: 30 },
  { name: 'Laugh Line Fillers',            category: 'Fillers',        price: 10000, duration_minutes: 30 },
  { name: 'Under Eye Fillers',             category: 'Fillers',        price: 10000, duration_minutes: 30 },
  { name: 'Forehead Fillers',              category: 'Fillers',        price: 12000, duration_minutes: 30 },
  { name: 'Body Fillers - Butt',           category: 'Fillers',        price: 25000, duration_minutes: 60 },
  { name: 'Body Fillers - Breast',         category: 'Fillers',        price: 25000, duration_minutes: 60 },
  { name: 'Body Fillers - Hips',           category: 'Fillers',        price: 20000, duration_minutes: 60 },
  { name: 'Milia/Warts/Syringoma - Per Piece',         category: 'Skin Removal', price: 200,  duration_minutes: 10 },
  { name: 'Milia/Warts/Syringoma - Unli Face/Neck',    category: 'Skin Removal', price: 3000, duration_minutes: 45 },
  { name: 'Milia/Warts/Syringoma - Unli Face & Neck',  category: 'Skin Removal', price: 4000, duration_minutes: 60 },
  { name: 'Milia/Warts/Syringoma - Unli Back/Tummy',   category: 'Skin Removal', price: 3500, duration_minutes: 45 },
  { name: 'Milia/Warts/Syringoma - Unli Back & Tummy', category: 'Skin Removal', price: 5000, duration_minutes: 60 },
  { name: 'Milia/Warts/Syringoma - Whole Body Mild',   category: 'Skin Removal', price: 5000, duration_minutes: 60 },
  { name: 'Milia/Warts/Syringoma - Whole Body Moderate',category: 'Skin Removal', price: 7000, duration_minutes: 90 },
  { name: 'Milia/Warts/Syringoma - Whole Body Severe', category: 'Skin Removal', price: 10000, duration_minutes: 120 },
  { name: 'BB Foundation',                category: 'Semi-Perm Makeup', price: 8000, duration_minutes: 120 },
  { name: 'BB Blush',                     category: 'Semi-Perm Makeup', price: 6000, duration_minutes: 90 },
  { name: 'Microblading',                 category: 'Semi-Perm Makeup', price: 5000, duration_minutes: 120 },
  { name: 'Ombre Brows',                  category: 'Semi-Perm Makeup', price: 6000, duration_minutes: 120 },
  { name: 'Hybrid Brows',                 category: 'Semi-Perm Makeup', price: 5500, duration_minutes: 120 },
  { name: "Men's Brows",                  category: 'Semi-Perm Makeup', price: 4000, duration_minutes: 90 },
  { name: 'Lamination / Tint',            category: 'Semi-Perm Makeup', price: 1500, duration_minutes: 45 },
  { name: 'Brow Threading',               category: 'Semi-Perm Makeup', price: 200,  duration_minutes: 15 },
  { name: 'Top Eyeliner - Tattoo Makeup', category: 'Semi-Perm Makeup', price: 4000, duration_minutes: 60 },
  { name: 'Lip Blush - Tattoo Makeup',    category: 'Semi-Perm Makeup', price: 5000, duration_minutes: 90 },
  { name: 'Classic Eyelash Extension',    category: 'Lashes', price: 1500, duration_minutes: 60 },
  { name: 'Glamourous Eyelash Extension', category: 'Lashes', price: 2500, duration_minutes: 90 },
  { name: 'Customized Eyelash Extension', category: 'Lashes', price: 3000, duration_minutes: 90 },
  { name: 'Lash Lift w/ Tint',            category: 'Lashes', price: 1500, duration_minutes: 45 },
  { name: 'Lash Lift w/o Tint',           category: 'Lashes', price: 1200, duration_minutes: 45 },
  { name: 'Eyelash Removal',              category: 'Lashes', price: 500,  duration_minutes: 15 },
  { name: 'Classic Eyelash',             category: 'Lashes', price: 1200, duration_minutes: 60 },
  { name: 'Hybrid Eyelash',              category: 'Lashes', price: 1800, duration_minutes: 60 },
  { name: 'Volume Eyelash',              category: 'Lashes', price: 2200, duration_minutes: 75 },
  { name: 'Barbie Doll Eyelash',         category: 'Lashes', price: 2800, duration_minutes: 90 },
  { name: 'Lash Removal',                category: 'Lashes', price: 500,  duration_minutes: 15 },
  { name: 'Upper & Lower Lip - IPL',      category: 'IPL', price: 1000, duration_minutes: 15 },
  { name: 'Full Face - IPL',              category: 'IPL', price: 3000, duration_minutes: 30 },
  { name: 'Underarm - IPL',               category: 'IPL', price: 1500, duration_minutes: 15 },
  { name: 'Arms / Legs - IPL',            category: 'IPL', price: 3000, duration_minutes: 30 },
  { name: 'Brazilian - IPL',              category: 'IPL', price: 3000, duration_minutes: 30 },
  { name: 'Upper & Lower Lip - Diode/OPT', category: 'Hair Removal', price: 1500, duration_minutes: 15 },
  { name: 'Underarm - Diode/OPT',           category: 'Hair Removal', price: 2000, duration_minutes: 15 },
  { name: 'Arms / Legs - Diode/OPT',        category: 'Hair Removal', price: 4000, duration_minutes: 30 },
  { name: 'Brazilian - Diode/OPT',          category: 'Hair Removal', price: 4000, duration_minutes: 30 },
  { name: 'Pico Mela',                     category: 'Laser', price: 3000, duration_minutes: 30 },
  { name: 'Pico Full Face',                category: 'Laser', price: 5000, duration_minutes: 45 },
  { name: 'Underarm - Pico Treatment',     category: 'Laser', price: 2000, duration_minutes: 15 },
  { name: 'Brazilian/Butt/Bikini - Pico',  category: 'Laser', price: 5000, duration_minutes: 30 },
  { name: 'Arms / Legs - Waxing',          category: 'Waxing', price: 1000, duration_minutes: 30 },
  { name: 'Brazilian - Waxing',            category: 'Waxing', price: 1500, duration_minutes: 30 },
  { name: 'Brow - Waxing',                 category: 'Waxing', price: 300,  duration_minutes: 10 },
  { name: 'Threading Eyebrow',             category: 'Threading', price: 200, duration_minutes: 10 },
  { name: 'Threading Upper Lip',           category: 'Threading', price: 150, duration_minutes: 10 },
  { name: 'Threading Full Face',           category: 'Threading', price: 500, duration_minutes: 20 },
  { name: 'Mono Threads',                  category: 'Threads & Boosters', price: 5000,  duration_minutes: 45 },
  { name: 'Cog Threads',                   category: 'Threads & Boosters', price: 15000, duration_minutes: 60 },
  { name: 'Skin Booster',                  category: 'Threads & Boosters', price: 5000,  duration_minutes: 30 },
  { name: 'Rhinoplasty - Alartrim',                        category: 'Rhinoplasty', price: 25000, duration_minutes: 120 },
  { name: 'Rhinoplasty - Alartrim + Lift',                 category: 'Rhinoplasty', price: 35000, duration_minutes: 150 },
  { name: 'Rhinoplasty - Tipplasty Ear Cartilage',         category: 'Rhinoplasty', price: 45000, duration_minutes: 180 },
  { name: 'Rhinoplasty - Alartrim + Tipplasty',            category: 'Rhinoplasty', price: 50000, duration_minutes: 180 },
  { name: 'Rhinoplasty - Virgin Nose Silicone',            category: 'Rhinoplasty', price: 55000, duration_minutes: 180 },
  { name: 'Rhinoplasty - Virgin Nose Goretex',             category: 'Rhinoplasty', price: 65000, duration_minutes: 180 },
  { name: 'Rhinoplasty - Virgin Nose Ear Cartilage',       category: 'Rhinoplasty', price: 70000, duration_minutes: 240 },
  { name: 'Rhinoplasty - Virgin Nose Rib Cartilage',       category: 'Rhinoplasty', price: 85000, duration_minutes: 240 },
  { name: 'Rhinoplasty - Revision to Silicone',            category: 'Rhinoplasty', price: 65000, duration_minutes: 240 },
  { name: 'Rhinoplasty - Revision to Goretex',             category: 'Rhinoplasty', price: 75000, duration_minutes: 240 },
  { name: 'Rhinoplasty - Revision to Ear Cartilage',       category: 'Rhinoplasty', price: 80000, duration_minutes: 240 },
  { name: 'Rhinoplasty - Revision to Rib Cartilage',       category: 'Rhinoplasty', price: 95000, duration_minutes: 300 },
  { name: 'Rhinofixed (Rhinolift + Alar Trim)',             category: 'Rhinoplasty', price: 30000, duration_minutes: 150 },
  { name: 'Buccal Fat Removal',            category: 'Surgical', price: 35000,  duration_minutes: 120 },
  { name: 'Chin Augmentation',             category: 'Surgical', price: 30000,  duration_minutes: 120 },
  { name: 'Dimple Creation',               category: 'Surgical', price: 15000,  duration_minutes: 60 },
  { name: 'Facelift (Full)',               category: 'Surgical', price: 120000, duration_minutes: 300 },
  { name: 'Facelift (Mini)',               category: 'Surgical', price: 70000,  duration_minutes: 180 },
  { name: 'Otoplasty',                     category: 'Surgical', price: 40000,  duration_minutes: 120 },
  { name: 'Vaginoplasty',                  category: 'Surgical', price: 80000,  duration_minutes: 240 },
  { name: 'Labiaplasty',                   category: 'Surgical', price: 50000,  duration_minutes: 180 },
  { name: 'Liposuction - Abdomen',         category: 'Liposuction', price: 60000,  duration_minutes: 180 },
  { name: 'Liposuction - Arms',            category: 'Liposuction', price: 40000,  duration_minutes: 120 },
  { name: 'Liposuction - Back',            category: 'Liposuction', price: 50000,  duration_minutes: 150 },
  { name: 'Liposuction - Thighs',          category: 'Liposuction', price: 55000,  duration_minutes: 150 },
  { name: 'Liposuction - Submental/Chin',  category: 'Liposuction', price: 35000,  duration_minutes: 90 },
  { name: 'Liposuction - Tummy Tuck',      category: 'Liposuction', price: 80000,  duration_minutes: 240 },
  { name: 'Liposuction - Mini Tuck',       category: 'Liposuction', price: 50000,  duration_minutes: 180 },
  { name: 'Liposuction - Brazilian Butt Lift (BBL)', category: 'Liposuction', price: 100000, duration_minutes: 300 },
  { name: 'Upper Blepharoplasty',          category: 'Eyelid Surgery', price: 25000, duration_minutes: 90 },
  { name: 'Lower Blepharoplasty',          category: 'Eyelid Surgery', price: 25000, duration_minutes: 90 },
  { name: 'Upper + Lower Blepharoplasty',  category: 'Eyelid Surgery', price: 45000, duration_minutes: 150 },
  { name: 'Double Eyelid Creation',        category: 'Eyelid Surgery', price: 20000, duration_minutes: 90 },
  { name: 'Lip Augmentation - Upper Lip Reshaping',        category: 'Lip Augmentation', price: 15000, duration_minutes: 60 },
  { name: 'Lip Augmentation - Upper + Lower Lip Reshaping',category: 'Lip Augmentation', price: 25000, duration_minutes: 90 },
  { name: 'Lip Augmentation - Lip Lift Surgery',           category: 'Lip Augmentation', price: 30000, duration_minutes: 90 },
  { name: 'Breast Augmentation - Under Skin',   category: 'Breast Surgery', price: 120000, duration_minutes: 240 },
  { name: 'Breast Augmentation - Under Muscle', category: 'Breast Surgery', price: 140000, duration_minutes: 300 },
  { name: 'Breast Augmentation - Revision',     category: 'Breast Surgery', price: 150000, duration_minutes: 300 },
  { name: 'Hair Cut Men',              category: 'Hair Salon', price: 200,  duration_minutes: 30 },
  { name: 'Haircut Women',             category: 'Hair Salon', price: 350,  duration_minutes: 45 },
  { name: 'Hair Color Full',           category: 'Hair Salon', price: 2000, duration_minutes: 120 },
  { name: 'Highlights',                category: 'Hair Salon', price: 2500, duration_minutes: 120 },
  { name: 'Roots Retouch',             category: 'Hair Salon', price: 1000, duration_minutes: 60 },
  { name: 'Lightening & Bleach',       category: 'Hair Salon', price: 3000, duration_minutes: 120 },
  { name: 'Rebond Yuko Japanese',      category: 'Hair Salon', price: 3500, duration_minutes: 180 },
  { name: 'Rebond Volume',             category: 'Hair Salon', price: 3000, duration_minutes: 180 },
  { name: 'Relax',                     category: 'Hair Salon', price: 2000, duration_minutes: 120 },
  { name: 'Rebond Retouch',            category: 'Hair Salon', price: 2000, duration_minutes: 120 },
  { name: 'Hair Spa',                  category: 'Hair Salon', price: 800,  duration_minutes: 45 },
  { name: 'Organic Collagen',          category: 'Hair Salon', price: 1500, duration_minutes: 60 },
  { name: 'Dry Scalp Treatment',       category: 'Hair Salon', price: 1000, duration_minutes: 45 },
  { name: 'Anti Hairloss Treatment',   category: 'Hair Salon', price: 2000, duration_minutes: 60 },
  { name: 'Stemcell Therapy',          category: 'Hair Salon', price: 3000, duration_minutes: 60 },
  { name: 'Hair & Makeup',             category: 'Hair Salon', price: 3000, duration_minutes: 90 },
  { name: 'Shampoo & Blowdry',         category: 'Hair Salon', price: 300,  duration_minutes: 30 },
  { name: 'Straight / Beach Wave',     category: 'Hair Salon', price: 1500, duration_minutes: 60 },
  { name: 'Up Style / Hairdo',         category: 'Hair Salon', price: 1500, duration_minutes: 60 },
  { name: 'Keratin Smoothing',         category: 'Hair Salon', price: 3000, duration_minutes: 120 },
  { name: 'Straight Therapy',          category: 'Hair Salon', price: 2500, duration_minutes: 120 },
  { name: 'Shampoo, Blowdry & Iron',   category: 'Hair Salon', price: 500,  duration_minutes: 45 },
  { name: 'Nails',                      category: 'Nails', price: 200,  duration_minutes: 30 },
  { name: 'Manicure Cleaning',          category: 'Nails', price: 200,  duration_minutes: 30 },
  { name: 'Pedicure Cleaning',          category: 'Nails', price: 250,  duration_minutes: 45 },
  { name: 'Gel Manicure',               category: 'Nails', price: 500,  duration_minutes: 45 },
  { name: 'Gel Pedicure',               category: 'Nails', price: 600,  duration_minutes: 60 },
  { name: 'Footspa',                    category: 'Nails', price: 500,  duration_minutes: 45 },
  { name: 'Gel Remover',                category: 'Nails', price: 200,  duration_minutes: 15 },
  { name: 'Softgel Ext. w/ Colors',     category: 'Nails', price: 1000, duration_minutes: 60 },
  { name: 'Polygel Ext. w/ Colors',     category: 'Nails', price: 1200, duration_minutes: 90 },
];

async function main() {
  const sep = '═'.repeat(52);
  console.log(`\n${sep}`);
  console.log('  FitWhite — Seeding Services (Direct SQL)');
  console.log(sep);

  await pgClient.connect();
  console.log('\n  ✅  Connected to Supabase PostgreSQL\n');

  // Add unique constraint if it doesn't exist
  console.log('▶  Ensuring unique constraint on services(branch_id, name)...');
  await pgClient.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'services_branch_id_name_key'
      ) THEN
        ALTER TABLE services ADD CONSTRAINT services_branch_id_name_key UNIQUE (branch_id, name);
      END IF;
    END $$;
  `);
  console.log('   ✅  Constraint ensured\n');

  // Fetch branches
  const { rows: branches } = await pgClient.query(
    'SELECT id, name, code FROM branches WHERE is_active = TRUE ORDER BY name'
  );
  console.log(`📍  Found ${branches.length} active branches\n`);

  let totalServices = 0;

  for (const branch of branches) {
    console.log(`▶  Seeding: ${branch.name} (${branch.code}) — ${SERVICES.length} services`);

    for (const s of SERVICES) {
      await pgClient.query(
        `INSERT INTO services (branch_id, name, category, price, duration_minutes, is_active)
         VALUES ($1, $2, $3, $4, $5, TRUE)
         ON CONFLICT (branch_id, name) DO NOTHING`,
        [branch.id, s.name, s.category, s.price, s.duration_minutes]
      );
      totalServices++;
    }
    console.log(`   ✅  Done`);
  }

  await pgClient.end();

  console.log(`\n${sep}`);
  console.log(`  ✅  Services seeded!`);
  console.log(`     Total: ${totalServices} service records across ${branches.length} branches`);
  console.log(`${sep}\n`);
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
