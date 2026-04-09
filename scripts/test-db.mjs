import pg from 'pg';
const { Client } = pg;

// Try direct connection (port 5432, not pooler)
const configs = [
  {
    name: 'Direct (5432)',
    host: 'db.cdtmufbsexzlgucmlols.supabase.co',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: 'Fitwhite2026!',
    ssl: { rejectUnauthorized: false }
  },
  {
    name: 'Pooler Transaction (6543)',
    host: 'aws-0-ap-southeast-1.pooler.supabase.com',
    port: 6543,
    database: 'postgres',
    user: 'postgres.cdtmufbsexzlgucmlols',
    password: 'Fitwhite2026!',
    ssl: { rejectUnauthorized: false }
  },
  {
    name: 'Pooler Session (5432)',
    host: 'aws-0-ap-southeast-1.pooler.supabase.com',
    port: 5432,
    database: 'postgres',
    user: 'postgres.cdtmufbsexzlgucmlols',
    password: 'Fitwhite2026!',
    ssl: { rejectUnauthorized: false }
  }
];

for (const config of configs) {
  const { name, ...clientConfig } = config;
  const client = new pg.Client(clientConfig);
  try {
    await client.connect();
    const res = await client.query("SELECT 1");
    console.log(`✅ ${name}: Connected!`);
    await client.end();
    break;
  } catch (err) {
    console.log(`❌ ${name}: ${err.message}`);
    try { await client.end(); } catch {}
  }
}