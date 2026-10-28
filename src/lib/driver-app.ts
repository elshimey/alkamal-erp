import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db, Tx } from "@/db";
import * as s from "@/db/schema";
import { createWaybill, recordStage } from "@/lib/waybills";
import { createExpense, vehicleCostCenter } from "@/lib/purchases";
import { createBreakdownRequest } from "@/lib/maintenance";
import { hashPassword, MIN_PASSWORD_LENGTH } from "@/lib/password";
import { DRIVER_EXPENSE_ACCOUNTS, type DriverExpenseType, type DriverLang } from "@/data/driver-i18n";

// تطبيق السائق: كل عملية هنا مقيّدة بسائق الحساب نفسه، ولا يرى الأسعار.

export type TripStage = (typeof s.tripStageType.enumValues)[number];
type WaybillStatus = (typeof s.waybillStatus.enumValues)[number];

// مراحل السائق نفسه على الرحلة (لا ما سجّله المكتب)
const OWN_STAGE = sql.raw(`ts.waybill_id = "waybills"."id" and ts.created_by = (select dr.user_id from drivers dr where dr.id = "waybills"."driver_id")`);

/**
 * حالة الرحلة كما يراها السائق: من مراحله هو لا من حالة المستند في المكتب.
 * اعتماد المكتب مراجعة قبل الفوترة؛ لا تُغلق الرحلة عند السائق حتى يسجّل التسليم.
 */
export function driverStatus(status: WaybillStatus, stages: TripStage[]): WaybillStatus {
  if (status === "rejected") return "rejected";
  if (stages.includes("delivery")) return status === "approved" || status === "invoiced" ? status : "delivered";
  return stages.length ? "in_transit" : "draft";
}

export interface DriverProfile {
  id: number;
  name: string;
  appLanguage: DriverLang;
  custodyAccountId: number;
  payableAccountId: number | null;
  vehicle: { id: number; plate: string } | null;
}

export async function driverForUser(db: Db | Tx, userId: number): Promise<DriverProfile | null> {
  const [d] = await db
    .select({
      id: s.drivers.id,
      name: s.employees.nameAr,
      appLanguage: s.drivers.appLanguage,
      custodyAccountId: s.drivers.custodyAccountId,
      payableAccountId: s.employees.payableAccountId,
      vehicleId: s.vehicles.id,
      plate: s.vehicles.plate,
    })
    .from(s.drivers)
    .innerJoin(s.employees, eq(s.employees.id, s.drivers.employeeId))
    .leftJoin(s.vehicleAssignments, and(eq(s.vehicleAssignments.driverId, s.drivers.id), isNull(s.vehicleAssignments.toDate)))
    .leftJoin(s.vehicles, eq(s.vehicles.id, s.vehicleAssignments.vehicleId))
    .where(eq(s.drivers.userId, userId));
  if (!d) return null;
  const { vehicleId, plate, ...rest } = d;
  return { ...rest, vehicle: vehicleId ? { id: vehicleId, plate: plate! } : null };
}

/** رحلات السائق دون الأسعار، مع آخر مرحلة. */
export async function driverTrips(db: Db | Tx, driverId: number, opts: { open: boolean; limit?: number }) {
  const from = alias(s.locations, "from_loc");
  const to = alias(s.locations, "to_loc");
  const rows = await db
    .select({
      id: s.waybills.id,
      number: s.waybills.number,
      date: s.waybills.waybillDate,
      status: s.waybills.status,
      customer: s.parties.nameAr,
      from: from.nameAr,
      to: to.nameAr,
      isInternational: s.waybills.isInternational,
      lastStage: sql<TripStage | null>`(select stage from trip_stages ts where ${OWN_STAGE} order by ts.at desc, ts.id desc limit 1)`,
      delivered: sql<boolean>`exists (select 1 from trip_stages ts where ${OWN_STAGE} and ts.stage = 'delivery')`,
      sentToDriverAt: s.waybills.sentToDriverAt,
      driverAcceptedAt: s.waybills.driverAcceptedAt,
    })
    .from(s.waybills)
    .innerJoin(s.parties, eq(s.parties.id, s.waybills.customerId))
    .innerJoin(s.routes, eq(s.routes.id, s.waybills.routeId))
    .innerJoin(from, eq(from.id, s.routes.fromLocationId))
    .innerJoin(to, eq(to.id, s.routes.toLocationId))
    .where(
      and(
        eq(s.waybills.driverId, driverId),
        // تظهر للسائق الرحلة التي أرسلها له المكتب (أو رحلة بدأها هو من قبل)
        // مراحل سجّلها المكتب بتغيير الحالة لا تُظهر الرحلة للسائق؛ يراها فقط إن أرسلها المسؤول أو بدأها السائق بنفسه
        or(
          isNotNull(s.waybills.sentToDriverAt),
          sql`exists (select 1 from trip_stages ts join drivers dr on dr.user_id = ts.created_by where ts.waybill_id = ${s.waybills.id} and dr.id = ${s.waybills.driverId})`,
        ),
        // المعتمدة تبقى مفتوحة عند السائق حتى يسجّل التسليم بنفسه
        opts.open
          ? sql`(${s.waybills.status} in ('draft','in_transit','delivered','rejected') or not exists (select 1 from trip_stages ts where ${OWN_STAGE} and ts.stage = 'delivery'))`
          : sql`(${s.waybills.status} in ('approved','invoiced') and exists (select 1 from trip_stages ts where ${OWN_STAGE} and ts.stage = 'delivery'))`,
      ),
    )
    .orderBy(desc(s.waybills.waybillDate), desc(s.waybills.id))
    .limit(opts.limit ?? 50);
  return rows.map(({ delivered, ...r }) => ({
    ...r,
    status: driverStatus(r.status, [...(r.lastStage ? [r.lastStage] : []), ...(delivered ? (["delivery"] as TripStage[]) : [])]),
  }));
}

export async function ownTrip(db: Db | Tx, driverId: number, waybillId: number) {
  const [w] = await db.select().from(s.waybills).where(and(eq(s.waybills.id, waybillId), eq(s.waybills.driverId, driverId)));
  if (!w) throw new Error("هذه الرحلة ليست لك");
  return w;
}

/** تفاصيل الرحلة للسائق: المراحل والديزل والمصاريف، بلا مبالغ الإيراد أو العمولة. */
export async function tripDetail(db: Db | Tx, driverId: number, waybillId: number) {
  const w = await ownTrip(db, driverId, waybillId);
  const [trip] = await driverTripsById(db, waybillId);
  const [stages, fuel, expenses] = await Promise.all([
    // السائق يرى مراحله هو؛ ما سجّله المكتب يبقى في المكتب
    db
      .select()
      .from(s.tripStages)
      .where(and(eq(s.tripStages.waybillId, waybillId), w.driverId ? sql`${s.tripStages.createdBy} = (select user_id from drivers where id = ${w.driverId})` : sql`false`))
      .orderBy(s.tripStages.at, s.tripStages.id),
    db.select().from(s.waybillFuel).where(eq(s.waybillFuel.waybillId, waybillId)).orderBy(s.waybillFuel.id),
    db
      .select({ e: s.waybillExpenses, type: s.chargeTypes.nameAr })
      .from(s.waybillExpenses)
      .innerJoin(s.chargeTypes, eq(s.chargeTypes.id, s.waybillExpenses.chargeTypeId))
      .where(eq(s.waybillExpenses.waybillId, waybillId))
      .orderBy(s.waybillExpenses.id),
  ]);
  const done = stages.map((x) => x.stage);
  return {
    trip: { ...trip, status: driverStatus(w.status, done), shipper: w.shipper, consignee: w.consignee, containerNumber: w.containerNumber, weightTons: w.weightTons, rejectionReason: w.rejectionReason, sentToDriverAt: w.sentToDriverAt, driverAcceptedAt: w.driverAcceptedAt, logistiNumber: w.logistiNumber, tripCustody: w.tripCustody },
    stages,
    fuel,
    expenses,
    next: nextStages(w, done),
    editable: w.status !== "rejected" && !done.includes("delivery"),
  };
}

async function driverTripsById(db: Db | Tx, waybillId: number) {
  const from = alias(s.locations, "from_loc");
  const to = alias(s.locations, "to_loc");
  return db
    .select({
      id: s.waybills.id,
      number: s.waybills.number,
      date: s.waybills.waybillDate,
      status: s.waybills.status,
      customer: s.parties.nameAr,
      from: from.nameAr,
      to: to.nameAr,
      isInternational: s.waybills.isInternational,
      currencyCode: s.waybills.currencyCode,
    })
    .from(s.waybills)
    .innerJoin(s.parties, eq(s.parties.id, s.waybills.customerId))
    .innerJoin(s.routes, eq(s.routes.id, s.waybills.routeId))
    .innerJoin(from, eq(from.id, s.routes.fromLocationId))
    .innerJoin(to, eq(to.id, s.routes.toLocationId))
    .where(eq(s.waybills.id, waybillId));
}

/**
 * ما يضغطه السائق الآن: «تم التحميل» ثم «تم التسليم» فقط (زران كبيران بلا كتابة)، من مراحله هو.
 * التحميل يجعل الشحنة «في الطريق» والتسليم يجعلها «مُسلَّمة» تلقائياً.
 * تبقى متاحة مهما غيّر المكتب الحالة، حتى لو اعتمدها (الاعتماد مراجعة لا إغلاق)، إلا إن رُفضت للتصحيح.
 */
export function nextStages(w: { status: string }, done: TripStage[]): TripStage[] {
  if (w.status === "rejected" || done.includes("delivery")) return [];
  return done.includes("loading") ? ["delivery"] : ["loading"];
}

/** التراجع عن آخر مرحلة ضغطها السائق بالخطأ. صورها تبقى محفوظة. */
export async function undoDriverStage(db: Db, driverId: number, waybillId: number, userId?: number) {
  return db.transaction(async (tx) => {
    const [w] = await tx.select().from(s.waybills).where(and(eq(s.waybills.id, waybillId), eq(s.waybills.driverId, driverId))).for("update");
    if (!w) throw new Error("هذه الرحلة ليست لك");
    const stages = await tx.select().from(s.tripStages).where(eq(s.tripStages.waybillId, waybillId)).orderBy(desc(s.tripStages.at), desc(s.tripStages.id));
    const last = stages[0];
    if (!last) throw new Error("لا توجد مرحلة للتراجع عنها");
    // ما سجّله المكتب بتغيير الحالة لا يتراجع عنه السائق
    if (userId && last.createdBy !== userId) throw new Error("آخر مرحلة سجّلها المكتب؛ لا يمكنك التراجع عنها");
    await tx.delete(s.tripStages).where(eq(s.tripStages.id, last.id));
    const rest = stages.slice(1).map((x) => x.stage);
    // التسليم الذي سجّله المكتب يدوياً لا يلغيه تراجع السائق عن التحميل
    const status = rest.includes("delivery") || (w.status === "delivered" && last.stage !== "delivery") ? "delivered" : rest.length ? "in_transit" : "draft";
    // المعتمدة والمرفوضة تبقى على حالتها؛ التراجع يخص مراحل الرحلة فقط
    const set: Partial<typeof s.waybills.$inferInsert> = { updatedAt: new Date() };
    if (["draft", "in_transit", "delivered"].includes(w.status)) set.status = status;
    if (last.stage === "delivery") set.odometerEnd = null;
    if (last.stage === "loading" && !rest.includes("loading")) set.odometerStart = null;
    await tx.update(s.waybills).set(set).where(eq(s.waybills.id, waybillId));
    return last.stage;
  });
}

/** السائق يؤكد استلام الرحلة التي أرسلها له المكتب. */
export async function acceptTrip(db: Db, driverId: number, waybillId: number) {
  const w = await ownTrip(db, driverId, waybillId);
  if (!w.driverAcceptedAt) await db.update(s.waybills).set({ driverAcceptedAt: new Date() }).where(eq(s.waybills.id, waybillId));
}

export async function startTrip(
  db: Db,
  driver: DriverProfile,
  input: { date: string; customerId: number; routeId: number; shipper: string; consignee: string; containerNumber?: string | null; weightTons?: number | null; odometer?: number | null; notes?: string | null; userId?: number },
) {
  if (!driver.vehicle) throw new Error("لا توجد مركبة مسندة لك");
  if (!input.shipper.trim() || !input.consignee.trim()) throw new Error("المرسل والمستلم إلزاميان");
  const w = await createWaybill(db, {
    waybillDate: input.date,
    customerId: input.customerId,
    routeId: input.routeId,
    shipper: input.shipper,
    consignee: input.consignee,
    vehicleId: driver.vehicle.id,
    driverId: driver.id,
    containerNumber: input.containerNumber,
    weightTons: input.weightTons,
    notes: input.notes,
    userId: input.userId,
  });
  await recordStage(db, w.id, "loading", { odometer: input.odometer ?? null, userId: input.userId });
  return w;
}

export async function recordDriverStage(db: Db, driverId: number, waybillId: number, stage: TripStage, opts: { odometer?: number | null; note?: string | null; userId?: number }) {
  const { next, trip } = await tripDetail(db, driverId, waybillId);
  if (!next.includes(stage)) throw new Error("هذه المرحلة غير متاحة الآن");
  // التحميل يعني أنه استلم الرحلة حتى لو لم يضغط «استلمت»
  if (!trip.driverAcceptedAt) await db.update(s.waybills).set({ driverAcceptedAt: new Date() }).where(eq(s.waybills.id, waybillId));
  await recordStage(db, waybillId, stage, opts);
}

// ما يكتبه البرنامج بياناً لمصروف السائق (السائق لا يكتب بياناً)
const KIND_AR: Record<DriverExpenseType, string> = { diesel: "ديزل", maintenance: "صيانة", road: "مصاريف طريق ورسوم", tires: "إطارات", other: "مصروف آخر" };

export interface DriverExpenseInput {
  kind: DriverExpenseType;
  amount: number;
  reportedPayer: "custody" | "company";
  waybillId?: number | null;
  maintenanceTypeId?: number | null;
  date: string;
  userId?: number;
}

async function resolveDriverExpense(db: Db | Tx, driver: DriverProfile, input: DriverExpenseInput) {
  const code = DRIVER_EXPENSE_ACCOUNTS[input.kind];
  if (!code) throw new Error("اختر نوع المصروف");
  if (!(input.amount > 0)) throw new Error("المبلغ إلزامي");
  const trip = input.waybillId ? await ownTrip(db, driver.id, input.waybillId) : null;
  let maintenance: { id: number; nameAr: string } | null = null;
  if (input.kind === "maintenance") {
    if (!input.maintenanceTypeId) throw new Error("اختر نوع الصيانة");
    [maintenance] = await db.select({ id: s.maintenanceTypes.id, nameAr: s.maintenanceTypes.nameAr }).from(s.maintenanceTypes).where(eq(s.maintenanceTypes.id, input.maintenanceTypeId));
    if (!maintenance) throw new Error("نوع الصيانة غير موجود");
  }
  const [account] = await db.select({ id: s.accounts.id }).from(s.accounts).where(eq(s.accounts.code, code));
  if (!account) throw new Error(`الحساب ${code} غير موجود في الدليل`);
  return {
    accountId: account.id,
    vehicleId: trip?.vehicleId ?? driver.vehicle?.id ?? null,
    waybillId: trip?.id ?? null,
    maintenanceTypeId: maintenance?.id ?? null,
    description: [KIND_AR[input.kind], maintenance?.nameAr, trip ? `رحلة ${trip.number}` : null].filter(Boolean).join(" · "),
  };
}

/**
 * مصروف من تطبيق السائق: النوع والمبلغ الإجمالي والصورة ومن دفع، عاماً أو لرحلة.
 * يبقى بانتظار اعتماد المكتب بلا قيد؛ والمعتمد يحدد الدافع الفعلي والحساب ويفصل الضريبة.
 */
export async function createDriverExpense(db: Db, driver: DriverProfile, input: DriverExpenseInput) {
  const r = await resolveDriverExpense(db, driver, input);
  return createExpense(db, {
    expenseDate: input.date,
    payer: "driver_custody",
    driverId: driver.id,
    accountId: r.accountId,
    vehicleId: r.vehicleId,
    waybillId: r.waybillId,
    description: r.description,
    amount: input.amount,
    driverKind: input.kind,
    reportedPayer: input.reportedPayer,
    maintenanceTypeId: r.maintenanceTypeId,
    userId: input.userId,
  });
}

async function lockDriverExpense(tx: Tx, driverId: number, id: number) {
  const [e] = await tx.select().from(s.expenses).where(and(eq(s.expenses.id, id), eq(s.expenses.driverId, driverId))).for("update");
  if (!e || !e.driverKind) throw new Error("المصروف غير موجود");
  if (e.status !== "pending") throw new Error("لا يُعدّل إلا ما ينتظر الاعتماد");
  return e;
}

/** تعديل مصروف ما زال بانتظار الاعتماد (الصورة الجديدة تُضاف ولا تُحذف القديمة). */
export async function updateDriverExpense(db: Db, driver: DriverProfile, id: number, input: DriverExpenseInput) {
  return db.transaction(async (tx) => {
    await lockDriverExpense(tx, driver.id, id);
    const r = await resolveDriverExpense(tx, driver, input);
    await tx
      .update(s.expenses)
      .set({
        accountId: r.accountId,
        vehicleId: r.vehicleId,
        costCenterId: await vehicleCostCenter(tx, r.vehicleId),
        waybillId: r.waybillId,
        description: r.description,
        amount: String(Math.round(input.amount * 100) / 100),
        vatAmount: "0",
        driverKind: input.kind,
        reportedPayer: input.reportedPayer,
        maintenanceTypeId: r.maintenanceTypeId,
      })
      .where(eq(s.expenses.id, id));
  });
}

/** «رُفع بالخطأ»: لا يُحذف ما رفعه السائق، بل يُلغى ويبقى ظاهراً كملغى. */
export async function voidDriverExpense(db: Db, driverId: number, id: number, reason?: string | null) {
  return db.transaction(async (tx) => {
    await lockDriverExpense(tx, driverId, id);
    await tx.update(s.expenses).set({ status: "voided", voidReason: reason?.trim() || "رُفع بالخطأ" }).where(eq(s.expenses.id, id));
  });
}

export async function driverExpenses(db: Db | Tx, driverId: number, waybillId?: number) {
  return db
    .select({ e: s.expenses, code: s.accounts.code, maintenance: s.maintenanceTypes.nameAr, maintenanceEn: s.maintenanceTypes.nameEn, trip: s.waybills.number })
    .from(s.expenses)
    .innerJoin(s.accounts, eq(s.accounts.id, s.expenses.accountId))
    .leftJoin(s.maintenanceTypes, eq(s.maintenanceTypes.id, s.expenses.maintenanceTypeId))
    .leftJoin(s.waybills, eq(s.waybills.id, s.expenses.waybillId))
    .where(and(eq(s.expenses.driverId, driverId), waybillId ? eq(s.expenses.waybillId, waybillId) : undefined))
    .orderBy(desc(s.expenses.expenseDate), desc(s.expenses.id))
    .limit(50);
}

export async function maintenanceTypeOptions(db: Db | Tx, opts: { all?: boolean } = {}) {
  return db
    .select()
    .from(s.maintenanceTypes)
    .where(opts.all ? undefined : eq(s.maintenanceTypes.isActive, true))
    .orderBy(s.maintenanceTypes.sortOrder, s.maintenanceTypes.id);
}

/**
 * عهدة كل رحلة أُرسلت للسائق: المبلغ، وما اعتُمد من مصاريفها على عهدته، وما ينتظر الاعتماد، والمتبقي.
 * ما دفعته الشركة لا يُخصم من العهدة، والمتبقي قد يكون سالباً.
 */
export async function tripCustodySummary(db: Db | Tx, driverId: number, waybillIds?: number[]) {
  if (waybillIds && !waybillIds.length) return [];
  const rows = await db
    .select({
      id: s.waybills.id,
      number: s.waybills.number,
      status: s.waybills.status,
      custody: s.waybills.tripCustody,
      approved: sql<string>`coalesce((select sum(e.amount + e.vat_amount) from expenses e where e.waybill_id = "waybills"."id" and e.status = 'approved' and e.payer = 'driver_custody'), 0)`,
      pending: sql<string>`coalesce((select sum(e.amount + e.vat_amount) from expenses e where e.waybill_id = "waybills"."id" and e.status = 'pending' and coalesce(e.reported_payer, 'custody') <> 'company'), 0)`,
    })
    .from(s.waybills)
    .where(
      and(
        eq(s.waybills.driverId, driverId),
        waybillIds ? inArray(s.waybills.id, waybillIds) : and(isNotNull(s.waybills.sentToDriverAt), sql`${s.waybills.tripCustody} > 0`),
      ),
    )
    .orderBy(desc(s.waybills.waybillDate), desc(s.waybills.id))
    .limit(waybillIds ? 100 : 30);
  return rows.map((r) => {
    const custody = Number(r.custody);
    const approved = Number(r.approved);
    const pending = Number(r.pending);
    return { id: r.id, number: r.number, status: r.status, custody, approved, pending, remaining: Math.round((custody - approved - pending) * 100) / 100 };
  });
}

export async function reportBreakdown(
  db: Db,
  driver: DriverProfile,
  input: { date: string; description?: string | null; maintenanceTypeId?: number | null; priority: "low" | "normal" | "urgent"; userId?: number },
) {
  if (!driver.vehicle) throw new Error("لا توجد مركبة مسندة لك");
  let type: string | null = null;
  if (input.maintenanceTypeId) {
    const [m] = await db.select({ nameAr: s.maintenanceTypes.nameAr }).from(s.maintenanceTypes).where(eq(s.maintenanceTypes.id, input.maintenanceTypeId));
    if (!m) throw new Error("نوع الصيانة غير موجود");
    type = m.nameAr;
  }
  const description = [type, input.description?.trim()].filter(Boolean).join(" – ");
  return createBreakdownRequest(db, {
    vehicleId: driver.vehicle.id,
    driverId: driver.id,
    reportDate: input.date,
    description,
    priority: input.priority,
    maintenanceTypeId: input.maintenanceTypeId ?? null,
    userId: input.userId,
  });
}

export async function driverBreakdowns(db: Db | Tx, driverId: number) {
  return db
    .select({ r: s.breakdownRequests, plate: s.vehicles.plate })
    .from(s.breakdownRequests)
    .innerJoin(s.vehicles, eq(s.vehicles.id, s.breakdownRequests.vehicleId))
    .where(eq(s.breakdownRequests.driverId, driverId))
    .orderBy(desc(s.breakdownRequests.id))
    .limit(30);
}

const balanceOf = async (db: Db | Tx, accountId: number | null) => {
  if (!accountId) return 0;
  const [r] = await db
    .select({ v: sql<string>`coalesce(sum(${s.journalLines.debitBase} - ${s.journalLines.creditBase}), 0)` })
    .from(s.journalLines)
    .innerJoin(s.journalEntries, eq(s.journalEntries.id, s.journalLines.entryId))
    .where(and(eq(s.journalLines.accountId, accountId), eq(s.journalEntries.status, "posted")));
  return Number(r.v);
};

/** العهدة (موجب = عنده للشركة)، والمستحق له (رواتب وعمولات)، وعمولات الشهر، والمصاريف المعلّقة. */
export async function driverBalances(db: Db | Tx, driver: DriverProfile, today: string) {
  const monthStart = `${today.slice(0, 7)}-01`;
  const [custody, payable, [commission], [pending], movements] = await Promise.all([
    balanceOf(db, driver.custodyAccountId),
    balanceOf(db, driver.payableAccountId),
    db
      .select({ v: sql<string>`coalesce(sum(${s.waybills.driverCommission}), 0)` })
      .from(s.waybills)
      .where(and(eq(s.waybills.driverId, driver.id), inArray(s.waybills.status, ["approved", "invoiced"]), gte(s.waybills.waybillDate, monthStart), lte(s.waybills.waybillDate, today))),
    db
      .select({ v: sql<string>`coalesce(sum(${s.expenses.amount} + ${s.expenses.vatAmount}), 0)`, n: sql<number>`count(*)::int` })
      .from(s.expenses)
      .where(and(eq(s.expenses.driverId, driver.id), eq(s.expenses.status, "pending"), sql`coalesce(${s.expenses.reportedPayer}, 'custody') <> 'company'`)),
    db
      .select({ date: s.journalEntries.entryDate, description: sql<string>`coalesce(${s.journalLines.description}, ${s.journalEntries.description})`, debit: s.journalLines.debitBase, credit: s.journalLines.creditBase })
      .from(s.journalLines)
      .innerJoin(s.journalEntries, eq(s.journalEntries.id, s.journalLines.entryId))
      .where(and(eq(s.journalLines.accountId, driver.custodyAccountId), eq(s.journalEntries.status, "posted")))
      .orderBy(desc(s.journalEntries.entryDate), desc(s.journalLines.id))
      .limit(15),
  ]);
  return {
    custody,
    payable: -payable,
    monthCommission: Number(commission.v),
    pendingExpenses: Number(pending.v),
    pendingCount: pending.n,
    movements: movements.map((m) => ({ ...m, debit: Number(m.debit), credit: Number(m.credit) })),
  };
}

export async function setDriverLanguage(db: Db, driverId: number, lang: DriverLang) {
  await db.update(s.drivers).set({ appLanguage: lang, updatedAt: new Date() }).where(eq(s.drivers.id, driverId));
}

/** ينشئ حساب دخول بدور «السائق» ويربطه بالسائق. */
export async function createDriverLogin(db: Db | Tx, input: { driverId: number; login: string; password: string }) {
  const login = input.login.trim();
  if (login.length < 3) throw new Error("اسم الدخول إلزامي (الجوال مثلاً)");
  if (input.password.length < MIN_PASSWORD_LENGTH) throw new Error(`كلمة المرور ${MIN_PASSWORD_LENGTH} أحرف على الأقل`);
  return db.transaction(async (tx) => {
    const [d] = await tx
      .select({ id: s.drivers.id, userId: s.drivers.userId, name: s.employees.nameAr })
      .from(s.drivers)
      .innerJoin(s.employees, eq(s.employees.id, s.drivers.employeeId))
      .where(eq(s.drivers.id, input.driverId))
      .for("update");
    if (!d) throw new Error("السائق غير موجود");
    if (d.userId) throw new Error(`${d.name} لديه حساب دخول مسبقاً`);
    const [taken] = await tx.select({ id: s.users.id }).from(s.users).where(eq(s.users.login, login));
    if (taken) throw new Error("اسم الدخول مستخدم؛ اختر غيره");
    const [role] = await tx.select({ id: s.roles.id }).from(s.roles).where(eq(s.roles.key, "driver"));
    if (!role) throw new Error("دور السائق غير موجود");
    const [user] = await tx.insert(s.users).values({ name: d.name, login, passwordHash: await hashPassword(input.password) }).returning({ id: s.users.id });
    await tx.insert(s.userRoles).values({ userId: user.id, roleId: role.id });
    await tx.update(s.drivers).set({ userId: user.id, updatedAt: new Date() }).where(eq(s.drivers.id, d.id));
    return user;
  });
}

/** كلمة مرور جديدة لحساب السائق، وتُغلق جلساته المفتوحة. */
export async function resetDriverPassword(db: Db, driverId: number, password: string) {
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`كلمة المرور ${MIN_PASSWORD_LENGTH} أحرف على الأقل`);
  const [d] = await db.select({ userId: s.drivers.userId }).from(s.drivers).where(eq(s.drivers.id, driverId));
  if (!d?.userId) throw new Error("السائق ليس له حساب دخول");
  await db.update(s.users).set({ passwordHash: await hashPassword(password), isActive: true, updatedAt: new Date() }).where(eq(s.users.id, d.userId));
  await db.delete(s.sessions).where(eq(s.sessions.userId, d.userId));
}

/** يفك ربط حساب الدخول عن السائق ويحذفه (أو يوقفه إن كانت له سجلات). */
export async function removeDriverLogin(db: Db, driverId: number) {
  return db.transaction(async (tx) => {
    const [d] = await tx.select({ userId: s.drivers.userId }).from(s.drivers).where(eq(s.drivers.id, driverId)).for("update");
    if (!d?.userId) throw new Error("السائق ليس له حساب دخول");
    const userId = d.userId;
    await tx.update(s.drivers).set({ userId: null, updatedAt: new Date() }).where(eq(s.drivers.id, driverId));
    await tx.delete(s.sessions).where(eq(s.sessions.userId, userId));
    await tx.transaction((sp) => sp.delete(s.users).where(eq(s.users.id, userId))).catch(() =>
      tx.update(s.users).set({ isActive: false, updatedAt: new Date() }).where(eq(s.users.id, userId)),
    );
  });
}

/** يربط حساب مستخدم موجود بسائق (لمن أُنشئ حسابه من شاشة المستخدمين). */
export async function linkUserToDriver(db: Db | Tx, userId: number, driverId: number) {
  const [d] = await db.select({ userId: s.drivers.userId }).from(s.drivers).where(eq(s.drivers.id, driverId));
  if (!d) throw new Error("السائق غير موجود");
  if (d.userId && d.userId !== userId) throw new Error("هذا السائق مربوط بحساب دخول آخر");
  await db.update(s.drivers).set({ userId: null }).where(and(eq(s.drivers.userId, userId), sql`${s.drivers.id} <> ${driverId}`));
  await db.update(s.drivers).set({ userId, updatedAt: new Date() }).where(eq(s.drivers.id, driverId));
}

/** المستخدم الذي كل أدواره «سائق» يذهب لتطبيق السائق لا للوحة المكتب. */
export const isDriverOnly = (roles: { key: string | null }[]) => roles.length > 0 && roles.every((r) => r.key === "driver");
