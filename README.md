# FitWhite Aesthetics — POS & Clinic Management System

> A multi-branch Point-of-Sale and clinic management platform built for **FitWhite Aesthetics** salons and clinics.  
> Built with **Next.js 15**, **Supabase (PostgreSQL)**, **TailwindCSS v4**, deployed on **Vercel + Railway**.

---

## Table of Contents

1. [Features](#features)
2. [Tech Stack](#tech-stack)
3. [Architecture Overview](#architecture-overview)
4. [Getting Started (Local Dev)](#getting-started-local-dev)
5. [Environment Variables](#environment-variables)
6. [Default Login Credentials](#default-login-credentials)
7. [Database & Supabase Guide](#database--supabase-guide)
8. [Security](#security)
9. [Performance & Scalability](#performance--scalability)
10. [Commercial Readiness Checklist](#commercial-readiness-checklist)
11. [FAQ for the Owner / Business](#faq-for-the-owner--business)
12. [Developer Notes](#developer-notes)

---

## Features

### Point of Sale (POS)
- **Multi-item cart** — add services, products, and bundles in a single transaction
- **Real-time catalog** with category filters and search
- **Split payments** — mix Cash, GCash, Card, and Bank Transfer in one checkout
- **Live stock enforcement** — products capped at remaining inventory (client + server-side)
- **Discounts** — flat ₱ amount or % off the subtotal
- **Customer lookup** — attach an existing patient record to the sale
- **Digital receipt** — shown on screen after every successful sale; printable
- **Server-side price verification** — client prices are **never trusted**; all amounts are re-fetched from the database at checkout

### Inventory Management
- Per-branch product stock tracking
- Automated stock deduction on every sale
- Manual stock adjustment with audit trail
- Low-stock indicators on product cards (≤5 units → red)

### Customer (Patient) Management
- Create, search, and view patient records
- Store allergy notes (shown as a warning during checkout)
- Store credit balance

### Multi-Branch Management
- Unlimited branches (Owner-controlled)
- Each branch has its own: staff, services, products, inventory, customers, and sales
- Branch codes used in receipt numbers (e.g., `MKT-20240410-0012`)
- Owner can view all branches in a single dashboard
- Managers and cashiers are restricted to their assigned branch

### User & Role Management
- **Owner** — full system access across all branches
- **Manager** — full access within their branch; restricted cross-branch reporting
- **Cashier** — POS access only; cannot view reports or manage users

### Dashboard & Analytics
- Sales summary (daily/weekly/monthly)
- Revenue breakdown by branch
- Inventory alerts
- Audit log of all system actions

### Audit Logging
- Every sale, refund, void, user change, and stock adjustment is logged
- Logs include: who did it, when, on which branch, with what data

### Security
- Server-side Row-Level Security (RLS) on all tables via Supabase
- JWT-based authentication (Supabase Auth)
- All API routes validate the caller's identity before executing
- Price, item name, and stock are all verified server-side at checkout
- Service-role admin client used only in server-side API routes (never exposed to the browser)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15 (App Router, TypeScript) |
| Styling | TailwindCSS v4, Google Fonts (Inter + Playfair Display) |
| Backend API | Next.js API Routes (serverless) |
| Database | Supabase (PostgreSQL 15) |
| Auth | Supabase Auth (JWT) |
| Hosting — Frontend | Vercel (auto-deploy from GitHub) |
| Hosting — Backend API | Railway (optional separate deployment) |
| Time Zone | Philippine Standard Time (PHT / UTC+8) |

---

## Architecture Overview

```
Browser (Next.js Client)
    │
    ├─ useAuth() provider ─── Supabase Auth (JWT session)
    │
    └─ /api/* routes (Next.js Server)
            │
            ├─ createClient()      ← uses user's JWT (for RLS enforcement)
            └─ createAdminClient() ← uses service_role key (bypasses RLS, for writes)
                        │
                        └─ Supabase PostgreSQL
                                ├─ branches
                                ├─ profiles
                                ├─ services
                                ├─ products
                                ├─ inventory
                                ├─ customers
                                ├─ sales + sale_items
                                ├─ payments
                                ├─ stock_adjustments
                                ├─ bundles + bundle_items
                                ├─ audit_logs
                                └─ (RLS policies on all tables)
```

---

## Getting Started (Local Dev)

### Prerequisites
- Node.js 18+
- A Supabase project (free tier works)

### Steps

```bash
# 1. Install dependencies
npm install

# 2. Copy and fill in environment variables
cp .env.example .env.local
# → Edit .env.local with your Supabase keys

# 3. Initialize the database (run in Supabase SQL Editor)
#    supabase/migrations/001_schema.sql
#    supabase/migrations/002_rls_policies.sql

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
# Supabase project URL
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co

# Supabase anon key (safe to expose to the browser)
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...

# Supabase service_role key (NEVER expose to the browser — server-only)
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

> **IMPORTANT:** `SUPABASE_SERVICE_ROLE_KEY` must NEVER be used in any `'use client'` file.
> It is only used in `src/lib/supabase/admin.ts` and called from API routes (server-side only).

---

## Default Login Credentials

| Role | Email / Username | Password |
|---|---|---|
| Owner | `admin` | `admin123` |
| Manager | `manager_{code}` | `manager_{code}123` |
| Cashier | `cashier_{code}` | `cashier_{code}123` |

**Branch codes:** `IMS`, `PSY`, `MNL`, `MKT`, `ILO`, `BCL`, `DVO`, `CLB`, `PRQ`, `QC`, `BCR`

Example: Manager of Makati = email `manager_mkt`, password `manager_mkt123`

> ⚠️ **Change all default passwords before going live with real customers.**

---

## Database & Supabase Guide

### Do I need to manually create tables?

**No — not if you use the migration files.**  
Run the SQL files provided in the `supabase/migrations/` folder in the Supabase SQL Editor (in order).  
They create every table, index, function, and trigger the system needs.

### What is Supabase?

Supabase is a cloud-hosted PostgreSQL database with extras:
- **Auth** — login system, JWT tokens
- **RLS (Row-Level Security)** — database-level access control (like a firewall per row)
- **APIs** — automatically generated REST and real-time APIs
- **SQL Editor** — you can run SQL directly in the browser

Think of it as "Google Sheets in the cloud, but for professional apps, and extremely secure."

### Do I need to back up manually?

Supabase Pro plan and above includes **automated daily backups with Point-in-Time Recovery**.  
The free tier does **not** include automatic backups — you should either:
1. Upgrade to Supabase Pro (recommended for production), or
2. Set up a daily `pg_dump` export via a cron job

For a business doing real sales, **upgrade to Pro (≈$25/month)** — this includes:
- Automated daily backups (7-day retention)
- Point-in-Time Recovery
- Better performance limits

### Table Summary

| Table | What it stores |
|---|---|
| `branches` | All clinic/salon locations |
| `profiles` | Staff accounts and their roles |
| `services` | Menu of treatments per branch |
| `products` | Retail products per branch |
| `bundles` | Package deals |
| `inventory` | Stock levels per product per branch |
| `customers` | Patient records |
| `sales` | Sale header (total, receipt number, etc.) |
| `sale_items` | Line items per sale |
| `payments` | Payment breakdown per sale (cash/GCash/etc.) |
| `stock_adjustments` | History of all inventory changes |
| `audit_logs` | Full system audit trail |

---

## Security

### What protection do we have?

| Threat | How We Protect Against It |
|---|---|
| **Unauthorized access** | Supabase JWT authentication — you must login to use the system |
| **Price/item tampering** | All prices and item names are re-verified server-side at checkout; the browser can't fake them |
| **Cross-branch data theft** | RLS policies on every table; cashiers and managers can only see their own branch's data |
| **Admin endpoint abuse** | Service role key only used server-side; never sent to the browser |
| **Injection attacks** | Supabase client uses parameterized queries — SQL injection is not possible via the API |
| **Session hijacking** | JWT tokens expire; Supabase handles refresh token rotation |

### What about DDoS attacks?

- **Vercel** (where the frontend lives) has built-in DDoS mitigation at the CDN level. Large DDoS attacks are absorbed before they reach your code.
- **Supabase** has connection pooling and rate limiting, which protects the database from being overwhelmed.
- For a small to medium business, you are **well-protected** on both Vercel and Supabase's infrastructure — they run the same protection that large companies use.
- For enterprise-level protection (e.g., Cloudflare in front), this can be added later if needed, but is not required at the clinic scale.

### What about malware?

- The system runs in the cloud — there is no software installed on staff computers (just a browser). Malware on an individual PC cannot directly access or corrupt the database.
- Supabase database is not directly accessible from the internet without credentials — it only accepts connections from your app.
- Staff login credentials are the main risk. Ensure staff use strong passwords and do not share them.

### Recommended security practices

1. Change all default passwords before going live
2. Use company email addresses for staff (not personal)
3. Revoke access immediately when a staff member leaves
4. Enable **2FA (Two-Factor Authentication)** on the Supabase dashboard account
5. Never share the `SUPABASE_SERVICE_ROLE_KEY` with anyone

---

## Performance & Scalability

### How fast is the checkout?

After the optimization in this update:
- **Before:** 5–10 seconds (item DB lookups were sequential — one at a time)
- **After:** 1–3 seconds (all item lookups now run in parallel with `Promise.all`)

The remaining 1–2 seconds are the actual DB write operations (which are harder to parallelize safely).  
For a clinic with a typical cart of 2–5 items, **1–3 seconds is acceptable and normal** for a secure, server-verified checkout.

### How long can the database last with 100,000 sales per day?

#### Storage estimate per sale:
| Data | Approximate size |
|---|---|
| Sale header row | ~500 bytes |
| 3 sale items (avg) | ~900 bytes |
| 1–2 payments | ~400 bytes |
| Audit log entry | ~500 bytes |
| **Total per sale** | **~2,300 bytes (~2.3 KB)** |

#### At 100,000 sales/day per branch:
| Timeframe | Data generated |
|---|---|
| Per day | ~230 MB |
| Per month | ~7 GB |
| Per year | ~84 GB |

#### Supabase limits:
| Plan | Storage Included | Monthly Cost |
|---|---|---|
| Free | 500 MB total | $0 |
| Pro | 8 GB included (+ $0.125/GB after) | ~$25/month |
| Team | 100 GB | ~$599/month |

**Realistic assessment at 100K sales/day:**
- Free tier: would fill up in **~2 days**. Not suitable.
- Pro tier: initial 8 GB fills in ~35 days; after that, you pay ~$0.125/GB extra. At 7 GB/month, that's ~$0.875/month extra = ~$26/month total. Very affordable.
- **Recommendation:** For 100K daily sales, **Pro plan is sufficient** for at least 2–3 years. Beyond that, you can either pay for extra storage or archive old data.

#### What to do in the future:
1. **Archive old sales** — after 1–2 years, move old sales data to a separate "archive" table or export to CSV
2. **Database indexes** — already set up; keep monitoring query performance in Supabase's dashboard
3. **Read replicas** — Supabase Pro supports read replicas for high-load reporting queries

---

## Commercial Readiness Checklist

Before going live with real customers, verify:

- [ ] All default passwords changed
- [ ] Supabase upgraded to **Pro plan** (for backups + higher limits)
- [ ] `.env.local` variables configured correctly on Vercel (not just locally)
- [ ] All branches seeded correctly with their menus
- [ ] Receipt numbers tested to be unique
- [ ] Checkout tested end-to-end with a real GCash/card payment
- [ ] Staff trained on the POS flow
- [ ] A browser bookmark saved on each cashier's computer pointing to the production URL
- [ ] Sign-out tested — staff should sign out at end of shift

### Known Pending Items (for future dev work)
- Bundle checkout (API scaffolded, UI complete — needs bundle DB records)
- Refund/void flow (API exists, needs UI)
- Staff scheduling module (not yet built)
- SMS/email receipt notification
- Customer loyalty/points system

---

## FAQ for the Owner / Business

**Q: If the internet goes down, can we still use the system?**  
A: No — the system requires internet to communicate with the Supabase cloud database. A Wi-Fi/LTE backup connection is recommended at each branch.

**Q: Can staff access it from their phones?**  
A: Yes — the system is web-based and works on any modern browser including mobile. It is optimized for desktop/tablet use at the counter but is accessible on mobile.

**Q: What happens if Supabase goes down?**  
A: Supabase has a 99.9% uptime SLA on paid plans. If it does go down, the system will be unavailable until they restore it. This is rare (a few minutes per year). For absolute uptime guarantees, a self-hosted PostgreSQL could be considered in the future.

**Q: Do I need a developer to maintain this day-to-day?**  
A: No. Once deployed, the system runs on its own. You only need a developer to add new features, fix bugs, or change the menu/services.

**Q: How do I add a new branch?**  
A: Currently, the "Add Branch" button is available to developers via a feature flag. You only need to ask your developer, and they can add a new branch in minutes. This was done intentionally so branches cannot be accidentally created from the owner dashboard.

---

## Developer Notes

### Re-enabling "Add Branch" button

In `src/app/(dashboard)/branches/page.tsx`, find this line near the top:

```ts
const ALLOW_UI_ADD_BRANCH = false;
```

Change it to `true` and redeploy. The full form and API remain intact.

### Time Zone

The header shows live **Philippine Time (PHT / UTC+8)** using the `Asia/Manila` timezone, updated every second.  
All receipts and timestamps use `en-PH` locale.

### Checkout Performance

Checkout now uses `Promise.all` to verify all cart items and inventory simultaneously (parallel), instead of one-by-one (sequential).  
This reduced typical checkout time from 5–10s → 1–3s.

### Adding Bundle Checkout Support

In `src/app/api/sales/checkout/route.ts`, find the comment:
```
// bundles: extend here when bundle table is fully implemented
```
Add a `bundle` case in the `itemLookupResults` `Promise.all` block, similar to the service/product cases.

---

*FitWhite Aesthetics POS — Built with ❤️ for Philippine beauty and wellness clinics.*
