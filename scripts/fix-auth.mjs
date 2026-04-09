/**
 * FitWhite — Fix accounts: add auth.identities + reload PostgREST schema
 */
import pg from 'pg';
const { Client } = pg;

const db = new Client({
  host: 'db.cdtmufbsexzlgucmlols.supabase.co',
  port: 5432, database: 'postgres', user: 'postgres',
  password: 'Fitwhite2026!', ssl: { rejectUnauthorized: false },
});

async function main() {
  await db.connect();
  console.log('\n✅  Connected\n');

  // Get the 3 accounts we created
  const { rows: users } = await db.query(`
    SELECT id, email FROM auth.users
    WHERE email IN ('owner@fitwhite.com', 'manager@fitwhite.com', 'staff@fitwhite.com')
  `);
  console.log(`Found ${users.length} users\n`);

  for (const u of users) {
    // Check existing identity
    const { rows: existing } = await db.query(`
      SELECT id FROM auth.identities
      WHERE user_id = '${u.id}' AND provider = 'email'
    `);

    if (existing.length > 0) {
      console.log(`↺  ${u.email} — identity already exists`);
      continue;
    }

    // Insert identity record
    await db.query(`
      INSERT INTO auth.identities (
        id, user_id, identity_data, provider, provider_id,
        last_sign_in_at, created_at, updated_at
      ) VALUES (
        gen_random_uuid(),
        '${u.id}',
        json_build_object('sub', '${u.id}', 'email', '${u.email}')::jsonb,
        'email',
        '${u.email}',
        NOW(), NOW(), NOW()
      )
    `);
    console.log(`✅  ${u.email} — identity created`);
  }

  // Force PostgREST to reload schema cache
  console.log('\n▶  Reloading PostgREST schema cache...');
  await db.query(`NOTIFY pgrst, 'reload schema'`);
  console.log('   ✅  Done\n');

  await db.end();

  console.log('═'.repeat(52));
  console.log('  ✅  Fix complete! Try logging in:\n');
  console.log('  🌐  https://fit-white-system.vercel.app/login\n');
  console.log('  owner@fitwhite.com    →  FitWhite2026');
  console.log('  manager@fitwhite.com  →  FitWhite2026');
  console.log('  staff@fitwhite.com    →  FitWhite2026');
  console.log('═'.repeat(52) + '\n');
}

main().catch(err => {
  console.error('❌', err.message);
  process.exit(1);
});
