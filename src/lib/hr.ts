import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db, Tx } from "@/db";
import * as s from "@/db/schema";
import { addSubAccountTx } from "@/lib/accounts";
import { createJournalEntryTx, deleteEntryTx, nextDocumentNumber, type LineInput } from "@/lib/ledger";
import { createAdvance, payAdvance } from "@/lib/payroll";
import { monthRange } from "@/data/payroll";
import { annualEntitlement, computeEvaluation, inclusiveDays } from "@/data/hr";
import { notifyDriver } from "@/lib/driver-notify";
import { cashAccountFor } from "@/lib/banks";

// الموارد البشرية: العُهد، والإنذارات والجزاءات والحوافز، والإجازات والحضور، والتقييم والترقية، ومقدم العمولة.
// كل ما يمس الراتب يدخل المسير بعد اعتماده؛ والعهدة النقدية وحدها لها قيد، والعينية سجل رقابي.

const num = (v: string | number | null | undefined) => (v == null ? 0 : Number(v));
const r2 = (v: number) => Math.round(v * 100) / 100 + 0;
const like = (q: string) => `%${q.trim()}%`;

async function accountIdByCode(db: Db | Tx, code: string) {
  const [row] = await db.select({ id: s.accounts.id }).from(s.accounts).where(eq(s.accounts.code, code));
  if (!row) throw new Error(`الحساب ${code} غير موجود في الشجرة`);
  return row.id;
}

async function activeEmployee(db: Db | Tx, id: number) {
  const [emp] = await db
    .select({ e: s.employees, driverId: s.drivers.id, driverCustody: s.drivers.custodyAccountId, commissionClass: s.drivers.commissionClass })
    .from(s.employees)
    .leftJoin(s.drivers, eq(s.drivers.employeeId, s.employees.id))
    .where(eq(s.employees.id, id));
  if (!emp || emp.e.status === "terminated") throw new Error("الموظف غير موجود أو منتهية خدمته");
  return emp;
}

// ───────────── الإعدادات ─────────────

export type HrSettings = typeof s.hrSettings.$inferSelect;

export async function getHrSettings(db: Db | Tx): Promise<HrSettings> {
  const [row] = await db.select().from(s.hrSettings).where(eq(s.hrSettings.id, 1));
  if (row) return row;
  const [created] = await db.insert(s.hrSettings).values({ id: 1 }).onConflictDoNothing().returning();
  return created ?? (await db.select().from(s.hrSettings).where(eq(s.hrSettings.id, 1)))[0];
}

export interface HrSettingsInput {
  warningPoints: number;
  violationsAsWarnings: boolean;
  promotionScore: number;
  promotionMonths: number;
  advanceOpenDay: number;
  advanceCloseDay: number;
  advanceCapDomestic: number;
  advanceCapInternational: number;
}

export async function saveHrSettings(db: Db, input: HrSettingsInput) {
  const int = (v: number, min: number, max: number, label: string) => {
    if (!Number.isInteger(v) || v < min || v > max) throw new Error(`${label} من ${min} إلى ${max}`);
    return v;
  };
  int(input.warningPoints, 0, 50, "نقاط الإنذار");
  int(input.promotionScore, 50, 100, "درجة الترقية");
  int(input.promotionMonths, 1, 12, "أشهر الترقية");
  int(input.advanceOpenDay, 1, 31, "يوم فتح الطلبات");
  int(input.advanceCloseDay, input.advanceOpenDay, 31, "يوم الإغلاق");
  if (!(input.advanceCapDomestic >= 0) || !(input.advanceCapInternational >= 0)) throw new Error("السقف لا يكون سالباً");
  await getHrSettings(db);
  const [row] = await db
    .update(s.hrSettings)
    .set({ ...input, advanceCapDomestic: String(input.advanceCapDomestic), advanceCapInternational: String(input.advanceCapInternational), updatedAt: new Date() })
    .where(eq(s.hrSettings.id, 1))
    .returning();
  return row;
}

export async function listCriteria(db: Db | Tx, activeOnly = false) {
  return db
    .select()
    .from(s.evaluationCriteria)
    .where(activeOnly ? eq(s.evaluationCriteria.active, true) : undefined)
    .orderBy(asc(s.evaluationCriteria.sortOrder), asc(s.evaluationCriteria.id));
}

export async function saveCriterion(db: Db, input: { id?: number | null; nameAr: string; weight: number; active?: boolean }) {
  const nameAr = input.nameAr.trim();
  if (!nameAr) throw new Error("اسم المعيار إلزامي");
  if (!Number.isInteger(input.weight) || input.weight < 1 || input.weight > 10) throw new Error("الوزن من 1 إلى 10");
  if (input.id) {
    const [row] = await db.update(s.evaluationCriteria).set({ nameAr, weight: input.weight, active: input.active ?? true }).where(eq(s.evaluationCriteria.id, input.id)).returning();
    if (!row) throw new Error("المعيار غير موجود");
    return row;
  }
  const [{ n }] = await db.select({ n: sql<number>`coalesce(max(${s.evaluationCriteria.sortOrder}), 0)::int` }).from(s.evaluationCriteria);
  const [row] = await db.insert(s.evaluationCriteria).values({ nameAr, weight: input.weight, active: input.active ?? true, sortOrder: n + 1 }).returning();
  return row;
}

export async function listLeaveTypes(db: Db | Tx, activeOnly = false) {
  return db.select().from(s.leaveTypes).where(activeOnly ? eq(s.leaveTypes.active, true) : undefined).orderBy(asc(s.leaveTypes.id));
}

export async function saveLeaveType(db: Db, input: { id?: number | null; nameAr: string; paid: boolean; yearlyDays?: number | null; active?: boolean }) {
  const nameAr = input.nameAr.trim();
  if (!nameAr) throw new Error("اسم نوع الإجازة إلزامي");
  if (input.yearlyDays != null && (!Number.isInteger(input.yearlyDays) || input.yearlyDays < 1 || input.yearlyDays > 365)) throw new Error("الرصيد السنوي من 1 إلى 365 يوماً");
  const values = { nameAr, paid: input.paid, yearlyDays: input.yearlyDays ?? null, active: input.active ?? true };
  if (input.id) {
    const [row] = await db.update(s.leaveTypes).set(values).where(eq(s.leaveTypes.id, input.id)).returning();
    if (!row) throw new Error("نوع الإجازة غير موجود");
    return row;
  }
  const [row] = await db.insert(s.leaveTypes).values(values).returning();
  return row;
}

// ───────────── العُهد ─────────────

export interface CustodyInput {
  kind: "cash" | "in_kind";
  employeeId: number;
  docDate: string;
  description: string;
  quantity?: number | null;
  amount?: number | null;
  serialNo?: string | null;
  isOpening?: boolean;
  notes?: string | null;
  userId?: number;
}

/** مستند عهدة جديد مسودةً. العهدة الافتتاحية تُسجل مسلّمة مباشرة بلا قيد لأن رصيدها في القيد الافتتاحي. */
export async function createCustody(db: Db | Tx, input: CustodyInput) {
  const description = input.description.trim();
  if (!description) throw new Error("وصف العهدة إلزامي");
  const amount = input.amount ?? 0;
  if (amount < 0) throw new Error("القيمة لا تكون سالبة");
  if (input.kind === "cash" && !(amount > 0)) throw new Error("مبلغ العهدة النقدية إلزامي");
  const quantity = input.quantity ?? 1;
  if (!(quantity > 0)) throw new Error("الكمية أكبر من صفر");
  await activeEmployee(db, input.employeeId);
  const number = await nextDocumentNumber(db, "custody", "CUS", Number(input.docDate.slice(0, 4)));
  const [row] = await db
    .insert(s.custodyDocs)
    .values({
      number,
      kind: input.kind,
      employeeId: input.employeeId,
      docDate: input.docDate,
      description,
      quantity: String(quantity),
      amount: String(amount),
      serialNo: input.serialNo?.trim() || null,
      isOpening: input.isOpening ?? false,
      status: input.isOpening ? "delivered" : "draft",
      notes: input.notes?.trim() || null,
      createdBy: input.userId,
      approvedBy: input.isOpening ? input.userId : null,
    })
    .returning();
  return row;
}

async function lockCustody(tx: Tx, id: number) {
  const [c] = await tx.select().from(s.custodyDocs).where(eq(s.custodyDocs.id, id)).for("update");
  if (!c) throw new Error("مستند العهدة غير موجود");
  return c;
}

/** حساب عهدة الموظف: للسائق حسابه، وللإداري يُفتح حساب فرعي تحت 1105 عند أول عهدة نقدية. */
async function custodyAccountFor(tx: Tx, employeeId: number) {
  const emp = await activeEmployee(tx, employeeId);
  if (emp.driverCustody) return emp.driverCustody;
  if (emp.e.custodyAccountId) return emp.e.custodyAccountId;
  const acc = await addSubAccountTx(tx, await accountIdByCode(tx, "1105"), `عهدة – ${emp.e.nameAr}`);
  await tx.update(s.employees).set({ custodyAccountId: acc.id, updatedAt: new Date() }).where(eq(s.employees.id, employeeId));
  return acc.id;
}

const cashAccountTx = (tx: Tx, id: number | null | undefined, what: string) => cashAccountFor(tx, id, `اختر ${what}`);

export async function approveCustody(db: Db, id: number, userId?: number) {
  return db.transaction(async (tx) => {
    const c = await lockCustody(tx, id);
    if (c.status !== "draft") throw new Error(`العهدة ${c.number} ليست مسودة`);
    await tx.update(s.custodyDocs).set({ status: "approved", approvedBy: userId ?? null }).where(eq(s.custodyDocs.id, id));
  });
}

/** التسليم: النقدية تُقيد من حـ/ عهدة الموظف إلى حـ/ الصندوق أو البنك؛ والعينية تُسجل بلا قيد. */
export async function deliverCustody(db: Db, id: number, opts: { cashAccountId?: number | null; date?: string | null; userId?: number }) {
  return db.transaction(async (tx) => {
    const c = await lockCustody(tx, id);
    if (c.status === "draft") throw new Error("اعتمد العهدة قبل تسليمها");
    if (c.status !== "approved") throw new Error(`العهدة ${c.number} مسلّمة أو مغلقة`);
    const date = opts.date || c.docDate;
    let entryId: number | null = null;
    let cashId: number | null = null;
    if (c.kind === "cash") {
      const cash = await cashAccountTx(tx, opts.cashAccountId, "الصندوق أو البنك الذي صُرفت منه العهدة");
      const [emp] = await tx.select({ name: s.employees.nameAr }).from(s.employees).where(eq(s.employees.id, c.employeeId));
      const description = `عهدة نقدية ${c.number} – ${emp.name}`;
      const entry = await createJournalEntryTx(tx, {
        entryDate: date,
        description,
        source: { type: "custody", id: c.id },
        post: true,
        userId: opts.userId,
        lines: [
          { accountId: await custodyAccountFor(tx, c.employeeId), debit: num(c.amount), description },
          { accountId: cash.id, credit: num(c.amount), description },
        ],
      });
      entryId = entry.id;
      cashId = cash.id;
    }
    await tx.update(s.custodyDocs).set({ status: "delivered", docDate: date, journalEntryId: entryId, cashAccountId: cashId }).where(eq(s.custodyDocs.id, id));
  });
}

export interface CustodyClose {
  outcome: "settled" | "returned";
  date: string;
  /** النقدية: المبلغ المُعاد للصندوق */
  returnedAmount?: number | null;
  cashAccountId?: number | null;
  /** النقدية: ما صُرف بمستندات ولم يُسجل مصروفاً من قبل، وحساب مصروفه */
  spentAmount?: number | null;
  expenseAccountId?: number | null;
  costCenterId?: number | null;
  notes?: string | null;
  userId?: number;
}

/**
 * الإغلاق: الإرجاع يعيد العهدة كاملة، والتسوية تغلقها بما صُرف منها.
 * النقدية: المُعاد مدين الصندوق، والمصروف بمستندات مدين حسابه، وكلاهما دائن عهدة الموظف.
 * ما سجله السائق من مصاريف في التطبيق نزل من عهدته عند اعتماده فلا يُعاد هنا.
 */
export async function closeCustody(db: Db, id: number, input: CustodyClose) {
  return db.transaction(async (tx) => {
    const c = await lockCustody(tx, id);
    if (c.status !== "delivered") throw new Error("الإغلاق متاح للعهدة المسلّمة فقط");
    if (input.date < c.docDate) throw new Error("تاريخ الإغلاق قبل تاريخ التسليم");
    let returned = 0;
    let closeEntryId: number | null = null;
    if (c.kind === "cash") {
      returned = r2(input.outcome === "returned" ? (input.returnedAmount ?? num(c.amount)) : (input.returnedAmount ?? 0));
      const spent = r2(input.spentAmount ?? 0);
      if (returned < 0 || spent < 0) throw new Error("لا تُقبل قيم سالبة");
      if (r2(returned + spent) > num(c.amount)) throw new Error("المُعاد والمصروف أكبر من مبلغ العهدة");
      if (input.outcome === "returned" && returned !== num(c.amount)) throw new Error("الإرجاع يعني إعادة المبلغ كاملاً؛ استخدم التسوية للجزئي");
      const [emp] = await tx.select({ name: s.employees.nameAr }).from(s.employees).where(eq(s.employees.id, c.employeeId));
      const description = `${input.outcome === "returned" ? "إرجاع" : "تسوية"} عهدة ${c.number} – ${emp.name}`;
      const lines: LineInput[] = [];
      if (returned > 0) lines.push({ accountId: (await cashAccountTx(tx, input.cashAccountId, "الصندوق أو البنك الذي أُعيد إليه المبلغ")).id, debit: returned, description });
      if (spent > 0) {
        const [exp] = input.expenseAccountId ? await tx.select().from(s.accounts).where(eq(s.accounts.id, input.expenseAccountId)) : [];
        if (!exp || !exp.isPostable || !["expense", "asset"].includes(exp.type)) throw new Error("اختر حساب المصروف لما صُرف من العهدة");
        lines.push({ accountId: exp.id, costCenterId: input.costCenterId ?? null, debit: spent, description });
      }
      if (lines.length) {
        const custody = await custodyAccountFor(tx, c.employeeId);
        lines.push({ accountId: custody, credit: r2(returned + spent), description });
        const entry = await createJournalEntryTx(tx, { entryDate: input.date, description, source: { type: "custody_close", id: c.id }, post: true, userId: input.userId, lines });
        closeEntryId = entry.id;
      }
    }
    await tx
      .update(s.custodyDocs)
      .set({ status: input.outcome, closeDate: input.date, returnedAmount: String(returned), closeEntryId, closeNotes: input.notes?.trim() || null })
      .where(eq(s.custodyDocs.id, id));
  });
}

/** إعادة الحالة خطوة: المغلقة ← مسلّمة، والمسلّمة ← معتمدة، مع إلغاء قيدها. */
export async function revertCustody(db: Db, id: number) {
  return db.transaction(async (tx) => {
    const c = await lockCustody(tx, id);
    if (c.status === "settled" || c.status === "returned") {
      await tx.update(s.custodyDocs).set({ status: "delivered", closeDate: null, returnedAmount: "0", closeEntryId: null, closeNotes: null }).where(eq(s.custodyDocs.id, id));
      if (c.closeEntryId) await deleteEntryTx(tx, c.closeEntryId);
      return "delivered" as const;
    }
    if (c.status === "delivered" && !c.isOpening) {
      await tx.update(s.custodyDocs).set({ status: "approved", journalEntryId: null, cashAccountId: null }).where(eq(s.custodyDocs.id, id));
      if (c.journalEntryId) await deleteEntryTx(tx, c.journalEntryId);
      return "approved" as const;
    }
    if (c.status === "approved") {
      await tx.update(s.custodyDocs).set({ status: "draft", approvedBy: null }).where(eq(s.custodyDocs.id, id));
      return "draft" as const;
    }
    throw new Error("لا توجد خطوة سابقة لهذه العهدة");
  });
}

export async function cancelCustody(db: Db, id: number) {
  return db.transaction(async (tx) => {
    const c = await lockCustody(tx, id);
    if (c.status !== "draft" && c.status !== "approved" && !(c.isOpening && c.status === "delivered")) throw new Error("الإلغاء قبل التسليم فقط؛ أرجع العهدة أولاً");
    await tx.update(s.custodyDocs).set({ status: "cancelled" }).where(eq(s.custodyDocs.id, id));
  });
}

export interface CustodyFilter {
  q?: string;
  status?: string;
  kind?: "cash" | "in_kind";
  employeeId?: number;
  from?: string;
  to?: string;
  open?: boolean;
}

export async function listCustody(db: Db | Tx, f: CustodyFilter, limit = 500) {
  const where: (SQL | undefined)[] = [
    f.status ? eq(s.custodyDocs.status, f.status as (typeof s.custodyStatus.enumValues)[number]) : undefined,
    f.open ? inArray(s.custodyDocs.status, ["approved", "delivered"]) : undefined,
    f.kind ? eq(s.custodyDocs.kind, f.kind) : undefined,
    f.employeeId ? eq(s.custodyDocs.employeeId, f.employeeId) : undefined,
    f.from ? gte(s.custodyDocs.docDate, f.from) : undefined,
    f.to ? lte(s.custodyDocs.docDate, f.to) : undefined,
    f.q ? or(ilike(s.custodyDocs.number, like(f.q)), ilike(s.custodyDocs.description, like(f.q)), ilike(s.employees.nameAr, like(f.q)), ilike(s.custodyDocs.serialNo, like(f.q))) : undefined,
  ];
  return db
    .select({ c: s.custodyDocs, employee: s.employees.nameAr, isDriver: sql<boolean>`${s.drivers.id} is not null` })
    .from(s.custodyDocs)
    .innerJoin(s.employees, eq(s.employees.id, s.custodyDocs.employeeId))
    .leftJoin(s.drivers, eq(s.drivers.employeeId, s.employees.id))
    .where(and(...where))
    .orderBy(desc(s.custodyDocs.docDate), desc(s.custodyDocs.id))
    .limit(limit);
}

export async function custodyDoc(db: Db | Tx, id: number) {
  const creator = alias(s.users, "creator");
  const approver = alias(s.users, "approver");
  const cash = alias(s.accounts, "cash");
  const entry = alias(s.journalEntries, "entry");
  const closeEntry = alias(s.journalEntries, "close_entry");
  const [row] = await db
    .select({
      c: s.custodyDocs,
      employee: s.employees.nameAr,
      jobTitle: s.employees.jobTitle,
      nationalId: s.employees.nationalId,
      creator: creator.name,
      approver: approver.name,
      cash: cash.nameAr,
      entry: entry.number,
      closeEntry: closeEntry.number,
    })
    .from(s.custodyDocs)
    .innerJoin(s.employees, eq(s.employees.id, s.custodyDocs.employeeId))
    .leftJoin(creator, eq(creator.id, s.custodyDocs.createdBy))
    .leftJoin(approver, eq(approver.id, s.custodyDocs.approvedBy))
    .leftJoin(cash, eq(cash.id, s.custodyDocs.cashAccountId))
    .leftJoin(entry, eq(entry.id, s.custodyDocs.journalEntryId))
    .leftJoin(closeEntry, eq(closeEntry.id, s.custodyDocs.closeEntryId))
    .where(eq(s.custodyDocs.id, id));
  return row ?? null;
}

// ───────────── الإنذارات والجزاءات والحوافز ─────────────

export interface HrActionInput {
  kind: "warning" | "penalty" | "incentive";
  employeeId: number;
  actionDate: string;
  amount?: number | null;
  points?: number | null;
  reason: string;
  userId?: number;
}

export async function createHrAction(db: Db | Tx, input: HrActionInput) {
  const reason = input.reason.trim();
  if (!reason) throw new Error("السبب إلزامي");
  await activeEmployee(db, input.employeeId);
  let amount = 0;
  let points = 0;
  if (input.kind === "warning") {
    points = input.points ?? (await getHrSettings(db)).warningPoints;
    if (!Number.isInteger(points) || points < 0 || points > 100) throw new Error("نقاط الإنذار من 0 إلى 100");
  } else {
    amount = r2(input.amount ?? 0);
    if (!(amount > 0)) throw new Error(`مبلغ ${input.kind === "penalty" ? "الجزاء" : "الحافز"} إلزامي`);
  }
  const number = await nextDocumentNumber(db, "hr_action", "HRA", Number(input.actionDate.slice(0, 4)));
  const [row] = await db
    .insert(s.hrActions)
    .values({ number, kind: input.kind, employeeId: input.employeeId, actionDate: input.actionDate, amount: String(amount), points, reason, createdBy: input.userId })
    .returning();
  return row;
}

async function lockAction(tx: Tx, id: number) {
  const [a] = await tx.select().from(s.hrActions).where(eq(s.hrActions.id, id)).for("update");
  if (!a) throw new Error("المستند غير موجود");
  return a;
}

export async function approveHrAction(db: Db, id: number, userId?: number) {
  return db.transaction(async (tx) => {
    const a = await lockAction(tx, id);
    if (a.status !== "draft") throw new Error(`${a.number} ليس مسودة`);
    await tx.update(s.hrActions).set({ status: "approved", approvedBy: userId ?? null }).where(eq(s.hrActions.id, id));
  });
}

/** الإلغاء: المسودة مباشرة، والمعتمد ما لم يدخل مسيراً معتمداً (ويُحرر من المسير المسودة فيلزم تحديثه). */
export async function cancelHrAction(db: Db, id: number) {
  return db.transaction(async (tx) => {
    const a = await lockAction(tx, id);
    if (a.status === "cancelled") throw new Error("ملغى مسبقاً");
    if (a.payrollRunId) {
      const [run] = await tx.select().from(s.payrollRuns).where(eq(s.payrollRuns.id, a.payrollRunId));
      if (run && run.status !== "draft") throw new Error(`دخل في المسير المعتمد ${run.number}؛ أرجعه لمسودة أولاً`);
    }
    await tx.update(s.hrActions).set({ status: "cancelled", payrollRunId: null }).where(eq(s.hrActions.id, id));
  });
}

export interface HrActionFilter {
  q?: string;
  status?: string;
  kind?: "warning" | "penalty" | "incentive";
  employeeId?: number;
  from?: string;
  to?: string;
}

export async function listHrActions(db: Db | Tx, f: HrActionFilter, limit = 500) {
  return db
    .select({ a: s.hrActions, employee: s.employees.nameAr, run: s.payrollRuns.number, runStatus: s.payrollRuns.status })
    .from(s.hrActions)
    .innerJoin(s.employees, eq(s.employees.id, s.hrActions.employeeId))
    .leftJoin(s.payrollRuns, eq(s.payrollRuns.id, s.hrActions.payrollRunId))
    .where(
      and(
        f.status ? eq(s.hrActions.status, f.status as (typeof s.hrActionStatus.enumValues)[number]) : undefined,
        f.kind ? eq(s.hrActions.kind, f.kind) : undefined,
        f.employeeId ? eq(s.hrActions.employeeId, f.employeeId) : undefined,
        f.from ? gte(s.hrActions.actionDate, f.from) : undefined,
        f.to ? lte(s.hrActions.actionDate, f.to) : undefined,
        f.q ? or(ilike(s.hrActions.number, like(f.q)), ilike(s.hrActions.reason, like(f.q)), ilike(s.employees.nameAr, like(f.q))) : undefined,
      ),
    )
    .orderBy(desc(s.hrActions.actionDate), desc(s.hrActions.id))
    .limit(limit);
}

// ───────────── الإجازات ─────────────

export interface LeaveInput {
  employeeId: number;
  typeId: number;
  fromDate: string;
  toDate: string;
  reason?: string | null;
  userId?: number;
}

export async function createLeave(db: Db | Tx, input: LeaveInput) {
  if (!input.fromDate || !input.toDate || input.toDate < input.fromDate) throw new Error("تاريخ النهاية قبل البداية");
  const days = inclusiveDays(input.fromDate, input.toDate);
  if (days > 365) throw new Error("مدة الإجازة أطول من سنة");
  await activeEmployee(db, input.employeeId);
  const [type] = await db.select().from(s.leaveTypes).where(eq(s.leaveTypes.id, input.typeId));
  if (!type || !type.active) throw new Error("اختر نوع الإجازة");
  const [clash] = await db
    .select({ number: s.leaveRequests.number })
    .from(s.leaveRequests)
    .where(
      and(
        eq(s.leaveRequests.employeeId, input.employeeId),
        inArray(s.leaveRequests.status, ["pending", "approved"]),
        lte(s.leaveRequests.fromDate, input.toDate),
        gte(s.leaveRequests.toDate, input.fromDate),
      ),
    )
    .limit(1);
  if (clash) throw new Error(`تتداخل مع الإجازة ${clash.number}`);
  const number = await nextDocumentNumber(db, "leave", "LV", Number(input.fromDate.slice(0, 4)));
  const [row] = await db
    .insert(s.leaveRequests)
    .values({ number, employeeId: input.employeeId, typeId: type.id, fromDate: input.fromDate, toDate: input.toDate, days, reason: input.reason?.trim() || null, createdBy: input.userId })
    .returning();
  return row;
}

/** الرصيد السنوي لنوع الإجازة: السنوية 21/30 يوماً حسب الخدمة، وغيرها برصيدها الثابت، وما سواهما بلا حد. */
async function entitlementFor(db: Db | Tx, employeeId: number, type: typeof s.leaveTypes.$inferSelect, year: number) {
  if (type.isAnnual) {
    const [emp] = await db.select({ hireDate: s.employees.hireDate }).from(s.employees).where(eq(s.employees.id, employeeId));
    return annualEntitlement(emp?.hireDate ?? null, `${year}-12-31`);
  }
  return type.yearlyDays;
}

async function usedDays(db: Db | Tx, employeeId: number, typeId: number, year: number, exceptId?: number) {
  const [r] = await db
    .select({ v: sql<number>`coalesce(sum(${s.leaveRequests.days}), 0)::int` })
    .from(s.leaveRequests)
    .where(
      and(
        eq(s.leaveRequests.employeeId, employeeId),
        eq(s.leaveRequests.typeId, typeId),
        eq(s.leaveRequests.status, "approved"),
        sql`extract(year from ${s.leaveRequests.fromDate}) = ${year}`,
        exceptId ? ne(s.leaveRequests.id, exceptId) : undefined,
      ),
    );
  return r.v;
}

async function lockLeave(tx: Tx, id: number) {
  const [l] = await tx.select().from(s.leaveRequests).where(eq(s.leaveRequests.id, id)).for("update");
  if (!l) throw new Error("طلب الإجازة غير موجود");
  return l;
}

/** الاعتماد يتحقق من الرصيد، وتمنع الإجازة المعتمدة إسناد رحلة للسائق في أيامها. */
export async function approveLeave(db: Db, id: number, opts: { userId?: number; override?: boolean } = {}) {
  return db.transaction(async (tx) => {
    const l = await lockLeave(tx, id);
    if (l.status !== "pending") throw new Error(`الإجازة ${l.number} ليست بانتظار الاعتماد`);
    const [type] = await tx.select().from(s.leaveTypes).where(eq(s.leaveTypes.id, l.typeId));
    const year = Number(l.fromDate.slice(0, 4));
    const quota = await entitlementFor(tx, l.employeeId, type, year);
    if (quota != null && !opts.override) {
      const used = await usedDays(tx, l.employeeId, l.typeId, year, l.id);
      if (used + l.days > quota) throw new Error(`الرصيد لا يكفي: المتبقي ${Math.max(0, quota - used)} يوم من ${quota}`);
    }
    await tx.update(s.leaveRequests).set({ status: "approved", approvedBy: opts.userId ?? null }).where(eq(s.leaveRequests.id, id));
  });
}

async function guardPayroll(tx: Tx, l: { fromDate: string; toDate: string; typeId: number }) {
  const [type] = await tx.select().from(s.leaveTypes).where(eq(s.leaveTypes.id, l.typeId));
  if (type?.paid) return;
  const [run] = await tx
    .select({ number: s.payrollRuns.number })
    .from(s.payrollRuns)
    .where(and(inArray(s.payrollRuns.status, ["approved", "paid"]), lte(s.payrollRuns.month, l.toDate), sql`(${s.payrollRuns.month} + interval '1 month' - interval '1 day')::date >= ${l.fromDate}`))
    .limit(1);
  if (run) throw new Error(`خُصمت الإجازة في المسير المعتمد ${run.number}؛ أرجعه لمسودة أولاً`);
}

export async function rejectLeave(db: Db, id: number, opts: { reason: string; userId?: number }) {
  if (!opts.reason.trim()) throw new Error("اكتب سبب الرفض");
  return db.transaction(async (tx) => {
    const l = await lockLeave(tx, id);
    if (l.status !== "pending") throw new Error("الرفض متاح للطلب المنتظر فقط");
    await tx.update(s.leaveRequests).set({ status: "rejected", rejectReason: opts.reason.trim(), approvedBy: opts.userId ?? null }).where(eq(s.leaveRequests.id, id));
  });
}

export async function cancelLeave(db: Db, id: number) {
  return db.transaction(async (tx) => {
    const l = await lockLeave(tx, id);
    if (l.status !== "pending" && l.status !== "approved") throw new Error("لا يمكن إلغاء هذا الطلب");
    if (l.status === "approved") await guardPayroll(tx, l);
    await tx.update(s.leaveRequests).set({ status: "cancelled" }).where(eq(s.leaveRequests.id, id));
  });
}

/** الإجازة المعتمدة للسائق في تاريخ (تمنع إسناده لرحلة). */
export async function driverLeaveOn(db: Db | Tx, driverId: number, date: string) {
  const [row] = await db
    .select({ number: s.leaveRequests.number, name: s.employees.nameAr, toDate: s.leaveRequests.toDate })
    .from(s.leaveRequests)
    .innerJoin(s.drivers, eq(s.drivers.employeeId, s.leaveRequests.employeeId))
    .innerJoin(s.employees, eq(s.employees.id, s.leaveRequests.employeeId))
    .where(and(eq(s.drivers.id, driverId), eq(s.leaveRequests.status, "approved"), lte(s.leaveRequests.fromDate, date), gte(s.leaveRequests.toDate, date)))
    .limit(1);
  return row ?? null;
}

export interface LeaveFilter {
  q?: string;
  status?: string;
  typeId?: number;
  employeeId?: number;
  from?: string;
  to?: string;
}

export async function listLeaves(db: Db | Tx, f: LeaveFilter, limit = 500) {
  return db
    .select({ l: s.leaveRequests, employee: s.employees.nameAr, type: s.leaveTypes.nameAr, paid: s.leaveTypes.paid })
    .from(s.leaveRequests)
    .innerJoin(s.employees, eq(s.employees.id, s.leaveRequests.employeeId))
    .innerJoin(s.leaveTypes, eq(s.leaveTypes.id, s.leaveRequests.typeId))
    .where(
      and(
        f.status ? eq(s.leaveRequests.status, f.status as (typeof s.leaveStatus.enumValues)[number]) : undefined,
        f.typeId ? eq(s.leaveRequests.typeId, f.typeId) : undefined,
        f.employeeId ? eq(s.leaveRequests.employeeId, f.employeeId) : undefined,
        f.from ? gte(s.leaveRequests.toDate, f.from) : undefined,
        f.to ? lte(s.leaveRequests.fromDate, f.to) : undefined,
        f.q ? or(ilike(s.leaveRequests.number, like(f.q)), ilike(s.employees.nameAr, like(f.q)), ilike(s.leaveRequests.reason, like(f.q))) : undefined,
      ),
    )
    .orderBy(desc(s.leaveRequests.fromDate), desc(s.leaveRequests.id))
    .limit(limit);
}

/** أرصدة الإجازات ذات الرصيد لكل موظف في السنة: المستحق والمستخدم والمنتظر والمتبقي. */
export async function leaveBalances(db: Db | Tx, year: number) {
  const [emps, types, used] = await Promise.all([
    db
      .select({ id: s.employees.id, name: s.employees.nameAr, hireDate: s.employees.hireDate, isDriver: sql<boolean>`${s.drivers.id} is not null` })
      .from(s.employees)
      .leftJoin(s.drivers, eq(s.drivers.employeeId, s.employees.id))
      .where(inArray(s.employees.status, ["active", "on_leave"]))
      .orderBy(asc(s.employees.nameAr)),
    db.select().from(s.leaveTypes).where(and(eq(s.leaveTypes.active, true), or(eq(s.leaveTypes.isAnnual, true), sql`${s.leaveTypes.yearlyDays} is not null`))).orderBy(asc(s.leaveTypes.id)),
    db
      .select({ employeeId: s.leaveRequests.employeeId, typeId: s.leaveRequests.typeId, status: s.leaveRequests.status, days: sql<number>`sum(${s.leaveRequests.days})::int` })
      .from(s.leaveRequests)
      .where(and(inArray(s.leaveRequests.status, ["approved", "pending"]), sql`extract(year from ${s.leaveRequests.fromDate}) = ${year}`))
      .groupBy(s.leaveRequests.employeeId, s.leaveRequests.typeId, s.leaveRequests.status),
  ]);
  const key = (e: number, t: number, st: string) => `${e}:${t}:${st}`;
  const map = new Map(used.map((u) => [key(u.employeeId, u.typeId, u.status), u.days]));
  return {
    types,
    rows: emps.map((e) => ({
      ...e,
      balances: types.map((t) => {
        const quota = t.isAnnual ? annualEntitlement(e.hireDate, `${year}-12-31`) : (t.yearlyDays ?? 0);
        const usedDays = map.get(key(e.id, t.id, "approved")) ?? 0;
        const pending = map.get(key(e.id, t.id, "pending")) ?? 0;
        return { typeId: t.id, quota, used: usedDays, pending, left: quota - usedDays };
      }),
    })),
  };
}

// ───────────── الحضور (الإداريون فقط) ─────────────

export async function officeStaff(db: Db | Tx) {
  return db
    .select({ id: s.employees.id, name: s.employees.nameAr, jobTitle: s.employees.jobTitle })
    .from(s.employees)
    .leftJoin(s.drivers, eq(s.drivers.employeeId, s.employees.id))
    .where(and(isNull(s.drivers.id), inArray(s.employees.status, ["active", "on_leave"])))
    .orderBy(asc(s.employees.nameAr));
}

/** حضور يوم: كل إداري بحالته المسجلة، وإجازته المعتمدة إن وُجدت. */
export async function attendanceDay(db: Db | Tx, day: string) {
  const [staff, marks, leaves] = await Promise.all([
    officeStaff(db),
    db.select().from(s.attendance).where(eq(s.attendance.day, day)),
    db
      .select({ employeeId: s.leaveRequests.employeeId, type: s.leaveTypes.nameAr })
      .from(s.leaveRequests)
      .innerJoin(s.leaveTypes, eq(s.leaveTypes.id, s.leaveRequests.typeId))
      .where(and(eq(s.leaveRequests.status, "approved"), lte(s.leaveRequests.fromDate, day), gte(s.leaveRequests.toDate, day))),
  ]);
  const byEmp = new Map(marks.map((m) => [m.employeeId, m]));
  const leaveBy = new Map(leaves.map((l) => [l.employeeId, l.type]));
  return staff.map((e) => ({ ...e, mark: byEmp.get(e.id) ?? null, leave: leaveBy.get(e.id) ?? null }));
}

export interface AttendanceMark {
  employeeId: number;
  status: "present" | "absent" | "late" | "leave";
  lateMinutes?: number | null;
  notes?: string | null;
}

/** تسجيل حضور يوم (إضافة أو تعديل). الغياب يُخصم في المسير ما لم يُعتمد المسير. */
export async function saveAttendance(db: Db, day: string, marks: AttendanceMark[], userId?: number) {
  if (!day) throw new Error("اختر اليوم");
  return db.transaction(async (tx) => {
    const { start } = monthRange(day.slice(0, 7));
    const [run] = await tx.select({ number: s.payrollRuns.number }).from(s.payrollRuns).where(and(eq(s.payrollRuns.month, start), inArray(s.payrollRuns.status, ["approved", "paid"])));
    if (run) throw new Error(`مسير هذا الشهر (${run.number}) معتمد؛ أرجعه لمسودة لتعديل الحضور`);
    const staff = new Set((await officeStaff(tx)).map((e) => e.id));
    for (const m of marks) {
      if (!staff.has(m.employeeId)) throw new Error("الحضور للموظفين الإداريين فقط؛ حضور السائق رحلاته");
      const late = m.status === "late" ? Math.max(0, Math.round(m.lateMinutes ?? 0)) : 0;
      await tx
        .insert(s.attendance)
        .values({ employeeId: m.employeeId, day, status: m.status, lateMinutes: late, notes: m.notes?.trim() || null, createdBy: userId })
        .onConflictDoUpdate({ target: [s.attendance.employeeId, s.attendance.day], set: { status: m.status, lateMinutes: late, notes: m.notes?.trim() || null, updatedAt: new Date() } });
    }
    return marks.length;
  });
}

/** ملخص حضور الشهر لكل إداري. */
export async function attendanceMonth(db: Db | Tx, month: string) {
  const { start, end } = monthRange(month);
  const [staff, rows] = await Promise.all([
    officeStaff(db),
    db
      .select({ employeeId: s.attendance.employeeId, status: s.attendance.status, n: sql<number>`count(*)::int`, late: sql<number>`coalesce(sum(${s.attendance.lateMinutes}), 0)::int` })
      .from(s.attendance)
      .where(sql`${s.attendance.day} between ${start} and ${end}`)
      .groupBy(s.attendance.employeeId, s.attendance.status),
  ]);
  return staff.map((e) => {
    const mine = rows.filter((r) => r.employeeId === e.id);
    const c = (st: string) => mine.find((r) => r.status === st)?.n ?? 0;
    return { ...e, present: c("present"), late: c("late"), absent: c("absent"), leave: c("leave"), lateMinutes: mine.reduce((t, r) => t + r.late, 0) };
  });
}

// ───────────── التقييم الشهري والترقية ─────────────

/** الإنذارات المعتمدة (ونقاطها) ومخالفات السائق في الشهر لكل موظف. */
async function monthDiscipline(db: Db | Tx, start: string, end: string) {
  const [warnings, violations] = await Promise.all([
    db
      .select({ employeeId: s.hrActions.employeeId, n: sql<number>`count(*)::int`, points: sql<number>`coalesce(sum(${s.hrActions.points}), 0)::int` })
      .from(s.hrActions)
      .where(and(eq(s.hrActions.kind, "warning"), eq(s.hrActions.status, "approved"), sql`${s.hrActions.actionDate} between ${start} and ${end}`))
      .groupBy(s.hrActions.employeeId),
    db
      .select({ employeeId: s.drivers.employeeId, n: sql<number>`count(*)::int` })
      .from(s.trafficViolations)
      .innerJoin(s.drivers, eq(s.drivers.id, s.trafficViolations.driverId))
      .where(sql`${s.trafficViolations.violationDate} between ${start} and ${end}`)
      .groupBy(s.drivers.employeeId),
  ]);
  return { warnings: new Map(warnings.map((w) => [w.employeeId, w])), violations: new Map(violations.map((v) => [v.employeeId, v.n])) };
}

/** شاشة تقييم الشهر: كل موظف بتقييمه إن وُجد، وإنذاراته ومخالفاته. */
export async function evaluationMonth(db: Db | Tx, month: string) {
  const { start, end } = monthRange(month);
  const [emps, evals, disc] = await Promise.all([
    db
      .select({ id: s.employees.id, name: s.employees.nameAr, jobTitle: s.employees.jobTitle, isDriver: sql<boolean>`${s.drivers.id} is not null` })
      .from(s.employees)
      .leftJoin(s.drivers, eq(s.drivers.employeeId, s.employees.id))
      .where(and(inArray(s.employees.status, ["active", "on_leave"]), or(isNull(s.employees.hireDate), lte(s.employees.hireDate, end))))
      .orderBy(asc(s.employees.nameAr)),
    db.select().from(s.evaluations).where(eq(s.evaluations.month, start)),
    monthDiscipline(db, start, end),
  ]);
  const byEmp = new Map(evals.map((e) => [e.employeeId, e]));
  return emps.map((e) => ({ ...e, evaluation: byEmp.get(e.id) ?? null, warnings: disc.warnings.get(e.id)?.n ?? 0, violations: disc.violations.get(e.id) ?? 0 }));
}

async function scoreFor(db: Db | Tx, employeeId: number, month: string, scores: Record<string, number>) {
  const { start, end } = monthRange(month);
  const [settings, criteria, disc] = await Promise.all([getHrSettings(db), listCriteria(db, true), monthDiscipline(db, start, end)]);
  const w = disc.warnings.get(employeeId);
  const violations = settings.violationsAsWarnings ? (disc.violations.get(employeeId) ?? 0) : 0;
  // نقاط الإنذارات كما سُجلت، والمخالفة بنقاط الإنذار الافتراضية
  const c = computeEvaluation(criteria, scores, 0, 0);
  const deduction = r2((w?.points ?? 0) + violations * settings.warningPoints);
  return { ...c, deduction, finalScore: r2(Math.max(0, c.baseScore - deduction)), warnings: w?.n ?? 0, violations, start };
}

export async function saveEvaluation(db: Db | Tx, input: { employeeId: number; month: string; scores: Record<string, number>; notes?: string | null; userId?: number }) {
  await activeEmployee(db, input.employeeId);
  const c = await scoreFor(db, input.employeeId, input.month, input.scores);
  const [cur] = await db.select().from(s.evaluations).where(and(eq(s.evaluations.employeeId, input.employeeId), eq(s.evaluations.month, c.start)));
  if (cur?.status === "approved") throw new Error("التقييم معتمد؛ أرجعه لمسودة للتعديل");
  const values = {
    scores: input.scores,
    baseScore: String(c.baseScore),
    warnings: c.warnings,
    violations: c.violations,
    deduction: String(c.deduction),
    finalScore: String(c.finalScore),
    notes: input.notes?.trim() || null,
  };
  if (cur) {
    const [row] = await db.update(s.evaluations).set(values).where(eq(s.evaluations.id, cur.id)).returning();
    return row;
  }
  const [row] = await db.insert(s.evaluations).values({ ...values, employeeId: input.employeeId, month: c.start, createdBy: input.userId }).returning();
  return row;
}

/** الاعتماد يعيد الحساب بآخر الإنذارات والمخالفات ثم يثبت الدرجة. */
export async function approveEvaluation(db: Db, id: number, userId?: number) {
  return db.transaction(async (tx) => {
    const [ev] = await tx.select().from(s.evaluations).where(eq(s.evaluations.id, id)).for("update");
    if (!ev) throw new Error("التقييم غير موجود");
    if (ev.status !== "draft") throw new Error("التقييم معتمد مسبقاً");
    await saveEvaluation(tx, { employeeId: ev.employeeId, month: ev.month, scores: ev.scores, notes: ev.notes });
    await tx.update(s.evaluations).set({ status: "approved", approvedBy: userId ?? null }).where(eq(s.evaluations.id, id));
  });
}

export async function revertEvaluation(db: Db, id: number) {
  const [row] = await db.update(s.evaluations).set({ status: "draft", approvedBy: null }).where(and(eq(s.evaluations.id, id), eq(s.evaluations.status, "approved"))).returning();
  if (!row) throw new Error("التقييم ليس معتمداً");
}

/** المستحقون للترقية: آخر N تقييمات معتمدة متتالية كلها بالدرجة المطلوبة أو أعلى. */
export async function promotionCandidates(db: Db | Tx) {
  const settings = await getHrSettings(db);
  const rows = await db
    .select({ employeeId: s.evaluations.employeeId, month: s.evaluations.month, score: s.evaluations.finalScore, name: s.employees.nameAr, jobTitle: s.employees.jobTitle, basic: s.employees.basicSalary })
    .from(s.evaluations)
    .innerJoin(s.employees, eq(s.employees.id, s.evaluations.employeeId))
    .where(and(eq(s.evaluations.status, "approved"), inArray(s.employees.status, ["active", "on_leave"])))
    .orderBy(asc(s.evaluations.employeeId), desc(s.evaluations.month));
  const lastPromo = new Map(
    (await db.select({ employeeId: s.promotions.employeeId, d: sql<string>`max(${s.promotions.effectiveDate})` }).from(s.promotions).groupBy(s.promotions.employeeId)).map((p) => [p.employeeId, p.d]),
  );
  const byEmp = new Map<number, typeof rows>();
  for (const r of rows) byEmp.set(r.employeeId, [...(byEmp.get(r.employeeId) ?? []), r]);
  const out = [];
  for (const [employeeId, list] of byEmp) {
    // تقييمات بعد آخر ترقية فقط
    const since = lastPromo.get(employeeId);
    const recent = list.filter((r) => !since || r.month > since).slice(0, settings.promotionMonths);
    if (recent.length < settings.promotionMonths) continue;
    const consecutive = recent.every((r, i) => {
      if (i === 0) return true;
      const [y, m] = recent[i - 1].month.split("-").map(Number);
      const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
      return r.month === prev;
    });
    if (!consecutive || recent.some((r) => num(r.score) < settings.promotionScore)) continue;
    const avg = r2(recent.reduce((t, r) => t + num(r.score), 0) / recent.length);
    out.push({ employeeId, name: recent[0].name, jobTitle: recent[0].jobTitle, basic: num(recent[0].basic), average: avg, months: recent.length });
  }
  return out.sort((a, b) => b.average - a.average);
}

export async function promoteEmployee(db: Db, input: { employeeId: number; effectiveDate: string; toTitle?: string | null; toBasic: number; reason?: string | null; userId?: number }) {
  return db.transaction(async (tx) => {
    const { e } = await activeEmployee(tx, input.employeeId);
    if (!(input.toBasic >= 0)) throw new Error("الراتب الأساسي الجديد إلزامي");
    const toTitle = input.toTitle?.trim() || e.jobTitle;
    if (toTitle === e.jobTitle && input.toBasic === num(e.basicSalary)) throw new Error("لم يتغير المسمى ولا الراتب");
    const [row] = await tx
      .insert(s.promotions)
      .values({ employeeId: e.id, effectiveDate: input.effectiveDate, fromTitle: e.jobTitle, toTitle, fromBasic: e.basicSalary, toBasic: String(input.toBasic), reason: input.reason?.trim() || null, createdBy: input.userId })
      .returning();
    await tx.update(s.employees).set({ jobTitle: toTitle, basicSalary: String(input.toBasic), updatedAt: new Date() }).where(eq(s.employees.id, e.id));
    return row;
  });
}

export async function listPromotions(db: Db | Tx, limit = 100) {
  return db
    .select({ p: s.promotions, name: s.employees.nameAr })
    .from(s.promotions)
    .innerJoin(s.employees, eq(s.employees.id, s.promotions.employeeId))
    .orderBy(desc(s.promotions.effectiveDate), desc(s.promotions.id))
    .limit(limit);
}

// ───────────── مقدم العمولة من تطبيق السائق ─────────────

/** نافذة الطلب وسقف فئة السائق وما استُخدم منه هذا الشهر. */
export async function advanceWindow(db: Db | Tx, driverId: number, today: string) {
  const settings = await getHrSettings(db);
  const [d] = await db.select({ cls: s.drivers.commissionClass }).from(s.drivers).where(eq(s.drivers.id, driverId));
  if (!d) throw new Error("السائق غير موجود");
  const cap = num(d.cls === "international" ? settings.advanceCapInternational : settings.advanceCapDomestic);
  const { start, end } = monthRange(today.slice(0, 7));
  const [used] = await db
    .select({ v: sql<string>`coalesce(sum(${s.commissionAdvanceRequests.amount}), 0)` })
    .from(s.commissionAdvanceRequests)
    .where(
      and(
        eq(s.commissionAdvanceRequests.driverId, driverId),
        eq(s.commissionAdvanceRequests.source, "cash"),
        inArray(s.commissionAdvanceRequests.status, ["pending", "approved"]),
        sql`${s.commissionAdvanceRequests.requestDate} between ${start} and ${end}`,
      ),
    );
  const day = Number(today.slice(8, 10));
  return {
    open: day >= settings.advanceOpenDay && day <= settings.advanceCloseDay,
    openDay: settings.advanceOpenDay,
    closeDay: settings.advanceCloseDay,
    cap,
    used: num(used.v),
    remaining: r2(Math.max(0, cap - num(used.v))),
    commissionClass: d.cls,
  };
}

/**
 * طلب السائق: مقدم عمولة نقداً (في أيام الطلب وبسقف فئته)، أو سلفة يأخذها من العهدة التي معه
 * (تُقيد على عهدته وتُستقطع من راتبه بعد اعتماد المكتب، ولا يحكمها سقف مقدم العمولة).
 */
export async function requestCommissionAdvance(db: Db, input: { driverId: number; amount: number; source?: "cash" | "custody"; notes?: string | null; today: string }) {
  if (!(input.amount > 0)) throw new Error("المبلغ إلزامي");
  const source = input.source ?? "cash";
  return db.transaction(async (tx) => {
    // قفل السائق يمنع طلبين متزامنين يتجاوزان السقف
    await tx.select({ id: s.drivers.id }).from(s.drivers).where(eq(s.drivers.id, input.driverId)).for("update");
    if (source === "cash") {
      const w = await advanceWindow(tx, input.driverId, input.today);
      if (!w.open) throw new Error(`الطلبات مفتوحة من يوم ${w.openDay} إلى يوم ${w.closeDay} من كل شهر`);
      if (input.amount > w.remaining) throw new Error(`المتاح لك هذا الشهر ${w.remaining} من سقف ${w.cap}`);
    }
    const number = await nextDocumentNumber(tx, "commission_advance", "CAR", Number(input.today.slice(0, 4)));
    const [row] = await tx
      .insert(s.commissionAdvanceRequests)
      .values({ number, driverId: input.driverId, requestDate: input.today, amount: String(r2(input.amount)), source, notes: input.notes?.trim() || null })
      .returning();
    return row;
  });
}

export async function driverAdvanceRequests(db: Db | Tx, driverId: number) {
  return db.select().from(s.commissionAdvanceRequests).where(eq(s.commissionAdvanceRequests.driverId, driverId)).orderBy(desc(s.commissionAdvanceRequests.requestDate), desc(s.commissionAdvanceRequests.id)).limit(10);
}

export async function listAdvanceRequests(db: Db | Tx, f: { status?: string; q?: string; from?: string; to?: string } = {}) {
  return db
    .select({ r: s.commissionAdvanceRequests, name: s.employees.nameAr, commissionClass: s.drivers.commissionClass, advance: s.employeeAdvances.number })
    .from(s.commissionAdvanceRequests)
    .innerJoin(s.drivers, eq(s.drivers.id, s.commissionAdvanceRequests.driverId))
    .innerJoin(s.employees, eq(s.employees.id, s.drivers.employeeId))
    .leftJoin(s.employeeAdvances, eq(s.employeeAdvances.id, s.commissionAdvanceRequests.advanceId))
    .where(
      and(
        f.status ? eq(s.commissionAdvanceRequests.status, f.status as (typeof s.commissionAdvanceStatus.enumValues)[number]) : undefined,
        f.from ? gte(s.commissionAdvanceRequests.requestDate, f.from) : undefined,
        f.to ? lte(s.commissionAdvanceRequests.requestDate, f.to) : undefined,
        f.q ? or(ilike(s.commissionAdvanceRequests.number, like(f.q)), ilike(s.employees.nameAr, like(f.q))) : undefined,
      ),
    )
    .orderBy(desc(s.commissionAdvanceRequests.requestDate), desc(s.commissionAdvanceRequests.id))
    .limit(300);
}

/** الاعتماد: سلفة بقسط يساوي المبلغ (تُستقطع كاملة من مسير الشهر)، وتُصرف فوراً إن اختير الصندوق. */
export async function approveAdvanceRequest(db: Db, id: number, opts: { cashAccountId?: number | null; installment?: number | null; userId?: number }) {
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(s.commissionAdvanceRequests).where(eq(s.commissionAdvanceRequests.id, id)).for("update");
    if (!r) throw new Error("الطلب غير موجود");
    if (r.status !== "pending") throw new Error(`الطلب ${r.number} تمت معالجته`);
    const [d] = await tx.select({ employeeId: s.drivers.employeeId }).from(s.drivers).where(eq(s.drivers.id, r.driverId));
    const fromCustody = r.source === "custody";
    // سلفة العهدة تُقسّط على الرواتب حسب ما يحدده المعتمد، ومقدم العمولة يُستقطع كاملاً
    const installment = fromCustody && opts.installment ? Math.min(opts.installment, num(r.amount)) : num(r.amount);
    const adv = await createAdvance(tx, {
      employeeId: d.employeeId,
      advanceDate: r.requestDate,
      amount: num(r.amount),
      installment,
      notes: `${fromCustody ? "سلفة من العهدة" : "مقدم عمولة"} – طلب ${r.number}`,
      userId: opts.userId,
    });
    if (fromCustody) await payAdvance(tx, adv.id, { fromCustodyOf: r.driverId, userId: opts.userId });
    else if (opts.cashAccountId) await payAdvance(tx, adv.id, { cashAccountId: opts.cashAccountId, userId: opts.userId });
    await tx.update(s.commissionAdvanceRequests).set({ status: "approved", advanceId: adv.id, decidedBy: opts.userId ?? null }).where(eq(s.commissionAdvanceRequests.id, id));
    await notifyDriver(tx, r.driverId, { kind: "advance_approved", body: `${r.number} · ${num(r.amount)}`, href: "/driver/balance" });
    return adv;
  });
}

export async function rejectAdvanceRequest(db: Db, id: number, opts: { reason: string; userId?: number }) {
  if (!opts.reason.trim()) throw new Error("اكتب سبب الرفض");
  const [row] = await db
    .update(s.commissionAdvanceRequests)
    .set({ status: "rejected", rejectReason: opts.reason.trim(), decidedBy: opts.userId ?? null })
    .where(and(eq(s.commissionAdvanceRequests.id, id), eq(s.commissionAdvanceRequests.status, "pending")))
    .returning();
  if (!row) throw new Error("الطلب تمت معالجته");
  await notifyDriver(db, row.driverId, { kind: "advance_rejected", body: `${row.number}: ${opts.reason.trim()}`, href: "/driver/balance" });
}

// ───────────── لوحة الموارد البشرية وتقاريرها ─────────────

export async function hrDashboard(db: Db | Tx, today: string) {
  const { start, end } = monthRange(today.slice(0, 7));
  const [[emp], [custody], [pend], [month], onLeave] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)::int`,
        drivers: sql<number>`count(${s.drivers.id})::int`,
      })
      .from(s.employees)
      .leftJoin(s.drivers, eq(s.drivers.employeeId, s.employees.id))
      .where(inArray(s.employees.status, ["active", "on_leave"])),
    db
      .select({
        n: sql<number>`count(*)::int`,
        cash: sql<string>`coalesce(sum(case when ${s.custodyDocs.kind} = 'cash' then ${s.custodyDocs.amount} end), 0)`,
        inKind: sql<string>`coalesce(sum(case when ${s.custodyDocs.kind} = 'in_kind' then ${s.custodyDocs.amount} end), 0)`,
      })
      .from(s.custodyDocs)
      .where(eq(s.custodyDocs.status, "delivered")),
    db
      .select({
        leaves: sql<number>`(select count(*)::int from leave_requests where status = 'pending')`,
        advances: sql<number>`(select count(*)::int from commission_advance_requests where status = 'pending')`,
        actions: sql<number>`(select count(*)::int from hr_actions where status = 'draft')`,
        custody: sql<number>`(select count(*)::int from custody_docs where status in ('draft', 'approved'))`,
      })
      .from(sql`(select 1) x`),
    db
      .select({
        warnings: sql<number>`count(*) filter (where ${s.hrActions.kind} = 'warning')::int`,
        incentives: sql<string>`coalesce(sum(${s.hrActions.amount}) filter (where ${s.hrActions.kind} = 'incentive'), 0)`,
        penalties: sql<string>`coalesce(sum(${s.hrActions.amount}) filter (where ${s.hrActions.kind} = 'penalty'), 0)`,
      })
      .from(s.hrActions)
      .where(and(eq(s.hrActions.status, "approved"), sql`${s.hrActions.actionDate} between ${start} and ${end}`)),
    db
      .select({ name: s.employees.nameAr, type: s.leaveTypes.nameAr, toDate: s.leaveRequests.toDate })
      .from(s.leaveRequests)
      .innerJoin(s.employees, eq(s.employees.id, s.leaveRequests.employeeId))
      .innerJoin(s.leaveTypes, eq(s.leaveTypes.id, s.leaveRequests.typeId))
      .where(and(eq(s.leaveRequests.status, "approved"), lte(s.leaveRequests.fromDate, today), gte(s.leaveRequests.toDate, today)))
      .orderBy(asc(s.leaveRequests.toDate)),
  ]);
  return {
    employees: emp.total,
    drivers: emp.drivers,
    staff: emp.total - emp.drivers,
    onLeave,
    custody: { open: custody.n, cash: num(custody.cash), inKind: num(custody.inKind) },
    pending: pend,
    month: { warnings: month.warnings, incentives: num(month.incentives), penalties: num(month.penalties) },
  };
}

/** العهد المفتوحة مجمعة لكل موظف. */
export async function openCustodyByEmployee(db: Db | Tx) {
  return db
    .select({
      employeeId: s.employees.id,
      name: s.employees.nameAr,
      n: sql<number>`count(*)::int`,
      cash: sql<string>`coalesce(sum(case when ${s.custodyDocs.kind} = 'cash' then ${s.custodyDocs.amount} end), 0)`,
      inKind: sql<string>`coalesce(sum(case when ${s.custodyDocs.kind} = 'in_kind' then ${s.custodyDocs.amount} end), 0)`,
      oldest: sql<string>`min(${s.custodyDocs.docDate})`,
    })
    .from(s.custodyDocs)
    .innerJoin(s.employees, eq(s.employees.id, s.custodyDocs.employeeId))
    .where(eq(s.custodyDocs.status, "delivered"))
    .groupBy(s.employees.id, s.employees.nameAr)
    .orderBy(asc(s.employees.nameAr));
}

/** تكلفة كل موظف في مسير الشهر: المستحق وحصة المنشأة في التأمينات ومخصص نهاية الخدمة والعمولات. */
export async function employeeCost(db: Db | Tx, month: string) {
  const { start } = monthRange(month);
  const [run] = await db.select().from(s.payrollRuns).where(eq(s.payrollRuns.month, start));
  if (!run) return { run: null, rows: [] };
  const rows = await db
    .select({ l: s.payrollLines, name: s.employees.nameAr, cc: s.costCenters.nameAr })
    .from(s.payrollLines)
    .innerJoin(s.employees, eq(s.employees.id, s.payrollLines.employeeId))
    .leftJoin(s.costCenters, eq(s.costCenters.id, s.payrollLines.costCenterId))
    .where(eq(s.payrollLines.runId, run.id))
    .orderBy(asc(s.employees.nameAr));
  return {
    run,
    rows: rows.map(({ l, name, cc }) => {
      const salary = r2(num(l.basic) + num(l.housing) + num(l.otherAllowances) + num(l.additions) + num(l.incentives) - num(l.absenceDeduction) - num(l.deductions));
      const employer = r2(num(l.gosiEmployer) + num(l.eosbAccrual));
      return { name, cc, isDriver: l.driverId != null, salary, commissions: num(l.commissions), employer, total: r2(salary + num(l.commissions) + employer) };
    }),
  };
}

/** درجات التقييم للأشهر الستة الأخيرة لكل موظف. */
export async function evaluationHistory(db: Db | Tx, today: string) {
  const [y, m] = today.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 6, 1)).toISOString().slice(0, 10);
  const rows = await db
    .select({ employeeId: s.evaluations.employeeId, name: s.employees.nameAr, month: s.evaluations.month, score: s.evaluations.finalScore })
    .from(s.evaluations)
    .innerJoin(s.employees, eq(s.employees.id, s.evaluations.employeeId))
    .where(and(eq(s.evaluations.status, "approved"), gte(s.evaluations.month, from)))
    .orderBy(asc(s.employees.nameAr), asc(s.evaluations.month));
  const months = Array.from({ length: 6 }, (_, i) => new Date(Date.UTC(y, m - 6 + i, 1)).toISOString().slice(0, 10));
  const byEmp = new Map<number, { name: string; scores: Record<string, number> }>();
  for (const r of rows) {
    const e = byEmp.get(r.employeeId) ?? { name: r.name, scores: {} };
    e.scores[r.month] = num(r.score);
    byEmp.set(r.employeeId, e);
  }
  return { months, rows: [...byEmp.values()] };
}

/** حسابات المصروف التي تُسوّى عليها العهدة النقدية (بلا مركز تكلفة إلزامي). */
export async function custodyExpenseAccounts(db: Db | Tx) {
  return db
    .select({ id: s.accounts.id, code: s.accounts.code, nameAr: s.accounts.nameAr })
    .from(s.accounts)
    .where(and(eq(s.accounts.type, "expense"), eq(s.accounts.isPostable, true), eq(s.accounts.isActive, true), eq(s.accounts.requiresCostCenter, false)))
    .orderBy(asc(s.accounts.code));
}
