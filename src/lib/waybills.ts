import { and, asc, desc, eq, gte, ilike, inArray, like, lte, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db, Tx } from "@/db";
import { blockingDocumentIssues } from "@/lib/documents";
import * as s from "@/db/schema";
import { createJournalEntryTx, deleteEntryTx, nextDocumentNumber } from "@/lib/ledger";
import { activeContract, contractRatesFor } from "@/lib/operations";
import { resolvePrice } from "@/lib/pricing";
import { driverOnDate } from "@/lib/fleet";
import { driverLeaveOn } from "@/lib/hr";
import { waybillPostingLines } from "@/lib/waybill-posting";
import { PERIODS, periodRange, type Period } from "@/lib/doc-filters";
import { FREIGHT_PAYERS, GOODS_CONDITIONS, LOGISTI_STATUSES, PACKAGE_UNITS, PAYMENT_METHODS, WEIGHT_UNITS, WAYBILL_ACCOUNTS, WAYBILL_FLOW, WAYBILL_SORTS, WAYBILL_STATUS, WAYBILL_TABS, type WaybillAccountKey, type WaybillFlowStatus, type WaybillSort, type WaybillStatus } from "@/data/waybills";

// الشحنة = رحلة واحدة (القرار 2). لا قيد قبل الاعتماد (القرار 3).

export const EDITABLE: WaybillStatus[] = ["draft", "in_transit", "delivered", "rejected"];
const APPROVABLE: WaybillStatus[] = ["draft", "in_transit", "delivered"];

const num = (v: string | null | undefined) => (v == null ? 0 : Number(v));

async function hasRole(tx: Db | Tx, partyId: number, role: (typeof s.partyRoleType.enumValues)[number]) {
  const rows = await tx.select().from(s.partyRoles).where(and(eq(s.partyRoles.partyId, partyId), eq(s.partyRoles.role, role)));
  return rows.length > 0;
}

async function lockWaybill(tx: Tx, id: number) {
  const [w] = await tx.select().from(s.waybills).where(eq(s.waybills.id, id)).for("update");
  if (!w) throw new Error("الشحنة غير موجودة");
  return w;
}

function assertEditable(w: { status: WaybillStatus; number: string }) {
  if (!EDITABLE.includes(w.status)) throw new Error(`الشحنة ${w.number} معتمدة؛ أرجعها لمسودة أولاً للتعديل`);
}

/** سعر الصرف المسجل للعملة في التاريخ أو قبله (الريال = 1). */
export async function rateOn(db: Db | Tx, currencyCode: string, onDate: string) {
  if (currencyCode === "SAR") return 1;
  const [row] = await db
    .select({ rate: s.exchangeRates.rate })
    .from(s.exchangeRates)
    .where(and(eq(s.exchangeRates.currencyCode, currencyCode), lte(s.exchangeRates.rateDate, onDate)))
    .orderBy(desc(s.exchangeRates.rateDate))
    .limit(1);
  if (!row) throw new Error(`لا يوجد سعر صرف مسجّل لـ ${currencyCode}؛ أدخل سعر الصرف`);
  return Number(row.rate);
}

// ───────────── الإنشاء والتعديل ─────────────

export interface WaybillInput {
  waybillDate: string;
  customerId: number;
  routeId: number;
  shipper: string;
  consignee: string;
  vehicleId?: number | null;
  trailerId?: number | null;
  driverId?: number | null;
  carrierId?: number | null;
  carrierCost?: number | null;
  carrierPlate?: string | null;
  carrierDriverName?: string | null;
  // فارغ = من العقد الساري / من المسار
  amount?: number | null;
  driverCommission?: number | null;
  salesRepId?: number | null;
  salesRepCommission?: number | null;
  weightTons?: number | null;
  containerNumber?: string | null;
  deliveryAddress?: string | null;
  notes?: string | null;
  // عهدة الرحلة للسائق (تُصرف عند الإرسال)
  tripCustody?: number | null;
  userId?: number;
}

/** المقطورة المختارة يجب أن تكون مقطورة غير مباعة. */
async function checkTrailer(tx: Db | Tx, trailerId: number | null | undefined) {
  if (!trailerId) return null;
  const [t] = await tx.select({ plate: s.vehicles.plate, kind: s.vehicles.assetKind, status: s.vehicles.status }).from(s.vehicles).where(eq(s.vehicles.id, trailerId));
  if (!t) throw new Error("المقطورة غير موجودة");
  if (t.kind !== "trailer") throw new Error(`${t.plate} ليست مقطورة؛ حدّد «نوع الأصل: مقطورة» في بيانات المركبة`);
  if (t.status === "sold") throw new Error(`المقطورة ${t.plate} مباعة`);
  return trailerId;
}

/** يحسب قيم الشحنة من المدخلات: التنفيذ (أسطول أو ناقل)، السائق المسند، السعر من العقد، الضريبة من المسار. */
async function resolveWaybill(tx: Tx, input: WaybillInput) {
  const [route] = await tx.select().from(s.routes).where(eq(s.routes.id, input.routeId));
  if (!route) throw new Error("المسار غير موجود");
  if (!(await hasRole(tx, input.customerId, "customer"))) throw new Error("الجهة المختارة ليست عميلاً");
  if (!input.shipper?.trim()) throw new Error("المرسل مطلوب");
  if (!input.consignee?.trim()) throw new Error("المستلم مطلوب");

  const carrier = input.carrierId ?? null;
  if (carrier && (input.vehicleId || input.driverId || input.trailerId)) throw new Error("اختر مركبة من الأسطول أو ناقلاً خارجياً، لا الاثنين");
  let vehicleId: number | null = null;
  let driverId: number | null = null;
  let vehicleTypeId: number | null = null;
  if (carrier) {
    if (!(await hasRole(tx, carrier, "carrier"))) throw new Error("الجهة المختارة ليست ناقلاً خارجياً");
    if (!(input.carrierCost && input.carrierCost > 0)) throw new Error("تكلفة الناقل إلزامية");
  } else {
    if (!input.vehicleId) throw new Error("اختر المركبة أو الناقل الخارجي");
    const [v] = await tx.select().from(s.vehicles).where(eq(s.vehicles.id, input.vehicleId));
    if (!v) throw new Error("المركبة غير موجودة");
    if (v.assetKind === "trailer") throw new Error(`${v.plate} مقطورة؛ اختر الرأس في «المركبة» والمقطورة في حقلها`);
    vehicleId = v.id;
    vehicleTypeId = v.vehicleTypeId;
    // السائق المسند للمركبة في تاريخ الرحلة إن لم يُحدَّد
    driverId = input.driverId ?? (await driverOnDate(tx, v.id, input.waybillDate));
    if (!driverId) throw new Error(`المركبة ${v.plate} غير مسندة لسائق في هذا التاريخ؛ اختر السائق`);
    const leave = await driverLeaveOn(tx, driverId, input.waybillDate);
    if (leave) throw new Error(`السائق ${leave.name} في إجازة معتمدة (${leave.number}) حتى ${leave.toDate}؛ اختر سائقاً آخر`);
  }

  // السعر من العقد الساري (قابل للتعديل بصلاحية)
  const contract = await activeContract(tx, input.customerId, input.waybillDate);
  let amount = input.amount ?? null;
  let priceNote: string | null = amount != null ? "سعر مُدخل يدوياً" : null;
  if (amount == null) {
    const price = contract
      ? resolvePrice(await contractRatesFor(tx, contract.id), {
          routeId: route.id,
          distanceKm: route.distanceKm,
          vehicleId,
          vehicleTypeId,
        })
      : null;
    amount = price?.amount ?? 0;
    priceNote = price ? price.explanation : contract ? "لا يوجد بند مطابق في العقد" : "لا يوجد عقد ساري";
  }

  const [taxCode] = await tx
    .select({ id: s.taxCodes.id })
    .from(s.taxCodes)
    .where(eq(s.taxCodes.code, route.isInternational ? "ZERO" : "VAT15-OUT"));

  return {
    waybillDate: input.waybillDate,
    customerId: input.customerId,
    contractId: contract?.id ?? null,
    routeId: route.id,
    shipper: input.shipper.trim(),
    consignee: input.consignee.trim(),
    deliveryAddress: input.deliveryAddress || null,
    isInternational: route.isInternational,
    currencyCode: contract?.currencyCode ?? "SAR",
    execution: carrier ? ("carrier" as const) : ("fleet" as const),
    vehicleId,
    trailerId: carrier ? null : await checkTrailer(tx, input.trailerId),
    driverId,
    carrierId: carrier,
    carrierCost: carrier ? String(input.carrierCost) : null,
    carrierPlate: input.carrierPlate || null,
    carrierDriverName: input.carrierDriverName || null,
    distanceKm: route.distanceKm,
    weightTons: input.weightTons != null ? String(input.weightTons) : null,
    containerNumber: input.containerNumber || null,
    amount: String(amount),
    taxCodeId: taxCode?.id ?? null,
    priceNote,
    // العمولة من المسار، وتُعدَّل قبل الاعتماد
    driverCommission: carrier ? "0" : String(input.driverCommission ?? num(route.driverCommission)),
    salesRepId: input.salesRepId ?? null,
    salesRepCommission: String(input.salesRepCommission ?? 0),
    notes: input.notes || null,
    tripCustody: carrier ? "0" : String(Math.max(0, input.tripCustody ?? 0)),
  };
}

/**
 * الشحنة المرسلة للسائق: لا يتغير سائقها أو مركبتها أو عهدتها إلا بعد «إلغاء الإرسال»،
 * فما يراه السائق في تطبيقه وما قُيد على عهدته يبقيان مطابقين للشحنة.
 */
export function assertSentLocks(
  w: { number: string; sentToDriverAt: Date | null; driverId: number | null; vehicleId: number | null; execution: string; tripCustody: string },
  next: { driverId?: number | null; vehicleId?: number | null; execution?: string; tripCustody?: string | number | null },
) {
  if (!w.sentToDriverAt) return;
  const why = `الشحنة ${w.number} مرسلة للسائق؛ ألغِ الإرسال أولاً`;
  if (next.execution !== undefined && next.execution !== w.execution) throw new Error(`${why} لتغيير طريقة التنفيذ`);
  if (next.driverId !== undefined && next.driverId !== w.driverId) throw new Error(`${why} لتغيير السائق`);
  if (next.vehicleId !== undefined && next.vehicleId !== w.vehicleId) throw new Error(`${why} لتغيير المركبة`);
  if (next.tripCustody != null && Number(next.tripCustody) !== Number(w.tripCustody)) throw new Error(`${why} لتعديل عهدة الرحلة`);
}

export async function createWaybill(db: Db, input: WaybillInput) {
  return db.transaction((tx) => createWaybillTx(tx, input));
}

export async function createWaybillTx(tx: Tx, input: WaybillInput) {
  const values = await resolveWaybill(tx, input);
  const number = await nextDocumentNumber(tx, "waybill", "WB", Number(input.waybillDate.slice(0, 4)));
  const [row] = await tx
    .insert(s.waybills)
    .values({ ...values, number, createdBy: input.userId })
    .returning();
  return row;
}

/**
 * تعديل الشحنة كاملة من نافذة التعديل (العميل والمسار والمركبة والتاريخ…) قبل اعتمادها.
 * المبلغ الفارغ يُعاد حسابه من العقد الساري، والعمولة الفارغة من المسار. الرقم والمراحل والديزل والمصاريف تبقى.
 */
export async function editWaybill(db: Db, id: number, input: Omit<WaybillInput, "userId"> & { deliveryNoteNumber?: string | null; customsDeclaration?: string | null }) {
  return db.transaction(async (tx) => {
    const w = await lockWaybill(tx, id);
    assertEditable(w);
    const values = await resolveWaybill(tx, input);
    // من لا يرسل العهدة في النموذج (الجدول) تبقى عهدته كما هي
    if (input.tripCustody == null) values.tripCustody = w.tripCustody;
    assertSentLocks(w, values);
    // المرفوضة تبقى مرفوضة حتى تُعاد لمسودة؛ تعديلها لا يغير حالتها
    const [row] = await tx
      .update(s.waybills)
      .set({
        ...values,
        deliveryNoteNumber: input.deliveryNoteNumber !== undefined ? input.deliveryNoteNumber || null : w.deliveryNoteNumber,
        customsDeclaration: input.customsDeclaration !== undefined ? input.customsDeclaration || null : w.customsDeclaration,
        updatedAt: new Date(),
      })
      .where(eq(s.waybills.id, id))
      .returning();
    return row;
  });
}

export interface WaybillUpdate {
  amount?: number;
  driverCommission?: number;
  salesRepCommission?: number;
  carrierCost?: number;
  odometerStart?: number | null;
  odometerEnd?: number | null;
  deliveryNoteNumber?: string | null;
  customsDeclaration?: string | null;
  shipper?: string;
  consignee?: string;
  weightTons?: number | null;
  containerNumber?: string | null;
  notes?: string | null;
  trailerId?: number | null;
}

export async function updateWaybill(db: Db, id: number, patch: WaybillUpdate) {
  return db.transaction(async (tx) => {
    const w = await lockWaybill(tx, id);
    assertEditable(w);
    const set: Partial<typeof s.waybills.$inferInsert> = { updatedAt: new Date() };
    if (patch.amount !== undefined && patch.amount !== num(w.amount)) {
      set.amount = String(patch.amount);
      set.priceNote = "سعر معدَّل يدوياً";
    }
    if (patch.driverCommission !== undefined) set.driverCommission = String(patch.driverCommission);
    if (patch.salesRepCommission !== undefined) set.salesRepCommission = String(patch.salesRepCommission);
    if (patch.carrierCost !== undefined && w.execution === "carrier") set.carrierCost = String(patch.carrierCost);
    if (patch.odometerStart !== undefined) set.odometerStart = patch.odometerStart;
    if (patch.odometerEnd !== undefined) set.odometerEnd = patch.odometerEnd;
    if (patch.deliveryNoteNumber !== undefined) set.deliveryNoteNumber = patch.deliveryNoteNumber || null;
    if (patch.customsDeclaration !== undefined) set.customsDeclaration = patch.customsDeclaration || null;
    if (patch.shipper !== undefined) {
      if (!patch.shipper.trim()) throw new Error("المرسل مطلوب");
      set.shipper = patch.shipper.trim();
    }
    if (patch.consignee !== undefined) {
      if (!patch.consignee.trim()) throw new Error("المستلم مطلوب");
      set.consignee = patch.consignee.trim();
    }
    if (patch.weightTons !== undefined) set.weightTons = patch.weightTons != null ? String(patch.weightTons) : null;
    if (patch.containerNumber !== undefined) set.containerNumber = patch.containerNumber || null;
    if (patch.notes !== undefined) set.notes = patch.notes || null;
    if (patch.trailerId !== undefined && w.execution === "fleet") set.trailerId = await checkTrailer(tx, patch.trailerId);
    await tx.update(s.waybills).set(set).where(eq(s.waybills.id, id));
  });
}

// ───────────── الديزل والمصاريف والمراحل ─────────────

export interface FuelInput {
  source: "custody" | "fuel_card" | "station_credit";
  partyId?: number | null;
  liters?: number | null;
  amount: number;
  vatAmount?: number;
  currencyCode?: string;
  exchangeRate?: number | null;
  odometer?: number | null;
  invoiceNumber?: string | null;
}

export async function addFuel(db: Db, waybillId: number, f: FuelInput) {
  return db.transaction(async (tx) => {
    const w = await lockWaybill(tx, waybillId);
    assertEditable(w);
    if (f.source === "custody" && w.execution !== "fleet") throw new Error("عهدة السائق متاحة لشحنات الأسطول فقط");
    if (f.source === "station_credit" && !f.partyId) throw new Error("اختر المحطة");
    const currency = f.currencyCode ?? "SAR";
    const [row] = await tx
      .insert(s.waybillFuel)
      .values({
        waybillId,
        source: f.source,
        partyId: f.partyId ?? null,
        liters: f.liters != null ? String(f.liters) : null,
        amount: String(f.amount),
        vatAmount: String(f.vatAmount ?? 0),
        currencyCode: currency,
        exchangeRate: String(f.exchangeRate ?? (await rateOn(tx, currency, w.waybillDate))),
        odometer: f.odometer ?? null,
        invoiceNumber: f.invoiceNumber || null,
      })
      .returning();
    return row;
  });
}

export interface ExpenseInput {
  chargeTypeId: number;
  amount: number;
  currencyCode?: string;
  exchangeRate?: number | null;
  billTo?: "company" | "customer";
  payer?: "driver_custody" | "customs_broker";
  partyId?: number | null;
  note?: string | null;
}

export async function addExpense(db: Db, waybillId: number, e: ExpenseInput) {
  return db.transaction(async (tx) => {
    const w = await lockWaybill(tx, waybillId);
    assertEditable(w);
    const payer = e.payer ?? (w.execution === "fleet" ? "driver_custody" : "customs_broker");
    if (payer === "driver_custody" && w.execution !== "fleet") throw new Error("عهدة السائق متاحة لشحنات الأسطول فقط");
    if (payer === "customs_broker" && !e.partyId) throw new Error("اختر المخلص");
    const currency = e.currencyCode ?? "SAR";
    const [row] = await tx
      .insert(s.waybillExpenses)
      .values({
        waybillId,
        chargeTypeId: e.chargeTypeId,
        amount: String(e.amount),
        currencyCode: currency,
        exchangeRate: String(e.exchangeRate ?? (await rateOn(tx, currency, w.waybillDate))),
        billTo: e.billTo ?? "company",
        payer,
        partyId: payer === "customs_broker" ? (e.partyId ?? null) : null,
        note: e.note || null,
      })
      .returning();
    return row;
  });
}

/** يحذف سطر ديزل أو مصروف ما دامت الشحنة غير معتمدة. */
export async function deleteWaybillItem(db: Db, waybillId: number, kind: "fuel" | "expense", itemId: number) {
  return db.transaction(async (tx) => {
    assertEditable(await lockWaybill(tx, waybillId));
    const table = kind === "fuel" ? s.waybillFuel : s.waybillExpenses;
    await tx.delete(table).where(and(eq(table.id, itemId), eq(table.waybillId, waybillId)));
  });
}

/** تسجيل مرحلة الرحلة؛ التحميل والطريق والحدود تجعلها «في الطريق»، والتسليم يجعلها «مُسلَّمة» (ما لم تُعتمد). */
export async function recordStage(
  db: Db,
  waybillId: number,
  stage: "loading" | "in_transit" | "border" | "delivery",
  opts: { at?: Date; odometer?: number | null; note?: string | null; userId?: number } = {},
) {
  return db.transaction(async (tx) => {
    const w = await lockWaybill(tx, waybillId);
    if (w.status === "rejected") throw new Error("الشحنة مرفوضة؛ أعدها لمسودة أولاً");
    // الاعتماد مراجعة للفوترة لا تُنهي الرحلة: تُسجَّل مراحلها بعده دون أن تتغير حالة المستند
    const reviewed = w.status === "approved" || w.status === "invoiced";
    if (!reviewed) assertEditable(w);
    await tx.insert(s.tripStages).values({
      waybillId,
      stage,
      at: opts.at ?? new Date(),
      odometer: opts.odometer ?? null,
      note: opts.note || null,
      createdBy: opts.userId,
    });
    const set: Partial<typeof s.waybills.$inferInsert> = { updatedAt: new Date() };
    if (stage === "delivery") {
      if (!reviewed) set.status = "delivered";
      if (opts.odometer != null) set.odometerEnd = opts.odometer;
    } else {
      if (w.status === "draft") set.status = "in_transit";
      if (stage === "loading" && opts.odometer != null) set.odometerStart = opts.odometer;
    }
    await tx.update(s.waybills).set(set).where(eq(s.waybills.id, waybillId));
  });
}

// ───────────── الاعتماد والرفض والإرجاع ─────────────

export interface ControlIssue {
  code: "no_contract" | "zero_amount" | "credit_limit" | "documents";
  message: string;
}

/** ضوابط الاعتماد (البند 6 في نموذج البيانات)؛ تُتجاوز بصلاحية «تجاوز الضوابط» مع سبب. */
export async function approvalIssues(db: Db | Tx, w: typeof s.waybills.$inferSelect): Promise<ControlIssue[]> {
  const issues: ControlIssue[] = [];
  const contract = await activeContract(db, w.customerId, w.waybillDate);
  if (!contract) issues.push({ code: "no_contract", message: "لا يوجد عقد ساري للعميل في تاريخ الشحنة" });
  if (!(num(w.amount) > 0)) issues.push({ code: "zero_amount", message: "مبلغ الشحنة صفر" });
  if (contract?.creditLimit != null) {
    // الرصيد المرحّل على حساب العملاء + المعتمد غير المفوتر + هذه الشحنة
    const [ar] = await db
      .select({ balance: sql<string>`coalesce(sum(${s.journalLines.debitBase} - ${s.journalLines.creditBase}), 0)` })
      .from(s.journalLines)
      .innerJoin(s.journalEntries, eq(s.journalEntries.id, s.journalLines.entryId))
      .innerJoin(s.accounts, eq(s.accounts.id, s.journalLines.accountId))
      .where(and(eq(s.journalLines.partyId, w.customerId), eq(s.journalEntries.status, "posted"), like(s.accounts.code, "1103%")));
    const [pending] = await db
      .select({ total: sql<string>`coalesce(sum(${s.waybills.amount}), 0)` })
      .from(s.waybills)
      .where(and(eq(s.waybills.customerId, w.customerId), eq(s.waybills.status, "approved")));
    const exposure = num(ar.balance) + num(pending.total) + num(w.amount);
    const limit = num(contract.creditLimit);
    if (exposure > limit) {
      issues.push({ code: "credit_limit", message: `تتجاوز الحد الائتماني للعميل: ${exposure.toLocaleString("en")} من ${limit.toLocaleString("en")}` });
    }
  }
  // الوثائق المانعة المنتهية في تاريخ الرحلة: الرأس والمقطورة والسائق، والعميل
  const docs = await blockingDocumentIssues(
    db,
    [
      { kind: "vehicle", id: w.vehicleId },
      { kind: "trailer", id: w.trailerId },
      { kind: "driver", id: w.driverId },
      { kind: "customer", id: w.customerId },
    ],
    w.waybillDate,
    w.isInternational,
  );
  issues.push(...docs.map((d) => ({ code: "documents" as const, message: d.message })));
  return issues;
}

async function accountIds(tx: Tx) {
  const codes = Object.values(WAYBILL_ACCOUNTS);
  const rows = await tx.select({ id: s.accounts.id, code: s.accounts.code }).from(s.accounts).where(inArray(s.accounts.code, codes));
  const byCode = new Map(rows.map((r) => [r.code, r.id]));
  return Object.fromEntries(
    Object.entries(WAYBILL_ACCOUNTS).map(([key, code]) => {
      const id = byCode.get(code);
      if (!id) throw new Error(`الحساب ${code} غير موجود في الشجرة`);
      return [key, id];
    }),
  ) as Record<WaybillAccountKey, number>;
}

export async function approveWaybill(
  db: Db,
  id: number,
  opts: { userId?: number; canOverride?: boolean; overrideReason?: string | null } = {},
) {
  return db.transaction(async (tx) => {
    const w = await lockWaybill(tx, id);
    if (!APPROVABLE.includes(w.status)) {
      throw new Error(w.status === "rejected" ? `الشحنة ${w.number} مرفوضة؛ صحّحها وأعدها لمسودة أولاً` : `الشحنة ${w.number} معتمدة مسبقاً`);
    }
    const issues = await approvalIssues(tx, w);
    const reason = opts.overrideReason?.trim() || null;
    if (issues.length && !(opts.canOverride && reason)) {
      const hint = opts.canOverride ? "؛ اكتب سبب التجاوز للاعتماد" : "؛ يلزم مستخدم بصلاحية تجاوز الضوابط";
      throw new Error(issues.map((i) => i.message).join("، ") + hint);
    }

    // الأبعاد: مركز تكلفة المركبة، أو مركز الناقلين الخارجيين
    let costCenterId: number;
    let custodyId: number | null = null;
    let payableId: number | null = null;
    if (w.execution === "fleet") {
      const [v] = await tx.select({ cc: s.vehicles.costCenterId, odometer: s.vehicles.odometer }).from(s.vehicles).where(eq(s.vehicles.id, w.vehicleId!));
      costCenterId = v.cc;
      const [d] = await tx
        .select({ custody: s.drivers.custodyAccountId, payable: s.employees.payableAccountId })
        .from(s.drivers)
        .innerJoin(s.employees, eq(s.employees.id, s.drivers.employeeId))
        .where(eq(s.drivers.id, w.driverId!));
      custodyId = d.custody;
      payableId = d.payable;
      if (w.odometerEnd != null && w.odometerEnd > v.odometer) {
        await tx.update(s.vehicles).set({ odometer: w.odometerEnd, updatedAt: new Date() }).where(eq(s.vehicles.id, w.vehicleId!));
      }
    } else {
      const [cc] = await tx.select({ id: s.costCenters.id }).from(s.costCenters).where(eq(s.costCenters.code, "EXT"));
      if (!cc) throw new Error("مركز تكلفة الناقلين الخارجيين (EXT) غير موجود");
      costCenterId = cc.id;
    }

    const fuel = await tx.select().from(s.waybillFuel).where(eq(s.waybillFuel.waybillId, id));
    const expenses = await tx
      .select({ e: s.waybillExpenses, label: s.chargeTypes.nameAr, costAccountId: s.chargeTypes.costAccountId })
      .from(s.waybillExpenses)
      .innerJoin(s.chargeTypes, eq(s.chargeTypes.id, s.waybillExpenses.chargeTypeId))
      .where(eq(s.waybillExpenses.waybillId, id));
    const [vatIn] = await tx.select({ id: s.taxCodes.id }).from(s.taxCodes).where(eq(s.taxCodes.code, "VAT15-IN"));

    const lines = waybillPostingLines(
      {
        id: w.id,
        number: w.number,
        execution: w.execution,
        costCenterId,
        driverId: w.driverId,
        driverCustodyAccountId: custodyId,
        driverPayableAccountId: payableId,
        driverCommission: num(w.driverCommission),
        carrierId: w.carrierId,
        carrierCost: num(w.carrierCost),
        salesRepId: w.salesRepId,
        salesRepCommission: num(w.salesRepCommission),
      },
      fuel.map((f) => ({
        source: f.source,
        partyId: f.partyId,
        amount: num(f.amount),
        vatAmount: num(f.vatAmount),
        currencyCode: f.currencyCode,
        exchangeRate: num(f.exchangeRate),
      })),
      expenses.map(({ e, label, costAccountId }) => ({
        costAccountId,
        label,
        payer: e.payer,
        partyId: e.partyId,
        amount: num(e.amount),
        currencyCode: e.currencyCode,
        exchangeRate: num(e.exchangeRate),
      })),
      await accountIds(tx),
      vatIn?.id ?? null,
    );

    // شحنة بلا أي تكلفة (لا ديزل ولا عمولة) تُعتمد بلا قيد
    const entry = lines.length
      ? await createJournalEntryTx(tx, {
          entryDate: w.waybillDate,
          description: `تكلفة الشحنة ${w.number}`,
          source: { type: "waybill", id: w.id },
          lines,
          post: true,
          userId: opts.userId,
        })
      : null;

    const contract = w.contractId ? null : await activeContract(tx, w.customerId, w.waybillDate);
    await tx
      .update(s.waybills)
      .set({
        status: "approved",
        approvedBy: opts.userId ?? null,
        approvedAt: new Date(),
        journalEntryId: entry?.id ?? null,
        overrideReason: issues.length ? reason : null,
        rejectionReason: null,
        contractId: w.contractId ?? contract?.id ?? null,
        updatedAt: new Date(),
      })
      .where(eq(s.waybills.id, id));
    return { entry, issues };
  });
}

export async function rejectWaybill(db: Db, id: number, reason: string) {
  if (!reason.trim()) throw new Error("اكتب سبب الرفض ليصل للسائق");
  return db.transaction(async (tx) => {
    const w = await lockWaybill(tx, id);
    if (!APPROVABLE.includes(w.status)) throw new Error("لا يمكن رفض شحنة معتمدة؛ أرجعها لمسودة أولاً");
    await tx.update(s.waybills).set({ status: "rejected", rejectionReason: reason.trim(), updatedAt: new Date() }).where(eq(s.waybills.id, id));
  });
}

/** إرجاع لمسودة: يلغي قيد التكلفة (القرار 9). المرفوضة تعود مسودة للتصحيح. */
export async function revertWaybill(db: Db, id: number) {
  return db.transaction(async (tx) => {
    const w = await lockWaybill(tx, id);
    if (w.status === "invoiced") throw new Error("الشحنة مفوترة؛ ألغِ الفاتورة أولاً");
    if (w.status === "rejected") {
      await tx.update(s.waybills).set({ status: "draft", updatedAt: new Date() }).where(eq(s.waybills.id, id));
      return;
    }
    if (w.status !== "approved") throw new Error("الشحنة ليست معتمدة");
    await tx
      .update(s.waybills)
      .set({ status: "delivered", journalEntryId: null, approvedBy: null, approvedAt: null, updatedAt: new Date() })
      .where(eq(s.waybills.id, id));
    if (w.journalEntryId) await deleteEntryTx(tx, w.journalEntryId);
  });
}

/** حذف شحنة مسودة أو مرفوضة، مع حفظ نسخة في سجل المحذوفات. */
export async function deleteWaybill(db: Db, id: number, opts: { reason: string; userId?: number }) {
  if (!opts.reason.trim()) throw new Error("اكتب سبب الحذف");
  return db.transaction(async (tx) => {
    const w = await lockWaybill(tx, id);
    if (w.status !== "draft" && w.status !== "rejected") throw new Error("الحذف متاح للمسودة والمرفوضة فقط");
    if (w.sentToDriverAt) throw new Error(`الشحنة ${w.number} مرسلة للسائق؛ ألغِ الإرسال أولاً ثم احذفها`);
    const fuel = await tx.select().from(s.waybillFuel).where(eq(s.waybillFuel.waybillId, id));
    const expenses = await tx.select().from(s.waybillExpenses).where(eq(s.waybillExpenses.waybillId, id));
    await tx.insert(s.deletionLog).values({
      entity: "waybill",
      entityId: String(id),
      snapshot: { waybill: w, fuel, expenses },
      reason: opts.reason.trim(),
      userId: opts.userId,
    });
    await tx.delete(s.waybills).where(eq(s.waybills.id, id));
  });
}

/** بيانات بوليصة الشحن للطباعة والمشاركة (دون أسعار أو تكاليف). */
export async function waybillDoc(db: Db | Tx, id: number) {
  const from = alias(s.locations, "from_loc");
  const to = alias(s.locations, "to_loc");
  const carrier = alias(s.parties, "carrier");
  const trailer = alias(s.vehicles, "trailer");
  const [w] = await db
    .select({
      w: s.waybills,
      fromCountry: sql<string | null>`(select c.name_ar from locations c where c.level = 'country' and c.country_code = ${from.countryCode} order by c.id limit 1)`,
      toCountry: sql<string | null>`(select c.name_ar from locations c where c.level = 'country' and c.country_code = ${to.countryCode} order by c.id limit 1)`,
      plateType: s.vehicles.plateType,
      trailerPlate: trailer.plate,
      driverIdNumber: sql<string | null>`coalesce(${s.drivers.residencyNumber}, ${s.employees.nationalId})`,
      driverNationality: s.drivers.nationality,
      customer: s.parties.nameAr,
      customerMobile: s.parties.mobile,
      customerEmail: s.parties.email,
      from: from.nameAr,
      to: to.nameAr,
      plate: s.vehicles.plate,
      driver: s.employees.nameAr,
      driverMobile: s.drivers.mobile,
      carrier: carrier.nameAr,
    })
    .from(s.waybills)
    .innerJoin(s.parties, eq(s.parties.id, s.waybills.customerId))
    .innerJoin(s.routes, eq(s.routes.id, s.waybills.routeId))
    .innerJoin(from, eq(from.id, s.routes.fromLocationId))
    .innerJoin(to, eq(to.id, s.routes.toLocationId))
    .leftJoin(s.vehicles, eq(s.vehicles.id, s.waybills.vehicleId))
    .leftJoin(s.drivers, eq(s.drivers.id, s.waybills.driverId))
    .leftJoin(s.employees, eq(s.employees.id, s.drivers.employeeId))
    .leftJoin(carrier, eq(carrier.id, s.waybills.carrierId))
    .leftJoin(trailer, eq(trailer.id, s.waybills.trailerId))
    .where(eq(s.waybills.id, id));
  if (!w) return null;
  const [stages, goods] = await Promise.all([
    db.select().from(s.tripStages).where(eq(s.tripStages.waybillId, id)).orderBy(s.tripStages.at),
    db.select().from(s.waybillGoods).where(eq(s.waybillGoods.waybillId, id)).orderBy(s.waybillGoods.lineNo),
  ]);
  return { ...w, stages, goods };
}

// ───────────── وثيقة النقل (لوجستي) ─────────────

export interface GoodsLine {
  description: string;
  quantity?: number | null;
  packageUnit?: string | null;
  weight?: number | null;
  weightUnit?: string | null;
  dimensions?: string | null;
  condition?: string | null;
}

export interface TransportInput {
  shipperPhone?: string | null;
  shipperCity?: string | null;
  shipperAddress?: string | null;
  shipperNotes?: string | null;
  consigneePhone?: string | null;
  consigneeCity?: string | null;
  deliveryAddress?: string | null;
  consigneeNotes?: string | null;
  pickupDate?: string | null;
  expectedDeliveryDate?: string | null;
  freightPayer?: string | null;
  paymentMethod?: string | null;
  freightInstructions?: string | null;
  negotiable?: boolean;
  logistiNumber?: string | null;
  logistiStatus?: string | null;
  goods?: GoodsLine[];
}

const oneOf = <T extends Record<string, string>>(map: T, v: string | null | undefined, fallback: keyof T, label: string): keyof T => {
  if (!v) return fallback;
  if (!(v in map)) throw new Error(`${label} غير صالح: ${v}`);
  return v as keyof T;
};
const clean = (v: string | null | undefined) => (v ?? "").trim() || null;

/**
 * يحفظ بيانات وثيقة النقل وبضاعتها. لا تمس المحاسبة، فتُعدَّل في أي حالة ما عدا المرفوضة.
 * أوزان البضاعة إن وُجدت تصبح وزن الشحنة (بالطن).
 */
export async function saveTransportDoc(db: Db | Tx, id: number, input: TransportInput) {
  const run = async (tx: Tx) => {
    const w = await lockWaybill(tx, id);
    if (w.status === "rejected") throw new Error(`الشحنة ${w.number} مرفوضة؛ أعدها لمسودة أولاً`);
    if (input.pickupDate && input.expectedDeliveryDate && input.expectedDeliveryDate < input.pickupDate)
      throw new Error("تاريخ التسليم المتوقع قبل تاريخ الاستلام");
    const status = oneOf(LOGISTI_STATUSES, input.logistiStatus, "none", "حالة وثيقة لوجستي");
    const logistiNumber = clean(input.logistiNumber);
    if (status !== "none" && !logistiNumber) throw new Error("أدخل رقم وثيقة لوجستي قبل تحديد حالتها");
    const set: Partial<typeof s.waybills.$inferInsert> = { updatedAt: new Date() };
    const text = ["shipperPhone", "shipperCity", "shipperAddress", "shipperNotes", "consigneePhone", "consigneeCity", "deliveryAddress", "consigneeNotes", "freightInstructions"] as const;
    for (const k of text) if (input[k] !== undefined) set[k] = clean(input[k]);
    if (input.pickupDate !== undefined) set.pickupDate = input.pickupDate || null;
    if (input.expectedDeliveryDate !== undefined) set.expectedDeliveryDate = input.expectedDeliveryDate || null;
    if (input.freightPayer !== undefined) set.freightPayer = oneOf(FREIGHT_PAYERS, input.freightPayer, "shipper", "دافع الأجرة") as string;
    if (input.paymentMethod !== undefined) set.paymentMethod = oneOf(PAYMENT_METHODS, input.paymentMethod, "credit", "طريقة الدفع") as string;
    if (input.negotiable !== undefined) set.negotiable = input.negotiable;
    if (input.logistiNumber !== undefined || input.logistiStatus !== undefined) {
      set.logistiNumber = logistiNumber;
      set.logistiStatus = status as string;
    }
    if (input.goods) {
      const lines = input.goods.filter((g) => g.description?.trim() || g.quantity || g.weight);
      const rows = lines.map((g, i) => {
        if (!g.description?.trim()) throw new Error(`سطر البضاعة ${i + 1}: الوصف مطلوب`);
        for (const [v, label] of [
          [g.quantity, "العدد"],
          [g.weight, "الوزن"],
        ] as const)
          if (v != null && !(Number.isFinite(v) && v >= 0)) throw new Error(`سطر البضاعة ${i + 1}: ${label} غير صالح`);
        return {
          waybillId: id,
          lineNo: i + 1,
          description: g.description.trim(),
          quantity: g.quantity != null ? String(g.quantity) : null,
          packageUnit: g.packageUnit ? (oneOf(PACKAGE_UNITS, g.packageUnit, "piece", "الوحدة") as string) : null,
          weight: g.weight != null ? String(g.weight) : null,
          weightUnit: oneOf(WEIGHT_UNITS, g.weightUnit, "kg", "وحدة الوزن") as string,
          dimensions: clean(g.dimensions),
          condition: oneOf(GOODS_CONDITIONS, g.condition, "good", "حالة البضاعة") as string,
        };
      });
      await tx.delete(s.waybillGoods).where(eq(s.waybillGoods.waybillId, id));
      if (rows.length) await tx.insert(s.waybillGoods).values(rows);
      const tons = rows.reduce((t, r) => t + (r.weight ? Number(r.weight) / (r.weightUnit === "ton" ? 1 : 1000) : 0), 0);
      if (tons > 0) set.weightTons = String(Math.round(tons * 1000) / 1000);
    }
    const [row] = await tx.update(s.waybills).set(set).where(eq(s.waybills.id, id)).returning();
    return row;
  };
  return db.transaction(run);
}

// ───────────── تغيير الحالة من الجدول (للأمام والخلف) ─────────────

/**
 * ينقل الشحنة إلى الحالة المطلوبة خطوة خطوة على المسار: مسودة ← في الطريق ← مُسلَّمة ← معتمدة.
 * الحالة مستقلة عن مراحل الرحلة التي يسجلها السائق؛ الاعتماد يرحّل قيد التكلفة، والرجوع من المعتمدة يلغي القيد.
 * المفوترة لا ترجع إلا بإلغاء فاتورتها أو إخراجها منها أولاً.
 */
export async function setWaybillStatus(
  db: Db,
  id: number,
  target: WaybillFlowStatus,
  opts: { userId?: number; canOverride?: boolean; overrideReason?: string | null } = {},
) {
  const [w] = await db.select({ status: s.waybills.status, number: s.waybills.number }).from(s.waybills).where(eq(s.waybills.id, id));
  if (!w) throw new Error("الشحنة غير موجودة");
  if (w.status === "invoiced") throw new Error(`الشحنة ${w.number} مفوترة؛ ألغِ الفاتورة أو أخرج الشحنة منها أولاً`);
  if (w.status === target) return;
  if (w.status === "approved") {
    const [line] = await db.select({ inv: s.salesInvoices.number }).from(s.salesInvoiceLines).innerJoin(s.salesInvoices, eq(s.salesInvoices.id, s.salesInvoiceLines.invoiceId)).where(and(eq(s.salesInvoiceLines.waybillId, id), eq(s.salesInvoiceLines.kind, "waybill"))).limit(1);
    if (line) throw new Error(`الشحنة ${w.number} في الفاتورة المسودة ${line.inv}؛ أخرجها من الفاتورة أو فك الدمج أولاً`);
  }
  if (w.status === "rejected") {
    await revertWaybill(db, id);
    if (target !== "draft") return setWaybillStatus(db, id, target, opts);
    return;
  }
  const from = WAYBILL_FLOW.indexOf(w.status as WaybillFlowStatus);
  const to = WAYBILL_FLOW.indexOf(target);
  if (to > from) {
    // الاعتماد الذي ستمنعه الضوابط (مثل عدم وجود عقد) يُرفض قبل أي تغيير، فلا تتحول الشحنة لمُسلَّمة ولا تُسجَّل مراحل
    if (to === 3) {
      const [row] = await db.select().from(s.waybills).where(eq(s.waybills.id, id));
      const issues = await approvalIssues(db, row);
      if (issues.length && !(opts.canOverride && opts.overrideReason?.trim())) {
        const hint = opts.canOverride ? "؛ اكتب سبب التجاوز للاعتماد" : "؛ يلزم مستخدم بصلاحية تجاوز الضوابط";
        throw new Error(issues.map((i) => i.message).join("، ") + hint);
      }
    }
    // تغيير الحالة من المكتب لا يسجّل مراحل رحلة: التحميل والتسليم يسجّلهما السائق من تطبيقه
    if (to === 3) await approveWaybill(db, id, opts);
    else await db.update(s.waybills).set({ status: target, updatedAt: new Date() }).where(eq(s.waybills.id, id));
    return;
  }
  if (w.status === "approved") await revertWaybill(db, id);
  if (to < 2) await db.update(s.waybills).set({ status: target, updatedAt: new Date() }).where(eq(s.waybills.id, id));
}

// ───────────── القائمة والبحث ─────────────

export interface WaybillFilter {
  q?: string;
  tab?: (typeof WAYBILL_TABS)[number];
  from?: string;
  to?: string;
  sort?: WaybillSort;
  /** السائق يرى شحناته فقط */
  driverUserId?: number;
}

export function parseWaybillFilter(sp: { q?: string; status?: string; period?: string; sort?: string }, today: string): WaybillFilter {
  const period: Period = sp.period && sp.period in PERIODS ? (sp.period as Period) : "all";
  return {
    q: sp.q?.trim() || undefined,
    tab: (WAYBILL_TABS as readonly string[]).includes(sp.status ?? "") ? (sp.status as WaybillFilter["tab"]) : undefined,
    ...periodRange(period, today),
    sort: sp.sort && sp.sort in WAYBILL_SORTS ? (sp.sort as WaybillSort) : "date_desc",
  };
}

// العمود باسم جدوله صراحة: في استعلام جدول واحد يُكتب بلا اسم الجدول فيقرأه الاستعلام الداخلي عموداً من جدوله هو
const WAYBILL_ID = sql.raw(`"waybills"."id"`);
// داخلة في فاتورة: سطرها في فاتورة، أو رحلة أنشأتها فاتورة مباشرة
const invoicedLine = sql`(exists (select 1 from sales_invoice_lines l where l.waybill_id = ${WAYBILL_ID} and l.kind = 'waybill') or "waybills"."source_invoice_id" is not null)`;

const carrier = alias(s.parties, "carrier");
const fromLoc = alias(s.locations, "from_loc");
const toLoc = alias(s.locations, "to_loc");

function waybillWhere(f: WaybillFilter, opts: { tab: boolean }) {
  const where: (SQL | undefined)[] = [];
  if (f.driverUserId) where.push(eq(s.drivers.userId, f.driverUserId));
  if (f.from) where.push(gte(s.waybills.waybillDate, f.from));
  if (f.to) where.push(lte(s.waybills.waybillDate, f.to));
  if (f.q) {
    const q = `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const digits = f.q.replace(/[,\s]/g, "");
    where.push(
      or(
        ilike(s.waybills.number, q),
        ilike(s.parties.nameAr, q),
        ilike(s.waybills.shipper, q),
        ilike(s.waybills.consignee, q),
        ilike(s.waybills.containerNumber, q),
        ilike(s.waybills.deliveryNoteNumber, q),
        ilike(s.waybills.notes, q),
        ilike(s.vehicles.plate, q),
        ilike(s.employees.nameAr, q),
        ilike(carrier.nameAr, q),
        sql`exists (select 1 from routes r join locations a on a.id = r.from_location_id join locations b on b.id = r.to_location_id where r.id = ${s.waybills.routeId} and (a.name_ar ilike ${q} or b.name_ar ilike ${q}))`,
        /^\d+(\.\d+)?$/.test(digits) ? sql`${s.waybills.amount}::text like ${`${digits}%`}` : undefined,
      ),
    );
  }
  if (opts.tab && f.tab) {
    if (f.tab === "pending_invoice") where.push(eq(s.waybills.status, "approved"), sql`not ${invoicedLine}`);
    else if (f.tab === "merged") where.push(eq(s.waybills.status, "approved"), invoicedLine);
    else where.push(eq(s.waybills.status, f.tab));
  }
  return where.length ? and(...where) : undefined;
}

export async function listWaybills(db: Db | Tx, f: WaybillFilter = {}, limit = 500) {
  const order = {
    date_desc: [desc(s.waybills.waybillDate), desc(s.waybills.id)],
    date_asc: [asc(s.waybills.waybillDate), asc(s.waybills.id)],
    amount_desc: [desc(s.waybills.amount), desc(s.waybills.id)],
    amount_asc: [asc(s.waybills.amount), asc(s.waybills.id)],
    number_desc: [desc(s.waybills.number)],
    party_asc: [asc(s.parties.nameAr), desc(s.waybills.waybillDate)],
  }[f.sort ?? "date_desc"];
  const base = () =>
    db
      .select({
        w: s.waybills,
        customer: s.parties.nameAr,
        plate: s.vehicles.plate,
        carrier: carrier.nameAr,
        driver: s.employees.nameAr,
        route: sql<string>`${fromLoc.nameAr} || ' ← ' || ${toLoc.nameAr}`,
        invoiceId: sql<number | null>`coalesce(${s.waybills.sourceInvoiceId}, (select l.invoice_id from sales_invoice_lines l where l.waybill_id = ${WAYBILL_ID} and l.kind = 'waybill' limit 1))`.mapWith((v) => (v == null ? null : Number(v))),
        invoice: sql<string | null>`coalesce((select i.number from sales_invoices i where i.id = ${s.waybills.sourceInvoiceId}), (select i.number from sales_invoice_lines l join sales_invoices i on i.id = l.invoice_id where l.waybill_id = ${WAYBILL_ID} and l.kind = 'waybill' limit 1))`,
        // عدد الشحنات في فاتورتها: أكثر من واحدة = مدمجة
        invoiceWaybills: sql<number>`case when ${s.waybills.sourceInvoiceId} is not null then -1 else coalesce((select count(*) from sales_invoice_lines x where x.kind = 'waybill' and x.invoice_id = (select l.invoice_id from sales_invoice_lines l where l.waybill_id = ${s.waybills.id} and l.kind = 'waybill' limit 1)), 0) end::int`,
      })
      .from(s.waybills)
      .innerJoin(s.parties, eq(s.parties.id, s.waybills.customerId))
      .leftJoin(s.vehicles, eq(s.vehicles.id, s.waybills.vehicleId))
      .leftJoin(carrier, eq(carrier.id, s.waybills.carrierId))
      .leftJoin(s.drivers, eq(s.drivers.id, s.waybills.driverId))
      .leftJoin(s.employees, eq(s.employees.id, s.drivers.employeeId))
      .innerJoin(s.routes, eq(s.routes.id, s.waybills.routeId))
      .innerJoin(fromLoc, eq(fromLoc.id, s.routes.fromLocationId))
      .innerJoin(toLoc, eq(toLoc.id, s.routes.toLocationId));
  const [rows, counts] = await Promise.all([
    base()
      .where(waybillWhere(f, { tab: true }))
      .orderBy(...order)
      .limit(limit),
    // عدد كل تبويب بنفس البحث والفترة
    db
      .select({
        status: s.waybills.status,
        pending: sql<boolean>`${s.waybills.status} = 'approved' and not ${invoicedLine}`,
        n: sql<number>`count(*)::int`,
      })
      .from(s.waybills)
      .innerJoin(s.parties, eq(s.parties.id, s.waybills.customerId))
      .leftJoin(s.vehicles, eq(s.vehicles.id, s.waybills.vehicleId))
      .leftJoin(carrier, eq(carrier.id, s.waybills.carrierId))
      .leftJoin(s.drivers, eq(s.drivers.id, s.waybills.driverId))
      .leftJoin(s.employees, eq(s.employees.id, s.drivers.employeeId))
      .where(waybillWhere(f, { tab: false }))
      .groupBy(s.waybills.status, sql`2`),
  ]);
  const tabCounts: Record<string, number> = { all: 0, pending_invoice: 0, merged: 0 };
  for (const c of counts) {
    tabCounts.all += c.n;
    tabCounts[c.status] = (tabCounts[c.status] ?? 0) + c.n;
    if (c.pending) tabCounts.pending_invoice += c.n;
    else if (c.status === "approved") tabCounts.merged += c.n;
  }
  return { rows, counts: tabCounts };
}

// ───────────── دمج المحدد وفوترته ─────────────

/**
 * دمج المحدد: يجمع الشحنات المعتمدة غير المفوترة في فاتورة مسودة واحدة لكل عميل وعملة.
 * الشحنات التي لا تصلح (غير معتمدة أو داخلة في فاتورة) تُذكر بأرقامها ولا تمنع الباقي.
 */
export async function invoiceSelectedWaybills(db: Db, ids: number[], opts: { invoiceDate: string; userId?: number }) {
  if (!ids.length) throw new Error("حدد شحنة واحدة على الأقل");
  const rows = await db
    .select({ id: s.waybills.id, number: s.waybills.number, status: s.waybills.status, customerId: s.waybills.customerId, currencyCode: s.waybills.currencyCode, date: s.waybills.waybillDate, invoiced: sql<boolean>`${invoicedLine}` })
    .from(s.waybills)
    .where(inArray(s.waybills.id, ids));
  const skipped: string[] = [];
  const groups = new Map<string, { customerId: number; currencyCode: string; ids: number[] }>();
  for (const r of rows) {
    if (r.status !== "approved") skipped.push(`${r.number}: ${WAYBILL_STATUS[r.status].label}، الفوترة للمعتمدة فقط`);
    else if (r.invoiced) skipped.push(`${r.number}: مدمجة في فاتورة مسبقاً`);
    else if (r.date > opts.invoiceDate) skipped.push(`${r.number}: تاريخها بعد تاريخ الفاتورة`);
    else {
      const key = `${r.customerId}:${r.currencyCode}`;
      const g = groups.get(key) ?? { customerId: r.customerId, currencyCode: r.currencyCode, ids: [] };
      g.ids.push(r.id);
      groups.set(key, g);
    }
  }
  const created: { id: number; number: string; count: number }[] = [];
  for (const g of groups.values()) {
    try {
      const { createInvoice } = await import("@/lib/invoices");
      const inv = await createInvoice(db, { customerId: g.customerId, currencyCode: g.currencyCode, invoiceDate: opts.invoiceDate, waybillIds: g.ids, userId: opts.userId });
      created.push({ id: inv.id, number: inv.number, count: g.ids.length });
    } catch (err) {
      skipped.push(err instanceof Error ? err.message : String(err));
    }
  }
  return { created, skipped };
}

/**
 * فوترة المحدد: تُصدر فاتورة كل شحنة ويُرحّل قيدها. المدمجة تُصدر مسودتها (بكل ما فيها)،
 * وغير المدمجة تأخذ فاتورة مستقلة بتاريخ الفوترة. للفاتورة الواحدة لعدة شحنات: ادمجها أولاً.
 */
export async function invoiceWaybillsNow(db: Db, ids: number[], opts: { invoiceDate: string; userId?: number }) {
  if (!ids.length) throw new Error("حدد شحنة واحدة على الأقل");
  const { createInvoice, issueInvoice } = await import("@/lib/invoices");
  const rows = await db
    .select({
      id: s.waybills.id,
      number: s.waybills.number,
      status: s.waybills.status,
      customerId: s.waybills.customerId,
      currencyCode: s.waybills.currencyCode,
      date: s.waybills.waybillDate,
      invoiceId: sql<number | null>`coalesce("waybills"."source_invoice_id", (select l.invoice_id from sales_invoice_lines l where l.waybill_id = ${WAYBILL_ID} and l.kind = 'waybill' limit 1))`.mapWith(Number),
    })
    .from(s.waybills)
    .where(inArray(s.waybills.id, ids));
  const skipped: string[] = [];
  const invoiceIds = new Set<number>();
  for (const r of rows) {
    if (r.status === "invoiced") skipped.push(`${r.number}: مفوترة مسبقاً`);
    else if (r.status !== "approved") skipped.push(`${r.number}: ${WAYBILL_STATUS[r.status].label}، الفوترة للمعتمدة فقط`);
    else if (r.invoiceId) invoiceIds.add(r.invoiceId);
    else if (r.date > opts.invoiceDate) skipped.push(`${r.number}: تاريخها بعد تاريخ الفاتورة`);
    else {
      try {
        const inv = await createInvoice(db, { customerId: r.customerId, currencyCode: r.currencyCode, invoiceDate: opts.invoiceDate, waybillIds: [r.id], userId: opts.userId });
        invoiceIds.add(inv.id);
      } catch (err) {
        skipped.push(`${r.number}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  const issued: { id: number; number: string }[] = [];
  for (const id of invoiceIds) {
    try {
      issued.push({ id, number: (await issueInvoice(db, id, opts.userId)).invoiceNumber });
    } catch (err) {
      skipped.push(err instanceof Error ? err.message : String(err));
    }
  }
  return { issued, skipped };
}

/**
 * تعديل حقول محددة من الورقة (العميل، المسار، المركبة، السائق، التاريخ…) مع إبقاء الباقي.
 * السعر غير المعدّل يدوياً يُعاد حسابه من العقد، وتغيير المركبة دون السائق يأخذ سائقها المسند.
 */
export async function patchWaybill(db: Db, id: number, patch: Partial<Omit<WaybillInput, "userId">>) {
  const [w] = await db.select().from(s.waybills).where(eq(s.waybills.id, id));
  if (!w) throw new Error("الشحنة غير موجودة");
  const manualPrice = !!w.priceNote && /يدوي/.test(w.priceNote);
  const has = (k: keyof typeof patch) => patch[k] !== undefined;
  const repriced = has("customerId") || has("routeId") || has("vehicleId") || has("waybillDate") || has("carrierId");
  return editWaybill(db, id, {
    waybillDate: patch.waybillDate ?? w.waybillDate,
    customerId: patch.customerId ?? w.customerId,
    routeId: patch.routeId ?? w.routeId,
    shipper: patch.shipper ?? w.shipper,
    consignee: patch.consignee ?? w.consignee,
    vehicleId: has("vehicleId") ? patch.vehicleId : w.vehicleId,
    trailerId: has("trailerId") ? patch.trailerId : w.trailerId,
    driverId: has("driverId") ? patch.driverId : has("vehicleId") ? null : w.driverId,
    carrierId: has("carrierId") ? patch.carrierId : w.carrierId,
    carrierCost: has("carrierCost") ? patch.carrierCost : w.carrierCost != null ? Number(w.carrierCost) : null,
    carrierPlate: has("carrierPlate") ? patch.carrierPlate : w.carrierPlate,
    carrierDriverName: has("carrierDriverName") ? patch.carrierDriverName : w.carrierDriverName,
    amount: has("amount") ? patch.amount : repriced && !manualPrice ? null : Number(w.amount),
    driverCommission: has("driverCommission") ? patch.driverCommission : has("routeId") ? null : Number(w.driverCommission),
    salesRepId: w.salesRepId,
    salesRepCommission: Number(w.salesRepCommission),
    weightTons: has("weightTons") ? patch.weightTons : w.weightTons != null ? Number(w.weightTons) : null,
    containerNumber: has("containerNumber") ? patch.containerNumber : w.containerNumber,
    deliveryAddress: has("deliveryAddress") ? patch.deliveryAddress : w.deliveryAddress,
    notes: has("notes") ? patch.notes : w.notes,
    tripCustody: has("tripCustody") ? patch.tripCustody : Number(w.tripCustody),
  });
}

// ───────────── رحلة الفاتورة المباشرة ─────────────

export interface InvoiceTripInput {
  routeId: number;
  vehicleId: number;
  driverId?: number | null;
  shipper: string;
  consignee: string;
  tripCustody?: number | null;
}

/**
 * الفاتورة المباشرة التي ينفذها سائق من الأسطول: تُنشأ لها شحنة مرتبطة (رحلة) تظهر للسائق عند الإرسال.
 * إيرادها في الفاتورة نفسها، فلا تدخل «بانتظار الفوترة» ولا الاستحقاق الشهري. null = بلا رحلة.
 */
export async function syncInvoiceTripTx(
  tx: Tx,
  inv: { id: number; number: string; invoiceDate: string; customerId: number; currencyCode: string; subtotal: string; userId?: number },
  trip: InvoiceTripInput | null,
) {
  const [existing] = await tx.select().from(s.waybills).where(eq(s.waybills.sourceInvoiceId, inv.id)).for("update");
  if (!trip) {
    if (!existing) return null;
    if (existing.sentToDriverAt) throw new Error(`رحلة الفاتورة (${existing.number}) مرسلة للسائق؛ ألغِ الإرسال أولاً`);
    if (!EDITABLE.includes(existing.status) || existing.status === "rejected") throw new Error(`رحلة الفاتورة ${existing.number} ${WAYBILL_STATUS[existing.status].label}؛ أرجعها أولاً`);
    await tx.insert(s.deletionLog).values({ entity: "waybill", entityId: String(existing.id), snapshot: { waybill: existing }, reason: `حُذفت رحلة الفاتورة ${inv.number}`, userId: inv.userId });
    await tx.delete(s.waybills).where(eq(s.waybills.id, existing.id));
    return null;
  }
  const values = await resolveWaybill(tx, {
    waybillDate: inv.invoiceDate,
    customerId: inv.customerId,
    routeId: trip.routeId,
    vehicleId: trip.vehicleId,
    driverId: trip.driverId ?? null,
    shipper: trip.shipper,
    consignee: trip.consignee,
    amount: num(inv.subtotal),
    tripCustody: trip.tripCustody ?? 0,
    notes: `رحلة الفاتورة ${inv.number}`,
  });
  const row = { ...values, currencyCode: inv.currencyCode, priceNote: `من الفاتورة ${inv.number}`, sourceInvoiceId: inv.id };
  if (existing) {
    if (!EDITABLE.includes(existing.status)) {
      // رحلة منتهية (معتمدة): تتغير فواتيرها وأسعارها، أما بيانات الرحلة فبعد إرجاعها
      const same =
        existing.routeId === row.routeId && existing.vehicleId === row.vehicleId && existing.driverId === row.driverId && existing.shipper === row.shipper && existing.consignee === row.consignee && num(existing.tripCustody) === num(row.tripCustody);
      if (!same) throw new Error(`رحلة الفاتورة ${existing.number} ${WAYBILL_STATUS[existing.status].label}؛ أرجعها لمسودة لتعديل بياناتها`);
      const [u] = await tx.update(s.waybills).set({ amount: row.amount, updatedAt: new Date() }).where(eq(s.waybills.id, existing.id)).returning();
      return u;
    }
    assertSentLocks(existing, row);
    const [u] = await tx.update(s.waybills).set({ ...row, updatedAt: new Date() }).where(eq(s.waybills.id, existing.id)).returning();
    return u;
  }
  const number = await nextDocumentNumber(tx, "waybill", "WB", Number(inv.invoiceDate.slice(0, 4)));
  const [created] = await tx.insert(s.waybills).values({ ...row, number, createdBy: inv.userId }).returning();
  return created;
}
