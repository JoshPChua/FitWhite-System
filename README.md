# FitWhite Aesthetics — POS & Clinic Management System

> A multi-branch Point-of-Sale and clinic management platform built for **FitWhite Aesthetics**.  
> Built with **Next.js 16**, **Supabase (PostgreSQL)**, **TailwindCSS v4**, deployed on **Vercel + Supabase Cloud**.

---

## Table of Contents

1. [Deployment Topology](#deployment-topology)
2. [Features](#features)
3. [Imus-Only Mode](#imus-only-mode)
4. [Feature Flags](#feature-flags)
5. [Tech Stack](#tech-stack)
6. [Architecture Overview](#architecture-overview)
7. [Getting Started (Local Dev)](#getting-started-local-dev)
8. [Environment Variables](#environment-variables)
9. [Database & Supabase Guide](#database--supabase-guide)
10. [Security](#security)
11. [Smoke-Test Checklist](#smoke-test-checklist)
12. [FAQ for the Owner / Business](#faq-for-the-owner--business)
13. [Developer Notes](#developer-notes)

---

## Deployment Topology

```
┌──────────────────────────────────────────────┐
│  Vercel (Frontend + API Routes)              │
│  ├─ Next.js App Router (SSR + Edge)          │
│  └─ /api/* route handlers (serverless)       │
│       ← all business logic lives here        │
└──────────────┬───────────────────────────────┘
               │ HTTPS
┌──────────────▼───────────────────────────────┐
│  Supabase Cloud (Database + Auth)            │
│  ├─ PostgreSQL 15 (tables, RLS, enums)       │
│  ├─ Supabase Auth (JWT, user management)     │
│  └─ Auto-generated REST API (used by client) │
└──────────────────────────────────────────────┘
```

- **Source of business logic:** Next.js route handlers in `src/app/api/*`
- **Data layer:** Supabase PostgreSQL with Row-Level Security (RLS)
- **Auth:** Supabase Auth (JWT). Service-role admin client used only server-side.

---

## Features

### Point of Sale (POS)
- Multi-item cart (services, products, bundles)
- Real-time catalog with category filters and search
- Split payments (Cash, GCash, Card, Bank Transfer)
- Live stock enforcement (client + server-side)
- Discounts (flat ₱ or %)
- Customer/patient lookup and allergy warnings
- Digital receipt after every sale
- **Server-side price verification** — client prices are never trusted
- **Installment/Package sales** — partial payment creates patient packages for multi-session services
- **Doctor commission tracking** — attending doctor selected at POS, commissions computed automatically

### Patient Packages
- Auto-created from installment sales
- Session tracking (used / remaining)
- Follow-up payments with ledger history
- Package expiration and cancellation

### Shifts & Cash Drawer
- Open/close shifts with opening cash declaration
- Cash movement tracking (petty cash, bank deposits)
- End-of-shift variance calculation

### Service BOM (Bill of Materials)
- Assign consumable products to services
- Automatic inventory deduction at checkout
- Race-condition detection with compensating rollback

### Inventory Management
- Per-branch stock tracking
- Automated deduction on sales + BOM
- Manual adjustments with audit trail
- Low-stock indicators (≤5 units → red)
- Canonical `inventory_logs` table for all stock movements

### Customer (Patient) Management
- Server-side CRUD via `/api/customers`
- Branch-restricted (managers cannot cross-branch)
- Allergy notes, store credit, treatment history

### Multi-Branch Management
- Per-branch: staff, services, products, inventory, customers, sales
- Branch codes in receipt numbers (e.g., `IMS-20240410-0012`)
- Owner sees all branches; managers/cashiers restricted to their branch

### User & Role Management
- **Owner** — full system access across all branches
- **Manager** — full access within their branch only
- **Cashier** — POS access only
- **Doctor flag** — mark staff as doctors for commission tracking
- Default commission rate per doctor

### Doctor Commissions
- Automatic commission calculation on service sales
- Per-sale-item granularity
- Configurable commission rate per doctor
- Commission dashboard with payment tracking

### Dashboard & Analytics
- Sales summary (daily/weekly/monthly)
- Revenue breakdown by branch
- Inventory alerts
- Full audit log of all system actions

### Void & Refund
- **Full void reversal** — restores product inventory, reverses BOM deductions, cancels packages, deletes commissions
- Partial refund with inventory return option

---

## Imus-Only Mode

The system supports a **single-branch lockdown** for deployments that serve only one location.

When `NEXT_PUBLIC_IMUS_ONLY=true`:

| Behavior | Effect |
|---|---|
| `branches` array | Filtered to `[imusBranch]` at the provider level |
| Branch selectors | Hidden across all pages (POS, Users, Customers) |
| API routes | `assertImusOnlyBranch()` rejects non-Imus `branch_id` values |
| Customer creation | Server-side route ignores client `branch_id`, resolves Imus automatically |
| User creation | `branch_id` auto-assigned to Imus for managers in Imus-only mode |

**Limitations:**
- This is an application-level enforcement, not an RLS-level restriction (yet)
- The Imus branch must exist in the `branches` table with code `IMS`
- Switching to multi-branch requires removing the env var and redeploying

---

## Feature Flags

All feature flags are environment variables set in `.env.local` (or Vercel project settings).

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_IMUS_ONLY` | `false` | Lock to Imus branch only (see above) |
| `NEXT_PUBLIC_ENABLE_PATIENT_PACKAGES` | `true` | Patient package / session tracking module |
| `NEXT_PUBLIC_ENABLE_SHIFTS` | `true` | Shift / cash drawer management |
| `NEXT_PUBLIC_ENABLE_DOCTOR_COMMISSIONS` | `true` | Doctor commission tracking and UI |
| `NEXT_PUBLIC_ENABLE_SERVICE_BOM` | `true` | Service BOM consumable deduction at checkout |

Flags default to `true` once Phase 3+ migrations are applied. Set to `'false'` to disable.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router, TypeScript) |
| Styling | TailwindCSS v4, Google Fonts (Inter + Playfair Display) |
| Backend API | Next.js API Routes (serverless) |
| Database | Supabase (PostgreSQL 15) |
| Auth | Supabase Auth (JWT) |
| Hosting | Vercel (auto-deploy from GitHub) |
| Time Zone | Philippine Standard Time (PHT / UTC+8) |

---

## Architecture Overview

```
Browser (Next.js Client)
    │
    ├─ useAuth() provider ─── Supabase Auth (JWT session)
    │       └─ branches[] filtered by IMUS_ONLY at source
    │
    └─ /api/* routes (Next.js Server)
            │
            ├─ createClient()      ← user's JWT (RLS enforcement)
            └─ createAdminClient() ← service_role key (bypasses RLS)
                        │
                        └─ Supabase PostgreSQL
                                ├─ branches, profiles
                                ├─ services, products, bundles
                                ├─ inventory, inventory_logs
                                ├─ customers, treatment_history
                                ├─ sales, sale_items, payments
                                ├─ patient_packages, package_payments, package_sessions
                                ├─ shifts, cash_movements
                                ├─ doctor_commissions
                                ├─ service_consumables
                                ├─ stock_adjustments
                                ├─ refunds, refund_items
                                └─ audit_logs
```

---

## Getting Started (Local Dev)

### Prerequisites
- Node.js 18+
- A Supabase project (free tier works for dev)

### Steps

```bash
# 1. Install dependencies
npm install

# 2. Copy and fill in environment variables
cp .env.example .env.local
# → Edit .env.local with your Supabase keys + feature flags

# 3. Initialize the database (run in Supabase SQL Editor, in order)
#    supabase/migrations/001_schema.sql
#    supabase/migrations/002_rls_policies.sql
#    supabase/migrations/003_phase3_schema.sql
#    supabase/migrations/004_phase3_rls.sql
#    supabase/migrations/005_add_void_reversal_source.sql

# 4. Create the seed auth users
npx ts-node scripts/seed-auth-users.ts

# 5. Seed the product catalog and branches
#    Run supabase/seed.sql in the Supabase SQL Editor

# 6. Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Environment Variables

Create a `.env.local` file (copy from `.env.example`):

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Feature Flags
NEXT_PUBLIC_IMUS_ONLY=true
NEXT_PUBLIC_ENABLE_PATIENT_PACKAGES=true
NEXT_PUBLIC_ENABLE_SHIFTS=true
NEXT_PUBLIC_ENABLE_DOCTOR_COMMISSIONS=true
NEXT_PUBLIC_ENABLE_SERVICE_BOM=true
```

> **IMPORTANT:** `SUPABASE_SERVICE_ROLE_KEY` must NEVER be used in any `'use client'` file.
> It is only used in `src/lib/supabase/admin.ts` and called from API routes (server-side only).

---

## Database & Supabase Guide

### Migrations

Run the SQL files in `supabase/migrations/` in the Supabase SQL Editor, **in order**.
They create every table, index, function, trigger, and RLS policy the system needs.

| Migration | Description |
|---|---|
| `001_schema.sql` | Core tables (branches, profiles, services, products, etc.) |
| `002_rls_policies.sql` | Row-Level Security policies |
| `003_phase3_schema.sql` | Phase 3 tables (packages, shifts, commissions, BOM) |
| `004_phase3_rls.sql` | Phase 3 RLS policies |
| `005_add_void_reversal_source.sql` | `void_reversal` enum value for inventory logs |

### Table Summary

| Table | Description |
|---|---|
| `branches` | Clinic/salon locations |
| `profiles` | Staff accounts, roles, doctor flag |
| `services` | Treatment menu per branch |
| `products` | Retail products per branch |
| `bundles` / `bundle_items` | Package deals |
| `inventory` / `inventory_logs` | Stock levels + full change history |
| `service_consumables` | BOM: which products a service consumes |
| `customers` | Patient records (allergies, notes, credit) |
| `sales` / `sale_items` / `payments` | Transaction data |
| `patient_packages` / `package_payments` / `package_sessions` | Multi-session service packages |
| `shifts` / `cash_movements` | Cash drawer management |
| `doctor_commissions` | Commission tracking per doctor per service |
| `stock_adjustments` | Legacy inventory change log |
| `refunds` / `refund_items` | Refund records |
| `audit_logs` | Full system audit trail |

---

## Security

| Threat | Protection |
|---|---|
| Unauthorized access | Supabase JWT authentication |
| Price/item tampering | Server-side price re-verification at checkout |
| Cross-branch data leak | Imus-only branch filtering + manager-branch restrictions |
| Admin endpoint abuse | Service role key server-side only |
| SQL injection | Supabase parameterized queries |
| Session hijacking | JWT expiry + refresh token rotation |
| BOM oversell race | Negative-stock detection + full sale rollback |

---

## Smoke-Test Checklist

Before deploying to production, verify each flow manually:

### Checkout
- [ ] Full payment (services + products) — verify receipt, inventory deducted
- [ ] Installment payment — verify patient package created with correct pro-rata downpayment
- [ ] Multi-package checkout — verify allocations sum to exact `totalPaid` (no ledger drift)
- [ ] Doctor commission — verify commission rows created with correct rate × gross amount
- [ ] BOM deduction — verify consumable products deducted from inventory on service sale

### Void
- [ ] Void a sale with products — verify inventory restored
- [ ] Void a sale with BOM services — verify consumable inventory restored
- [ ] Void a sale that created packages — verify packages cancelled, package_payments deleted
- [ ] Void a sale with doctor commissions — verify commission rows deleted

### Refund
- [ ] Partial refund — verify correct amount returned
- [ ] Refund with inventory return — verify stock restored

### User Management
- [ ] Create staff in Imus-only mode — branch auto-assigned, no branch selector visible
- [ ] Mark staff as doctor — set commission rate, verify shows in POS doctor dropdown
- [ ] Manager cannot create users in another branch

### Customer Management
- [ ] Create patient in Imus-only mode — branch auto-assigned server-side
- [ ] Manager cannot create customers in another branch
- [ ] Update patient details via server API

### Login
- [ ] Cashier login → redirects to `/pos` (not `/dashboard`)
- [ ] Owner login → redirects to `/dashboard`
- [ ] Already-authenticated user on `/login` → auto-redirected by role

---

## FAQ for the Owner / Business

**Q: If the internet goes down, can we still use the system?**  
A: No — the system requires internet. A Wi-Fi/LTE backup is recommended.

**Q: Can staff use their phones?**  
A: Yes — web-based, works on any modern browser. Optimized for desktop/tablet.

**Q: What happens if Supabase goes down?**  
A: Supabase has 99.9% uptime SLA on paid plans. Downtime is rare (minutes/year).

**Q: Do I need a developer day-to-day?**  
A: No. The system runs on its own. You only need a developer for new features or bug fixes.

---

## Developer Notes

### Business Logic Location

All server-side business logic is in `src/app/api/*` route handlers. The client (browser) never writes directly to sensitive tables — all mutations go through these routes.

Key routes:
- `POST /api/sales/checkout` — sale creation, inventory deduction, BOM, commissions, packages
- `POST /api/sales/[id]/void` — full void reversal with compensating cleanup
- `POST /api/users` — staff creation with Imus-only guard
- `POST /api/customers` — patient creation with branch enforcement

### Time Zone

All timestamps use **Philippine Standard Time (PHT / UTC+8)** via the `Asia/Manila` timezone.
Receipts and UI timestamps use `en-PH` locale.

### Checkout Performance

Checkout uses `Promise.all` for parallel item verification, reducing typical checkout from 5–10s → 1–3s.

---

*FitWhite Aesthetics POS — Built with ❤️ for Philippine beauty and wellness clinics.*
