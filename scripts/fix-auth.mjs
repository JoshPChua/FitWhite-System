/**
 * FitWhite — Fix handle_new_user trigger to be fault-tolerant
 * then delete/recreate accounts properly via Admin API.
 */
import pg from 'pg';
const { Client } = pg;

const db = new Client({
  host: 'db.cdtmufbsexzlgucmlols.supabase.co',
  port: 5432, database: 'postgres', user: 'postgres',
  password: 'Fitwhite2026!', ssl: { rejectUnauthorized: false },
});

const SUPABASE_URL = 'https://cdtmufbsexzlgucmlols.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNkdG11ZmJzZXh6bGd1Y21sb2xzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTcyOTYxMSwiZXhwIjoyMDkxMzA1NjExfQ.rHSYEZsCwnga5A8orBuefuzbStJ_oEQAxio-IV2ArmM';

const ACCOUNTS = [
  { email: 'owner@fitwhite.com',   password: 'FitWhite2026', firstName: 'FitWhite', lastName: 'Owner',   role: 'owner',   branchCode: null },
  { email: 'manager@fitwhite.com', password: 'FitWhite2026', firstName: 'Branch',   lastName: 'Manager', role: 'manager', branchCode: 'MNL' },
  { email: 'staff@fitwhite.com',   password: 'FitWhite2026', firstName: 'FitWhite', lastName: 'Staff',   role: 'cashier', branchCode: 'MNL' },
];

async function adminFetch(path, method = 'GET', body = null) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { ok: res.ok, status: res.status, data: await res.json() };
}

async function main() {
  await db.connect();
  console.log('\n✅  Connected\n');

  // ── Step 1: Fix handle_new_user trigger to be fault-tolerant ──────────────
  console.log('▶  Fixing handle_new_user trigger...');
  await db.query(`
    CREATE OR REPLACE FUNCTION handle_new_user()
    RETURNS TRIGGER AS $$
    BEGIN
      INSERT INTO public.profiles (id, email, first_name, last_name, role)
      VALUES (
        NEW.id,
        COALESCE(NEW.email, ''),
        COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
        COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
        COALESCE((NEW.raw_user_meta_data->>'role')::public.user_role, 'cashier')
      )
      ON CONFLICT (id) DO NOTHING;
      RETURN NEW;
    EXCEPTION WHEN OTHERS THEN
      -- Never block user creation due to profile insert failure
      RAISE WARNING 'handle_new_user failed: %', SQLERRM;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth;
  `);
  console.log('   ✅  Trigger patched (fault-tolerant + ON CONFLICT DO NOTHING)\n');

  // ── Step 2: Delete old directly-inserted users ────────────────────────────
  console.log('▶  Removing old broken accounts...');
  const emails = ACCOUNTS.map(a => a.email);
  for (const email of emails) {
    const { rows } = await db.query(`SELECT id FROM auth.users WHERE email = '${email}'`);
    if (rows.length === 0) {
      console.log(`   ↺  ${email} not found`);
      continue;
    }
    const userId = rows[0].id;
    // Delete profile first (FK)
    await db.query(`DELETE FROM profiles WHERE id = '${userId}'`);
    // Delete identity
    await db.query(`DELETE FROM auth.identities WHERE user_id = '${userId}'`);
    // Delete user
    await db.query(`DELETE FROM auth.users WHERE id = '${userId}'`);
    console.log(`   ✓  Deleted: ${email}`);
  }

  // ── Step 3: Get branch IDs ────────────────────────────────────────────────
  const { rows: branches } = await db.query('SELECT id, code FROM branches');
  const branchMap = Object.fromEntries(branches.map(b => [b.code, b.id]));

  // ── Step 4: Recreate via Admin API (trigger will work now) ────────────────
  console.log('\n▶  Creating accounts via Admin API...');
  for (const acc of ACCOUNTS) {
    console.log(`\n   ${acc.email} (${acc.role})`);

    const { ok, data: createData } = await adminFetch('/users', 'POST', {
      email: acc.email,
      password: acc.password,
      email_confirm: true,
      user_metadata: {
        first_name: acc.firstName,
        last_name: acc.lastName,
        role: acc.role,
      },
    });

    if (!ok) {
      console.log(`   ❌  API error: ${createData.msg || createData.message || JSON.stringify(createData)}`);
      continue;
    }

    const userId = createData.id;
    console.log(`   ✓  Auth user: ${userId}`);

    // Set correct role & branch in profile (trigger sets 'cashier' by default,
    // we override it to the correct role)
    const branchId = acc.branchCode ? (branchMap[acc.branchCode] ?? null) : null;
    await db.query(`
      INSERT INTO profiles (id, email, first_name, last_name, role, branch_id, is_active)
      VALUES ('${userId}', '${acc.email}', '${acc.firstName}', '${acc.lastName}', 
              '${acc.role}', ${branchId ? `'${branchId}'` : 'NULL'}, TRUE)
      ON CONFLICT (id) DO UPDATE SET
        role = '${acc.role}',
        branch_id = ${branchId ? `'${branchId}'` : 'NULL'},
        is_active = TRUE,
        updated_at = NOW()
    `);
    console.log(`   ✅  Profile: role=${acc.role}${acc.branchCode ? ', branch=' + acc.branchCode : ' (all branches)'}`);
  }

  await db.end();

  console.log('\n' + '═'.repeat(52));
  console.log('  ✅  All done!\n');
  console.log('  🔑  Login credentials:\n');
  console.log('  Email                       Password');
  console.log('  ─────────────────────────────────────────');
  for (const a of ACCOUNTS) {
    const pad = ' '.repeat(28 - a.email.length);
    console.log(`  ${a.email}${pad}${a.password}`);
  }
  console.log(`\n  🌐  https://fit-white-system.vercel.app/login`);
  console.log('═'.repeat(52) + '\n');
}

main().catch(async err => {
  try { await db.end(); } catch {}
  console.error('\n❌ Fatal:', err.message);
  process.exit(1);
});
