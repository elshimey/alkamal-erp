import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db, Tx } from "@/db";
import * as s from "@/db/schema";
import { createWaybill, recordStage } from "@/lib/waybills";
import { createExpense } from "@/lib/purchases";
import { createBreakdownRequest } from "@/lib/maintenance";
import { hashPassword, MIN_PASSWORD_LENGTH } from "@/lib/password";
import { DRIVER_EXPENSE_ACCOUNTS, type DriverExpenseType, type DriverLang } from "@/data/driver-i18n";

// تطبيق السائق: كل عملية هنا مقيّدة بسائق الحساب نفسه، ولا يرى الأسعار.

export type TripStage = (typeof s.tripStageType.enumValues)[number];
const STAGE_ORDER: TripStage[] = ["loading", "in_transit", "border", "delivery"];
const OPEN: (typeof s.waybillStatus.enumValues)[number][] = ["draft", "in_transit", "delivered", "rejected"];

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
      lastStage: sql<TripStage | null>`(select stage from trip_stages ts where ts.waybill_id = ${s.waybills.id} order by ts.at desc, ts.id desc limit 1)`,
    })
    .from(s.waybills)
    .innerJoin(s.parties, eq(s.parties.id, s.waybills.customerId))
    .innerJoin(s.routes, eq(s.routes.id, s.waybills.routeId))
    .innerJoin(from, eq(from.id, s.routes.fromLocationId))
    .innerJoin(to, eq(to.id, s.routes.toLocationId))
    .where(
      and(
        eq(s.waybills.driverId, driverId),
        opts.open ? inArray(s.waybills.status, OPEN) : sql`${s.waybills.status} not in ('draft','in_transit','delivered','rejected')`,
      ),
    )
    .orderBy(desc(s.waybills.waybillDate), desc(s.waybills.id))
    .limit(opts.limit ?? 50);
  return rows;
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
    db.select().from(s.tripStages).where(eq(s.tripStages.waybillId, waybillId)).orderBy(s.tripStages.at, s.tripStages.id),
    db.select().from(s.waybillFuel).where(eq(s.waybillFuel.waybillId, waybillId)).orderBy(s.waybillFuel.id),
    db
      .select({ e: s.waybillExpenses, type: s.chargeTypes.nameAr })
      .from(s.waybillExpenses)
      .innerJoin(s.chargeTypes, eq(s.chargeTypes.id, s.waybillExpenses.chargeTypeId))
      .where(eq(s.waybillExpenses.waybillId, waybillId))
      .orderBy(s.waybillExpenses.id),
  ]);
  return {
    trip: { ...trip, shipper: w.shipper, consignee: w.consignee, containerNumber: w.containerNumber, weightTons: w.weightTons, rejectionReason: w.rejectionReason },
    stages,
    fuel,
    expenses,
    next: nextStages(w, stages.map((x) => x.stage)),
    editable: OPEN.includes(w.status),
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

/** المراحل المتاحة الآن: لا تسجيل بعد التسليم، والحدود للرحلات الدولية فقط. */
export function nextStages(w: { status: string; isInternational: boolean }, done: TripStage[]): TripStage[] {
  if (!["draft", "in_transit"].includes(w.status) || done.includes("delivery")) return [];
  if (!done.includes("loading")) return ["loading"];
  const last = Math.max(...done.map((x) => STAGE_ORDER.indexOf(x)));
  return STAGE_ORDER.filter((x, i) => i > last && x !== "loading" && (x !== "border" || w.isInternational));
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
  const { next } = await tripDetail(db, driverId, waybillId);
  if (!next.includes(stage)) throw new Error("هذه المرحلة غير متاحة الآن");
  await recordStage(db, waybillId, stage, opts);
}

export async function createDriverExpense(
  db: Db,
  driver: DriverProfile,
  input: { date: string; type: DriverExpenseType; description: string; amount: number; vatAmount?: number; vendorName?: string | null; reference?: string | null; userId?: number },
) {
  const code = DRIVER_EXPENSE_ACCOUNTS[input.type];
  if (!code) throw new Error("نوع المصروف غير معروف");
  const [account] = await db.select({ id: s.accounts.id }).from(s.accounts).where(eq(s.accounts.code, code));
  // المصروف يبقى بانتظار اعتماد المكتب، ولا قيد قبل ذلك
  return createExpense(db, {
    expenseDate: input.date,
    payer: "driver_custody",
    driverId: driver.id,
    accountId: account.id,
    vehicleId: driver.vehicle?.id ?? null,
    description: input.description,
    amount: input.amount,
    vatAmount: input.vatAmount ?? 0,
    vendorName: input.vendorName,
    reference: input.reference,
    userId: input.userId,
  });
}

export async function driverExpenses(db: Db | Tx, driverId: number) {
  return db
    .select({ e: s.expenses, code: s.accounts.code })
    .from(s.expenses)
    .innerJoin(s.accounts, eq(s.accounts.id, s.expenses.accountId))
    .where(eq(s.expenses.driverId, driverId))
    .orderBy(desc(s.expenses.expenseDate), desc(s.expenses.id))
    .limit(50);
}

export async function reportBreakdown(db: Db, driver: DriverProfile, input: { date: string; description: string; priority: "low" | "normal" | "urgent"; userId?: number }) {
  if (!driver.vehicle) throw new Error("لا توجد مركبة مسندة لك");
  return createBreakdownRequest(db, { vehicleId: driver.vehicle.id, driverId: driver.id, reportDate: input.date, description: input.description, priority: input.priority, userId: input.userId });
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
      .where(and(eq(s.expenses.driverId, driver.id), eq(s.expenses.status, "pending"))),
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
export async function createDriverLogin(db: Db, input: { driverId: number; login: string; password: string }) {
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
