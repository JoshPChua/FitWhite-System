# FitWhite Aesthetics POS

Multi-branch POS and Clinic Management System.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in Supabase keys
3. Run `supabase/migrations/001_schema.sql` then `002_rls_policies.sql` in Supabase SQL Editor
4. Seed auth users: `npx ts-node scripts/seed-auth-users.ts`
5. Run `supabase/seed.sql` in SQL Editor
6. `npm run dev`

## Credentials

- Owner: admin / admin123
- Manager: manager_{code} / manager_{code}123
- Cashier: cashier_{code} / cashier_{code}123

Branch codes: IMS, PSY, MNL, MKT, ILO, BCL, DVO, CLB, PRQ, QC, BCR
