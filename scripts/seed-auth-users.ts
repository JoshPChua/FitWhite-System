/**
 * FitWhite Aesthetics POS - Auth User Seeder
 * 
 * This script creates Supabase Auth users for the system.
 * Run this BEFORE the seed.sql to ensure profiles are auto-created via trigger.
 * 
 * Usage: 
 *   Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local
 *   Then: npx ts-node scripts/seed-auth-users.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ─── Branch mapping (must match seed.sql UUIDs) ─────────────

const branches = [
  { code: 'ims',  name: 'Imus',         id: 'b0000001-0000-0000-0000-000000000001' },
  { code: 'psy',  name: 'Pasay',        id: 'b0000001-0000-0000-0000-000000000002' },
  { code: 'mnl',  name: 'Manila',       id: 'b0000001-0000-0000-0000-000000000003' },
  { code: 'mkt',  name: 'Makati',       id: 'b0000001-0000-0000-0000-000000000004' },
  { code: 'ilo',  name: 'Iloilo',       id: 'b0000001-0000-0000-0000-000000000005' },
  { code: 'bcl',  name: 'Bacolod',      id: 'b0000001-0000-0000-0000-000000000006' },
  { code: 'dvo',  name: 'Davao',        id: 'b0000001-0000-0000-0000-000000000007' },
  { code: 'clb',  name: 'Calamba',      id: 'b0000001-0000-0000-0000-000000000008' },
  { code: 'prq',  name: 'Paranaque',    id: 'b0000001-0000-0000-0000-000000000009' },
  { code: 'qc',   name: 'Quezon City',  id: 'b0000001-0000-0000-0000-000000000010' },
  { code: 'bcr',  name: 'Baclaran',     id: 'b0000001-0000-0000-0000-000000000011' },
];

interface UserToCreate {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: 'owner' | 'manager' | 'cashier';
  branchId: string | null;
}

async function createUser(user: UserToCreate) {
  // Create auth user with metadata (trigger will create profile)
  const { data, error } = await supabase.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
    user_metadata: {
      first_name: user.firstName,
      last_name: user.lastName,
      role: user.role,
    },
  });

  if (error) {
    if (error.message?.includes('already been registered')) {
      console.log(`  ⏭  ${user.email} (already exists)`);
      return null;
    }
    console.error(`  ❌ ${user.email}: ${error.message}`);
    return null;
  }

  // Update the profile with the correct branch_id
  if (data.user && user.branchId) {
    const { error: profileError } = await supabase
      .from('profiles')
      .update({ branch_id: user.branchId })
      .eq('id', data.user.id);

    if (profileError) {
      console.error(`  ⚠️  ${user.email} profile update failed: ${profileError.message}`);
    }
  }

  console.log(`  ✅ ${user.email} (${user.role})`);
  return data.user;
}

async function main() {
  console.log('🌱 FitWhite Auth User Seeder\n');
  console.log(`📡 Supabase URL: ${supabaseUrl}\n`);

  // 1. Create Owner (Super Admin)
  console.log('👑 Creating Owner account...');
  await createUser({
    email: 'admin',
    password: 'admin123',
    firstName: 'Super',
    lastName: 'Admin',
    role: 'owner',
    branchId: null,
  });

  // 2. Create Manager + Cashier per branch
  console.log('\n👥 Creating branch staff...');
  for (const branch of branches) {
    console.log(`\n📍 ${branch.name}:`);

    await createUser({
      email: `manager_${branch.code}`,
      password: `manager_${branch.code}123`,
      firstName: branch.name,
      lastName: 'Manager',
      role: 'manager',
      branchId: branch.id,
    });

    await createUser({
      email: `cashier_${branch.code}`,
      password: `cashier_${branch.code}123`,
      firstName: branch.name,
      lastName: 'Cashier',
      role: 'cashier',
      branchId: branch.id,
    });
  }

  console.log('\n✅ Auth seeding complete!');
  console.log('\n📋 Credentials Summary:');
  console.log('  Owner:   admin / admin123');
  console.log('  Format:  manager_{branch_code} / manager_{branch_code}123');
  console.log('  Format:  cashier_{branch_code} / cashier_{branch_code}123');
  console.log('  Example: manager_ims / manager_ims123');
  console.log('  Example: cashier_mkt / cashier_mkt123');
}

main().catch(console.error);
