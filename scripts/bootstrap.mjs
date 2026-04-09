/**
 * FitWhite Aesthetics System — Bootstrap Script
 * =============================================
 * 1. Seeds the 11 FitWhite branches
 * 2. Then runs seed-products.mjs automatically
 *
 * Usage:
 *   node scripts/bootstrap.mjs
 *
 * Requires .env.local with:
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

// ─── Branch Definitions ────────────────────────────────────────────────────

const BRANCHES = [
  { name: 'Bacolod',     code: 'BCL', type: 'owned', address: 'Bacolod City, Negros Occidental',     is_active: true },
  { name: 'Baclaran',    code: 'BCR', type: 'owned', address: 'Baclaran, Parañaque City, Metro Manila', is_active: true },
  { name: 'Calamba',     code: 'CLB', type: 'owned', address: 'Calamba, Laguna',                     is_active: true },
  { name: 'Davao',       code: 'DVO', type: 'owned', address: 'Davao City',                          is_active: true },
  { name: 'Iloilo',      code: 'ILO', type: 'owned', address: 'Iloilo City',                         is_active: true },
  { name: 'Imus',        code: 'IMS', type: 'owned', address: 'Imus, Cavite',                        is_active: true },
  { name: 'Makati',      code: 'MKT', type: 'owned', address: 'Makati City, Metro Manila',           is_active: true },
  { name: 'Manila',      code: 'MNL', type: 'owned', address: 'Manila, Metro Manila',                is_active: true },
  { name: 'Paranaque',   code: 'PRQ', type: 'owned', address: 'Parañaque City, Metro Manila',        is_active: true },
  { name: 'Pasay',       code: 'PSY', type: 'owned', address: 'Pasay City, Metro Manila',            is_active: true },
  { name: 'Quezon City', code: 'QC',  type: 'owned', address: 'Quezon City, Metro Manila',           is_active: true },
];

async function main() {
  const sep = '═'.repeat(52);
  console.log(`\n${sep}`);
  console.log('  FitWhite Bootstrap — Branches + Products');
  console.log(sep);

  // ── Step 1: Seed Branches ────────────────────────────────────
  console.log('\n▶  Step 1: Seeding branches...');

  const { data: inserted, error: branchErr } = await supabase
    .from('branches')
    .upsert(BRANCHES, { onConflict: 'code', ignoreDuplicates: false })
    .select('id, name, code');

  if (branchErr) {
    console.error('❌  Failed to seed branches:', branchErr.message);
    process.exit(1);
  }

  console.log(`   ✅  ${inserted.length} branches upserted:`);
  inserted.forEach(b => console.log(`       ${b.code}  ${b.name}`));

  // ── Step 2: Seed Services + Products via seed-products.mjs ───
  console.log('\n▶  Step 2: Seeding services and products...\n');

  const { default: seedProducts } = await import('./seed-products.mjs');
}

main().catch(err => {
  console.error('Fatal bootstrap error:', err.message);
  process.exit(1);
});
