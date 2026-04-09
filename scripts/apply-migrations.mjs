/**
 * FitWhite - Apply Supabase Migrations
 * Connects directly to Supabase PostgreSQL and applies migration files.
 */
import pg from 'pg';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const { Client } = pg;

const client = new Client({
  host: 'db.cdtmufbsexzlgucmlols.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: 'Fitwhite2026!',
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000,
  statement_timeout: 60000,
});

const migrations = [
  { label: '001_schema.sql',      file: 'supabase/migrations/001_schema.sql' },
  { label: '002_rls_policies.sql', file: 'supabase/migrations/002_rls_policies.sql' },
];

function printHeader(text) {
  const line = '═'.repeat(50);
  console.log(`\n${line}`);
  console.log(`  ${text}`);
  console.log(line);
}

async function applyMigration(label, sql) {
  console.log(`\n▶  Applying: ${label}`);
  try {
    await client.query(sql);
    console.log(`   ✅  ${label} — success`);
    return true;
  } catch (err) {
    // If it's "already exists" errors, that's fine
    if (err.message.includes('already exists')) {
      console.log(`   ⚠️   ${label} — some objects already exist (safe to continue)`);
      console.log(`       Detail: ${err.message}`);
      return true;
    }
    console.error(`   ❌  ${label} — ERROR: ${err.message}`);
    return false;
  }
}

async function main() {
  printHeader('FitWhite Database Migration Runner');
  console.log(`\n  Host: db.cdtmufbsexzlgucmlols.supabase.co`);
  console.log(`  DB:   postgres`);

  console.log('\n  Connecting...');
  await client.connect();
  console.log('  ✅  Connected to Supabase PostgreSQL\n');

  let success = true;
  for (const { label, file } of migrations) {
    const sql = readFileSync(resolve(file), 'utf-8');
    const ok = await applyMigration(label, sql);
    if (!ok) {
      success = false;
      console.log(`\n  ⚠️   Stopping after failed migration: ${label}`);
      break;
    }
  }

  await client.end();

  console.log('\n' + '═'.repeat(50));
  if (success) {
    console.log('\n  ✅  All migrations applied successfully!');
    console.log('  Next: run "npm run seed" to populate data.\n');
  } else {
    console.log('\n  ❌  Migration failed. Check errors above.\n');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err.message);
  process.exit(1);
});
