import { and, asc, eq, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import * as s from "@/db/schema";
import { createJournalEntryTx, deleteEntryTx, nextDocumentNumber } from "@/lib/ledger";
import { lineVat, round2 } from "@/lib/invoice-posting";
import { payableAccountFor, purchasePostingLines } from "@/lib/purchases";
import { rateOn } from "@/lib/waybills";
import { PURCHASE_ACCOUNTS } from "@/data/purchases";
import { BREAKDOWN_APPROVAL_LIMIT, maintenanceAccountCode, type MaintenanceType } from "@/data/maintenance";

// الصيانة: طلب العطل ← أمر الصيانة ببنوده ← قيد على مركز تكلفة المركبة عند الاعتماد.
// القطع تُشترى مباشرة على الأمر بلا مخزون (قرار أحمد): دائنة للورشة الخارجية أو للصندوق.

const num = (v: string | null | undefined) => (v == null ? 0 : Number(v));

async function accountIdByCode(db: Db | Tx, code: string) {
  const [row] = await db.select({ id: s.accounts.id }).from(s.accounts).where(eq(s.accounts.code, code));
  if (!row) throw new Error(`الحساب ${code} غير موجود في الشجرة`);
  return row.id;
}

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

// ───────────── طلبات العطل ─────────────

export interface BreakdownInput {
  vehicleId: number;
  driverId?: number | null;
  reportDate: string;
  description: string;
  priority?: "low" | "normal" | "urgent";
  estimatedCost?: number | null;
  userId?: number;
}

export async function createBreakdownRequest(db: Db, input: BreakdownInput) {
  if (!input.description.trim()) throw new Error("اكتب وصف العطل");
  return db.transaction(async (tx) => {
    const number = await nextDocumentNumber(tx, "breakdown_request", "BR", Number(input.reportDate.slice(0, 4)));
    const [r] = await tx
      .insert(s.breakdownRequests)
      .values({
        number,
        vehicleId: input.vehicleId,
        driverId: input.driverId ?? null,
        reportDate: input.reportDate,
        description: input.description.trim(),
        priority: input.priority ?? "normal",
        estimatedCost: input.estimatedCost != null ? String(input.estimatedCost) : null,
        createdBy: input.userId,
      })
      .returning();
    return r;
  });
}

async function lockRequest(tx: Tx, id: number) {
  const [r] = await tx.select().from(s.breakdownRequests).where(eq(s.breakdownRequests.id, id)).for("update");
  if (!r) throw new Error("طلب العطل غير موجود");
  return r;
}

/** مراجعة المشرف: يعتمده مباشرة إن كانت التكلفة ضمن الحد، وإلا يحوّله لاعتماد المدير. */
export async function reviewBreakdownRequest(db: Db, id: number, opts: { estimatedCost?: number | null; userId?: number; limit?: number } = {}) {
  return db.transaction(async (tx) => {
    const r = await lockRequest(tx, id);
    if (r.status !== "pending_supervisor") throw new Error("الطلب ليس بانتظار المشرف");
    const cost = opts.estimatedCost ?? (r.estimatedCost != null ? num(r.estimatedCost) : null);
    if (cost == null) throw new Error("حدد التكلفة التقديرية قبل المراجعة");
    const status = cost > (opts.limit ?? BREAKDOWN_APPROVAL_LIMIT) ? "pending_approval" : "approved";
    const [row] = await tx
      .update(s.breakdownRequests)
      .set({ status, estimatedCost: String(cost), reviewedBy: opts.userId ?? null, approvedBy: status === "approved" ? (opts.userId ?? null) : null })
      .where(eq(s.breakdownRequests.id, id))
      .returning();
    return row;
  });
}

export async function approveBreakdownRequest(db: Db, id: number, userId?: number) {
  return db.transaction(async (tx) => {
    const r = await lockRequest(tx, id);
    if (r.status !== "pending_approval") throw new Error("الطلب ليس بانتظار الاعتماد");
    await tx.update(s.breakdownRequests).set({ status: "approved", approvedBy: userId ?? null }).where(eq(s.breakdownRequests.id, id));
  });
}

export async function rejectBreakdownRequest(db: Db, id: number, reason: string) {
  if (!reason.trim()) throw new Error("اكتب سبب الرفض");
  return db.transaction(async (tx) => {
    const r = await lockRequest(tx, id);
    if (!["pending_supervisor", "pending_approval", "approved"].includes(r.status)) throw new Error("لا يمكن رفض طلب تحت التنفيذ أو مكتمل");
    await tx.update(s.breakdownRequests).set({ status: "rejected", rejectReason: reason.trim() }).where(eq(s.breakdownRequests.id, id));
  });
}

// ───────────── أوامر الصيانة ─────────────

export interface OrderInput {
  vehicleId: number;
  orderDate: string;
  type: MaintenanceType;
  provider: "internal" | "external";
  supplierId?: number | null;
  supplierInvoiceNo?: string | null;
  cashAccountId?: number | null;
  odometer?: number | null;
  breakdownRequestId?: number | null;
  planId?: number | null;
  currencyCode?: string;
  notes?: string | null;
  userId?: number;
}

export async function createMaintenanceOrder(db: Db, input: OrderInput) {
  return db.transaction(async (tx) => {
    const [vehicle] = await tx.select().from(s.vehicles).where(eq(s.vehicles.id, input.vehicleId));
    if (!vehicle) throw new Error("المركبة غير موجودة");
    if (input.provider === "external" && !input.supplierId) throw new Error("اختر الورشة الخارجية أو المورد");
    if (input.provider === "external") await payableAccountFor(tx, input.supplierId!);
    const invoiceNo = input.supplierInvoiceNo?.trim() || null;
    if (invoiceNo && input.supplierId) {
      const [dup] = await tx
        .select({ number: s.purchaseInvoices.number })
        .from(s.purchaseInvoices)
        .where(and(eq(s.purchaseInvoices.supplierId, input.supplierId), eq(s.purchaseInvoices.supplierInvoiceNo, invoiceNo)));
      if (dup) throw new Error(`فاتورة المورد ${invoiceNo} مسجلة مسبقاً في فواتير الموردين (${dup.number})`);
    }
    if (input.breakdownRequestId) {
      const r = await lockRequest(tx, input.breakdownRequestId);
      if (r.status !== "approved") throw new Error(`طلب العطل ${r.number} غير معتمد`);
      if (r.vehicleId !== input.vehicleId) throw new Error("طلب العطل لمركبة أخرى");
      await tx.update(s.breakdownRequests).set({ status: "in_progress" }).where(eq(s.breakdownRequests.id, r.id));
    }
    if (input.planId) {
      const [plan] = await tx.select().from(s.maintenancePlans).where(eq(s.maintenancePlans.id, input.planId));
      if (!plan || plan.vehicleId !== input.vehicleId) throw new Error("الخطة الدورية لمركبة أخرى");
    }
    const currency = input.currencyCode ?? "SAR";
    const number = await nextDocumentNumber(tx, "maintenance_order", "MO", Number(input.orderDate.slice(0, 4)));
    const [o] = await tx
      .insert(s.maintenanceOrders)
      .values({
        number,
        vehicleId: input.vehicleId,
        orderDate: input.orderDate,
        type: input.type,
        provider: input.provider,
        supplierId: input.provider === "external" ? input.supplierId! : null,
        supplierInvoiceNo: input.provider === "external" ? invoiceNo : null,
        cashAccountId: input.provider === "internal" ? (input.cashAccountId ?? null) : null,
        odometer: input.odometer ?? null,
        breakdownRequestId: input.breakdownRequestId ?? null,
        planId: input.planId ?? null,
        currencyCode: currency,
        exchangeRate: String(await rateOn(tx, currency, input.orderDate)),
        notes: input.notes || null,
        createdBy: input.userId,
      })
      .returning();
    return o;
  });
}

async function lockOrder(tx: Tx, id: number) {
  const [o] = await tx.select().from(s.maintenanceOrders).where(eq(s.maintenanceOrders.id, id)).for("update");
  if (!o) throw new Error("أمر الصيانة غير موجود");
  return o;
}

async function recomputeTotals(tx: Tx, orderId: number) {
  const [t] = await tx
    .select({ subtotal: sql<string>`coalesce(sum(${s.maintenanceLines.amount}), 0)`, vat: sql<string>`coalesce(sum(${s.maintenanceLines.vatAmount}), 0)` })
    .from(s.maintenanceLines)
    .where(eq(s.maintenanceLines.orderId, orderId));
  const subtotal = round2(num(t.subtotal));
  const vat = round2(num(t.vat));
  await tx
    .update(s.maintenanceOrders)
    .set({ subtotal: String(subtotal), vatTotal: String(vat), total: String(round2(subtotal + vat)) })
    .where(eq(s.maintenanceOrders.id, orderId));
}

export interface MaintenanceLineInput {
  kind: "part" | "labor";
  description: string;
  quantity?: number;
  unitPrice: number;
  vatRate?: number;
}

export async function addMaintenanceLines(db: Db, orderId: number, lines: MaintenanceLineInput[]) {
  return db.transaction(async (tx) => {
    const o = await lockOrder(tx, orderId);
    if (o.status !== "draft") throw new Error("الأمر معتمد؛ أرجعه لمسودة لتعديل البنود");
    const [{ max }] = await tx
      .select({ max: sql<number>`coalesce(max(${s.maintenanceLines.lineNo}), 0)::int` })
      .from(s.maintenanceLines)
      .where(eq(s.maintenanceLines.orderId, orderId));
    const rows = lines.map((l, i) => {
      if (!l.description.trim()) throw new Error("وصف البند إلزامي");
      const qty = l.quantity ?? 1;
      if (!(qty > 0)) throw new Error("الكمية يجب أن تكون أكبر من صفر");
      const vatRate = l.vatRate ?? 15;
      if (vatRate !== 0 && vatRate !== 15) throw new Error("الضريبة 15% أو بدون");
      const amount = round2(qty * l.unitPrice);
      return {
        orderId,
        lineNo: max + i + 1,
        kind: l.kind,
        description: l.description.trim(),
        quantity: String(qty),
        unitPrice: String(l.unitPrice),
        amount: String(amount),
        vatRate: String(vatRate),
        vatAmount: String(lineVat(amount, vatRate)),
      };
    });
    if (rows.length) await tx.insert(s.maintenanceLines).values(rows);
    await recomputeTotals(tx, orderId);
  });
}

export async function removeMaintenanceLine(db: Db, orderId: number, lineId: number) {
  return db.transaction(async (tx) => {
    const o = await lockOrder(tx, orderId);
    if (o.status !== "draft") throw new Error("الأمر معتمد؛ أرجعه لمسودة لتعديل البنود");
    await tx.delete(s.maintenanceLines).where(and(eq(s.maintenanceLines.id, lineId), eq(s.maintenanceLines.orderId, orderId)));
    await recomputeTotals(tx, orderId);
  });
}

/** الاعتماد: قيد الصيانة على مركز تكلفة المركبة، والمركبة تصبح «في الصيانة». */
export async function approveMaintenanceOrder(db: Db, orderId: number, opts: { cashAccountId?: number | null; userId?: number } = {}) {
  return db.transaction(async (tx) => {
    const o = await lockOrder(tx, orderId);
    if (o.status !== "draft") throw new Error(`الأمر ${o.number} معتمد مسبقاً`);
    const lines = await tx.select().from(s.maintenanceLines).where(eq(s.maintenanceLines.orderId, orderId)).orderBy(asc(s.maintenanceLines.lineNo));
    if (!lines.length) throw new Error("أضف بنداً واحداً على الأقل (قطعة غيار أو شغل يد)");
    const [vehicle] = await tx.select().from(s.vehicles).where(eq(s.vehicles.id, o.vehicleId));
    let creditAccountId: number;
    const cashAccountId = opts.cashAccountId ?? o.cashAccountId;
    if (o.provider === "external") {
      creditAccountId = await payableAccountFor(tx, o.supplierId!);
    } else {
      const [cash] = cashAccountId ? await tx.select().from(s.accounts).where(eq(s.accounts.id, cashAccountId)) : [];
      if (!cash || !cash.isPostable || !/^110[12]/.test(cash.code)) throw new Error("اختر الصندوق أو البنك الذي اشتُريت منه القطع");
      creditAccountId = cash.id;
    }
    const costAccountId = await accountIdByCode(tx, maintenanceAccountCode(o.type));
    const [tax] = await tx.select().from(s.taxCodes).where(eq(s.taxCodes.code, "VAT15-IN"));
    const entry = await createJournalEntryTx(tx, {
      entryDate: o.orderDate,
      description: `أمر صيانة ${o.number} – ${vehicle.plate}`,
      source: { type: "maintenance_order", id: o.id },
      post: true,
      userId: opts.userId,
      lines: purchasePostingLines(
        {
          number: o.number,
          supplierInvoiceNo: o.supplierInvoiceNo ?? o.number,
          supplierId: o.supplierId,
          currencyCode: o.currencyCode,
          exchangeRate: num(o.exchangeRate),
          payableAccountId: creditAccountId,
        },
        lines.map((l) => ({ accountId: costAccountId, costCenterId: vehicle.costCenterId, description: `${l.description} – ${vehicle.plate}`, amount: num(l.amount), vatAmount: num(l.vatAmount) })),
        await accountIdByCode(tx, PURCHASE_ACCOUNTS.inputVat),
        tax?.id ?? null,
      ),
    });
    await tx
      .update(s.maintenanceOrders)
      .set({ status: "approved", journalEntryId: entry.id, approvedBy: opts.userId ?? null, cashAccountId: o.provider === "internal" ? cashAccountId : null })
      .where(eq(s.maintenanceOrders.id, orderId));
    if (vehicle.status === "active") await tx.update(s.vehicles).set({ status: "maintenance", updatedAt: new Date() }).where(eq(s.vehicles.id, vehicle.id));
    return entry;
  });
}

/** الإكمال: المركبة تعود «تعمل»، ويُحدَّث العداد وآخر تنفيذ للخطة الدورية وطلب العطل. */
export async function completeMaintenanceOrder(db: Db, orderId: number, opts: { completedDate: string; odometer?: number | null }) {
  return db.transaction(async (tx) => {
    const o = await lockOrder(tx, orderId);
    if (o.status !== "approved") throw new Error("الأمر غير معتمد أو مكتمل مسبقاً");
    if (opts.completedDate < o.orderDate) throw new Error("تاريخ الإكمال قبل تاريخ الأمر");
    const odometer = opts.odometer ?? o.odometer;
    await tx.update(s.maintenanceOrders).set({ status: "completed", completedDate: opts.completedDate, odometer }).where(eq(s.maintenanceOrders.id, orderId));
    // تعود المركبة للعمل إن لم يبقَ لها أمر آخر تحت التنفيذ
    const [{ open }] = await tx
      .select({ open: sql<number>`count(*)::int` })
      .from(s.maintenanceOrders)
      .where(and(eq(s.maintenanceOrders.vehicleId, o.vehicleId), eq(s.maintenanceOrders.status, "approved")));
    const [vehicle] = await tx.select().from(s.vehicles).where(eq(s.vehicles.id, o.vehicleId));
    await tx
      .update(s.vehicles)
      .set({
        status: open === 0 && vehicle.status === "maintenance" ? "active" : vehicle.status,
        odometer: odometer && odometer > vehicle.odometer ? odometer : vehicle.odometer,
        updatedAt: new Date(),
      })
      .where(eq(s.vehicles.id, o.vehicleId));
    if (o.planId) await tx.update(s.maintenancePlans).set({ lastDoneDate: opts.completedDate }).where(eq(s.maintenancePlans.id, o.planId));
    if (o.breakdownRequestId) await tx.update(s.breakdownRequests).set({ status: "completed" }).where(eq(s.breakdownRequests.id, o.breakdownRequestId));
  });
}

/** الإرجاع لمسودة: يلغي القيد؛ المركبة تعود «تعمل» إن لم يبقَ لها أمر آخر. */
export async function revertMaintenanceOrder(db: Db, orderId: number) {
  return db.transaction(async (tx) => {
    const o = await lockOrder(tx, orderId);
    if (o.status !== "approved") throw new Error("الإرجاع متاح للأمر المعتمد غير المكتمل");
    await tx.update(s.maintenanceOrders).set({ status: "draft", journalEntryId: null, approvedBy: null }).where(eq(s.maintenanceOrders.id, orderId));
    if (o.journalEntryId) await deleteEntryTx(tx, o.journalEntryId);
    const [{ open }] = await tx
      .select({ open: sql<number>`count(*)::int` })
      .from(s.maintenanceOrders)
      .where(and(eq(s.maintenanceOrders.vehicleId, o.vehicleId), eq(s.maintenanceOrders.status, "approved")));
    if (open === 0) await tx.update(s.vehicles).set({ status: "active", updatedAt: new Date() }).where(and(eq(s.vehicles.id, o.vehicleId), eq(s.vehicles.status, "maintenance")));
  });
}

export async function deleteMaintenanceOrder(db: Db, orderId: number, opts: { reason: string; userId?: number }) {
  if (!opts.reason.trim()) throw new Error("اكتب سبب الحذف");
  return db.transaction(async (tx) => {
    const o = await lockOrder(tx, orderId);
    if (o.status !== "draft") throw new Error("الحذف متاح للمسودة فقط");
    const lines = await tx.select().from(s.maintenanceLines).where(eq(s.maintenanceLines.orderId, orderId));
    await tx.insert(s.deletionLog).values({ entity: "maintenance_order", entityId: String(orderId), snapshot: { order: o, lines }, reason: opts.reason.trim(), userId: opts.userId });
    await tx.delete(s.maintenanceOrders).where(eq(s.maintenanceOrders.id, orderId));
    // طلب العطل يعود معتمداً بانتظار أمر جديد
    if (o.breakdownRequestId) await tx.update(s.breakdownRequests).set({ status: "approved" }).where(eq(s.breakdownRequests.id, o.breakdownRequestId));
  });
}

// ───────────── الخطة الدورية ─────────────

export async function savePlan(db: Db, input: { vehicleId: number; type: MaintenanceType; title: string; intervalDays: number; lastDoneDate?: string | null }) {
  const title = input.title.trim();
  if (!title) throw new Error("اسم الصيانة إلزامي");
  if (!Number.isInteger(input.intervalDays) || input.intervalDays < 1) throw new Error("المدة بالأيام إلزامية");
  const [row] = await db
    .insert(s.maintenancePlans)
    .values({ vehicleId: input.vehicleId, type: input.type, title, intervalDays: input.intervalDays, lastDoneDate: input.lastDoneDate ?? null })
    .onConflictDoUpdate({
      target: [s.maintenancePlans.vehicleId, s.maintenancePlans.title],
      set: { type: input.type, intervalDays: input.intervalDays, lastDoneDate: input.lastDoneDate ?? sql`${s.maintenancePlans.lastDoneDate}`, isActive: true },
    })
    .returning();
  return row;
}

/** الاستحقاق التالي = آخر تنفيذ + المدة؛ بلا تنفيذ سابق تُعد مستحقة الآن. */
export function nextDue(plan: { lastDoneDate: string | null; intervalDays: number }, today: string) {
  return plan.lastDoneDate ? addDays(plan.lastDoneDate, plan.intervalDays) : today;
}

/** الخطط النشطة مع استحقاقها، الأقرب أولاً. */
export async function planSchedule(db: Db | Tx, today: string) {
  const rows = await db
    .select({ p: s.maintenancePlans, plate: s.vehicles.plate })
    .from(s.maintenancePlans)
    .innerJoin(s.vehicles, eq(s.vehicles.id, s.maintenancePlans.vehicleId))
    .where(and(eq(s.maintenancePlans.isActive, true), sql`${s.vehicles.status} <> 'sold'`));
  return rows
    .map(({ p, plate }) => {
      const due = nextDue(p, today);
      const days = Math.round((Date.parse(due) - Date.parse(today)) / 86_400_000);
      return { ...p, plate, due, days };
    })
    .sort((a, b) => a.days - b.days);
}

/** تكلفة صيانة كل مركبة من القيود المرحّلة (5107 و5108) في فترة. */
export async function maintenanceCostByVehicle(db: Db | Tx, from: string, to: string) {
  const rows = (await db.execute(sql`
    select v.id, v.plate, sum(l.debit_base - l.credit_base) as cost
    from journal_lines l
    join journal_entries e on e.id = l.entry_id and e.status = 'posted'
    join accounts a on a.id = l.account_id
    join vehicles v on v.cost_center_id = l.cost_center_id
    where (a.code like '5107%' or a.code like '5108%') and e.entry_date between ${from} and ${to}
    group by v.id, v.plate order by cost desc`)) as unknown as { id: number; plate: string; cost: string }[];
  return rows.map((r) => ({ id: Number(r.id), plate: r.plate, cost: Number(r.cost) }));
}
