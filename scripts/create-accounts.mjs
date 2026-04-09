/**
 * FitWhite — Create User Accounts
 * Inserts directly into auth.users with a bcrypt password hash,
 * bypassing the Supabase Admin API trigger issue.
 */
import pg from 'pg';

const { Client } = pg;
const db = new Client({
  host: 'db.cdtmufbsexzlgucmlols.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: 'Fitwhite2026!',
  ssl: { rejectUnauthorized: false },
});

const ACCOUNTS = [
  { email: 'owner@fitwhite.com',   password: 'FitWhite2026', firstName: 'FitWhite', lastName: 'Owner',   role: 'owner',   branchCode: null },
  { email: 'manager@fitwhite.com', password: 'FitWhite2026', firstName: 'Branch',   lastName: 'Manager', role: 'manager', branchCode: 'MNL' },
  { email: 'staff@fitwhite.com',   password: 'FitWhite2026', firstName: 'FitWhite', lastName: 'Staff',   role: 'cashier', branchCode: 'MNL' },
];

async function main() {
  const sep = '═'.repeat(52);
  console.log(`\n${sep}\n  FitWhite — Creating Accounts\n${sep}\n`);

  await db.connect();

  // Get branches
  const { rows: branches } = await db.query('SELECT id, code FROM branches');
  const branchMap = Object.fromEntries(branches.map(b => [b.code, b.id]));

  for (const acc of ACCOUNTS) {
    console.log(`▶  ${acc.email} (${acc.role})`);

    // Check if user already exists in auth.users
    const { rows: existing } = await db.query(
      `SELECT id FROM auth.users WHERE email = $1`, [acc.email]
    );

    let userId;

    if (existing.length > 0) {
      userId = existing[0].id;
      console.log(`   ↺  Exists: ${userId} — updating password hash`);

      // Update password: Supabase uses crypt() from pgcrypto
      await db.query(
        `UPDATE auth.users
         SET encrypted_password = crypt($1, gen_salt('bf')),
             updated_at = NOW()
         WHERE id = $2`,
        [acc.password, userId]
      );
    } else {
      // Insert directly into auth.users
      const res = await db.query(
        `INSERT INTO auth.users (
           instance_id, id, aud, role, email,
           encrypted_password, email_confirmed_at,
           raw_app_meta_data, raw_user_meta_data,
           created_at, updated_at, confirmation_token, recovery_token
         )
         VALUES (
           '00000000-0000-0000-0000-000000000000',
           gen_random_uuid(),
           'authenticated',
           'authenticated',
           $1,
           crypt($2, gen_salt('bf')),
           NOW(),
           '{"provider":"email","providers":["email"]}'::jsonb,
           $3::jsonb,
           NOW(), NOW(), '', ''
         )
         RETURNING id`,
        [
          acc.email,
          acc.password,
          JSON.stringify({ first_name: acc.firstName, last_name: acc.lastName, role: acc.role }),
        ]
      );

      userId = res.rows[0].id;
      console.log(`   ✓  Auth user created: ${userId}`);
    }

    const branchId = acc.branchCode ? (branchMap[acc.branchCode] ?? null) : null;

    // Upsert profile
    await db.query(
      `INSERT INTO profiles (id, email, first_name, last_name, role, branch_id, is_active)
       VALUES ($1, $2, $3, $4, $5::user_role, $6, TRUE)
       ON CONFLICT (id) DO UPDATE
         SET role = $5::user_role, first_name = $3, last_name = $4,
             email = $2, branch_id = $6, is_active = TRUE, updated_at = NOW()`,
      [userId, acc.email, acc.firstName, acc.lastName, acc.role, branchId]
    );

    console.log(`   ✅  role=${acc.role}${acc.branchCode ? ', branch=' + acc.branchCode : ' (all branches)'}`);
  }

  await db.end();

  console.log(`\n${sep}\n  ✅  All accounts ready!\n`);
  console.log('  Email                       Role      Password');
  console.log('  ─────────────────────────────────────────────────');
  for (const a of ACCOUNTS) {
    const ep = ' '.repeat(28 - a.email.length);
    const rp = ' '.repeat(10 - a.role.length);
    console.log(`  ${a.email}${ep}${a.role}${rp}${a.password}`);
  }
  console.log(`\n  🌐  https://fit-white-system.vercel.app/login\n${sep}\n`);
}

main().catch(async err => {
  try { await db.end(); } catch {}
  console.error('\n❌ Fatal:', err.message);
  process.exit(1);
});
