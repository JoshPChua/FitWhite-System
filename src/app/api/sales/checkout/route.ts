import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertImusOnlyBranch, IMUS_ONLY, IMUS_BRANCH_CODE, ENABLE_SERVICE_BOM } from '@/lib/feature-flags';
import type { Profile } from '@/types/database';

/**
 * POST /api/sales/checkout
 *
 * Creates a complete sale transaction.
 *
 * Phase 4 enhancements:
 *   - Imus-only branch guard
 *   - shift_id linkage (optional — no enforcement, just links if a shift is open)
 *   - attending_doctor_id tracking
 *   - payment_type support (full / installment / package_use)
 *   - Service BOM auto-deduction from inventory
 *   - inventory_logs (canonical) + stock_adjustments (backward compat)
 *   - Auto-creates patient_packages for installment sales
 *   - Auto-creates doctor_commissions when attending doctor is specified
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    if (!currentUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: rawProfile } = await supabase
      .from('profiles').select('*').eq('id', currentUser.id).single();
    const caller = rawProfile as Profile | null;
    if (!caller || !caller.is_active) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const {
      branch_id,
      customer_id = null,
      items = [],
      payments = [],
      discount = 0,
      tax = 0,
      notes = null,
      attending_doctor_id = null,
      payment_type = 'full',
      // Phase 5: commission override + session count
      commission_mode = 'default',
      commission_value = null,
      total_sessions = null,
    } = body as {
      branch_id: string;
      customer_id?: string | null;
      items: Array<{
        item_type: 'service' | 'product' | 'bundle';
        id: string;
        quantity: number;
      }>;
      payments: Array<{
        method: 'cash' | 'gcash' | 'card' | 'bank_transfer';
        amount: number;
        change_amount?: number;
        reference_number?: string | null;
      }>;
      discount?: number;
      tax?: number;
      notes?: string | null;
      attending_doctor_id?: string | null;
      payment_type?: 'full' | 'installment' | 'package_use';
      commission_mode?: 'default' | 'percent' | 'fixed';
      commission_value?: number | null;
      total_sessions?: number | null;
    };

    // ─── Basic validation ────────────────────────────────────

    if (!branch_id) return NextResponse.json({ error: 'branch_id is required' }, { status: 400 });
    if (!items.length) return NextResponse.json({ error: 'Cart cannot be empty' }, { status: 400 });
    if (!payments.length) return NextResponse.json({ error: 'At least one payment required' }, { status: 400 });

    // Installment sales require a customer
    if (payment_type === 'installment' && !customer_id) {
      return NextResponse.json({ error: 'Customer is required for installment sales' }, { status: 400 });
    }

    // Manager / cashier branch isolation
    if ((caller.role === 'manager' || caller.role === 'cashier') && caller.branch_id !== branch_id) {
      return NextResponse.json({ error: 'Cannot process sales for a different branch' }, { status: 403 });
    }

    const adminClient = createAdminClient();

    // ─── Imus-only guard ─────────────────────────────────────
    if (IMUS_ONLY) {
      const { data: imusBranch } = await adminClient
        .from('branches').select('id').eq('code', IMUS_BRANCH_CODE).single();
      const imusBranchId = imusBranch ? (imusBranch as Record<string, unknown>).id as string : null;
      try {
        assertImusOnlyBranch(branch_id, imusBranchId);
      } catch {
        return NextResponse.json({ error: 'This installation is restricted to the Imus branch' }, { status: 403 });
      }
    }

    // ─── Find open shift (no enforcement — just link if available) ──
    let shiftId: string | null = null;
    const { data: openShift } = await adminClient
      .from('shifts')
      .select('id')
      .eq('branch_id', branch_id)
      .eq('status', 'open')
      .single();
    if (openShift) {
      shiftId = (openShift as Record<string, unknown>).id as string;
    }

    // ─── Server-side item verification (parallel) ────────────

    const verifiedItems: Array<{
      item_type: 'service' | 'product' | 'bundle';
      id: string;
      name: string;
      unit_price: number;
      quantity: number;
      product_id?: string | null;
      default_session_count?: number;
    }> = [];

    for (const item of items) {
      if (!['service', 'product', 'bundle'].includes(item.item_type)) {
        return NextResponse.json({ error: `Invalid item_type: ${item.item_type}` }, { status: 400 });
      }
      if (!item.id || !item.quantity || item.quantity < 1) {
        return NextResponse.json({ error: 'Each item needs a valid id and quantity ≥ 1' }, { status: 400 });
      }
    }

    const itemLookupResults = await Promise.all(
      items.map(async (item) => {
        if (item.item_type === 'service') {
          const { data: svc, error: svcErr } = await adminClient
            .from('services')
            .select('id, name, price, is_active, branch_id, default_session_count')
            .eq('id', item.id)
            .eq('branch_id', branch_id)
            .eq('is_active', true)
            .single();
          return { item, record: svc as Record<string, unknown> | null, err: svcErr };
        } else if (item.item_type === 'product') {
          const { data: prod, error: prodErr } = await adminClient
            .from('products')
            .select('id, name, price, is_active, branch_id')
            .eq('id', item.id)
            .eq('branch_id', branch_id)
            .eq('is_active', true)
            .single();
          return { item, record: prod as Record<string, unknown> | null, err: prodErr };
        } else {
          return { item, record: null, err: new Error('Bundle checkout not yet implemented') };
        }
      })
    );

    for (const { item, record, err } of itemLookupResults) {
      if (err || !record) {
        const typeName = item.item_type.charAt(0).toUpperCase() + item.item_type.slice(1);
        return NextResponse.json({
          error: `${typeName} not found, inactive, or not available in this branch (id: ${item.id})`
        }, { status: 400 });
      }
      if (item.item_type === 'service') {
        verifiedItems.push({
          item_type: 'service', id: item.id,
          name: record.name as string,
          unit_price: record.price as number,
          quantity: item.quantity,
          default_session_count: (record.default_session_count as number) || 1,
        });
      } else if (item.item_type === 'product') {
        verifiedItems.push({
          item_type: 'product', id: item.id,
          name: record.name as string,
          unit_price: record.price as number,
          quantity: item.quantity,
          product_id: item.id,
        });
      }
    }

    // ─── Inventory check (products only) ─────────────────────

    const productItems = verifiedItems.filter(i => i.item_type === 'product');
    const invResults = await Promise.all(
      productItems.map(item =>
        adminClient.from('inventory').select('id, quantity')
          .eq('product_id', item.id).eq('branch_id', branch_id).single()
          .then(({ data, error }) => ({ item, inv: data as Record<string, unknown> | null, error }))
      )
    );

    for (const { item, inv } of invResults) {
      if (!inv) {
        return NextResponse.json({
          error: `No inventory record found for "${item.name}" in this branch`
        }, { status: 400 });
      }
      if ((inv.quantity as number) < item.quantity) {
        return NextResponse.json({
          error: `Insufficient stock for "${item.name}". Available: ${inv.quantity}, Requested: ${item.quantity}`
        }, { status: 400 });
      }
    }

    // ─── BOM stock check (services — prevent selling if consumables unavailable) ──
    if (ENABLE_SERVICE_BOM) {
      const serviceItems = verifiedItems.filter(i => i.item_type === 'service');
      for (const svcItem of serviceItems) {
        const { data: bomEntries } = await adminClient
          .from('service_consumables')
          .select('product_id, quantity, products:product_id(name)')
          .eq('service_id', svcItem.id);

        if (bomEntries && bomEntries.length > 0) {
          for (const bom of bomEntries as Record<string, unknown>[]) {
            const bomProductId = bom.product_id as string;
            const bomQtyNeeded = (bom.quantity as number) * svcItem.quantity;
            const productName = (bom.products as Record<string, unknown>)?.name as string || bomProductId;

            const { data: bomInv } = await adminClient
              .from('inventory')
              .select('quantity')
              .eq('product_id', bomProductId)
              .eq('branch_id', branch_id)
              .single();

            const available = bomInv ? (bomInv as Record<string, unknown>).quantity as number : 0;
            if (available < bomQtyNeeded) {
              return NextResponse.json({
                error: `Insufficient consumable stock for "${svcItem.name}": needs ${bomQtyNeeded}× "${productName}" but only ${available} available`
              }, { status: 400 });
            }
          }
        }
      }
    }

    // ─── Totals (computed from server-verified prices) ────────

    const subtotal = verifiedItems.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
    const total = Math.max(0, subtotal - discount + tax);

    const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);

    // For installment sales, allow partial payment (downpayment)
    if (payment_type === 'full' && totalPaid < total - 0.01) {
      return NextResponse.json({
        error: `Insufficient payment. Total: ₱${total.toFixed(2)}, Paid: ₱${totalPaid.toFixed(2)}`
      }, { status: 400 });
    }

    // Branch code for receipt
    const { data: branchData } = await adminClient
      .from('branches').select('code').eq('id', branch_id).single();
    const branchCode = branchData ? (branchData as Record<string, unknown>).code as string : 'FW';

    // ─── Insert Sale (with receipt retry for concurrency safety) ─────

    let saleData: Record<string, unknown> | null = null;
    let receiptNumber = '';
    const MAX_RECEIPT_RETRIES = 3;

    for (let attempt = 0; attempt < MAX_RECEIPT_RETRIES; attempt++) {
      const { data: receiptData } = await adminClient
        .rpc('generate_receipt_number', { branch_code: branchCode });
      receiptNumber = receiptData as string;

      const { data: insertedSale, error: saleError } = await adminClient
        .from('sales')
        .insert({
          receipt_number: receiptNumber,
          branch_id,
          user_id: currentUser.id,
          customer_id: customer_id || null,
          subtotal,
          discount,
          tax,
          total,
          status: 'completed',
          notes: notes || null,
          shift_id: shiftId,
          attending_doctor_id: attending_doctor_id || null,
          payment_type,
          commission_mode: commission_mode !== 'default' ? commission_mode : null,
          commission_value: commission_value ?? null,
        } as Record<string, unknown>)
        .select('id')
        .single();

      if (!saleError) {
        saleData = insertedSale as Record<string, unknown>;
        break;
      }

      // If it's a duplicate key error, retry with a new receipt number
      if (saleError.message.includes('sales_receipt_number_key') && attempt < MAX_RECEIPT_RETRIES - 1) {
        console.warn(`Receipt number collision (${receiptNumber}), retrying... attempt ${attempt + 2}`);
        continue;
      }

      return NextResponse.json({ error: saleError.message }, { status: 500 });
    }

    if (!saleData) {
      return NextResponse.json({ error: 'Failed to generate unique receipt number after retries' }, { status: 500 });
    }

    const saleId = saleData.id as string;

    // ─── Insert Sale Items ───────────────────────────────────

    const saleItemsPayload = verifiedItems.map(item => ({
      sale_id: saleId,
      item_type: item.item_type,
      service_id: item.item_type === 'service' ? item.id : null,
      product_id: item.item_type === 'product' ? item.id : null,
      bundle_id:  item.item_type === 'bundle'  ? item.id : null,
      name: item.name,
      quantity: item.quantity,
      unit_price: item.unit_price,
      total_price: item.unit_price * item.quantity,
    }));

    const { data: insertedSaleItems, error: itemsError } = await adminClient
      .from('sale_items')
      .insert(saleItemsPayload as Record<string, unknown>[])
      .select('id, item_type, service_id, product_id');

    if (itemsError) {
      await adminClient.from('sales').delete().eq('id', saleId);
      return NextResponse.json({ error: itemsError.message }, { status: 500 });
    }

    // ─── Insert Payments ─────────────────────────────────────

    const paymentsPayload = payments.map(p => ({
      sale_id: saleId,
      method: p.method,
      amount: p.amount,
      change_amount: p.change_amount ?? 0,
      reference_number: p.reference_number ?? null,
    }));

    const { error: paymentsError } = await adminClient
      .from('payments')
      .insert(paymentsPayload as Record<string, unknown>[]);

    if (paymentsError) {
      await adminClient.from('sales').delete().eq('id', saleId);
      return NextResponse.json({ error: paymentsError.message }, { status: 500 });
    }

    // ─── Adjust Inventory — Products (dual-write) ────────────

    for (const item of verifiedItems.filter(i => i.item_type === 'product')) {
      const { data: inv } = await adminClient
        .from('inventory')
        .select('id, quantity')
        .eq('product_id', item.id)
        .eq('branch_id', branch_id)
        .single();

      if (inv) {
        const invRecord = inv as Record<string, unknown>;
        const oldQty = invRecord.quantity as number;
        const newQty = oldQty - item.quantity;

        await adminClient.from('inventory')
          .update({ quantity: newQty } as Record<string, unknown>)
          .eq('id', invRecord.id as string);

        // Legacy stock_adjustments (backward compat)
        await adminClient.from('stock_adjustments').insert({
          inventory_id: invRecord.id as string,
          branch_id,
          user_id: currentUser.id,
          adjustment_type: 'sale',
          quantity_change: -item.quantity,
          reason: `Sale ${receiptNumber}`,
          reference_id: saleId,
        } as Record<string, unknown>);

        // New canonical inventory_logs
        await adminClient.from('inventory_logs').insert({
          inventory_id: invRecord.id as string,
          product_id: item.id,
          branch_id,
          performed_by: currentUser.id,
          source: 'sale_product',
          quantity_delta: -item.quantity,
          quantity_before: oldQty,
          quantity_after: newQty,
          sale_id: saleId,
        } as Record<string, unknown>);
      }
    }

    // ─── Rollback helper (compensating cleanup if post-write step fails) ──
    const rollbackSale = async () => {
      try {
        // Reverse any product inventory changes already made for this sale
        const { data: invLogs } = await adminClient
          .from('inventory_logs')
          .select('inventory_id, quantity_delta, quantity_before')
          .eq('sale_id', saleId);

        for (const log of (invLogs || []) as Record<string, unknown>[]) {
          // Restore to quantity_before
          await adminClient.from('inventory')
            .update({ quantity: log.quantity_before } as Record<string, unknown>)
            .eq('id', log.inventory_id as string);
        }

        // Delete inventory logs, stock adjustments, payments, sale items, and sale
        await adminClient.from('inventory_logs').delete().eq('sale_id', saleId);
        await adminClient.from('stock_adjustments').delete().eq('reference_id', saleId);
        await adminClient.from('payments').delete().eq('sale_id', saleId);
        await adminClient.from('sale_items').delete().eq('sale_id', saleId);
        await adminClient.from('sales').delete().eq('id', saleId);
      } catch (rbErr) {
        console.error('Rollback error (sale may be partially written):', rbErr);
      }
    };

    // ─── Service BOM deduction ───────────────────────────────

    if (ENABLE_SERVICE_BOM) {
      for (const svcItem of verifiedItems.filter(i => i.item_type === 'service')) {
        const { data: bomEntries } = await adminClient
          .from('service_consumables')
          .select('product_id, quantity')
          .eq('service_id', svcItem.id);

        if (bomEntries && bomEntries.length > 0) {
          for (const bom of bomEntries as Record<string, unknown>[]) {
            const bomProductId = bom.product_id as string;
            const bomQty = (bom.quantity as number) * svcItem.quantity;

            const { data: bomInv } = await adminClient
              .from('inventory')
              .select('id, quantity')
              .eq('product_id', bomProductId)
              .eq('branch_id', branch_id)
              .single();

            if (bomInv) {
              const bomInvData = bomInv as Record<string, unknown>;
              const oldQty = bomInvData.quantity as number;
              const newQty = oldQty - bomQty;

              // ── Race detection: if concurrent request consumed stock between
              //    our pre-check and this deduction, fail cleanly + rollback ──
              if (newQty < 0) {
                await rollbackSale();
                return NextResponse.json({
                  error: `Concurrent stock conflict for consumable of "${svcItem.name}". Sale rolled back — please retry.`
                }, { status: 409 });
              }

              await adminClient.from('inventory')
                .update({ quantity: newQty } as Record<string, unknown>)
                .eq('id', bomInvData.id as string);

              await adminClient.from('inventory_logs').insert({
                inventory_id: bomInvData.id as string,
                product_id: bomProductId,
                branch_id,
                performed_by: currentUser.id,
                source: 'service_bom',
                quantity_delta: -bomQty,
                quantity_before: oldQty,
                quantity_after: newQty,
                sale_id: saleId,
                notes: `BOM for "${svcItem.name}" — Sale ${receiptNumber}`,
              } as Record<string, unknown>);
            }
          }
        }
      }
    }

    // ─── Doctor commission for direct service sales ───────────

    if (attending_doctor_id) {
      // Phase 5: look up doctor from standalone doctors table
      const { data: doctorRecord } = await adminClient
        .from('doctors')
        .select('id, full_name, default_commission_type, default_commission_value')
        .eq('id', attending_doctor_id)
        .single();

      if (doctorRecord) {
        const doc = doctorRecord as Record<string, unknown>;
        const saleItemsData = (insertedSaleItems || []) as Record<string, unknown>[];

        for (const svcItem of verifiedItems.filter(i => i.item_type === 'service')) {
          const matchingSaleItem = saleItemsData.find(si => si.service_id === svcItem.id);
          const grossAmount = svcItem.unit_price * svcItem.quantity;

           // Determine commission: POS override takes priority, then doctor default
          let commAmount = 0;
          let commRate: number | null = null;

          if (commission_mode === 'fixed' && commission_value != null) {
            // Fixed amount override — use exact value
            commAmount = commission_value;
          } else if (commission_mode === 'percent' && commission_value != null) {
            // Percentage override — normalize if > 1 (e.g. 30 → 0.30)
            commRate = commission_value > 1 ? commission_value / 100 : commission_value;
            commAmount = grossAmount * commRate;
          } else {
            // Default: use doctor's default commission
            const defType = doc.default_commission_type as string;
            const defVal = Number(doc.default_commission_value) || 0;
            if (defType === 'fixed') {
              commAmount = defVal;
            } else {
              commRate = defVal;
              commAmount = grossAmount * defVal;
            }
          }

          if (commAmount > 0) {
            const { error: commError } = await adminClient.from('doctor_commissions').insert({
              branch_id,
              doctor_id: attending_doctor_id,
              sale_item_id: matchingSaleItem ? matchingSaleItem.id as string : null,
              gross_amount: grossAmount,
              commission_rate: commRate,
              commission_amount: Math.round(commAmount * 100) / 100,
            } as Record<string, unknown>);
            if (commError) {
              console.error('Commission insert error:', commError.message);
            }
          }
        }
      }
    }

    // ─── Auto-create packages for installment sales ──────────
    //     Cent-safe pro-rata allocation with remainder to last package

    const createdPackages: Array<{ id: string; service_name: string; total_sessions: number }> = [];

    if (payment_type === 'installment' && customer_id) {
      const saleItemsData = (insertedSaleItems || []) as Record<string, unknown>[];

      // Phase 5: ALL installment service items create packages (removed >1 guard)
      const packageEligibleItems = verifiedItems.filter(i => i.item_type === 'service');

      const totalPackageCost = packageEligibleItems.reduce(
        (sum, i) => sum + i.unit_price * i.quantity, 0
      );

      let allocatedSoFar = 0;

      for (let idx = 0; idx < packageEligibleItems.length; idx++) {
        const svcItem = packageEligibleItems[idx];
        // Phase 5: use POS-provided total_sessions override, else service default
        const sessionCount = total_sessions || svcItem.default_session_count || 1;
        const matchingSaleItem = saleItemsData.find(si => si.service_id === svcItem.id);
        const itemTotal = svcItem.unit_price * svcItem.quantity;
        const isLast = idx === packageEligibleItems.length - 1;

        // ── Cent-safe pro-rata allocation ──
        let allocated: number;
        if (isLast) {
          // Last package absorbs exact remainder to prevent ledger drift
          allocated = Math.min(itemTotal, Math.max(0, totalPaid - allocatedSoFar));
        } else {
          const proRata = totalPackageCost > 0
            ? (itemTotal / totalPackageCost) * totalPaid
            : 0;
          allocated = Math.min(
            Math.round(proRata * 100) / 100,  // centavo-safe rounding
            itemTotal
          );
        }
        allocatedSoFar += allocated;

        const { data: pkg } = await adminClient
          .from('patient_packages')
          .insert({
            branch_id,
            customer_id,
            service_id: svcItem.id,
            sale_item_id: matchingSaleItem ? matchingSaleItem.id as string : null,
            total_price: itemTotal,
            downpayment: allocated,
            total_paid: allocated,
            total_sessions: sessionCount * svcItem.quantity,
            attending_doctor_id: attending_doctor_id || null,
            status: 'active',
            notes: `Auto-created from sale ${receiptNumber}`,
          } as Record<string, unknown>)
          .select('id')
          .single();

        if (pkg) {
          createdPackages.push({
            id: (pkg as Record<string, unknown>).id as string,
            service_name: svcItem.name,
            total_sessions: sessionCount * svcItem.quantity,
          });

          // Record downpayment in package_payments ledger
          if (allocated > 0) {
            await adminClient.from('package_payments').insert({
              package_id: (pkg as Record<string, unknown>).id as string,
              branch_id,
              received_by: currentUser.id,
              amount: allocated,
              method: payments[0]?.method || 'cash',
              notes: `Downpayment from sale ${receiptNumber}`,
            } as Record<string, unknown>);
          }
        }
      }
    }

    // ─── Audit Log ───────────────────────────────────────────

    await adminClient.from('audit_logs').insert({
      user_id: currentUser.id,
      branch_id,
      action_type: 'SALE_COMPLETED',
      entity_type: 'sale',
      entity_id: saleId,
      description: `Sale ${receiptNumber} — ₱${total.toFixed(2)} (${payment_type})`,
      metadata: {
        receipt_number: receiptNumber, total,
        items_count: verifiedItems.length,
        payment_methods: payments.map(p => p.method),
        payment_type,
        attending_doctor_id,
        shift_id: shiftId,
        packages_created: createdPackages.length,
      },
    } as Record<string, unknown>);

    return NextResponse.json({
      success: true,
      sale_id: saleId,
      receipt_number: receiptNumber,
      total,
      payment_type,
      packages_created: createdPackages,
    });

  } catch (error) {
    console.error('POST /api/sales/checkout error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
