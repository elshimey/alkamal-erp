import { and, asc, desc, eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db, Tx } from "@/db";
import * as s from "@/db/schema";
import { averageCost, issueForMaintenanceTx, onHand, removeMovesTx } from "@/lib/inventory";
import { createJournalEntryTx, deleteEntryTx, nextDocumentNumber } from "@/lib/ledger";
import { lineVat, round2 } from "@/lib/invoice-posting";
import { payableAccountFor, purchasePostingLines } from "@/lib/purchases";
import { rateOn } from "@/lib/waybills";
import { PURCHASE_ACCOUNTS } from "@/data/purchases";
import { BREAKDOWN_APPROVAL_LIMIT, maintenanceAccountCode, type MaintenanceType } from "@/data/maintenance";
import { notifyDriver } from "@/lib/driver-notify";

// الصيانة: طلب العطل ← أمر الصيانة ببنوده ← قيد على مركز تكلفة المركبة عند الاعتماد.
// القطع تُشترى على الأمر (دائنة للورشة الخارجية أو للصندوق)، أو تُصرف من المستودع بمتوسط التكلفة.

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
  maintenanceTypeId?: number | null;
  userId?: number;
}

export async function createBreakdownRequest(db: Db | Tx, input: BreakdownInput) {
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
        maintenanceTypeId: input.maintenanceTypeId ?? null,
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
export async function reviewBreakdownRequest(db: Db | Tx, id: number, opts: { estimatedCost?: number | null; userId?: number; limit?: number } = {}) {
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
    if (status === "approved") await notifyDriver(tx, r.driverId, { kind: "maint_approved", body: r.number, href: "/driver/breakdown" });
    return row;
  });
}

export async function approveBreakdownRequest(db: Db | Tx, id: number, userId?: number) {
  return db.transaction(async (tx) => {
    const r = await lockRequest(tx, id);
    if (r.status !== "pending_approval") throw new Error("الطلب ليس بانتظار الاعتماد");
    await tx.update(s.breakdownRequests).set({ status: "approved", approvedBy: userId ?? null }).where(eq(s.breakdownRequests.id, id));
    await notifyDriver(tx, r.driverId, { kind: "maint_approved", body: r.number, href: "/driver/breakdown" });
  });
}

export async function rejectBreakdownRequest(db: Db | Tx, id: number, reason: string) {
  if (!reason.trim()) throw new Error("اكتب سبب الرفض");
  return db.transaction(async (tx) => {
    const r = await lockRequest(tx, id);
    if (!["pending_supervisor", "pending_approval", "approved"].includes(r.status)) throw new Error("لا يمكن رفض طلب تحت التنفيذ أو مكتمل");
    await tx.update(s.breakdownRequests).set({ status: "rejected", rejectReason: reason.trim() }).where(eq(s.breakdownRequests.id, id));
    await notifyDriver(tx, r.driverId, { kind: "maint_rejected", body: `${r.number}: ${reason.trim()}`, href: "/driver/breakdown" });
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

export async function createMaintenanceOrder(db: Db | Tx, input: OrderInput) {
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
  // قطعة من المستودع: تُصرف بمتوسط التكلفة عند الاعتماد ولا تدخل في ذمة الورشة
  productId?: number | null;
  warehouseId?: number | null;
  description: string;
  quantity?: number;
  /** فارغ مسموح لقطعة تُصرف من المخزون فقط (تُحمّل بمتوسط تكلفتها) */
  unitPrice: number | null;
  vatRate?: number;
}

export async function addMaintenanceLines(db: Db | Tx, orderId: number, lines: MaintenanceLineInput[]) {
  return db.transaction(async (tx) => {
    const o = await lockOrder(tx, orderId);
    if (o.status !== "draft") throw new Error("الأمر معتمد؛ أرجعه لمسودة لتعديل البنود");
    const [{ max }] = await tx
      .select({ max: sql<number>`coalesce(max(${s.maintenanceLines.lineNo}), 0)::int` })
      .from(s.maintenanceLines)
      .where(eq(s.maintenanceLines.orderId, orderId));
    const rows = [];
    for (const [i, l] of lines.entries()) {
      const [product] = l.productId ? await tx.select().from(s.products).where(eq(s.products.id, l.productId)) : [];
      if (l.productId && !product) throw new Error("الصنف غير موجود");
      const fromStock = product?.kind === "stock";
      if (fromStock && !l.warehouseId) throw new Error(`حدد المستودع الذي تُصرف منه ${product.nameAr}`);
      const description = l.description.trim() || product?.nameAr || "";
      if (!description) throw new Error("وصف البند إلزامي");
      const qty = l.quantity ?? 1;
      if (!(qty > 0)) throw new Error("الكمية يجب أن تكون أكبر من صفر");
      if (fromStock) {
        const have = await onHand(tx, product.id, l.warehouseId!);
        if (have < qty) throw new Error(`رصيد ${product.nameAr} في المستودع ${have} ${product.unit} فقط`);
        const unit = await averageCost(tx, product.id);
        rows.push({ orderId, lineNo: max + i + 1, kind: "part" as const, productId: product.id, warehouseId: l.warehouseId!, description, quantity: String(qty), unitPrice: String(unit), amount: String(round2(qty * unit)), vatRate: "0", vatAmount: "0" });
        continue;
      }
      if (l.unitPrice == null) throw new Error(`سعر «${description}» إلزامي؛ الصرف بمتوسط التكلفة لأصناف المخزون فقط`);
      const vatRate = l.vatRate ?? 15;
      if (vatRate !== 0 && vatRate !== 15) throw new Error("الضريبة 15% أو بدون");
      const amount = round2(qty * l.unitPrice);
      rows.push({
        orderId,
        lineNo: max + i + 1,
        kind: l.kind,
        productId: product?.id ?? null,
        warehouseId: null,
        description,
        quantity: String(qty),
        unitPrice: String(l.unitPrice),
        amount: String(amount),
        vatRate: String(vatRate),
        vatAmount: String(lineVat(amount, vatRate)),
      });
    }
    if (rows.length) await tx.insert(s.maintenanceLines).values(rows);
    await recomputeTotals(tx, orderId);
  });
}

export async function removeMaintenanceLine(db: Db | Tx, orderId: number, lineId: number) {
  return db.transaction(async (tx) => {
    const o = await lockOrder(tx, orderId);
    if (o.status !== "draft") throw new Error("الأمر معتمد؛ أرجعه لمسودة لتعديل البنود");
    await tx.delete(s.maintenanceLines).where(and(eq(s.maintenanceLines.id, lineId), eq(s.maintenanceLines.orderId, orderId)));
    await recomputeTotals(tx, orderId);
  });
}

/** الاعتماد: قيد الصيانة على مركز تكلفة المركبة، والمركبة تصبح «في الصيانة». */
export async function approveMaintenanceOrder(db: Db | Tx, orderId: number, opts: { cashAccountId?: number | null; userId?: number } = {}) {
  return db.transaction(async (tx) => {
    const o = await lockOrder(tx, orderId);
    if (o.status !== "draft") throw new Error(`الأمر ${o.number} معتمد مسبقاً`);
    const lines = await tx.select().from(s.maintenanceLines).where(eq(s.maintenanceLines.orderId, orderId)).orderBy(asc(s.maintenanceLines.lineNo));
    if (!lines.length) throw new Error("أضف بنداً واحداً على الأقل (قطعة غيار أو شغل يد)");
    const [vehicle] = await tx.select().from(s.vehicles).where(eq(s.vehicles.id, o.vehicleId));
    const stockLines = lines.filter((l) => l.warehouseId);
    const bought = lines.filter((l) => !l.warehouseId);
    let creditAccountId = 0;
    const cashAccountId = opts.cashAccountId ?? o.cashAccountId;
    if (!bought.length) {
      // كل البنود من المستودع: لا ذمة ولا صندوق
    } else if (o.provider === "external") {
      creditAccountId = await payableAccountFor(tx, o.supplierId!);
    } else {
      const [cash] = cashAccountId ? await tx.select().from(s.accounts).where(eq(s.accounts.id, cashAccountId)) : [];
      if (!cash || !cash.isPostable || !/^110[12]/.test(cash.code)) throw new Error("اختر الصندوق أو البنك الذي اشتُريت منه القطع");
      creditAccountId = cash.id;
    }
    const costAccountId = await accountIdByCode(tx, maintenanceAccountCode(o.type));
    const [tax] = await tx.select().from(s.taxCodes).where(eq(s.taxCodes.code, "VAT15-IN"));
    const issued = await issueForMaintenanceTx(tx, o, stockLines, { accountId: costAccountId, costCenterId: vehicle.costCenterId, plate: vehicle.plate });
    if (stockLines.length) await recomputeTotals(tx, orderId);
    const purchased = bought.length
      ? purchasePostingLines(
        {
          number: o.number,
          supplierInvoiceNo: o.supplierInvoiceNo ?? o.number,
          supplierId: o.supplierId,
          currencyCode: o.currencyCode,
          exchangeRate: num(o.exchangeRate),
          payableAccountId: creditAccountId,
        },
          bought.map((l) => ({ accountId: costAccountId, costCenterId: vehicle.costCenterId, description: `${l.description} – ${vehicle.plate}`, amount: num(l.amount), vatAmount: num(l.vatAmount) })),
          await accountIdByCode(tx, PURCHASE_ACCOUNTS.inputVat),
          tax?.id ?? null,
        )
      : [];
    if (!issued.length && !purchased.length) throw new Error("قيمة الأمر صفر");
    const entry = await createJournalEntryTx(tx, {
      entryDate: o.orderDate,
      description: `أمر صيانة ${o.number} – ${vehicle.plate}`,
      source: { type: "maintenance_order", id: o.id },
      post: true,
      userId: opts.userId,
      lines: [...purchased, ...issued],
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
export async function completeMaintenanceOrder(db: Db | Tx, orderId: number, opts: { completedDate: string; odometer?: number | null }) {
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
export async function revertMaintenanceOrder(db: Db | Tx, orderId: number) {
  return db.transaction(async (tx) => {
    const o = await lockOrder(tx, orderId);
    if (o.status !== "approved") throw new Error("الإرجاع متاح للأمر المعتمد غير المكتمل");
    await removeMovesTx(tx, "maintenance_order", orderId);
    await tx.update(s.maintenanceOrders).set({ status: "draft", journalEntryId: null, approvedBy: null }).where(eq(s.maintenanceOrders.id, orderId));
    if (o.journalEntryId) await deleteEntryTx(tx, o.journalEntryId);
    const [{ open }] = await tx
      .select({ open: sql<number>`count(*)::int` })
      .from(s.maintenanceOrders)
      .where(and(eq(s.maintenanceOrders.vehicleId, o.vehicleId), eq(s.maintenanceOrders.status, "approved")));
    if (open === 0) await tx.update(s.vehicles).set({ status: "active", updatedAt: new Date() }).where(and(eq(s.vehicles.id, o.vehicleId), eq(s.vehicles.status, "maintenance")));
  });
}

export async function deleteMaintenanceOrder(db: Db | Tx, orderId: number, opts: { reason: string; userId?: number }) {
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

export async function savePlan(db: Db | Tx, input: { vehicleId: number; type: MaintenanceType; title: string; intervalDays: number; lastDoneDate?: string | null }) {
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

/** تعديل خطة بعينها (المركبة والاسم قابلان للتغيير)، مع إيقافها أو إعادة تفعيلها. */
export async function updatePlan(db: Db | Tx, id: number, input: { vehicleId: number; type: MaintenanceType; title: string; intervalDays: number; lastDoneDate?: string | null; isActive: boolean }) {
  const title = input.title.trim();
  if (!title) throw new Error("اسم الصيانة إلزامي");
  if (!Number.isInteger(input.intervalDays) || input.intervalDays < 1) throw new Error("المدة بالأيام إلزامية");
  const [clash] = await db
    .select({ id: s.maintenancePlans.id })
    .from(s.maintenancePlans)
    .where(and(eq(s.maintenancePlans.vehicleId, input.vehicleId), eq(s.maintenancePlans.title, title), sql`${s.maintenancePlans.id} <> ${id}`));
  if (clash) throw new Error("للمركبة خطة أخرى بنفس الاسم");
  const [row] = await db
    .update(s.maintenancePlans)
    .set({ vehicleId: input.vehicleId, type: input.type, title, intervalDays: input.intervalDays, lastDoneDate: input.lastDoneDate ?? null, isActive: input.isActive })
    .where(eq(s.maintenancePlans.id, id))
    .returning();
  if (!row) throw new Error("الخطة غير موجودة");
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

// ───────────── القوائم والمعاينة (بآلية الفواتير) ─────────────

const like = (q: string) => `%${q.replace(/[%_\\]/g, "\\$&")}%`;

export const ORDER_SORTS = {
  date_desc: "الأحدث أولاً",
  date_asc: "الأقدم أولاً",
  amount_desc: "الأعلى مبلغاً",
  amount_asc: "الأقل مبلغاً",
  vehicle: "حسب المركبة",
} as const;

export interface OrderFilter {
  q?: string;
  status?: "draft" | "approved" | "completed";
  from?: string;
  to?: string;
  vehicleId?: number;
  type?: MaintenanceType;
  provider?: "internal" | "external";
  sort?: keyof typeof ORDER_SORTS;
}

export async function listOrders(db: Db | Tx, f: OrderFilter = {}, limit = 300) {
  const where: SQL[] = [];
  const o = s.maintenanceOrders;
  if (f.status) where.push(eq(o.status, f.status));
  if (f.from) where.push(gte(o.orderDate, f.from));
  if (f.to) where.push(lte(o.orderDate, f.to));
  if (f.vehicleId) where.push(eq(o.vehicleId, f.vehicleId));
  if (f.type) where.push(eq(o.type, f.type));
  if (f.provider) where.push(eq(o.provider, f.provider));
  if (f.q) {
    const q = like(f.q);
    const any = or(ilike(o.number, q), ilike(s.vehicles.plate, q), ilike(s.parties.nameAr, q), ilike(o.supplierInvoiceNo, q), ilike(o.notes, q), ilike(s.breakdownRequests.number, q));
    if (any) where.push(any);
  }
  const order =
    f.sort === "date_asc"
      ? [asc(o.orderDate), asc(o.id)]
      : f.sort === "amount_desc"
        ? [desc(o.total), desc(o.id)]
        : f.sort === "amount_asc"
          ? [asc(o.total), asc(o.id)]
          : f.sort === "vehicle"
            ? [asc(s.vehicles.plate), desc(o.orderDate)]
            : [desc(o.orderDate), desc(o.id)];
  return db
    .select({
      o,
      plate: s.vehicles.plate,
      supplier: s.parties.nameAr,
      request: s.breakdownRequests.number,
      plan: s.maintenancePlans.title,
      lines: sql<number>`(select count(*)::int from maintenance_lines ml where ml.order_id = maintenance_orders.id)`,
    })
    .from(o)
    .innerJoin(s.vehicles, eq(s.vehicles.id, o.vehicleId))
    .leftJoin(s.parties, eq(s.parties.id, o.supplierId))
    .leftJoin(s.breakdownRequests, eq(s.breakdownRequests.id, o.breakdownRequestId))
    .leftJoin(s.maintenancePlans, eq(s.maintenancePlans.id, o.planId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(...order)
    .limit(limit);
}

/** أمر الصيانة كاملاً للمعاينة والطباعة. */
export async function orderDoc(db: Db | Tx, id: number) {
  const cash = alias(s.accounts, "cash");
  const [row] = await db
    .select({
      o: s.maintenanceOrders,
      plate: s.vehicles.plate,
      supplier: s.parties.nameAr,
      cash: cash.nameAr,
      request: s.breakdownRequests,
      plan: s.maintenancePlans.title,
      entry: s.journalEntries.number,
    })
    .from(s.maintenanceOrders)
    .innerJoin(s.vehicles, eq(s.vehicles.id, s.maintenanceOrders.vehicleId))
    .leftJoin(s.parties, eq(s.parties.id, s.maintenanceOrders.supplierId))
    .leftJoin(cash, eq(cash.id, s.maintenanceOrders.cashAccountId))
    .leftJoin(s.breakdownRequests, eq(s.breakdownRequests.id, s.maintenanceOrders.breakdownRequestId))
    .leftJoin(s.maintenancePlans, eq(s.maintenancePlans.id, s.maintenanceOrders.planId))
    .leftJoin(s.journalEntries, eq(s.journalEntries.id, s.maintenanceOrders.journalEntryId))
    .where(eq(s.maintenanceOrders.id, id));
  if (!row) return null;
  const lines = await db
    .select({ l: s.maintenanceLines, product: s.products.code, warehouse: s.warehouses.nameAr })
    .from(s.maintenanceLines)
    .leftJoin(s.products, eq(s.products.id, s.maintenanceLines.productId))
    .leftJoin(s.warehouses, eq(s.warehouses.id, s.maintenanceLines.warehouseId))
    .where(eq(s.maintenanceLines.orderId, id))
    .orderBy(asc(s.maintenanceLines.lineNo));
  return { ...row, lines };
}

/** تعديل بيانات رأس المسودة من الشيت. */
export async function updateDraftOrder(db: Db | Tx, id: number, patch: { orderDate?: string; supplierInvoiceNo?: string; odometer?: string; notes?: string }) {
  return db.transaction(async (tx) => {
    const o = await lockOrder(tx, id);
    if (o.status !== "draft") throw new Error(`الأمر ${o.number} معتمد؛ أرجعه لمسودة لتعديله`);
    const set: Partial<typeof s.maintenanceOrders.$inferInsert> = {};
    if (patch.orderDate !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(patch.orderDate)) throw new Error("التاريخ غير صحيح");
      set.orderDate = patch.orderDate;
    }
    if (patch.supplierInvoiceNo !== undefined) set.supplierInvoiceNo = o.provider === "external" ? patch.supplierInvoiceNo.trim() || null : null;
    if (patch.odometer !== undefined) {
      const n = patch.odometer.trim() ? Number(patch.odometer) : null;
      if (n != null && !(Number.isInteger(n) && n >= 0)) throw new Error("قراءة العداد رقم صحيح");
      set.odometer = n;
    }
    if (patch.notes !== undefined) set.notes = patch.notes.trim() || null;
    if (Object.keys(set).length) await tx.update(s.maintenanceOrders).set(set).where(eq(s.maintenanceOrders.id, id));
  });
}

export interface RequestFilter {
  q?: string;
  status?: BreakdownStatusKey;
  from?: string;
  to?: string;
  vehicleId?: number;
  priority?: "low" | "normal" | "urgent";
}
type BreakdownStatusKey = (typeof s.breakdownRequests.$inferSelect)["status"];

export async function listRequests(db: Db | Tx, f: RequestFilter = {}, limit = 300) {
  const r = s.breakdownRequests;
  const where: SQL[] = [];
  if (f.status) where.push(eq(r.status, f.status));
  if (f.from) where.push(gte(r.reportDate, f.from));
  if (f.to) where.push(lte(r.reportDate, f.to));
  if (f.vehicleId) where.push(eq(r.vehicleId, f.vehicleId));
  if (f.priority) where.push(eq(r.priority, f.priority));
  if (f.q) {
    const q = like(f.q);
    const any = or(ilike(r.number, q), ilike(r.description, q), ilike(s.vehicles.plate, q), ilike(s.employees.nameAr, q));
    if (any) where.push(any);
  }
  return db
    .select({ r, plate: s.vehicles.plate, driver: s.employees.nameAr, order: { id: s.maintenanceOrders.id, number: s.maintenanceOrders.number, status: s.maintenanceOrders.status } })
    .from(r)
    .innerJoin(s.vehicles, eq(s.vehicles.id, r.vehicleId))
    .leftJoin(s.drivers, eq(s.drivers.id, r.driverId))
    .leftJoin(s.employees, eq(s.employees.id, s.drivers.employeeId))
    .leftJoin(s.maintenanceOrders, eq(s.maintenanceOrders.breakdownRequestId, r.id))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(r.reportDate), desc(r.id))
    .limit(limit);
}

export async function requestDoc(db: Db | Tx, id: number) {
  const reviewer = alias(s.users, "reviewer");
  const approver = alias(s.users, "approver");
  const [row] = await db
    .select({
      r: s.breakdownRequests,
      plate: s.vehicles.plate,
      driver: s.employees.nameAr,
      reviewer: reviewer.name,
      approver: approver.name,
      order: { id: s.maintenanceOrders.id, number: s.maintenanceOrders.number, status: s.maintenanceOrders.status, total: s.maintenanceOrders.total },
    })
    .from(s.breakdownRequests)
    .innerJoin(s.vehicles, eq(s.vehicles.id, s.breakdownRequests.vehicleId))
    .leftJoin(s.drivers, eq(s.drivers.id, s.breakdownRequests.driverId))
    .leftJoin(s.employees, eq(s.employees.id, s.drivers.employeeId))
    .leftJoin(reviewer, eq(reviewer.id, s.breakdownRequests.reviewedBy))
    .leftJoin(approver, eq(approver.id, s.breakdownRequests.approvedBy))
    .leftJoin(s.maintenanceOrders, eq(s.maintenanceOrders.breakdownRequestId, s.breakdownRequests.id))
    .where(eq(s.breakdownRequests.id, id));
  return row ?? null;
}

/** أمر صيانة (مسودة، ورشة داخلية) لكل طلب عطل معتمد أو خطة دورية محددة. */
export async function createOrdersFrom(db: Db | Tx, source: { requests?: number[]; plans?: number[] }, opts: { orderDate: string; userId?: number }) {
  const created: string[] = [];
  for (const id of source.requests ?? []) {
    const [r] = await db.select().from(s.breakdownRequests).where(eq(s.breakdownRequests.id, id));
    if (!r) continue;
    const o = await createMaintenanceOrder(db, { vehicleId: r.vehicleId, orderDate: opts.orderDate, type: "mechanical", provider: "internal", breakdownRequestId: r.id, notes: r.description, userId: opts.userId });
    created.push(o.number);
  }
  for (const id of source.plans ?? []) {
    const [p] = await db.select().from(s.maintenancePlans).where(eq(s.maintenancePlans.id, id));
    if (!p) continue;
    const [open] = await db
      .select({ number: s.maintenanceOrders.number })
      .from(s.maintenanceOrders)
      .where(and(eq(s.maintenanceOrders.planId, p.id), sql`${s.maintenanceOrders.status} <> 'completed'`));
    if (open) throw new Error(`للخطة «${p.title}» أمر مفتوح ${open.number}`);
    const o = await createMaintenanceOrder(db, { vehicleId: p.vehicleId, orderDate: opts.orderDate, type: p.type, provider: "internal", planId: p.id, notes: p.title, userId: opts.userId });
    created.push(o.number);
  }
  return created;
}

// ───────────── أنواع الصيانة (قائمة يختار منها السائق ويُفلتر بها لاحقاً) ─────────────

export async function saveMaintenanceType(db: Db | Tx, input: { id?: number | null; nameAr: string; nameEn?: string | null; sortOrder?: number | null; isActive: boolean }) {
  const nameAr = input.nameAr.trim();
  if (!nameAr) throw new Error("اكتب اسم نوع الصيانة");
  const values = { nameAr, nameEn: input.nameEn?.trim() || null, sortOrder: input.sortOrder ?? 50, isActive: input.isActive };
  if (input.id) {
    const [row] = await db.update(s.maintenanceTypes).set(values).where(eq(s.maintenanceTypes.id, input.id)).returning();
    if (!row) throw new Error("النوع غير موجود");
    return row;
  }
  const [row] = await db.insert(s.maintenanceTypes).values(values).returning();
  return row;
}
