import { and, asc, desc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import * as s from "@/db/schema";
import { addSubAccountTx } from "@/lib/accounts";
import { createJournalEntryTx, deleteEntryTx, nextDocumentNumber, type LineInput } from "@/lib/ledger";
import { computePayrollLine, monthLabel, monthRange, PAYROLL_ACCOUNTS } from "@/data/payroll";

// الرواتب: الموظف ← السلفة ← مسير الشهر (قيد الاستحقاق عند الاعتماد) ← الصرف من البنك بالصافي.
// العمولات قُيدت لحساب راتب السائق عند اعتماد الشحنات، فالمسير يعرضها ويصرفها ولا يقيدها مرة ثانية.

const num = (v: string | null | undefined) => (v == null ? 0 : Number(v));
const r2 = (v: number) => Math.round(v * 100) / 100 + 0;

async function accountIdByCode(db: Db | Tx, code: string) {
  const [row] = await db.select({ id: s.accounts.id }).from(s.accounts).where(eq(s.accounts.code, code));
  if (!row) throw new Error(`الحساب ${code} غير موجود في الشجرة`);
  return row.id;
}

async function cashAccount(tx: Tx, id: number | null | undefined, what: string) {
  const [cash] = id ? await tx.select().from(s.accounts).where(eq(s.accounts.id, id)) : [];
  if (!cash || !cash.isPostable || !/^110[12]/.test(cash.code)) throw new Error(`اختر ${what}`);
  return cash;
}

// ───────────── الموظفون ─────────────

export interface EmployeeInput {
  nameAr: string;
  nationalId?: string | null;
  jobTitle?: string | null;
  hireDate?: string | null;
  basicSalary?: number;
  housingAllowance?: number;
  allowances?: number;
  isSaudi?: boolean;
  gosiSubject?: boolean;
  bankName?: string | null;
  iban?: string | null;
}

const cleanIban = (v: string | null | undefined) => {
  const iban = v?.replace(/\s+/g, "").toUpperCase() || null;
  if (iban && !/^SA\d{22}$/.test(iban)) throw new Error("الآيبان السعودي يبدأ بـ SA ويتبعه 22 رقماً");
  return iban;
};

/** موظف جديد (إداري أو فني) مع حساب رواتبه المستحقة تحت 2107. السائق يُضاف من شاشة السائقين. */
export async function createEmployee(db: Db, input: EmployeeInput) {
  const name = input.nameAr.trim();
  if (!name) throw new Error("الاسم إلزامي");
  return db.transaction(async (tx) => {
    const payable = await addSubAccountTx(tx, await accountIdByCode(tx, "2107"), `رواتب مستحقة – ${name}`);
    const [employee] = await tx
      .insert(s.employees)
      .values({
        nameAr: name,
        nationalId: input.nationalId || null,
        jobTitle: input.jobTitle || null,
        hireDate: input.hireDate || null,
        basicSalary: String(input.basicSalary ?? 0),
        housingAllowance: String(input.housingAllowance ?? 0),
        allowances: String(input.allowances ?? 0),
        isSaudi: input.isSaudi ?? false,
        gosiSubject: input.gosiSubject ?? true,
        bankName: input.bankName || null,
        iban: cleanIban(input.iban),
        payableAccountId: payable.id,
      })
      .returning();
    return employee;
  });
}

export async function updateEmployee(db: Db, id: number, input: Partial<EmployeeInput> & { status?: "active" | "on_leave" | "terminated" }) {
  const set: Partial<typeof s.employees.$inferInsert> = { updatedAt: new Date() };
  if (input.nameAr !== undefined) set.nameAr = input.nameAr.trim();
  if (input.nationalId !== undefined) set.nationalId = input.nationalId || null;
  if (input.jobTitle !== undefined) set.jobTitle = input.jobTitle || null;
  if (input.hireDate !== undefined) set.hireDate = input.hireDate || null;
  if (input.basicSalary !== undefined) set.basicSalary = String(input.basicSalary);
  if (input.housingAllowance !== undefined) set.housingAllowance = String(input.housingAllowance);
  if (input.allowances !== undefined) set.allowances = String(input.allowances);
  if (input.isSaudi !== undefined) set.isSaudi = input.isSaudi;
  if (input.gosiSubject !== undefined) set.gosiSubject = input.gosiSubject;
  if (input.bankName !== undefined) set.bankName = input.bankName || null;
  if (input.iban !== undefined) set.iban = cleanIban(input.iban);
  if (input.status !== undefined) set.status = input.status;
  if (input.status === "terminated") {
    const [open] = await db
      .select({ number: s.custodyDocs.number })
      .from(s.custodyDocs)
      .where(and(eq(s.custodyDocs.employeeId, id), inArray(s.custodyDocs.status, ["approved", "delivered"])))
      .limit(1);
    if (open) throw new Error(`على الموظف عهدة غير مسواة (${open.number})؛ سوّها أو استلمها قبل إنهاء خدمته`);
  }
  const [row] = await db.update(s.employees).set(set).where(eq(s.employees.id, id)).returning();
  if (!row) throw new Error("الموظف غير موجود");
  return row;
}

// ───────────── السلف ─────────────

export async function createAdvance(
  db: Db | Tx,
  input: { employeeId: number; advanceDate: string; amount: number; installment?: number | null; notes?: string | null; userId?: number },
) {
  if (!(input.amount > 0)) throw new Error("مبلغ السلفة إلزامي");
  const installment = input.installment ?? input.amount;
  if (!(installment > 0) || installment > input.amount) throw new Error("القسط الشهري بين صفر ومبلغ السلفة");
  return db.transaction(async (tx) => {
    const [emp] = await tx.select().from(s.employees).where(eq(s.employees.id, input.employeeId));
    if (!emp || emp.status === "terminated") throw new Error("الموظف غير موجود أو منتهية خدمته");
    const number = await nextDocumentNumber(tx, "employee_advance", "ADV", Number(input.advanceDate.slice(0, 4)));
    const [row] = await tx
      .insert(s.employeeAdvances)
      .values({
        number,
        employeeId: emp.id,
        advanceDate: input.advanceDate,
        amount: String(input.amount),
        installment: String(installment),
        notes: input.notes || null,
        createdBy: input.userId,
      })
      .returning();
    return row;
  });
}

async function lockAdvance(tx: Tx, id: number) {
  const [a] = await tx.select().from(s.employeeAdvances).where(eq(s.employeeAdvances.id, id)).for("update");
  if (!a) throw new Error("السلفة غير موجودة");
  return a;
}

/** صرف السلفة: من حـ/ سلف الموظفين إلى حـ/ الصندوق أو البنك. */
export async function payAdvance(db: Db | Tx, id: number, opts: { cashAccountId: number; userId?: number }) {
  return db.transaction(async (tx) => {
    const a = await lockAdvance(tx, id);
    if (a.status !== "pending") throw new Error(`السلفة ${a.number} مصروفة مسبقاً`);
    const cash = await cashAccount(tx, opts.cashAccountId, "الصندوق أو البنك الذي صُرفت منه السلفة");
    const [emp] = await tx.select().from(s.employees).where(eq(s.employees.id, a.employeeId));
    const description = `سلفة ${a.number} – ${emp.nameAr}`;
    const entry = await createJournalEntryTx(tx, {
      entryDate: a.advanceDate,
      description,
      source: { type: "employee_advance", id: a.id },
      post: true,
      userId: opts.userId,
      lines: [
        { accountId: await accountIdByCode(tx, PAYROLL_ACCOUNTS.advances), debit: num(a.amount), description },
        { accountId: cash.id, credit: num(a.amount), description },
      ],
    });
    await tx
      .update(s.employeeAdvances)
      .set({ status: "paid", cashAccountId: cash.id, journalEntryId: entry.id, approvedBy: opts.userId ?? null })
      .where(eq(s.employeeAdvances.id, id));
    return entry;
  });
}

export async function revertAdvance(db: Db, id: number) {
  return db.transaction(async (tx) => {
    const a = await lockAdvance(tx, id);
    if (a.status !== "paid") throw new Error("الإرجاع متاح للسلفة المصروفة فقط");
    if (num(a.repaidAmount) > 0) throw new Error("استُقطع من السلفة في مسير معتمد؛ أرجع المسير أولاً");
    await tx.update(s.employeeAdvances).set({ status: "pending", journalEntryId: null, approvedBy: null }).where(eq(s.employeeAdvances.id, id));
    if (a.journalEntryId) await deleteEntryTx(tx, a.journalEntryId);
  });
}

export async function deleteAdvance(db: Db, id: number, opts: { reason: string; userId?: number }) {
  if (!opts.reason.trim()) throw new Error("اكتب سبب الحذف");
  return db.transaction(async (tx) => {
    const a = await lockAdvance(tx, id);
    if (a.status !== "pending") throw new Error("الحذف متاح للسلفة غير المصروفة فقط");
    await tx.insert(s.deletionLog).values({ entity: "employee_advance", entityId: String(id), snapshot: a, reason: opts.reason.trim(), userId: opts.userId });
    await tx.delete(s.employeeAdvances).where(eq(s.employeeAdvances.id, id));
  });
}

/** المتبقي من سلف كل موظف وقسطه المستحق هذا الشهر. */
async function advanceDue(tx: Tx | Db, employeeIds: number[]) {
  const due = new Map<number, { outstanding: number; installment: number }>();
  if (!employeeIds.length) return due;
  const rows = await tx
    .select()
    .from(s.employeeAdvances)
    .where(and(eq(s.employeeAdvances.status, "paid"), inArray(s.employeeAdvances.employeeId, employeeIds)));
  for (const a of rows) {
    const left = num(a.amount) - num(a.repaidAmount);
    const d = due.get(a.employeeId) ?? { outstanding: 0, installment: 0 };
    d.outstanding = r2(d.outstanding + left);
    d.installment = r2(d.installment + Math.min(num(a.installment), left));
    due.set(a.employeeId, d);
  }
  return due;
}

// ───────────── المسير ─────────────

async function lockRun(tx: Tx, id: number) {
  const [run] = await tx.select().from(s.payrollRuns).where(eq(s.payrollRuns.id, id)).for("update");
  if (!run) throw new Error("المسير غير موجود");
  return run;
}

/** مركز تكلفة السائق: مركبته في آخر يوم من الشهر، أو آخر مركبة استلمها قبله. */
async function driverCostCenter(tx: Tx, driverId: number, monthEnd: string) {
  const [row] = await tx
    .select({ cc: s.vehicles.costCenterId })
    .from(s.vehicleAssignments)
    .innerJoin(s.vehicles, eq(s.vehicles.id, s.vehicleAssignments.vehicleId))
    .where(and(eq(s.vehicleAssignments.driverId, driverId), lte(s.vehicleAssignments.fromDate, monthEnd)))
    .orderBy(sql`(${s.vehicleAssignments.toDate} is null or ${s.vehicleAssignments.toDate} >= ${monthEnd}) desc`, desc(s.vehicleAssignments.fromDate))
    .limit(1);
  return row?.cc ?? null;
}

/** عمولات الشحنات المرحّلة لحساب راتب الموظف خلال الشهر. */
async function commissionsFor(tx: Tx, accountIds: number[], start: string, end: string) {
  const out = new Map<number, number>();
  if (!accountIds.length) return out;
  const rows = await tx
    .select({ accountId: s.journalLines.accountId, total: sql<string>`sum(${s.journalLines.creditBase} - ${s.journalLines.debitBase})` })
    .from(s.journalLines)
    .innerJoin(s.journalEntries, eq(s.journalEntries.id, s.journalLines.entryId))
    .where(
      and(
        eq(s.journalEntries.status, "posted"),
        inArray(s.journalLines.accountId, accountIds),
        sql`${s.journalLines.waybillId} is not null`,
        sql`${s.journalEntries.entryDate} between ${start} and ${end}`,
      ),
    )
    .groupBy(s.journalLines.accountId);
  for (const r of rows) out.set(r.accountId, num(r.total));
  return out;
}

/** مخالفات السائقين غير المخصومة حتى آخر الشهر: يحجزها المسير المسودة لنفسه حتى لا تُخصم مرتين. */
async function claimViolations(tx: Tx, runId: number, driverIds: number[], end: string) {
  await tx.update(s.trafficViolations).set({ payrollRunId: null }).where(eq(s.trafficViolations.payrollRunId, runId));
  const out = new Map<number, number>();
  if (!driverIds.length) return out;
  const rows = await tx
    .update(s.trafficViolations)
    .set({ payrollRunId: runId })
    .where(
      and(
        eq(s.trafficViolations.chargeTo, "driver"),
        isNull(s.trafficViolations.payrollRunId),
        inArray(s.trafficViolations.driverId, driverIds),
        lte(s.trafficViolations.violationDate, end),
      ),
    )
    .returning({ driverId: s.trafficViolations.driverId, amount: s.trafficViolations.amount });
  for (const r of rows) out.set(r.driverId!, r2((out.get(r.driverId!) ?? 0) + num(r.amount)));
  return out;
}

/** جزاءات وحوافز الموارد البشرية المعتمدة حتى آخر الشهر: يحجزها المسير المسودة كالمخالفات. */
async function claimHrActions(tx: Tx, runId: number, employeeIds: number[], end: string) {
  await tx.update(s.hrActions).set({ payrollRunId: null }).where(eq(s.hrActions.payrollRunId, runId));
  const out = new Map<number, { incentives: number; penalties: number }>();
  if (!employeeIds.length) return out;
  const rows = await tx
    .update(s.hrActions)
    .set({ payrollRunId: runId })
    .where(
      and(
        inArray(s.hrActions.kind, ["incentive", "penalty"]),
        eq(s.hrActions.status, "approved"),
        isNull(s.hrActions.payrollRunId),
        inArray(s.hrActions.employeeId, employeeIds),
        lte(s.hrActions.actionDate, end),
      ),
    )
    .returning({ employeeId: s.hrActions.employeeId, kind: s.hrActions.kind, amount: s.hrActions.amount });
  for (const r of rows) {
    const d = out.get(r.employeeId) ?? { incentives: 0, penalties: 0 };
    if (r.kind === "incentive") d.incentives = r2(d.incentives + num(r.amount));
    else d.penalties = r2(d.penalties + num(r.amount));
    out.set(r.employeeId, d);
  }
  return out;
}

const overlapDays = (from: string, to: string, start: string, end: string) => {
  const a = from > start ? from : start;
  const b = to < end ? to : end;
  return b < a ? 0 : Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1;
};

/** أيام بلا أجر في الشهر: الإجازات المعتمدة بدون راتب، وأيام الغياب في سجل الحضور. */
async function unpaidDays(tx: Tx, employeeIds: number[], start: string, end: string) {
  const out = new Map<number, number>();
  if (!employeeIds.length) return out;
  const leaves = await tx
    .select({ employeeId: s.leaveRequests.employeeId, fromDate: s.leaveRequests.fromDate, toDate: s.leaveRequests.toDate })
    .from(s.leaveRequests)
    .innerJoin(s.leaveTypes, eq(s.leaveTypes.id, s.leaveRequests.typeId))
    .where(
      and(
        eq(s.leaveRequests.status, "approved"),
        eq(s.leaveTypes.paid, false),
        inArray(s.leaveRequests.employeeId, employeeIds),
        lte(s.leaveRequests.fromDate, end),
        sql`${s.leaveRequests.toDate} >= ${start}`,
      ),
    );
  for (const l of leaves) out.set(l.employeeId, (out.get(l.employeeId) ?? 0) + overlapDays(l.fromDate, l.toDate, start, end));
  const absent = await tx
    .select({ employeeId: s.attendance.employeeId, n: sql<number>`count(*)::int` })
    .from(s.attendance)
    .where(and(eq(s.attendance.status, "absent"), inArray(s.attendance.employeeId, employeeIds), sql`${s.attendance.day} between ${start} and ${end}`))
    .groupBy(s.attendance.employeeId);
  for (const a of absent) out.set(a.employeeId, (out.get(a.employeeId) ?? 0) + a.n);
  return out;
}

const serviceYears = (hireDate: string | null, asOf: string) =>
  hireDate ? (Date.parse(asOf) - Date.parse(hireDate)) / (365.25 * 86_400_000) : null;

type LineRow = typeof s.payrollLines.$inferSelect;
type Adjust = Pick<LineRow, "absenceDays" | "additions" | "deductions" | "advanceDeduction" | "notes">;

/** يبني سطور المسير من بيانات الموظفين والعمولات والسلف، مع الإبقاء على التعديلات اليدوية. */
async function buildLines(tx: Tx, runId: number, month: string, keep: Map<number, Adjust>) {
  const { start, end } = monthRange(month);
  const emps = await tx
    .select({ e: s.employees, driverId: s.drivers.id })
    .from(s.employees)
    .leftJoin(s.drivers, eq(s.drivers.employeeId, s.employees.id))
    .where(and(inArray(s.employees.status, ["active", "on_leave"]), or(isNull(s.employees.hireDate), lte(s.employees.hireDate, end))))
    .orderBy(asc(s.employees.nameAr));
  const ids = emps.map((x) => x.e.id);
  const commissions = await commissionsFor(tx, emps.map((x) => x.e.payableAccountId).filter((v): v is number => v != null), start, end);
  const advances = await advanceDue(tx, ids);
  const violations = await claimViolations(tx, runId, emps.map((x) => x.driverId).filter((v): v is number => v != null), end);
  const hr = await claimHrActions(tx, runId, ids, end);
  const unpaid = await unpaidDays(tx, ids, start, end);
  // سائق بلا مركبة بعد: تُحمَّل تكلفته على الإدارة العامة
  const [adm] = await tx.select({ id: s.costCenters.id }).from(s.costCenters).where(eq(s.costCenters.code, "ADM"));
  await tx.delete(s.payrollLines).where(eq(s.payrollLines.runId, runId));
  const values = [];
  for (const { e, driverId } of emps) {
    const k = keep.get(e.id);
    const adv = advances.get(e.id);
    const advanceDeduction = k ? Math.min(num(k.advanceDeduction), adv?.outstanding ?? 0) : (adv?.installment ?? 0);
    const h = hr.get(e.id);
    const leaveDays = unpaid.get(e.id) ?? 0;
    const base = {
      basic: num(e.basicSalary),
      housing: num(e.housingAllowance),
      otherAllowances: num(e.allowances),
      absenceDays: num(k?.absenceDays),
      additions: num(k?.additions),
      deductions: num(k?.deductions),
      commissions: commissions.get(e.payableAccountId ?? -1) ?? 0,
      violations: driverId ? (violations.get(driverId) ?? 0) : 0,
      advanceDeduction,
      incentives: h?.incentives ?? 0,
      penalties: h?.penalties ?? 0,
      leaveDays,
    };
    const c = computePayrollLine({ ...base, absenceDays: base.absenceDays + leaveDays, isSaudi: e.isSaudi, gosiSubject: e.gosiSubject, serviceYears: serviceYears(e.hireDate, end) });
    values.push({
      runId,
      employeeId: e.id,
      driverId,
      costCenterId: driverId ? ((await driverCostCenter(tx, driverId, end)) ?? adm?.id ?? null) : null,
      ...Object.fromEntries(Object.entries(base).map(([key, v]) => [key, String(v)])),
      absenceDeduction: String(c.absenceDeduction),
      gosiEmployee: String(c.gosiEmployee),
      gosiEmployer: String(c.gosiEmployer),
      eosbAccrual: String(c.eosbAccrual),
      net: String(c.net),
      notes: k?.notes ?? null,
    } as typeof s.payrollLines.$inferInsert);
  }
  if (values.length) await tx.insert(s.payrollLines).values(values);
  return values.length;
}

/** مسير شهر جديد بسطر لكل موظف نشط. */
export async function createPayrollRun(db: Db, input: { month: string; userId?: number; notes?: string | null }) {
  const { start } = monthRange(input.month);
  return db.transaction(async (tx) => {
    const [exists] = await tx.select({ id: s.payrollRuns.id }).from(s.payrollRuns).where(eq(s.payrollRuns.month, start));
    if (exists) throw new Error(`مسير ${monthLabel(start)} موجود مسبقاً`);
    const number = await nextDocumentNumber(tx, "payroll_run", "PR", Number(start.slice(0, 4)));
    const [run] = await tx.insert(s.payrollRuns).values({ number, month: start, notes: input.notes || null, createdBy: input.userId }).returning();
    const count = await buildLines(tx, run.id, start, new Map());
    if (!count) throw new Error("لا يوجد موظفون نشطون لهذا الشهر");
    return run;
  });
}

/** تحديث المسودة من بيانات الموظفين والعمولات (بعد اعتماد شحنات جديدة مثلاً)، مع الإبقاء على الإدخالات اليدوية. */
export async function refreshPayrollRun(db: Db, runId: number) {
  return db.transaction(async (tx) => {
    const run = await lockRun(tx, runId);
    if (run.status !== "draft") throw new Error("التحديث متاح للمسودة فقط");
    const lines = await tx.select().from(s.payrollLines).where(eq(s.payrollLines.runId, runId));
    await buildLines(tx, runId, run.month, new Map(lines.map((l) => [l.employeeId, l])));
  });
}

export interface PayrollAdjustment {
  employeeId: number;
  absenceDays?: number | null;
  additions?: number | null;
  deductions?: number | null;
  advanceDeduction?: number | null;
  notes?: string | null;
}

/** إدخال الغياب والإضافات والخصومات وقسط السلفة على سطور المسودة (من الجدول أو لصقاً من Excel). */
export async function adjustPayrollLines(db: Db, runId: number, rows: PayrollAdjustment[]) {
  return db.transaction(async (tx) => {
    const run = await lockRun(tx, runId);
    if (run.status !== "draft") throw new Error("المسير معتمد؛ أرجعه لمسودة للتعديل");
    const lines = await tx.select().from(s.payrollLines).where(eq(s.payrollLines.runId, runId));
    const keep = new Map<number, Adjust>(lines.map((l) => [l.employeeId, l]));
    const advances = await advanceDue(tx, rows.map((r) => r.employeeId));
    for (const r of rows) {
      const cur = keep.get(r.employeeId);
      if (!cur) throw new Error("الموظف ليس في هذا المسير؛ حدّث المسير أولاً");
      for (const [key, v] of [["absenceDays", r.absenceDays], ["additions", r.additions], ["deductions", r.deductions], ["advanceDeduction", r.advanceDeduction]] as const) {
        if (v != null && v < 0) throw new Error("لا تُقبل قيم سالبة");
        if (key === "absenceDays" && v != null && v > 30) throw new Error("أيام الغياب لا تتجاوز 30");
      }
      const outstanding = advances.get(r.employeeId)?.outstanding ?? 0;
      if (r.advanceDeduction != null && r.advanceDeduction > outstanding) throw new Error(`قسط السلفة أكبر من المتبقي عليه (${outstanding})`);
      keep.set(r.employeeId, {
        absenceDays: r.absenceDays != null ? String(r.absenceDays) : cur.absenceDays,
        additions: r.additions != null ? String(r.additions) : cur.additions,
        deductions: r.deductions != null ? String(r.deductions) : cur.deductions,
        advanceDeduction: r.advanceDeduction != null ? String(r.advanceDeduction) : cur.advanceDeduction,
        notes: r.notes !== undefined && r.notes !== null ? r.notes || null : cur.notes,
      });
    }
    await buildLines(tx, runId, run.month, keep);
  });
}

/** قيد الاستحقاق لسطور المسير (بدون العمولات والمخالفات لأنها مقيدة على ذمة الموظف عند تسجيلها). */
export async function payrollPostingLines(tx: Tx, run: { number: string; month: string }, lines: (LineRow & { name: string; payableAccountId: number | null })[]) {
  const acc = {
    driver: await accountIdByCode(tx, PAYROLL_ACCOUNTS.driverSalaries),
    staff: await accountIdByCode(tx, PAYROLL_ACCOUNTS.staffSalaries),
    gosiExp: await accountIdByCode(tx, PAYROLL_ACCOUNTS.gosiExpense),
    eosbExp: await accountIdByCode(tx, PAYROLL_ACCOUNTS.eosbExpense),
    gosiPay: await accountIdByCode(tx, PAYROLL_ACCOUNTS.gosiPayable),
    eosbProv: await accountIdByCode(tx, PAYROLL_ACCOUNTS.eosbProvision),
    advances: await accountIdByCode(tx, PAYROLL_ACCOUNTS.advances),
    penalties: await accountIdByCode(tx, PAYROLL_ACCOUNTS.penalties),
  };
  const out: LineInput[] = [];
  const pair = (debit: LineInput, credit: LineInput, amount: number) => {
    const a = r2(amount);
    if (a <= 0) return;
    out.push({ ...debit, debit: a }, { ...credit, credit: a });
  };
  for (const l of lines) {
    if (!l.payableAccountId) throw new Error(`لا يوجد حساب رواتب مستحقة للموظف ${l.name}`);
    if (l.driverId && !l.costCenterId) throw new Error(`السائق ${l.name} بلا مركز تكلفة؛ أسنده لمركبة ثم حدّث المسير`);
    const earnings = r2(num(l.basic) + num(l.housing) + num(l.otherAllowances) + num(l.additions) + num(l.incentives) - num(l.absenceDeduction) - num(l.deductions));
    if (earnings < 0) throw new Error(`خصومات ${l.name} أكبر من استحقاقه`);
    const payable = { accountId: l.payableAccountId, driverId: l.driverId };
    const tag = `${l.name} – ${monthLabel(run.month)}`;
    pair(
      { accountId: l.driverId ? acc.driver : acc.staff, costCenterId: l.costCenterId, driverId: l.driverId, description: `راتب ${tag}` },
      { ...payable, description: `راتب ${tag}` },
      earnings,
    );
    pair({ ...payable, description: `حصة الموظف في التأمينات – ${tag}` }, { accountId: acc.gosiPay, description: `حصة الموظف في التأمينات – ${tag}` }, num(l.gosiEmployee));
    pair({ ...payable, description: `جزاءات – ${tag}` }, { accountId: acc.penalties, description: `جزاءات محتجزة – ${tag}` }, num(l.penalties));
    pair({ ...payable, description: `قسط سلفة – ${tag}` }, { accountId: acc.advances, description: `قسط سلفة – ${tag}` }, num(l.advanceDeduction));
    pair({ accountId: acc.gosiExp, costCenterId: l.costCenterId, description: `حصة المنشأة في التأمينات – ${tag}` }, { accountId: acc.gosiPay, description: `حصة المنشأة في التأمينات – ${tag}` }, num(l.gosiEmployer));
    pair({ accountId: acc.eosbExp, costCenterId: l.costCenterId, description: `مخصص نهاية الخدمة – ${tag}` }, { accountId: acc.eosbProv, description: `مخصص نهاية الخدمة – ${tag}` }, num(l.eosbAccrual));
  }
  return out;
}

async function runLines(tx: Tx, runId: number) {
  return tx
    .select({ l: s.payrollLines, name: s.employees.nameAr, payableAccountId: s.employees.payableAccountId })
    .from(s.payrollLines)
    .innerJoin(s.employees, eq(s.employees.id, s.payrollLines.employeeId))
    .where(eq(s.payrollLines.runId, runId))
    .orderBy(asc(s.employees.nameAr))
    .then((rows) => rows.map((r) => ({ ...r.l, name: r.name, payableAccountId: r.payableAccountId })));
}

/** الاعتماد: قيد الاستحقاق بتاريخ آخر الشهر، واستقطاع أقساط السلف من الأقدم. */
export async function approvePayrollRun(db: Db, runId: number, opts: { userId?: number } = {}) {
  return db.transaction(async (tx) => {
    const run = await lockRun(tx, runId);
    if (run.status !== "draft") throw new Error(`المسير ${run.number} معتمد مسبقاً`);
    const lines = await runLines(tx, runId);
    if (!lines.length) throw new Error("المسير بلا سطور");
    const { end } = monthRange(run.month);
    // مخالفة سُجلت أو حُذفت بعد بناء المسير: يجب تحديثه حتى يطابق الخصم المحجوز
    const claimed = await tx
      .select({ driverId: s.trafficViolations.driverId, total: sql<string>`sum(${s.trafficViolations.amount})` })
      .from(s.trafficViolations)
      .where(eq(s.trafficViolations.payrollRunId, runId))
      .groupBy(s.trafficViolations.driverId);
    const byDriver = new Map(claimed.map((c) => [c.driverId, num(c.total)]));
    const lineDrivers = lines.map((l) => l.driverId).filter((v): v is number => v != null);
    const [late] = lineDrivers.length
      ? await tx
          .select({ id: s.trafficViolations.id })
          .from(s.trafficViolations)
          .where(
            and(
              eq(s.trafficViolations.chargeTo, "driver"),
              isNull(s.trafficViolations.payrollRunId),
              inArray(s.trafficViolations.driverId, lineDrivers),
              lte(s.trafficViolations.violationDate, end),
            ),
          )
          .limit(1)
      : [];
    if (late || lines.some((l) => l.driverId && r2(byDriver.get(l.driverId) ?? 0) !== r2(num(l.violations)))) {
      throw new Error("سُجلت مخالفات بعد إعداد المسير؛ اضغط «تحديث المسير» ثم اعتمده");
    }
    const [lateHr] = await tx
      .select({ id: s.hrActions.id })
      .from(s.hrActions)
      .where(
        and(
          inArray(s.hrActions.kind, ["incentive", "penalty"]),
          eq(s.hrActions.status, "approved"),
          isNull(s.hrActions.payrollRunId),
          inArray(s.hrActions.employeeId, lines.map((l) => l.employeeId)),
          lte(s.hrActions.actionDate, end),
        ),
      )
      .limit(1);
    if (lateHr) throw new Error("اعتُمدت جزاءات أو حوافز بعد إعداد المسير؛ اضغط «تحديث المسير» ثم اعتمده");
    const entry = await createJournalEntryTx(tx, {
      entryDate: end,
      description: `مسير رواتب ${monthLabel(run.month)} – ${run.number}`,
      source: { type: "payroll_run", id: run.id },
      post: true,
      userId: opts.userId,
      lines: await payrollPostingLines(tx, run, lines),
    });
    for (const l of lines) {
      let left = num(l.advanceDeduction);
      if (left <= 0) continue;
      const advs = await tx
        .select()
        .from(s.employeeAdvances)
        .where(and(eq(s.employeeAdvances.employeeId, l.employeeId), eq(s.employeeAdvances.status, "paid")))
        .orderBy(asc(s.employeeAdvances.advanceDate), asc(s.employeeAdvances.id))
        .for("update");
      for (const a of advs) {
        if (left <= 0) break;
        const take = r2(Math.min(left, num(a.amount) - num(a.repaidAmount)));
        if (take <= 0) continue;
        const repaid = r2(num(a.repaidAmount) + take);
        await tx
          .update(s.employeeAdvances)
          .set({ repaidAmount: String(repaid), status: repaid >= num(a.amount) ? "settled" : "paid" })
          .where(eq(s.employeeAdvances.id, a.id));
        left = r2(left - take);
      }
      if (left > 0) throw new Error(`قسط سلفة ${l.name} أكبر من المتبقي عليه`);
    }
    await tx.update(s.payrollRuns).set({ status: "approved", journalEntryId: entry.id, approvedBy: opts.userId ?? null }).where(eq(s.payrollRuns.id, runId));
    return entry;
  });
}

/** الإرجاع لمسودة: يلغي القيد ويعيد أقساط السلف (من الأحدث). لا يُرجع مسير قبل مسير أحدث معتمد. */
export async function revertPayrollRun(db: Db, runId: number) {
  return db.transaction(async (tx) => {
    const run = await lockRun(tx, runId);
    if (run.status !== "approved") throw new Error(run.status === "paid" ? "ألغِ الصرف أولاً" : "المسير مسودة");
    const [later] = await tx
      .select({ number: s.payrollRuns.number })
      .from(s.payrollRuns)
      .where(and(gt(s.payrollRuns.month, run.month), inArray(s.payrollRuns.status, ["approved", "paid"])));
    if (later) throw new Error(`أرجع المسير الأحدث ${later.number} أولاً`);
    const lines = await tx.select().from(s.payrollLines).where(eq(s.payrollLines.runId, runId));
    for (const l of lines) {
      let left = num(l.advanceDeduction);
      if (left <= 0) continue;
      const advs = await tx
        .select()
        .from(s.employeeAdvances)
        .where(and(eq(s.employeeAdvances.employeeId, l.employeeId), inArray(s.employeeAdvances.status, ["paid", "settled"])))
        .orderBy(desc(s.employeeAdvances.advanceDate), desc(s.employeeAdvances.id))
        .for("update");
      for (const a of advs) {
        if (left <= 0) break;
        const back = r2(Math.min(left, num(a.repaidAmount)));
        if (back <= 0) continue;
        await tx.update(s.employeeAdvances).set({ repaidAmount: String(r2(num(a.repaidAmount) - back)), status: "paid" }).where(eq(s.employeeAdvances.id, a.id));
        left = r2(left - back);
      }
    }
    await tx.update(s.payrollRuns).set({ status: "draft", journalEntryId: null, approvedBy: null }).where(eq(s.payrollRuns.id, runId));
    if (run.journalEntryId) await deleteEntryTx(tx, run.journalEntryId);
  });
}

/** الصرف: من حسابات الرواتب المستحقة بالصافي إلى البنك. الصافي السالب يبقى رصيداً على الموظف. */
export async function payPayrollRun(db: Db, runId: number, opts: { bankAccountId: number; paymentDate: string; userId?: number }) {
  return db.transaction(async (tx) => {
    const run = await lockRun(tx, runId);
    if (run.status !== "approved") throw new Error("اعتمد المسير قبل الصرف");
    const { end } = monthRange(run.month);
    if (opts.paymentDate < end) throw new Error("تاريخ الصرف قبل نهاية الشهر");
    const bank = await cashAccount(tx, opts.bankAccountId, "البنك أو الصندوق الذي صُرفت منه الرواتب");
    const lines = (await runLines(tx, runId)).filter((l) => num(l.net) > 0);
    if (!lines.length) throw new Error("لا يوجد صافٍ مستحق للصرف");
    const label = `صرف رواتب ${monthLabel(run.month)} – ${run.number}`;
    const total = r2(lines.reduce((t, l) => t + num(l.net), 0));
    const entry = await createJournalEntryTx(tx, {
      entryDate: opts.paymentDate,
      description: label,
      source: { type: "payroll_payment", id: run.id },
      post: true,
      userId: opts.userId,
      lines: [
        ...lines.map((l) => ({ accountId: l.payableAccountId!, driverId: l.driverId, debit: num(l.net), description: `صافي راتب ${l.name} – ${monthLabel(run.month)}` })),
        { accountId: bank.id, credit: total, description: label },
      ],
    });
    await tx
      .update(s.payrollRuns)
      .set({ status: "paid", paymentEntryId: entry.id, bankAccountId: bank.id, paymentDate: opts.paymentDate })
      .where(eq(s.payrollRuns.id, runId));
    return entry;
  });
}

export async function revertPayrollPayment(db: Db, runId: number) {
  return db.transaction(async (tx) => {
    const run = await lockRun(tx, runId);
    if (run.status !== "paid") throw new Error("المسير غير مصروف");
    await tx.update(s.payrollRuns).set({ status: "approved", paymentEntryId: null, paymentDate: null, bankAccountId: null }).where(eq(s.payrollRuns.id, runId));
    if (run.paymentEntryId) await deleteEntryTx(tx, run.paymentEntryId);
  });
}

export async function deletePayrollRun(db: Db, runId: number, opts: { reason: string; userId?: number }) {
  if (!opts.reason.trim()) throw new Error("اكتب سبب الحذف");
  return db.transaction(async (tx) => {
    const run = await lockRun(tx, runId);
    if (run.status !== "draft") throw new Error("الحذف متاح للمسودة فقط");
    const lines = await tx.select().from(s.payrollLines).where(eq(s.payrollLines.runId, runId));
    await tx.insert(s.deletionLog).values({ entity: "payroll_run", entityId: String(runId), snapshot: { run, lines }, reason: opts.reason.trim(), userId: opts.userId });
    await tx.delete(s.payrollRuns).where(eq(s.payrollRuns.id, runId));
  });
}

/** ملف التحويل البنكي: الاسم والآيبان والصافي لكل موظف له صافٍ موجب. */
export async function bankTransferRows(db: Db, runId: number) {
  const rows = await db
    .select({ name: s.employees.nameAr, nationalId: s.employees.nationalId, bank: s.employees.bankName, iban: s.employees.iban, net: s.payrollLines.net })
    .from(s.payrollLines)
    .innerJoin(s.employees, eq(s.employees.id, s.payrollLines.employeeId))
    .where(and(eq(s.payrollLines.runId, runId), gt(s.payrollLines.net, "0")))
    .orderBy(asc(s.employees.nameAr));
  return rows.map((r) => ({ ...r, net: num(r.net) }));
}

/** إجماليات المسير للعرض. */
export function payrollTotals(lines: LineRow[]) {
  const keys = ["basic", "housing", "otherAllowances", "absenceDeduction", "additions", "deductions", "commissions", "violations", "advanceDeduction", "incentives", "penalties", "gosiEmployee", "gosiEmployer", "eosbAccrual", "net"] as const;
  return Object.fromEntries(keys.map((k) => [k, r2(lines.reduce((t, l) => t + num(l[k]), 0))])) as Record<(typeof keys)[number], number>;
}
