/**
 * FitWhite Aesthetics System — Database Seeder
 * =============================================
 * Seeds all services and products from Products.txt into Supabase
 * for ALL active branches.
 *
 * Usage:
 *   node scripts/seed-products.mjs
 *
 * Requires environment variables (copy from .env.local):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌  Missing environment variables. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ─── Service Definitions ─────────────────────────────────────────────────────

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

  // IV Add-ons
  { name: 'Stemcell Add-on',               category: 'Add-ons',       price: 500,  duration_minutes: 5 },
  { name: 'Whitening Booster',             category: 'Add-ons',       price: 500,  duration_minutes: 5 },
  { name: 'Placenta Add-on',               category: 'Add-ons',       price: 500,  duration_minutes: 5 },
  { name: 'Collagen Add-on',               category: 'Add-ons',       price: 500,  duration_minutes: 5 },
  { name: 'Vitamin C Add-on',              category: 'Add-ons',       price: 300,  duration_minutes: 5 },
  { name: 'Vitamin B Complex Add-on',      category: 'Add-ons',       price: 300,  duration_minutes: 5 },

  // Body Sculpting
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

  // HIFU
  { name: 'Face & Neck HIFU',              category: 'HIFU',           price: 12000, duration_minutes: 90 },
  { name: 'Arms HIFU',                     category: 'HIFU',           price: 6000,  duration_minutes: 45 },
  { name: 'Tummy HIFU',                    category: 'HIFU',           price: 8000,  duration_minutes: 60 },

  // Nose Treatments
  { name: 'Nose Sculpt',                   category: 'Nose Treatments', price: 5000, duration_minutes: 30 },
  { name: 'Naso Form',                     category: 'Nose Treatments', price: 6000, duration_minutes: 45 },
  { name: 'Rhinolift',                     category: 'Nose Treatments', price: 8000, duration_minutes: 45 },
  { name: 'Pixie Tip',                     category: 'Nose Treatments', price: 7000, duration_minutes: 30 },

  // Botox
  { name: 'Upper / Lower Botox',           category: 'Botox',          price: 6000, duration_minutes: 30 },
  { name: 'Arms / Shoulder Botox',         category: 'Botox',          price: 8000, duration_minutes: 30 },
  { name: 'Palm / Sweatox Botox',          category: 'Botox',          price: 8000, duration_minutes: 30 },
  { name: 'Calves Botox',                  category: 'Botox',          price: 10000, duration_minutes: 30 },

  // Facials
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

  // Acne Treatments
  { name: 'Acne Injection',                category: 'Acne Treatments', price: 500,  duration_minutes: 15 },
  { name: 'Acne Mild',                     category: 'Acne Treatments', price: 1500, duration_minutes: 30 },
  { name: 'Acne Moderate',                 category: 'Acne Treatments', price: 2500, duration_minutes: 45 },
  { name: 'Acne Severe',                   category: 'Acne Treatments', price: 3500, duration_minutes: 60 },
  { name: 'Back Acne Mild',               category: 'Acne Treatments', price: 2000, duration_minutes: 30 },
  { name: 'Back Acne Moderate',           category: 'Acne Treatments', price: 3000, duration_minutes: 45 },
  { name: 'Back Acne Severe',             category: 'Acne Treatments', price: 4000, duration_minutes: 60 },
  { name: 'Advance Acne Clear',           category: 'Acne Treatments', price: 12000, duration_minutes: 90 },

  // Underarm Treatments
  { name: 'Carbon Laser w/ Whitening - UA', category: 'Underarm',     price: 2000, duration_minutes: 30 },
  { name: 'Diamond w/ Whitening - UA',     category: 'Underarm',      price: 1500, duration_minutes: 30 },
  { name: 'Waxing - UA Treatment',         category: 'Underarm',      price: 500,  duration_minutes: 15 },
  { name: 'Threading Underarm',            category: 'Underarm',      price: 300,  duration_minutes: 15 },

  // Specialty
  { name: 'Fem Tightening',               category: 'Specialty',      price: 5000, duration_minutes: 30 },
  { name: 'Headspa Treatment',             category: 'Specialty',      price: 2000, duration_minutes: 45 },
  { name: 'Tattoo Removal',               category: 'Specialty',      price: 3000, duration_minutes: 30 },
  { name: 'Sclerotherapy',                category: 'Specialty',      price: 5000, duration_minutes: 30 },
  { name: 'Hair Restoration',             category: 'Specialty',      price: 8000, duration_minutes: 60 },
  { name: 'Advanced Scar Therapy',        category: 'Specialty',      price: 10000, duration_minutes: 90 },

  // Programs
  { name: 'Fit & White Program',           category: 'Programs',       price: 15000, duration_minutes: 120 },
  { name: 'Aphrodite Glow Up',             category: 'Programs',       price: 20000, duration_minutes: 120 },
  { name: 'Advanced Power Shape Body',     category: 'Programs',       price: 15000, duration_minutes: 120 },
  { name: 'Advanced Power Shape F & N',    category: 'Programs',       price: 12000, duration_minutes: 90 },
  { name: 'Glam Makeover',                category: 'Programs',       price: 5000,  duration_minutes: 60 },
  { name: '7D V Shape Face',              category: 'Programs',       price: 15000, duration_minutes: 90 },

  // Fillers
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

  // Skin Removal
  { name: 'Milia/Warts/Syringoma - Per Piece',         category: 'Skin Removal', price: 200,  duration_minutes: 10 },
  { name: 'Milia/Warts/Syringoma - Unli Face/Neck',    category: 'Skin Removal', price: 3000, duration_minutes: 45 },
  { name: 'Milia/Warts/Syringoma - Unli Face & Neck',  category: 'Skin Removal', price: 4000, duration_minutes: 60 },
  { name: 'Milia/Warts/Syringoma - Unli Back/Tummy',   category: 'Skin Removal', price: 3500, duration_minutes: 45 },
  { name: 'Milia/Warts/Syringoma - Unli Back & Tummy', category: 'Skin Removal', price: 5000, duration_minutes: 60 },
  { name: 'Milia/Warts/Syringoma - Whole Body Mild',   category: 'Skin Removal', price: 5000, duration_minutes: 60 },
  { name: 'Milia/Warts/Syringoma - Whole Body Moderate',category: 'Skin Removal', price: 7000, duration_minutes: 90 },
  { name: 'Milia/Warts/Syringoma - Whole Body Severe', category: 'Skin Removal', price: 10000, duration_minutes: 120 },

  // Semi-Permanent Makeup
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

  // Lashes
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

  // IPL
  { name: 'Upper & Lower Lip - IPL',      category: 'IPL', price: 1000, duration_minutes: 15 },
  { name: 'Full Face - IPL',              category: 'IPL', price: 3000, duration_minutes: 30 },
  { name: 'Underarm - IPL',               category: 'IPL', price: 1500, duration_minutes: 15 },
  { name: 'Arms / Legs - IPL',            category: 'IPL', price: 3000, duration_minutes: 30 },
  { name: 'Brazilian - IPL',              category: 'IPL', price: 3000, duration_minutes: 30 },

  // Diode / OPT
  { name: 'Upper & Lower Lip - Diode/OPT', category: 'Hair Removal', price: 1500, duration_minutes: 15 },
  { name: 'Underarm - Diode/OPT',           category: 'Hair Removal', price: 2000, duration_minutes: 15 },
  { name: 'Arms / Legs - Diode/OPT',        category: 'Hair Removal', price: 4000, duration_minutes: 30 },
  { name: 'Brazilian - Diode/OPT',          category: 'Hair Removal', price: 4000, duration_minutes: 30 },

  // PICO Laser
  { name: 'Pico Mela',                     category: 'Laser', price: 3000, duration_minutes: 30 },
  { name: 'Pico Full Face',                category: 'Laser', price: 5000, duration_minutes: 45 },
  { name: 'Underarm - Pico Treatment',     category: 'Laser', price: 2000, duration_minutes: 15 },
  { name: 'Brazilian/Butt/Bikini - Pico',  category: 'Laser', price: 5000, duration_minutes: 30 },

  // Waxing
  { name: 'Arms / Legs - Waxing',          category: 'Waxing', price: 1000, duration_minutes: 30 },
  { name: 'Brazilian - Waxing',            category: 'Waxing', price: 1500, duration_minutes: 30 },
  { name: 'Brow - Waxing',                 category: 'Waxing', price: 300,  duration_minutes: 10 },

  // Threading
  { name: 'Threading Eyebrow',             category: 'Threading', price: 200, duration_minutes: 10 },
  { name: 'Threading Upper Lip',           category: 'Threading', price: 150, duration_minutes: 10 },
  { name: 'Threading Full Face',           category: 'Threading', price: 500, duration_minutes: 20 },

  // Threads & Boosters
  { name: 'Mono Threads',                  category: 'Threads & Boosters', price: 5000,  duration_minutes: 45 },
  { name: 'Cog Threads',                   category: 'Threads & Boosters', price: 15000, duration_minutes: 60 },
  { name: 'Skin Booster',                  category: 'Threads & Boosters', price: 5000,  duration_minutes: 30 },

  // Rhinoplasty
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

  // Surgical
  { name: 'Buccal Fat Removal',            category: 'Surgical', price: 35000,  duration_minutes: 120 },
  { name: 'Chin Augmentation',             category: 'Surgical', price: 30000,  duration_minutes: 120 },
  { name: 'Dimple Creation',               category: 'Surgical', price: 15000,  duration_minutes: 60 },
  { name: 'Facelift (Full)',               category: 'Surgical', price: 120000, duration_minutes: 300 },
  { name: 'Facelift (Mini)',               category: 'Surgical', price: 70000,  duration_minutes: 180 },
  { name: 'Otoplasty',                     category: 'Surgical', price: 40000,  duration_minutes: 120 },
  { name: 'Vaginoplasty',                  category: 'Surgical', price: 80000,  duration_minutes: 240 },
  { name: 'Labiaplasty',                   category: 'Surgical', price: 50000,  duration_minutes: 180 },

  // Liposuction
  { name: 'Liposuction - Abdomen',         category: 'Liposuction', price: 60000,  duration_minutes: 180 },
  { name: 'Liposuction - Arms',            category: 'Liposuction', price: 40000,  duration_minutes: 120 },
  { name: 'Liposuction - Back',            category: 'Liposuction', price: 50000,  duration_minutes: 150 },
  { name: 'Liposuction - Thighs',          category: 'Liposuction', price: 55000,  duration_minutes: 150 },
  { name: 'Liposuction - Submental/Chin',  category: 'Liposuction', price: 35000,  duration_minutes: 90 },
  { name: 'Liposuction - Tummy Tuck',      category: 'Liposuction', price: 80000,  duration_minutes: 240 },
  { name: 'Liposuction - Mini Tuck',       category: 'Liposuction', price: 50000,  duration_minutes: 180 },
  { name: 'Liposuction - Brazilian Butt Lift (BBL)', category: 'Liposuction', price: 100000, duration_minutes: 300 },

  // Eyelid Surgery
  { name: 'Upper Blepharoplasty',          category: 'Eyelid Surgery', price: 25000, duration_minutes: 90 },
  { name: 'Lower Blepharoplasty',          category: 'Eyelid Surgery', price: 25000, duration_minutes: 90 },
  { name: 'Upper + Lower Blepharoplasty',  category: 'Eyelid Surgery', price: 45000, duration_minutes: 150 },
  { name: 'Double Eyelid Creation',        category: 'Eyelid Surgery', price: 20000, duration_minutes: 90 },

  // Lip Augmentation
  { name: 'Lip Augmentation - Upper Lip Reshaping',        category: 'Lip Augmentation', price: 15000, duration_minutes: 60 },
  { name: 'Lip Augmentation - Upper + Lower Lip Reshaping',category: 'Lip Augmentation', price: 25000, duration_minutes: 90 },
  { name: 'Lip Augmentation - Lip Lift Surgery',           category: 'Lip Augmentation', price: 30000, duration_minutes: 90 },

  // Breast Augmentation
  { name: 'Breast Augmentation - Under Skin',   category: 'Breast Surgery', price: 120000, duration_minutes: 240 },
  { name: 'Breast Augmentation - Under Muscle', category: 'Breast Surgery', price: 140000, duration_minutes: 300 },
  { name: 'Breast Augmentation - Revision',     category: 'Breast Surgery', price: 150000, duration_minutes: 300 },

  // Hair Salon
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

  // Nails
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

// ─── Product Definitions ─────────────────────────────────────────────────────

const PRODUCTS = [
  // IV Boosters
  { name: 'Stemcell Booster',     category: 'IV Boosters',  price: 500,  unit: 'vial', sku: 'IV-STEMCELL',    qty: 200, low: 20 },
  { name: 'Whitening Booster',    category: 'IV Boosters',  price: 500,  unit: 'vial', sku: 'IV-WHITENING',   qty: 200, low: 20 },
  { name: 'Placenta Booster',     category: 'IV Boosters',  price: 500,  unit: 'vial', sku: 'IV-PLACENTA',    qty: 200, low: 20 },
  { name: 'Collagen Booster',     category: 'IV Boosters',  price: 500,  unit: 'vial', sku: 'IV-COLLAGEN',    qty: 200, low: 20 },
  { name: 'Vitamin C Booster',    category: 'IV Boosters',  price: 300,  unit: 'vial', sku: 'IV-VITC',        qty: 300, low: 30 },
  { name: 'Vitamin B Complex',    category: 'IV Boosters',  price: 300,  unit: 'vial', sku: 'IV-VITB',        qty: 300, low: 30 },
  // Soaps
  { name: 'Calamansi Soap',       category: 'Soaps',        price: 150,  unit: 'bar', sku: 'SOAP-CALAMANSI',  qty: 100, low: 10 },
  { name: 'Carrot Soap',          category: 'Soaps',        price: 150,  unit: 'bar', sku: 'SOAP-CARROT',     qty: 100, low: 10 },
  { name: 'Collagen Soap',        category: 'Soaps',        price: 180,  unit: 'bar', sku: 'SOAP-COLLAGEN',   qty: 100, low: 10 },
  { name: 'Glutathione Soap',     category: 'Soaps',        price: 200,  unit: 'bar', sku: 'SOAP-GLUTA',      qty: 100, low: 10 },
  { name: 'Kojic Soap',           category: 'Soaps',        price: 150,  unit: 'bar', sku: 'SOAP-KOJIC',      qty: 100, low: 10 },
  { name: 'Lemon Soap',           category: 'Soaps',        price: 150,  unit: 'bar', sku: 'SOAP-LEMON',      qty: 100, low: 10 },
  { name: 'Oatmeal Soap',         category: 'Soaps',        price: 150,  unit: 'bar', sku: 'SOAP-OATMEAL',    qty: 100, low: 10 },
  { name: 'Placenta Soap',        category: 'Soaps',        price: 150,  unit: 'bar', sku: 'SOAP-PLACENTA',   qty: 100, low: 10 },
  { name: 'Tomato Soap',          category: 'Soaps',        price: 150,  unit: 'bar', sku: 'SOAP-TOMATO',     qty: 100, low: 10 },
  { name: 'Glutamansi Soap',      category: 'Soaps',        price: 180,  unit: 'bar', sku: 'SOAP-GLUTAMANSI', qty: 100, low: 10 },
  { name: 'Niacinamide Soap',     category: 'Soaps',        price: 180,  unit: 'bar', sku: 'SOAP-NIACINAMIDE',qty: 100, low: 10 },
  { name: 'Sugarcane Soap',       category: 'Soaps',        price: 150,  unit: 'bar', sku: 'SOAP-SUGARCANE',  qty: 100, low: 10 },
  // Creams
  { name: 'Collagen Elastin Cream',category: 'Creams',      price: 350,  unit: 'bottle', sku: 'CRM-COL-ELASTIN', qty: 50, low: 5 },
  { name: 'Mela White Cream',     category: 'Creams',       price: 400,  unit: 'bottle', sku: 'CRM-MELA-WHITE',  qty: 50, low: 5 },
  { name: 'Stretchmark Cream',    category: 'Creams',       price: 450,  unit: 'bottle', sku: 'CRM-STRETCHMARK', qty: 50, low: 5 },
  { name: 'Sunblock Beige Cream', category: 'Creams',       price: 350,  unit: 'bottle', sku: 'CRM-SUNBLOCK-BG', qty: 80, low: 10 },
  { name: 'Underarm Cream',       category: 'Creams',       price: 300,  unit: 'bottle', sku: 'CRM-UNDERARM',    qty: 80, low: 10 },
  { name: 'Antibacterial Cream',  category: 'Creams',       price: 200,  unit: 'tube',   sku: 'CRM-ANTIBAC',     qty: 80, low: 10 },
  { name: 'CO2 Cream',            category: 'Creams',       price: 250,  unit: 'tube',   sku: 'CRM-CO2',         qty: 60, low: 5 },
  { name: 'Hydrocortisone Cream', category: 'Creams',       price: 180,  unit: 'tube',   sku: 'CRM-HYDROCORT',   qty: 80, low: 10 },
  { name: 'Skin Defender',        category: 'Creams',       price: 300,  unit: 'bottle', sku: 'CRM-SKIN-DEF',    qty: 60, low: 5 },
  { name: 'Eyelift Cream',        category: 'Creams',       price: 500,  unit: 'bottle', sku: 'CRM-EYELIFT',     qty: 50, low: 5 },
  // Sunblock
  { name: 'Sunblock Gel',         category: 'Sunblock',     price: 350,  unit: 'bottle', sku: 'SBK-GEL',         qty: 80, low: 10 },
  { name: 'Sunblock SPF 70',      category: 'Sunblock',     price: 350,  unit: 'bottle', sku: 'SBK-SPF70',       qty: 80, low: 10 },
  // Solutions & Toners
  { name: 'Acne Toner',           category: 'Solutions',    price: 250,  unit: 'bottle', sku: 'SOL-ACNE-TNRR',   qty: 80, low: 10 },
  { name: 'Clarifying Solution Big',   category: 'Solutions', price: 400, unit: 'bottle', sku: 'SOL-CLARIFY-BIG', qty: 50, low: 5 },
  { name: 'Clarifying Solution Small', category: 'Solutions', price: 250, unit: 'bottle', sku: 'SOL-CLARIFY-SM',  qty: 80, low: 10 },
  { name: 'Mela Clear Solution Big',   category: 'Solutions', price: 400, unit: 'bottle', sku: 'SOL-MELA-BIG',    qty: 50, low: 5 },
  { name: 'Mela Clear Solution Small', category: 'Solutions', price: 250, unit: 'bottle', sku: 'SOL-MELA-SM',     qty: 80, low: 10 },
  { name: 'Intensive',            category: 'Solutions',    price: 350,  unit: 'bottle', sku: 'SOL-INTENSIVE',    qty: 60, low: 5 },
  { name: 'Instant White',        category: 'Solutions',    price: 250,  unit: 'bottle', sku: 'SOL-INSTANT-WHITE',qty: 80, low: 10 },
  // Lotions
  { name: 'Hand Lotion',          category: 'Lotions',      price: 200,  unit: 'bottle', sku: 'LOT-HAND',         qty: 100, low: 10 },
  { name: 'Skin Moisturizing Lotion', category: 'Lotions',  price: 250,  unit: 'bottle', sku: 'LOT-MOISTURIZE',   qty: 100, low: 10 },
  { name: 'Niacinamide Lotion',   category: 'Lotions',      price: 300,  unit: 'bottle', sku: 'LOT-NIACINAMIDE',  qty: 80,  low: 10 },
  // Serums & Sets
  { name: 'Glass Skin Serum',     category: 'Serums & Sets',price: 600,  unit: 'bottle', sku: 'SRM-GLASS-SKIN',   qty: 50, low: 5 },
  { name: 'Glass Skin Set',       category: 'Serums & Sets',price: 2000, unit: 'set',    sku: 'SET-GLASS-SKIN',   qty: 30, low: 5 },
  { name: 'Whitening Tea',        category: 'Serums & Sets',price: 350,  unit: 'box',    sku: 'WTE-WHITENING',    qty: 50, low: 5 },
  // Medical / Rx
  { name: 'Medical Kit (Complete)',                    category: 'Medical', price: 500,  unit: 'kit',    sku: 'MED-KIT-FULL',     qty: 50, low: 5 },
  { name: 'Medical Kit (Mupirocin & Antibiotics)',     category: 'Medical', price: 350,  unit: 'kit',    sku: 'MED-KIT-MUPABX',   qty: 60, low: 5 },
  { name: 'Medical Kit (Antibiotics & Mefenamic)',     category: 'Medical', price: 300,  unit: 'kit',    sku: 'MED-KIT-ABXMEF',   qty: 60, low: 5 },
  { name: 'Aphrodite Softgel',                         category: 'Medical', price: 800,  unit: 'bottle', sku: 'MED-APHRODITE-SG', qty: 40, low: 5 },
  { name: 'Vitamin C Orals',                           category: 'Medical', price: 250,  unit: 'bottle', sku: 'MED-VITC-ORAL',    qty: 80, low: 10 },
  { name: 'Vitamin B Orals',                           category: 'Medical', price: 250,  unit: 'bottle', sku: 'MED-VITB-ORAL',    qty: 80, low: 10 },
  { name: 'Vitamin E Orals',                           category: 'Medical', price: 250,  unit: 'bottle', sku: 'MED-VITE-ORAL',    qty: 80, low: 10 },
  { name: 'Tea Tree Soothing Gel',                     category: 'Medical', price: 200,  unit: 'tube',   sku: 'MED-TEATREE-GEL',  qty: 80, low: 10 },
  { name: 'Mupirocin',                                 category: 'Medical', price: 150,  unit: 'tube',   sku: 'MED-MUPIROCIN',    qty: 100, low: 10 },
  { name: 'Etherium',                                  category: 'Medical', price: 250,  unit: 'bottle', sku: 'MED-ETHERIUM',     qty: 60, low: 5 },
  { name: 'Fougera',                                   category: 'Medical', price: 200,  unit: 'tube',   sku: 'MED-FOUGERA',      qty: 60, low: 5 },
  // Accessories
  { name: 'Binder Corset',                             category: 'Accessories', price: 1500, unit: 'piece', sku: 'ACC-BINDER', qty: 20, low: 3 },
];

// ─── Seed Logic ───────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀  FitWhite Seeder starting...\n');

  // Fetch all active branches
  const { data: branches, error: branchErr } = await supabase
    .from('branches')
    .select('id, name, code')
    .eq('is_active', true)
    .order('name');

  if (branchErr || !branches?.length) {
    console.error('❌  Could not fetch branches:', branchErr?.message);
    process.exit(1);
  }

  console.log(`📍  Found ${branches.length} active branches:`);
  branches.forEach(b => console.log(`     ${b.code}  ${b.name}`));
  console.log('');

  let totalServices = 0;
  let totalProducts = 0;
  let errors = 0;

  for (const branch of branches) {
    console.log(`▶  Seeding branch: ${branch.name} (${branch.code})`);

    // ── Services ────────────────────────────────────────────────
    const servicePayload = SERVICES.map(s => ({
      branch_id: branch.id,
      name: s.name,
      category: s.category,
      price: s.price,
      duration_minutes: s.duration_minutes,
      is_active: true,
    }));

    const { error: svcErr } = await supabase
      .from('services')
      .upsert(servicePayload, { onConflict: 'branch_id,name', ignoreDuplicates: true });

    if (svcErr) {
      console.error(`  ❌  Services error (${branch.name}):`, svcErr.message);
      errors++;
    } else {
      totalServices += servicePayload.length;
      console.log(`  ✓  ${servicePayload.length} services`);
    }

    // ── Products + Inventory ─────────────────────────────────────
    for (const p of PRODUCTS) {
      // Upsert product
      const { data: prodData, error: prodErr } = await supabase
        .from('products')
        .upsert({
          branch_id: branch.id,
          name: p.name,
          category: p.category,
          price: p.price,
          unit: p.unit,
          sku: `${branch.code}-${p.sku}`,
          is_active: true,
        }, { onConflict: 'branch_id,sku', ignoreDuplicates: false })
        .select('id')
        .single();

      if (prodErr || !prodData) {
        // SKU conflict — skip, product already exists for this branch
        continue;
      }

      totalProducts++;

      // Upsert inventory
      await supabase.from('inventory').upsert({
        product_id: prodData.id,
        branch_id: branch.id,
        quantity: p.qty,
        low_stock_threshold: p.low,
      }, { onConflict: 'product_id,branch_id', ignoreDuplicates: true });
    }
    console.log(`  ✓  ${PRODUCTS.length} products (with inventory)`);
  }

  console.log('\n' + '═'.repeat(50));
  console.log(`✅  Seed complete!`);
  console.log(`   Services inserted: ${totalServices}`);
  console.log(`   Products inserted: ${totalProducts}`);
  if (errors > 0) {
    console.log(`   ⚠  Errors: ${errors} (check logs above)`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
