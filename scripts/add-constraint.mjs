import pg from 'pg';
const { Client } = pg;
const c = new Client({
  host: 'db.cdtmufbsexzlgucmlols.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: 'Fitwhite2026!',
  ssl: { rejectUnauthorized: false }
});
await c.connect();

await c.query(`
  DO $body$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_branch_id_name_key') THEN
      ALTER TABLE products ADD CONSTRAINT products_branch_id_name_key UNIQUE (branch_id, name);
    END IF;
  END $body$;
`);
console.log('✅ products(branch_id, name) unique constraint added');
await c.end();
