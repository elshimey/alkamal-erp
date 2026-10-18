import { and, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import * as s from "@/db/schema";
import { createJournalEntryTx, deleteEntryTx, nextDocumentNumber } from "@/lib/ledger";
import { driverOnDate } from "@/lib/fleet";

// المخالفة تُسجل على المركبة، والسائق يُعرف من سجل الإسناد في تاريخها.
// على السائق: مدين ذمة راتبه (2107) / دائن مخالفات مستحقة (2108)، وتُخصم في مسير الرواتب.
// على الشركة: مدين مصروف مخالفات (5113) على مركز تكلفة المركبة / دائن 2108.
// السداد للمرور: مدين 2108 / دائن الصندوق أو البنك.
export const VIOLATION_ACCOUNTS = { payable: "2108", companyExpense: "5113" } as const;

const num = (v: string | number | null | undefined) => Number(v ?? 0);

async function accountIdByCode(db: Db | Tx, code: string) {
  const [row] = await db.select({ id: s.accounts.id }).from(s.accounts).where(eq(s.accounts.code, code));
  if (!row) throw new Error(`الحساب ${code} غير موجود في الشجرة`);
  return row.id;
}

async function cashAccount(tx: Tx, id: number | null | undefined) {
  const [cash] = id ? await tx.select().from(s.accounts).where(eq(s.accounts.id, id)) : [];
  if (!cash || !cash.isPostable || !/^110[12]/.test(cash.code)) throw new Error("اختر الصندوق أو البنك الذي سُددت منه المخالفات");
  return cash;
}

export interface ViolationInput {
  violationDate: string;
  vehicleId: number;
  /** فارغ = يُستنتج من الإسناد */
  driverId?: number | null;
  reference?: string | null;
  violationType: string;
  location?: string | null;
  amount: number;
  chargeTo: "driver" | "company";
  notes?: string | null;
  userId?: number;
}

export async function createViolation(db: Db, input: ViolationInput) {
  if (!input.violationType.trim()) throw new Error("نوع المخالفة إلزامي");
  if (!(input.amount > 0)) throw new Error("المبلغ إلزامي");
  return db.transaction(async (tx) => {
    const [vehicle] = await tx.select().from(s.vehicles).where(eq(s.vehicles.id, input.vehicleId));
    if (!vehicle) throw new Error("اختر المركبة");
    const reference = input.reference?.trim() || null;
    if (reference) {
      const [dup] = await tx.select({ number: s.trafficViolations.number }).from(s.trafficViolations).where(eq(s.trafficViolations.reference, reference));
      if (dup) throw new Error(`رقم المخالفة ${reference} مسجل مسبقاً (${dup.number})`);
    }
    const driverId = input.driverId ?? (await driverOnDate(tx, vehicle.id, input.violationDate));
    const payableId = await accountIdByCode(tx, VIOLATION_ACCOUNTS.payable);
    let debit: { accountId: number; costCenterId?: number | null; driverId?: number | null };
    if (input.chargeTo === "driver") {
      if (!driverId) throw new Error(`لا يوجد سائق مسند للمركبة ${vehicle.plate} في ${input.violationDate}؛ اختر السائق أو حمّلها على الشركة`);
      const [d] = await tx
        .select({ name: s.employees.nameAr, payableAccountId: s.employees.payableAccountId })
        .from(s.drivers)
        .innerJoin(s.employees, eq(s.employees.id, s.drivers.employeeId))
        .where(eq(s.drivers.id, driverId));
      if (!d?.payableAccountId) throw new Error(`السائق ${d?.name ?? ""} بلا حساب رواتب مستحقة؛ افتح ملف الموظف أولاً`);
      debit = { accountId: d.payableAccountId, driverId };
    } else {
      debit = { accountId: await accountIdByCode(tx, VIOLATION_ACCOUNTS.companyExpense), costCenterId: vehicle.costCenterId, driverId };
    }
    const year = Number(input.violationDate.slice(0, 4));
    const number = await nextDocumentNumber(tx, "traffic_violation", "VIO", year);
    const description = `مخالفة ${number} – ${input.violationType.trim()} – ${vehicle.plate}${reference ? ` (${reference})` : ""}`;
    const [v] = await tx
      .insert(s.trafficViolations)
      .values({
        number,
        violationDate: input.violationDate,
        reference,
        vehicleId: vehicle.id,
        driverId,
        violationType: input.violationType.trim(),
        location: input.location?.trim() || null,
        amount: String(input.amount),
        chargeTo: input.chargeTo,
        notes: input.notes?.trim() || null,
        createdBy: input.userId,
      })
      .returning();
    const entry = await createJournalEntryTx(tx, {
      entryDate: input.violationDate,
      description,
      source: { type: "traffic_violation", id: v.id },
      post: true,
      userId: input.userId,
      lines: [
        { ...debit, debit: input.amount, description },
        { accountId: payableId, credit: input.amount, description, driverId },
      ],
    });
    await tx.update(s.trafficViolations).set({ journalEntryId: entry.id }).where(eq(s.trafficViolations.id, v.id));
    return { ...v, journalEntryId: entry.id };
  });
}

/** سداد مجموعة مخالفات للمرور بقيد واحد. */
export async function payViolations(db: Db, ids: number[], opts: { paymentDate: string; cashAccountId: number; userId?: number }) {
  if (!ids.length) throw new Error("حدد المخالفات المراد سدادها");
  return db.transaction(async (tx) => {
    const cash = await cashAccount(tx, opts.cashAccountId);
    const rows = await tx
      .select({ v: s.trafficViolations, plate: s.vehicles.plate })
      .from(s.trafficViolations)
      .innerJoin(s.vehicles, eq(s.vehicles.id, s.trafficViolations.vehicleId))
      .where(inArray(s.trafficViolations.id, ids))
      .for("update", { of: s.trafficViolations });
    if (rows.length !== new Set(ids).size) throw new Error("بعض المخالفات غير موجودة");
    const paid = rows.find((r) => r.v.status === "paid");
    if (paid) throw new Error(`المخالفة ${paid.v.number} مسددة مسبقاً`);
    const early = rows.find((r) => r.v.violationDate > opts.paymentDate);
    if (early) throw new Error(`تاريخ السداد قبل تاريخ المخالفة ${early.v.number}`);
    const payableId = await accountIdByCode(tx, VIOLATION_ACCOUNTS.payable);
    const total = rows.reduce((a, r) => a + num(r.v.amount), 0);
    const entry = await createJournalEntryTx(tx, {
      entryDate: opts.paymentDate,
      description: `سداد ${rows.length} مخالفة مرورية`,
      source: { type: "violation_payment", id: rows[0].v.id },
      post: true,
      userId: opts.userId,
      lines: [
        ...rows.map((r) => ({
          accountId: payableId,
          debit: num(r.v.amount),
          driverId: r.v.driverId,
          description: `سداد مخالفة ${r.v.number} – ${r.plate}${r.v.reference ? ` (${r.v.reference})` : ""}`,
        })),
        { accountId: cash.id, credit: Math.round(total * 100) / 100, description: `سداد ${rows.length} مخالفة مرورية` },
      ],
    });
    await tx
      .update(s.trafficViolations)
      .set({ status: "paid", paymentDate: opts.paymentDate, cashAccountId: cash.id, paymentEntryId: entry.id })
      .where(inArray(s.trafficViolations.id, ids));
    return entry;
  });
}

/** إلغاء السداد: يلغي قيد السداد كاملاً، فتعود كل مخالفاته غير مسددة. */
export async function revertViolationPayment(db: Db, id: number) {
  return db.transaction(async (tx) => {
    const [v] = await tx.select().from(s.trafficViolations).where(eq(s.trafficViolations.id, id)).for("update");
    if (!v || v.status !== "paid" || !v.paymentEntryId) throw new Error("المخالفة غير مسددة");
    const entryId = v.paymentEntryId;
    const affected = await tx
      .update(s.trafficViolations)
      .set({ status: "posted", paymentDate: null, cashAccountId: null, paymentEntryId: null })
      .where(eq(s.trafficViolations.paymentEntryId, entryId))
      .returning({ id: s.trafficViolations.id });
    await deleteEntryTx(tx, entryId);
    return affected.length;
  });
}

export async function deleteViolation(db: Db, id: number, opts: { reason: string; userId?: number }) {
  if (!opts.reason.trim()) throw new Error("اكتب سبب الحذف");
  return db.transaction(async (tx) => {
    const [v] = await tx.select().from(s.trafficViolations).where(eq(s.trafficViolations.id, id)).for("update");
    if (!v) throw new Error("المخالفة غير موجودة");
    if (v.status === "paid") throw new Error("ألغِ السداد أولاً");
    if (v.payrollRunId) {
      const [run] = await tx.select({ status: s.payrollRuns.status, number: s.payrollRuns.number }).from(s.payrollRuns).where(eq(s.payrollRuns.id, v.payrollRunId));
      if (run && run.status !== "draft") throw new Error(`خُصمت المخالفة في المسير المعتمد ${run.number}؛ أرجعه لمسودة أولاً`);
    }
    await tx.insert(s.deletionLog).values({ entity: "traffic_violation", entityId: String(id), snapshot: v, reason: opts.reason.trim(), userId: opts.userId });
    await tx.delete(s.trafficViolations).where(eq(s.trafficViolations.id, id));
    if (v.journalEntryId) await deleteEntryTx(tx, v.journalEntryId);
  });
}

export interface ViolationFilter {
  status?: "posted" | "paid";
  chargeTo?: "driver" | "company";
  vehicleId?: number;
  driverId?: number;
  from?: string;
  to?: string;
}

export async function listViolations(db: Db, f: ViolationFilter = {}, limit = 300) {
  const where: SQL[] = [];
  if (f.status) where.push(eq(s.trafficViolations.status, f.status));
  if (f.chargeTo) where.push(eq(s.trafficViolations.chargeTo, f.chargeTo));
  if (f.vehicleId) where.push(eq(s.trafficViolations.vehicleId, f.vehicleId));
  if (f.driverId) where.push(eq(s.trafficViolations.driverId, f.driverId));
  if (f.from) where.push(gte(s.trafficViolations.violationDate, f.from));
  if (f.to) where.push(lte(s.trafficViolations.violationDate, f.to));
  return db
    .select({
      v: s.trafficViolations,
      plate: s.vehicles.plate,
      driver: s.employees.nameAr,
      entry: s.journalEntries.number,
      run: s.payrollRuns.number,
      runStatus: s.payrollRuns.status,
    })
    .from(s.trafficViolations)
    .innerJoin(s.vehicles, eq(s.vehicles.id, s.trafficViolations.vehicleId))
    .leftJoin(s.drivers, eq(s.drivers.id, s.trafficViolations.driverId))
    .leftJoin(s.employees, eq(s.employees.id, s.drivers.employeeId))
    .leftJoin(s.journalEntries, eq(s.journalEntries.id, s.trafficViolations.journalEntryId))
    .leftJoin(s.payrollRuns, eq(s.payrollRuns.id, s.trafficViolations.payrollRunId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(s.trafficViolations.violationDate), desc(s.trafficViolations.id))
    .limit(limit);
}

/** إجمالي غير المسدد للمرور، وما على السائقين ولم يُخصم بعد. */
export async function violationSummary(db: Db | Tx) {
  const [r] = await db
    .select({
      unpaidCount: sql<number>`count(*) filter (where ${s.trafficViolations.status} = 'posted')::int`,
      unpaid: sql<string>`coalesce(sum(${s.trafficViolations.amount}) filter (where ${s.trafficViolations.status} = 'posted'), 0)`,
      undeducted: sql<string>`coalesce(sum(${s.trafficViolations.amount}) filter (where ${s.trafficViolations.chargeTo} = 'driver' and ${s.trafficViolations.payrollRunId} is null), 0)`,
      company: sql<string>`coalesce(sum(${s.trafficViolations.amount}) filter (where ${s.trafficViolations.chargeTo} = 'company'), 0)`,
    })
    .from(s.trafficViolations);
  return { unpaidCount: r.unpaidCount, unpaid: num(r.unpaid), undeducted: num(r.undeducted), company: num(r.company) };
}
