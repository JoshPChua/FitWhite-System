/**
 * FitWhite — Seed Branches directly via PostgreSQL
 * Then the seed-products.mjs script can run successfully.
 */
import pg from 'pg';
const { Client } = pg;

const client = new Client({
  host: 'db.cdtmufbsexzlgucmlols.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: 'Fitwhite2026!',
  ssl: { rejectUnauthorized: false },
});

const BRANCHES = [
  { name: 'Bacolod',     code: 'BCL', type: 'owned', address: 'Bacolod City, Negros Occidental' },
  { name: 'Baclaran',    code: 'BCR', type: 'owned', address: 'Baclaran, Parañaque City, Metro Manila' },
  { name: 'Calamba',     code: 'CLB', type: 'owned', address: 'Calamba, Laguna' },
  { name: 'Davao',       code: 'DVO', type: 'owned', address: 'Davao City' },
  { name: 'Iloilo',      code: 'ILO', type: 'owned', address: 'Iloilo City' },
  { name: 'Imus',        code: 'IMS', type: 'owned', address: 'Imus, Cavite' },
  { name: 'Makati',      code: 'MKT', type: 'owned', address: 'Makati City, Metro Manila' },
  { name: 'Manila',      code: 'MNL', type: 'owned', address: 'Manila, Metro Manila' },
  { name: 'Paranaque',   code: 'PRQ', type: 'owned', address: 'Parañaque City, Metro Manila' },
  { name: 'Pasay',       code: 'PSY', type: 'owned', address: 'Pasay City, Metro Manila' },
  { name: 'Quezon City', code: 'QC',  type: 'owned', address: 'Quezon City, Metro Manila' },
];

async function main() {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  FitWhite — Seeding Branches');
  console.log('══════════════════════════════════════════════════════\n');

  await client.connect();
  console.log('  ✅  Connected to Supabase PostgreSQL\n');

  let inserted = 0;
  let skipped = 0;

  for (const b of BRANCHES) {
    const result = await client.query(
      `INSERT INTO branches (name, code, type, address, is_active)
       VALUES ($1, $2, $3::branch_type, $4, TRUE)
       ON CONFLICT (code) DO UPDATE
         SET name = EXCLUDED.name,
             address = EXCLUDED.address,
             updated_at = NOW()
       RETURNING id, name, code`,
      [b.name, b.code, b.type, b.address]
    );

    if (result.rows.length > 0) {
      console.log(`  ✓  ${result.rows[0].code}  ${result.rows[0].name}`);
      inserted++;
    } else {
      skipped++;
    }
  }

  await client.end();

  console.log('\n══════════════════════════════════════════════════════');
  console.log(`  ✅  Done! ${inserted} branches seeded, ${skipped} skipped`);
  console.log('  Next: npm run seed\n');
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
