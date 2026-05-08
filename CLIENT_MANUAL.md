# FitWhite Aesthetics — POS System Manual

> **Version:** 1.0  
> **Last Updated:** May 2026  
> **Prepared for:** FitWhite Aesthetics Imus Branch

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [User Roles & Permissions](#2-user-roles--permissions)
3. [Logging In](#3-logging-in)
4. [Dashboard](#4-dashboard)
5. [Point of Sale (POS)](#5-point-of-sale-pos)
6. [Sales History](#6-sales-history)
7. [Products (Product Catalog)](#7-products-product-catalog)
8. [Services](#8-services)
9. [Inventory (Stock Levels)](#9-inventory-stock-levels)
10. [Products vs. Inventory Explained](#10-products-vs-inventory-explained)
11. [Patient Packages](#11-patient-packages)
12. [Customers (Patient Records)](#12-customers-patient-records)
13. [Doctors](#13-doctors)
14. [Shift Management](#14-shift-management)
15. [User Management](#15-user-management)
16. [Commissions](#16-commissions)
17. [Reports](#17-reports)
18. [Audit Logs](#18-audit-logs)
19. [How User Creation Works](#19-how-user-creation-works)
20. [Go-Live Checklist](#20-go-live-checklist)

---

## 1. System Overview

FitWhite Aesthetics POS is a **cloud-based Point of Sale and clinic management system** built specifically for aesthetics clinics. It runs on any device with a modern web browser — no installation needed.

### What the System Does

| Capability | Description |
|---|---|
| **Point of Sale** | Process walk-in and patient sales for services and products |
| **Multi-Payment** | Accept Cash, GCash, Card, and Bank Transfer — even split payments |
| **Session Packages** | Sell multi-session service packages with installment payment tracking |
| **Inventory Management** | Track product stock levels with low-stock alerts and bulk upload |
| **Patient Records** | Store customer info, contact details, and allergy notes |
| **Doctor Commissions** | Automatically compute doctor commissions per sale (% or fixed) |
| **Shift Management** | Open/close cash drawer shifts with variance tracking |
| **Cash Movements** | Record petty cash out, bank deposits, and cash in during shifts |
| **Refunds & Voids** | Issue full/partial refunds or void sales with inventory restoration |
| **Audit Trail** | Every action is logged — who did what, when |
| **Reports** | View sales, revenue, and operational reports |
| **Role-Based Access** | Owner, Manager, and Cashier roles with different permissions |
| **CSV Export** | Export package and report data to spreadsheets |

### Technology

- **Hosting:** Vercel (cloud, auto-scaling, 99.9% uptime)
- **Database:** Supabase (PostgreSQL, real-time, automatic backups)
- **Security:** Row-level security, encrypted authentication, service-role isolation
- **Access:** Any browser — Chrome, Safari, Edge, Firefox (desktop or tablet)

---

## 2. User Roles & Permissions

| Feature | Owner | Manager | Cashier |
|---|:---:|:---:|:---:|
| Access POS | ✅ | ✅ | ✅ |
| Process sales | ✅ | ✅ | ✅ |
| View sales history | ✅ | ✅ (own branch) | ✅ (own branch) |
| Issue refunds | ✅ | ✅ | ❌ |
| Void sales | ✅ | ✅ | ❌ |
| Manage products | ✅ | ✅ (own branch) | ❌ |
| Manage services | ✅ | ✅ (own branch) | ❌ |
| Adjust inventory | ✅ | ✅ (own branch) | ❌ |
| Manage customers | ✅ | ✅ (own branch) | ❌ |
| Manage doctors | ✅ | ✅ (own branch) | ❌ |
| Open/close shifts | ✅ | ✅ | ❌ |
| Record cash movements | ✅ | ✅ | ❌ |
| Create staff accounts | ✅ | ✅ (cashiers only) | ❌ |
| View all branches | ✅ | ❌ | ❌ |
| View audit logs | ✅ | ✅ | ❌ |
| View reports | ✅ | ✅ | ❌ |
| Delete users | ✅ | ❌ | ❌ |

---

## 3. Logging In

1. Open your browser and go to your FitWhite system URL
2. Enter your **email** and **password** (provided by the owner or manager)
3. Click **Sign In**
4. You will be taken to the Dashboard

> **Note:** Each staff member has their own login. Do not share passwords. The owner can create new accounts anytime (see [Section 15](#15-user-management)).

---

## 4. Dashboard

The Dashboard is your home screen after logging in. It shows:

- **Today's sales summary** — total revenue, number of transactions
- **Quick stats** — active packages, low-stock alerts
- **Navigation sidebar** — access all modules from the left menu

---

## 5. Point of Sale (POS)

The POS is where you process all sales. It has a **two-panel layout**:

### Left Panel — Service/Product Catalog
- Toggle between **Services** and **Products** tabs
- Filter by **category** using the pills at the top
- **Search** by name
- Tap any item to add it to the cart
- Products show **stock remaining** (e.g., "5 pcs left")
- Out-of-stock products are greyed out and cannot be added

### Right Panel — Cart & Checkout
- Shows all items in the cart with quantity controls (+/−)
- **Customer search** — type at least 2 characters to find a patient
- **Attending Doctor** — select the doctor performing the service (for commission tracking)
- **Commission Override** — optionally override the doctor's default commission rate
- **Payment Type** — choose Full Payment or Installment (requires a customer)
- **Discount** — apply a flat ₱ amount or percentage discount
- **Session Override** — for services, you can change the default session count per line item

### Processing a Sale

1. Add services/products to the cart
2. (Optional) Search and select a customer
3. (Optional) Select attending doctor
4. Choose payment type (Full or Installment)
5. Click **Checkout**
6. In the payment modal:
   - Default payment is Cash with full amount
   - You can add multiple payment methods (e.g., ₱500 cash + ₱500 GCash)
   - Enter reference numbers for GCash/Card/Bank transfers
7. Click **Confirm Payment**
8. Receipt is displayed — you can show this to the patient

### Installment Sales
When you choose **Installment** payment type:
- A patient **must** be selected
- You can pay any amount as a downpayment
- A **Session Package** is automatically created for each service
- The remaining balance is tracked under **Patient Packages**

---

## 6. Sales History

View all past transactions with filters:

- **Search** by receipt number, customer name, or cashier name
- **Filter by status:** Completed, Refunded, Partial Refund, Voided
- **Filter by date range**
- **Pagination** for large datasets

### Viewing a Sale
Click **View** on any row to see:
- Full item breakdown
- Payment details
- Branch, cashier, and customer info

### Voiding a Sale
*(Manager/Owner only)*
1. Open the sale detail
2. Click **Void Sale**
3. Enter a reason (required)
4. Confirm — the sale is marked as voided and product inventory is restored

### Issuing a Refund
*(Manager/Owner only)*
1. Open the sale detail
2. Click **Issue Refund**
3. Enter the refund amount (full or partial)
4. Enter a reason (required)
5. Check "Return items to inventory" if products should be restocked
6. Confirm

---

## 7. Products (Product Catalog)

**Products** is your catalog — the master list of all sellable physical items.

### What You Manage Here
- **Product name** (e.g., "Glutathione 600mg Ampule")
- **SKU** — optional stock-keeping unit code
- **Price** — the selling price
- **Category** — Glutathione, Vitamin C, Collagen, Whitening, etc.
- **Unit** — pcs, vials, ampules, bottles, etc.
- **Active/Inactive status** — inactive products don't appear in POS

### Stats at the Top
- Total Products count
- Active / Inactive counts
- **Low Stock** alert count (products below their threshold)

### Actions
- **Add Product** — creates a new product AND automatically creates its inventory record
- **Edit** — change name, price, category, etc.
- **Activate/Deactivate** — toggle visibility in POS
- **Delete** — permanently removes (or soft-deletes if the product has sale history)

> **Important:** Adding a product here automatically creates a stock record with quantity 0. You then go to **Inventory** to set the actual stock quantity.

---

## 8. Services

Manage all clinic services (treatments, procedures).

### What You Manage Here
- **Service name** (e.g., "Basic Gluta Drip")
- **Price** — the charge for each session
- **Category** — Drip Therapy, Facial, Body Whitening, etc.
- **Session count** — how many sessions this service provides by default
- **Active/Inactive status**

### Key Behaviors
- Services appear in the POS under the **Services** tab
- When sold as part of an installment, a patient package is created with the session count
- Session count can be overridden per sale in the POS

---

## 9. Inventory (Stock Levels)

**Inventory** is where you manage actual **stock quantities** for every product.

### What You See
- Product name, SKU, category
- **Current quantity** — how many units you have right now
- **Low stock threshold** — the minimum before it's flagged
- **Status** — In Stock (green), Low Stock (amber), Out of Stock (red)
- Last updated timestamp

### Adjusting Stock
1. Click the **Adjust** button on any product
2. Choose **+ Add Stock** or **− Remove Stock**
3. Enter the quantity to add/remove
4. Enter a **reason** (required — e.g., "Monthly restock", "Damaged goods", "Physical count")
5. Optionally update the low stock threshold
6. Click to confirm

The system shows you a preview of the new quantity before confirming.

### Bulk Upload
For large restocks, use **Bulk Upload**:
1. Click the Bulk Upload button
2. Select the branch
3. Either paste CSV data or upload a .csv file
4. Format: `Product Name, Quantity, Reason` (one per line)
5. Preview to verify product matches
6. Confirm to apply all adjustments

---

## 10. Products vs. Inventory Explained

> This is one of the most common questions, so here's the clear distinction:

| | **Products Page** | **Inventory Page** |
|---|---|---|
| **Purpose** | Define WHAT you sell | Manage HOW MUCH you have |
| **What you do** | Add/edit product names, prices, categories | Add/remove stock quantities |
| **When to use** | Adding a new product to your catalog | Restocking, physical count, damage write-offs |
| **Price changes** | ✅ Change price here | ❌ Cannot change price here |
| **Stock changes** | ❌ Cannot change stock here | ✅ Change stock here |
| **Example** | Create "Vitamin C 1000mg" at ₱500 | Add 50 vials of "Vitamin C 1000mg" |

### The Simple Rule

> **YES — always edit quantities under Inventory (Stock Levels), not under Products.**

- **Products** = what and how much it costs
- **Inventory** = how many you currently have in stock

When you create a new product, the system automatically creates an inventory record with **0 quantity**. You then go to Inventory to **Adjust** the stock to the actual amount.

---

## 11. Patient Packages

Manage multi-session service packages and installment payments.

### How Packages Are Created
Packages are created automatically when:
- A **service** is sold with **Installment** payment type in the POS
- The system creates a package tracking: total sessions, total price, downpayment

### Package Detail View
Click any package to see:
- **Sessions progress** — e.g., 3/10 used
- **Payment progress** — total paid vs. remaining balance
- **Session history** — who performed each session, date, notes
- **Payment history** — each installment payment recorded

### Recording a Session
1. Open the package detail
2. Click **Record Session**
3. Select the attending doctor (optional)
4. Enter session notes (optional)
5. Choose how many sessions to deduct (default: 1)
6. Confirm

The package automatically marks as **Completed** when all sessions are used.

### Recording a Payment
1. Open the package detail
2. Click **Record Payment**
3. Enter the amount
4. Select payment method (Cash, GCash, Card, Bank Transfer)
5. Enter reference number (for non-cash)
6. Confirm

### CSV Export
Click **Export CSV** to download all packages as a spreadsheet.

---

## 12. Customers (Patient Records)

### What You Store
- First name, last name
- Phone number, email
- **Allergies** — displayed as a warning ⚠ in POS when this customer is selected
- Store credit balance
- Branch assignment

### Creating Customers
You can add customers from the Customers page or quickly during checkout.

---

## 13. Doctors

Manage the clinic's doctors for commission tracking.

### What You Configure
- **Doctor name**
- **Specialty** (optional)
- **Commission type:** Percentage (%) or Fixed Amount (₱)
- **Commission value** — e.g., 30 for 30%, or 500 for ₱500 fixed
- **Active/Inactive status**

Doctors appear in the POS dropdown when processing a sale.

---

## 14. Shift Management

Track cash drawer activity per shift.

### Opening a Shift
1. Click **Open Shift**
2. Count the physical cash in the drawer
3. Enter the **Opening Cash** amount
4. Confirm

### During a Shift
You can record **Cash Movements**:
- **Petty Cash Out** — money taken from the drawer (e.g., office supplies)
- **Bank Deposit** — money removed for deposit
- **Cash In** — money added to the drawer

These movements are displayed under the active shift in real-time.

### Closing a Shift
1. Click **Close Shift**
2. Count the actual cash in the drawer
3. Enter the **Actual Cash Count**
4. Add optional notes
5. Confirm

The system calculates:
- **Expected Cash** = Opening Cash + Cash Sales − Cash Out + Cash In
- **Variance** = Actual Cash − Expected Cash
- Green variance = exact or over, Red = shortage

### Recent Shifts Table
Shows all closed shifts with opening, expected, actual, and variance amounts.

---

## 15. User Management

*(Owner and Manager access)*

### Creating a New Staff Account
1. Go to **User Management**
2. Click **Add Staff**
3. Fill in:
   - First name, Last name
   - Email address (this is their login)
   - Password (minimum 6 characters)
   - Role: Cashier, Manager, or Owner
   - Branch (auto-assigned in single-branch mode)
4. Click **Create**

### What Happens Behind the Scenes
- The system creates a **Supabase Auth** account (email/password)
- A **profile** is created linking the user to their branch and role
- The new user can **immediately log in** with the email/password
- They will have the same access as any other user with that role
- No manual Supabase dashboard action needed

### Editing Staff
- Change name, role, or branch assignment
- Cannot change email after creation

### Deactivating Staff
- Click the deactivate icon to disable a user's access
- They cannot log in while inactive
- You can reactivate them later

### Deleting Staff
*(Owner only)* — Permanently removes the user account.

---

## 16. Commissions

View doctor commission records generated from sales. Commissions are automatically calculated when a doctor is selected during checkout.

---

## 17. Reports

View business analytics including:
- Revenue by period
- Sales breakdown
- Top-selling services and products

---

## 18. Audit Logs

Every important action in the system is recorded:
- Who created, updated, or deleted data
- Sale, void, and refund events
- Inventory adjustments
- User account changes
- Shift open/close events

This provides a complete paper trail for accountability.

---

## 19. How User Creation Works

**Question:** *"If the owner creates a new manager account, will it automatically work?"*

**Answer: YES.** Here's exactly what happens:

```
Owner clicks "Add Staff" → Fills in form → Clicks Create
    ↓
System creates Supabase Auth account (email + password)
    ↓
System creates Profile (name, role, branch)
    ↓
New user can IMMEDIATELY log in
    ↓
They get the same access as any existing user with that role
```

**No Supabase dashboard interaction needed.** Everything is handled through the system. The new account is:
- ✅ Automatically created in Supabase Auth
- ✅ Linked to the correct branch
- ✅ Given the correct role permissions
- ✅ Ready to use immediately
- ✅ Email is auto-confirmed (no verification email needed)

---

## 20. Go-Live Checklist

### Step-by-Step: Reset All Test Data Before Launch

When you're ready to go live, follow these steps to start with a clean slate:

#### Step 1: Go to Supabase Dashboard
1. Log in to [supabase.com](https://supabase.com)
2. Open your FitWhite project
3. Go to **SQL Editor**

#### Step 2: Clear Test Sales Data
Run these SQL commands **in this exact order**:

```sql
-- Step 1: Delete all commission records (depends on sales)
DELETE FROM commissions;

-- Step 2: Delete all refund items (depends on refunds)
DELETE FROM refund_items;

-- Step 3: Delete all refunds (depends on sales)
DELETE FROM refunds;

-- Step 4: Delete all payments (depends on sales)
DELETE FROM payments;

-- Step 5: Delete all sale items (depends on sales)
DELETE FROM sale_items;

-- Step 6: Delete all sales
DELETE FROM sales;

-- Step 7: Reset the receipt counter to start from 1
UPDATE branches SET receipt_counter = 0;

-- Step 8: Delete all package sessions (depends on packages)
DELETE FROM package_sessions;

-- Step 9: Delete all package payments (depends on packages)
DELETE FROM package_payments;

-- Step 10: Delete all patient packages
DELETE FROM patient_packages;

-- Step 11: Delete all cash movements (depends on shifts)
DELETE FROM cash_movements;

-- Step 12: Close and delete all shifts
DELETE FROM shifts;

-- Step 13: Delete all inventory logs
DELETE FROM inventory_logs;

-- Step 14: Delete all stock adjustments
DELETE FROM stock_adjustments;

-- Step 15: Clear audit logs (optional — you may want to keep these)
DELETE FROM audit_logs;

-- Step 16: Reset all inventory to zero
UPDATE inventory SET quantity = 0, updated_at = NOW();
```

#### Step 3: Do a Physical Stock Count
1. Go to **Inventory** in the system
2. For each product, click **Adjust**
3. Choose **+ Add Stock**
4. Enter the actual physical count
5. Reason: "Opening inventory count"
6. Or use **Bulk Upload** with a CSV of all products and their counts

#### Step 4: Verify
1. Go to **Sales History** — should be empty
2. Go to **Patient Packages** — should be empty
3. Go to **Shifts** — should show no open/closed shifts
4. Go to **Inventory** — quantities should match your physical count
5. Process a test sale to verify everything works
6. Void the test sale immediately after

#### Step 5: Open Your First Real Shift
1. Go to **Shift Management**
2. Click **Open Shift**
3. Enter the actual opening cash in the drawer
4. You're live! 🎉

> **Important:** Keep the test sale + void as your first audit log entry — this proves the system was verified before going live.

---

## Support

For technical issues, contact your system administrator. All system data is automatically backed up by Supabase with point-in-time recovery.
