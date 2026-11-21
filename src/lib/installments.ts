import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import * as s from "@/db/schema";
import { createJournalEntryTx, deleteEntryTx, type LineInput } from "@/lib/ledger";
import { createPayment, revertPaymentTx } from "@/lib/purchases";
import { openYear } from "@/lib/periods";
import { todayRiyadh } from "@/lib/dates";
import { addDays, addMonths, installmentStage, ALERT_DAYS_BEFORE, validateSchedule, type ScheduleRow } from "@/lib/installment-schedule";
import { notifyOffice } from "@/lib/office-notify";

// جدول أقساط الدائنين (ملاحظة التشغيل 16، قرارات أحمد 2026-11-21):
// - الجدول خطة سداد على حساب دائن تفصيلي في الشجرة (2xxx)؛ الدين نفسه مقيد من قبل.
// - القسط = أصل + تكلفة تمويل. التكلفة تُستحق يوم الاستحقاق ولو لم يُسدد: مدين 7101 دائن حساب الدائن
//   (على مركز تكلفة المركبة إن رُبط بها)، ثم السداد بسند صرف «سداد قسط»: مدين الدائن بالقسط كاملاً.
// - السداد الجزئي يبقى باقيه على القسط نفسه. السداد المبكر بالمبلغ الذي يطلبه الدائن يقفل الباقي،
//   وفرقه عن الباقي على 7101.
// - القرض طويل الأجل 2201: الجزء المستحق خلال 12 شهراً يُعاد تصنيفه لـ 2114 بزر فقط، بقيد يُعكس اليوم التالي.

export const INSTALLMENT_ACCOUNTS = { financingCost: "7101", currentLoans: "2114", longLoans: "2201" } as const;
const SRC = { cost: "installment_cost", payoff: "installment_payoff", reclass: "installment_reclass", reclassReversal: "installment_reclass_reversal" } as const;
// ذمم الموردين: رصيد الجدول يُحسب لهذه الجهة فقط، وباقي الحسابات بالحساب كله
const PARTY_LEDGER = /^210[1-5]/;

const r2 = (n: number) => Math.round(n * 100) / 100;
const n = (v: unknown) => Number(v ?? 0);

async function accountByCode(tx: Db | Tx, code: string) {
  const [a] = await tx.select({ id: s.accounts.id }).from(s.accounts).where(eq(s.accounts.code, code));
  if (!a) throw new Error(`الحساب ${code} غير موجود في الشجرة`);
  return a.id;
}

/** حساب الدائن صالح للجدول: تفصيلي نشط من الالتزامات 2xxx بالريال. */
async function checkCreditorAccount(tx: Db | Tx, accountId: number) {
  const [a] = await tx.select().from(s.accounts).where(eq(s.accounts.id, accountId));
  if (!a) throw new Error("اختر حساب الدائن");
  if (!a.code.startsWith("2")) throw new Error("حساب الدائن يكون من الالتزامات (2xxx)");
  if (!a.isPostable) throw new Error("اختر حساباً فرعياً تحته");
  if (!a.isActive) throw new Error(`الحساب ${a.nameAr} موقوف`);
  if (a.currencyCode && a.currencyCode !== "SAR") throw new Error("جدول الأقساط بالريال فقط");
  return a;
}

async function vehicleCostCenter(tx: Db | Tx, vehicleId: number | null) {
  if (!vehicleId) return null;
  const [v] = await tx.select({ cc: s.vehicles.costCenterId }).from(s.vehicles).where(eq(s.vehicles.id, vehicleId));
  if (!v) throw new Error("المركبة غير موجودة");
  return v.cc;
}

export interface PlanInput {
  name: string;
  accountId: number;
  partyId?: number | null;
  vehicleId?: number | null;
  notes?: string | null;
  rows: ScheduleRow[];
  userId?: number;
}

export async function createInstallmentPlan(db: Db, input: PlanInput) {
  const name = input.name.trim();
  if (!name) throw new Error("اكتب اسم الجدول (مثل: قرض البنك الأهلي)");
  const rows = validateSchedule(input.rows);
  const plan = await db.transaction(async (tx) => {
    await checkCreditorAccount(tx, input.accountId);
    await vehicleCostCenter(tx, input.vehicleId ?? null);
    const [p] = await tx
      .insert(s.installmentPlans)
      .values({ name, accountId: input.accountId, partyId: input.partyId || null, vehicleId: input.vehicleId || null, notes: input.notes?.trim() || null, createdBy: input.userId })
      .returning();
    await tx.insert(s.installments).values(rows.map((r, i) => ({ planId: p.id, seq: i + 1, dueDate: r.dueDate, principal: String(r.principal), cost: String(r.cost) })));
    return p;
  });
  // أقساط فات استحقاقها: تكلفتها تُقيد الآن (القرار 7)
  await accrueDueCosts(db, todayRiyadh(), { planId: plan.id, userId: input.userId });
  return plan;
}

type PlanRow = typeof s.installmentPlans.$inferSelect;
type InstRow = typeof s.installments.$inferSelect;

/** قيد تكلفة التمويل لقسط واحد (مرة واحدة). */
async function accrueCostTx(tx: Tx, inst: InstRow, plan: PlanRow, date: string, userId?: number) {
  if (inst.costEntryId || !(n(inst.cost) > 0)) return null;
  const description = `تكلفة تمويل – ${plan.name} – القسط ${inst.seq}`;
  const entry = await createJournalEntryTx(tx, {
    entryDate: date,
    description,
    source: { type: SRC.cost, id: inst.id },
    post: true,
    userId,
    lines: [
      { accountId: await accountByCode(tx, INSTALLMENT_ACCOUNTS.financingCost), debit: n(inst.cost), costCenterId: await vehicleCostCenter(tx, plan.vehicleId), partyId: plan.partyId, description },
      { accountId: plan.accountId, credit: n(inst.cost), partyId: plan.partyId, description },
    ],
  });
  await tx.update(s.installments).set({ costEntryId: entry.id }).where(eq(s.installments.id, inst.id));
  return entry;
}

/**
 * يقيد تكلفة التمويل لكل قسط حلّ استحقاقه ولم تُقيد تكلفته (المهمة اليومية وعند إنشاء الجدول).
 * القسط في فترة مقفلة يُتخطى دون أن يوقف الباقي.
 */
export async function accrueDueCosts(db: Db, today: string, opts: { planId?: number; userId?: number } = {}) {
  const due = await db
    .select({ id: s.installments.id })
    .from(s.installments)
    .innerJoin(s.installmentPlans, eq(s.installmentPlans.id, s.installments.planId))
    .where(
      and(
        eq(s.installments.status, "open"),
        eq(s.installmentPlans.status, "active"),
        sql`${s.installments.cost} > 0 and ${s.installments.costEntryId} is null and ${s.installments.dueDate} <= ${today}`,
        opts.planId ? eq(s.installments.planId, opts.planId) : undefined,
      ),
    )
    .orderBy(asc(s.installments.dueDate));
  let done = 0;
  const failed: string[] = [];
  for (const d of due) {
    try {
      await db.transaction(async (tx) => {
        const [inst] = await tx.select().from(s.installments).where(eq(s.installments.id, d.id)).for("update");
        if (!inst || inst.costEntryId || inst.status !== "open") return;
        const [plan] = await tx.select().from(s.installmentPlans).where(eq(s.installmentPlans.id, inst.planId));
        if (await accrueCostTx(tx, inst, plan, inst.dueDate, opts.userId)) done++;
      });
    } catch (e) {
      failed.push(e instanceof Error ? e.message : String(e));
    }
  }
  return { done, failed };
}

/** ما سُدد لكل قسط من السندات المرحّلة فقط. */
async function paidByInstallment(tx: Db | Tx, ids: number[]) {
  if (!ids.length) return new Map<number, number>();
  const rows = await tx
    .select({ id: s.installmentPayments.installmentId, paid: sql<string>`sum(${s.payments.amount})` })
    .from(s.installmentPayments)
    .innerJoin(s.payments, and(eq(s.payments.id, s.installmentPayments.paymentId), eq(s.payments.status, "posted")))
    .where(inArray(s.installmentPayments.installmentId, ids))
    .groupBy(s.installmentPayments.installmentId);
  return new Map(rows.map((r) => [r.id, n(r.paid)]));
}

export type InstallmentState = "paid" | "overdue" | "due" | "upcoming" | "settled";

/** حالة القسط وأرقامه: الباقي للسداد، وما بقي من الأصل، وما يقابله في رصيد الدائن. */
function describe(i: InstRow, paid: number, today: string) {
  const principal = n(i.principal);
  const cost = n(i.cost);
  const accrued = !!i.costEntryId || cost === 0;
  const remaining = i.status === "settled" ? 0 : r2(Math.max(0, principal + cost - paid));
  // ما يقابل القسط في رصيد حساب الدائن: الأصل، وتكلفته إن قُيدت، ناقص المسدد
  const owed = i.status === "settled" ? 0 : r2(Math.max(0, principal + (accrued ? cost : 0) - paid));
  const principalLeft = i.status === "settled" ? 0 : r2(Math.max(0, principal - Math.max(0, paid - (accrued ? cost : 0))));
  const state: InstallmentState =
    i.status === "settled" ? "settled" : remaining < 0.005 ? "paid" : i.dueDate < today ? "overdue" : i.dueDate <= addDays(today, ALERT_DAYS_BEFORE) || i.dueDate.slice(0, 7) === today.slice(0, 7) ? "due" : "upcoming";
  return { id: i.id, seq: i.seq, dueDate: i.dueDate, principal, cost, total: r2(principal + cost), paid: r2(paid), remaining, owed, principalLeft, accrued: !!i.costEntryId, costEntryId: i.costEntryId, status: i.status, state };
}

/** رصيد حساب الدائن (دائن موجب): للجهة فقط في ذمم الموردين، وللحساب كله في غيرها. */
async function creditorBalance(tx: Db | Tx, plan: PlanRow, code: string) {
  const byParty = plan.partyId && PARTY_LEDGER.test(code);
  const r = await tx.execute<{ bal: string }>(sql`
    select coalesce(sum(l.credit_base - l.debit_base), 0) as bal
    from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted' and e.source_type is distinct from 'year_close'
    where l.account_id = ${plan.accountId} ${byParty ? sql`and l.party_id = ${plan.partyId}` : sql``}`);
  return r2(n([...r][0]?.bal));
}

/** الجدول كاملاً: بياناته وأقساطه وحالاتها، والفرق بين الباقي ورصيد الحساب، وتقسيم 12 شهراً للقرض 2201. */
export async function installmentPlan(db: Db | Tx, id: number, today = todayRiyadh()) {
  const [row] = await db
    .select({ plan: s.installmentPlans, code: s.accounts.code, account: s.accounts.nameAr, party: s.parties.nameAr, vehicle: s.vehicles.plate })
    .from(s.installmentPlans)
    .innerJoin(s.accounts, eq(s.accounts.id, s.installmentPlans.accountId))
    .leftJoin(s.parties, eq(s.parties.id, s.installmentPlans.partyId))
    .leftJoin(s.vehicles, eq(s.vehicles.id, s.installmentPlans.vehicleId))
    .where(eq(s.installmentPlans.id, id));
  if (!row) return null;
  const insts = await db.select().from(s.installments).where(eq(s.installments.planId, id)).orderBy(asc(s.installments.seq));
  const paid = await paidByInstallment(db, insts.map((i) => i.id));
  const items = insts.map((i) => describe(i, paid.get(i.id) ?? 0, today));
  const owed = r2(items.reduce((t, i) => t + i.owed, 0));
  const balance = await creditorBalance(db, row.plan, row.code);
  // الجداول الأخرى النشطة على نفس الحساب (ونفس الجهة في ذمم الموردين) تدخل في المقارنة
  const siblings = await db
    .select({ id: s.installmentPlans.id })
    .from(s.installmentPlans)
    .where(
      and(
        eq(s.installmentPlans.accountId, row.plan.accountId),
        eq(s.installmentPlans.status, "active"),
        sql`${s.installmentPlans.id} <> ${id}`,
        row.plan.partyId && PARTY_LEDGER.test(row.code) ? eq(s.installmentPlans.partyId, row.plan.partyId) : undefined,
      ),
    );
  let otherOwed = 0;
  for (const sib of siblings) {
    const si = await db.select().from(s.installments).where(eq(s.installments.planId, sib.id));
    const sp = await paidByInstallment(db, si.map((i) => i.id));
    otherOwed = r2(otherOwed + si.reduce((t, i) => t + describe(i, sp.get(i.id) ?? 0, today).owed, 0));
  }
  const horizon = addMonths(today, 12);
  const open = items.filter((i) => i.principalLeft > 0);
  const within12 = r2(open.filter((i) => i.dueDate <= horizon).reduce((t, i) => t + i.principalLeft, 0));
  const after12 = r2(open.filter((i) => i.dueDate > horizon).reduce((t, i) => t + i.principalLeft, 0));
  const hasPayments = items.some((i) => i.paid > 0) || !!row.plan.payoffPaymentId;
  return {
    ...row.plan,
    code: row.code,
    account: row.account,
    party: row.party,
    vehicle: row.vehicle,
    items,
    remaining: r2(items.reduce((t, i) => t + i.remaining, 0)),
    owed,
    balance,
    otherOwed,
    difference: r2(balance - owed - otherOwed),
    isLongTerm: row.code.startsWith(INSTALLMENT_ACCOUNTS.longLoans),
    within12,
    after12,
    hasPayments,
    next: items.find((i) => i.remaining > 0) ?? null,
  };
}

/** قائمة الجداول بملخصها (الباقي والقسط القادم). */
export async function installmentPlans(db: Db, today = todayRiyadh()) {
  const plans = await db.select({ id: s.installmentPlans.id }).from(s.installmentPlans).orderBy(asc(s.installmentPlans.status), asc(s.installmentPlans.name));
  const out = [];
  for (const p of plans) {
    const d = await installmentPlan(db, p.id, today);
    if (d) out.push(d);
  }
  return out;
}

/** أقساط هذا الشهر والمتأخرة غير المسددة، الأقدم أولاً، مع جدولها. */
export async function dueInstallments(db: Db, today = todayRiyadh()) {
  const monthEnd = addDays(addMonths(`${today.slice(0, 7)}-01`, 1), -1);
  const rows = await db
    .select({ inst: s.installments, plan: s.installmentPlans.name, planId: s.installmentPlans.id, account: s.accounts.nameAr, code: s.accounts.code, party: s.parties.nameAr, vehicle: s.vehicles.plate })
    .from(s.installments)
    .innerJoin(s.installmentPlans, and(eq(s.installmentPlans.id, s.installments.planId), eq(s.installmentPlans.status, "active")))
    .innerJoin(s.accounts, eq(s.accounts.id, s.installmentPlans.accountId))
    .leftJoin(s.parties, eq(s.parties.id, s.installmentPlans.partyId))
    .leftJoin(s.vehicles, eq(s.vehicles.id, s.installmentPlans.vehicleId))
    .where(and(eq(s.installments.status, "open"), sql`${s.installments.dueDate} <= ${monthEnd}`))
    .orderBy(asc(s.installments.dueDate), asc(s.installments.id));
  const paid = await paidByInstallment(db, rows.map((r) => r.inst.id));
  return rows
    .map((r) => ({ ...describe(r.inst, paid.get(r.inst.id) ?? 0, today), plan: r.plan, planId: r.planId, account: r.account, code: r.code, party: r.party, vehicle: r.vehicle }))
    .filter((r) => r.remaining > 0);
}

async function lockInstallment(tx: Tx, id: number) {
  const [inst] = await tx.select().from(s.installments).where(eq(s.installments.id, id)).for("update");
  if (!inst) throw new Error("القسط غير موجود");
  const [plan] = await tx.select().from(s.installmentPlans).where(eq(s.installmentPlans.id, inst.planId)).for("update");
  if (plan.status !== "active") throw new Error(`جدول «${plan.name}» مسدد بالكامل`);
  if (inst.status !== "open") throw new Error(`القسط ${inst.seq} أُقفل بالسداد المبكر`);
  return { inst, plan };
}

const methodOf = async (tx: Tx, cashAccountId: number) => {
  const [cash] = await tx.select({ code: s.accounts.code }).from(s.accounts).where(eq(s.accounts.id, cashAccountId));
  return cash?.code.startsWith("1102") ? ("transfer" as const) : ("cash" as const);
};

export interface PayInstallmentInput {
  installmentId: number;
  // فارغ = القسط كاملاً (أو باقيه)
  amount?: number | null;
  cashAccountId: number | null;
  date?: string;
  userId?: number;
}

/**
 * سداد قسط (القرار 6): المبلغ الافتراضي هو القسط ويمكن تقليله، والباقي يبقى على القسط نفسه.
 * تكلفة القسط تُقيد قبل السداد إن لم تُقيد بعد (سداد قبل الاستحقاق: بتاريخ السداد).
 */
export async function payInstallment(db: Db, input: PayInstallmentInput) {
  const cashAccountId = input.cashAccountId;
  if (!cashAccountId) throw new Error("اختر الحساب الذي يُسدد منه");
  const date = input.date || todayRiyadh();
  return db.transaction(async (tx) => {
    const { inst, plan } = await lockInstallment(tx, input.installmentId);
    const paid = (await paidByInstallment(tx, [inst.id])).get(inst.id) ?? 0;
    const remaining = r2(n(inst.principal) + n(inst.cost) - paid);
    if (remaining < 0.005) throw new Error(`القسط ${inst.seq} مسدد`);
    const amount = r2(input.amount ?? remaining);
    if (!(amount > 0)) throw new Error("المبلغ يجب أن يكون أكبر من صفر");
    if (amount > remaining + 0.005) throw new Error(`الباقي من القسط ${remaining.toFixed(2)} فقط؛ للسداد المبكر للباقي استخدم «سداد مبكر»`);
    await accrueCostTx(tx, inst, plan, inst.dueDate <= date ? inst.dueDate : date, input.userId);
    const payment = await createPayment(tx as unknown as Db, {
      paymentDate: date,
      kind: "installment",
      partyId: plan.partyId,
      debitAccountId: plan.accountId,
      amount,
      method: await methodOf(tx, cashAccountId),
      cashAccountId,
      reference: `${plan.name} – القسط ${inst.seq}`.slice(0, 60),
      notes: `سداد القسط ${inst.seq} من جدول «${plan.name}» المستحق ${inst.dueDate}`,
      post: true,
      userId: input.userId,
    });
    await tx.insert(s.installmentPayments).values({ paymentId: payment.id, installmentId: inst.id });
    return { ...payment, remaining: r2(remaining - amount) };
  });
}

/**
 * السداد المبكر (القرار 6): يُدفع المبلغ الذي يطلبه الدائن، وتُقفل الأقساط الباقية.
 * الفرق بينه وبين الباقي في رصيد الدائن على 7101: زيادة (رسوم) مدين 7101، ونقص (خصم تكلفة لم تُستحق) دائن 7101.
 */
export async function payoffPlan(db: Db, input: { planId: number; amount: number; cashAccountId: number | null; date?: string; userId?: number }) {
  const cashAccountId = input.cashAccountId;
  if (!cashAccountId) throw new Error("اختر الحساب الذي يُسدد منه");
  if (!(input.amount > 0)) throw new Error("اكتب المبلغ الذي يطلبه الدائن للسداد المبكر");
  const date = input.date || todayRiyadh();
  return db.transaction(async (tx) => {
    const [plan] = await tx.select().from(s.installmentPlans).where(eq(s.installmentPlans.id, input.planId)).for("update");
    if (!plan) throw new Error("الجدول غير موجود");
    if (plan.status !== "active") throw new Error(`جدول «${plan.name}» مسدد بالكامل`);
    const insts = await tx.select().from(s.installments).where(and(eq(s.installments.planId, plan.id), eq(s.installments.status, "open"))).for("update");
    const paid = await paidByInstallment(tx, insts.map((i) => i.id));
    const open = insts.map((i) => describe(i, paid.get(i.id) ?? 0, date)).filter((i) => i.remaining > 0);
    if (!open.length) throw new Error("لا يوجد باقٍ على هذا الجدول");
    const owed = r2(open.reduce((t, i) => t + i.owed, 0));
    const amount = r2(input.amount);
    const diff = r2(amount - owed);
    let payoffEntryId: number | null = null;
    if (Math.abs(diff) >= 0.005) {
      const description = `سداد مبكر – ${plan.name}: ${diff > 0 ? "زيادة" : "خصم"} عن الباقي ${owed.toFixed(2)}`;
      const cost = { accountId: await accountByCode(tx, INSTALLMENT_ACCOUNTS.financingCost), costCenterId: await vehicleCostCenter(tx, plan.vehicleId), partyId: plan.partyId, description };
      const creditor = { accountId: plan.accountId, partyId: plan.partyId, description };
      const lines: LineInput[] = diff > 0 ? [{ ...cost, debit: diff }, { ...creditor, credit: diff }] : [{ ...creditor, debit: -diff }, { ...cost, credit: -diff }];
      payoffEntryId = (await createJournalEntryTx(tx, { entryDate: date, description, source: { type: SRC.payoff, id: plan.id }, post: true, userId: input.userId, lines })).id;
    }
    const payment = await createPayment(tx as unknown as Db, {
      paymentDate: date,
      kind: "installment",
      partyId: plan.partyId,
      debitAccountId: plan.accountId,
      amount,
      method: await methodOf(tx, cashAccountId),
      cashAccountId,
      reference: `سداد مبكر – ${plan.name}`.slice(0, 60),
      notes: `سداد مبكر لجدول «${plan.name}»: ${open.length} قسط باقٍ`,
      post: true,
      userId: input.userId,
    });
    await tx.update(s.installments).set({ status: "settled" }).where(inArray(s.installments.id, open.map((i) => i.id)));
    await tx.update(s.installmentPlans).set({ status: "settled", payoffPaymentId: payment.id, payoffEntryId, payoffDate: date }).where(eq(s.installmentPlans.id, plan.id));
    return { payment, owed, diff, cancelled: open.length };
  });
}

/** إلغاء السداد المبكر: يُحذف سنده وقيد الفرق، وتعود الأقساط مستحقة. */
export async function undoPayoff(db: Db, planId: number, opts: { userId?: number } = {}) {
  return db.transaction(async (tx) => {
    const [plan] = await tx.select().from(s.installmentPlans).where(eq(s.installmentPlans.id, planId)).for("update");
    if (!plan?.payoffPaymentId) throw new Error("لا يوجد سداد مبكر لهذا الجدول");
    const paymentId = plan.payoffPaymentId;
    const [p] = await tx.select().from(s.payments).where(eq(s.payments.id, paymentId));
    await tx.update(s.installmentPlans).set({ status: "active", payoffPaymentId: null, payoffEntryId: null, payoffDate: null }).where(eq(s.installmentPlans.id, planId));
    if (plan.payoffEntryId) await deleteEntryTx(tx, plan.payoffEntryId);
    if (p?.status === "posted") await revertPaymentTx(tx, paymentId);
    if (p) {
      await tx.insert(s.deletionLog).values({ entity: "payment", entityId: String(paymentId), snapshot: p, reason: `إلغاء السداد المبكر لجدول «${plan.name}»`, userId: opts.userId });
      await tx.delete(s.payments).where(eq(s.payments.id, paymentId));
    }
    // ما أقفله السداد المبكر يعود مفتوحاً (ما سُدد بالكامل قبله يبقى مسدداً لأن حالته تُحسب من سنداته)
    await tx.update(s.installments).set({ status: "open" }).where(and(eq(s.installments.planId, planId), eq(s.installments.status, "settled")));
  });
}

/** تعديل قسط لم يُسدد منه شيء (تغيّر جدول البنك): التاريخ والأصل والتكلفة. قيد تكلفته يُعاد. */
export async function updateInstallment(db: Db, input: { id: number; dueDate: string; principal: number; cost: number; userId?: number }) {
  const [row] = validateSchedule([{ dueDate: input.dueDate, principal: input.principal, cost: input.cost }]);
  await db.transaction(async (tx) => {
    const { inst } = await lockInstallment(tx, input.id);
    const [link] = await tx.select({ id: s.installmentPayments.paymentId }).from(s.installmentPayments).where(eq(s.installmentPayments.installmentId, inst.id)).limit(1);
    if (link) throw new Error(`القسط ${inst.seq} عليه سداد؛ ارجع سنده أولاً لتعديله`);
    if (inst.costEntryId) await deleteEntryTx(tx, inst.costEntryId);
    await tx.update(s.installments).set({ dueDate: row.dueDate, principal: String(row.principal), cost: String(row.cost), costEntryId: null }).where(eq(s.installments.id, inst.id));
  });
  await accrueDueCosts(db, todayRiyadh(), { userId: input.userId });
}

/** حذف الجدول: فقط إن لم يُسدد منه شيء. قيود التكلفة المستحقة تُحذف معه. */
export async function deleteInstallmentPlan(db: Db, id: number, opts: { reason: string; userId?: number }) {
  if (!opts.reason.trim()) throw new Error("اكتب سبب الحذف");
  return db.transaction(async (tx) => {
    const [plan] = await tx.select().from(s.installmentPlans).where(eq(s.installmentPlans.id, id)).for("update");
    if (!plan) throw new Error("الجدول غير موجود");
    if (plan.payoffPaymentId) throw new Error("ألغِ السداد المبكر أولاً");
    const insts = await tx.select().from(s.installments).where(eq(s.installments.planId, id));
    const ids = insts.map((i) => i.id);
    const [link] = ids.length ? await tx.select({ id: s.installmentPayments.paymentId }).from(s.installmentPayments).where(inArray(s.installmentPayments.installmentId, ids)).limit(1) : [];
    if (link) throw new Error("على الجدول سندات سداد؛ ارجعها واحذفها أولاً");
    const reclass = await tx.select({ id: s.journalEntries.id }).from(s.journalEntries).where(and(inArray(s.journalEntries.sourceType, [SRC.reclass, SRC.reclassReversal]), eq(s.journalEntries.sourceId, id)));
    for (const e of [...insts.filter((i) => i.costEntryId).map((i) => i.costEntryId!), ...reclass.map((r) => r.id)]) await deleteEntryTx(tx, e);
    await tx.insert(s.deletionLog).values({ entity: "installment_plan", entityId: String(id), snapshot: { plan, installments: insts }, reason: opts.reason.trim(), userId: opts.userId });
    await tx.delete(s.installmentPlans).where(eq(s.installmentPlans.id, id));
  });
}

/** قيود إعادة تصنيف الجزء المتداول لهذا الجدول (الأحدث أولاً). */
export async function reclassEntries(db: Db | Tx, planId: number) {
  return db
    .select({ id: s.journalEntries.id, number: s.journalEntries.number, date: s.journalEntries.entryDate, type: s.journalEntries.sourceType })
    .from(s.journalEntries)
    .where(and(inArray(s.journalEntries.sourceType, [SRC.reclass, SRC.reclassReversal]), eq(s.journalEntries.sourceId, planId)))
    .orderBy(sql`${s.journalEntries.entryDate} desc`, asc(s.journalEntries.id));
}

/**
 * إعادة تصنيف الجزء المتداول (القرار 8): الأصل المستحق خلال 12 شهراً من التاريخ ينتقل من 2201 إلى حساب القروض
 * قصيرة الأجل بقيد بتاريخه، يُعكس تلقائياً في اليوم التالي فيبقى السداد على 2201 كما هو.
 */
export async function reclassifyCurrentPortion(db: Db, input: { planId: number; date: string; targetAccountId?: number | null; userId?: number }) {
  return db.transaction(async (tx) => {
    const plan = await installmentPlan(tx, input.planId, input.date);
    if (!plan) throw new Error("الجدول غير موجود");
    if (!plan.isLongTerm) throw new Error("إعادة التصنيف للقروض طويلة الأجل (2201) فقط");
    if (!(plan.within12 > 0)) throw new Error("لا يوجد أصل مستحق خلال 12 شهراً من هذا التاريخ");
    const [dup] = await tx
      .select({ number: s.journalEntries.number })
      .from(s.journalEntries)
      .where(and(eq(s.journalEntries.sourceType, SRC.reclass), eq(s.journalEntries.sourceId, plan.id), eq(s.journalEntries.entryDate, input.date)));
    if (dup) throw new Error(`أُعيد التصنيف بهذا التاريخ بالقيد ${dup.number}`);
    const target = input.targetAccountId ?? (await accountByCode(tx, INSTALLMENT_ACCOUNTS.currentLoans));
    const acc = await checkCreditorAccount(tx, target);
    if (acc.id === plan.accountId) throw new Error("اختر حساب القروض قصيرة الأجل");
    const description = `الجزء المتداول من «${plan.name}» حتى ${addMonths(input.date, 12)}`;
    const lines: LineInput[] = [
      { accountId: plan.accountId, debit: plan.within12, partyId: plan.partyId, description },
      { accountId: acc.id, credit: plan.within12, partyId: plan.partyId, description },
    ];
    const entry = await createJournalEntryTx(tx, { entryDate: input.date, description, source: { type: SRC.reclass, id: plan.id }, post: true, userId: input.userId, lines });
    const next = addDays(input.date, 1);
    await openYear(tx, Number(next.slice(0, 4)));
    const reversal = await createJournalEntryTx(tx, {
      entryDate: next,
      description: `عكس ${description}`,
      source: { type: SRC.reclassReversal, id: plan.id },
      post: true,
      userId: input.userId,
      lines: lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit, description: `عكس ${description}` })),
    });
    return { entry, reversal, amount: plan.within12 };
  });
}

/** يحذف قيد إعادة تصنيف بتاريخه مع عكسه. */
export async function undoReclassification(db: Db, planId: number, date: string) {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: s.journalEntries.id, type: s.journalEntries.sourceType, date: s.journalEntries.entryDate })
      .from(s.journalEntries)
      .where(and(inArray(s.journalEntries.sourceType, [SRC.reclass, SRC.reclassReversal]), eq(s.journalEntries.sourceId, planId)));
    const pair = rows.filter((r) => (r.type === SRC.reclass && r.date === date) || (r.type === SRC.reclassReversal && r.date === addDays(date, 1)));
    if (!pair.some((r) => r.type === SRC.reclass)) throw new Error("لا يوجد قيد إعادة تصنيف بهذا التاريخ");
    for (const r of pair) await deleteEntryTx(tx, r.id);
  });
}

/** عدد أقساط التنبيه في الجرس: المتأخرة، والمستحقة خلال 3 أيام. */
export const INSTALLMENT_REMAINING_SQL = sql.raw(`(i.principal + i.cost - coalesce((select sum(p.amount) from installment_payments ip2 join payments p on p.id = ip2.payment_id and p.status = 'posted' where ip2.installment_id = i.id), 0))`);

/**
 * إشعار الأقساط اليومي (القرار 5): قبل الاستحقاق بثلاثة أيام، ويوم الاستحقاق، ثم كل أسبوع حتى السداد،
 * في إشعار واحد يجمع أقساط اليوم. المرحلة تُسجَّل مرة واحدة لكل قسط فلا تتكرر.
 */
export async function sendInstallmentAlerts(db: Db, today: string) {
  const rows = await db.execute<{ id: string; seq: number; due_date: string; plan: string; remaining: string }>(sql`
    select i.id, i.seq, i.due_date::text as due_date, ip.name as plan, ${INSTALLMENT_REMAINING_SQL} as remaining
    from installments i join installment_plans ip on ip.id = i.plan_id and ip.status = 'active'
    where i.status = 'open' and i.due_date <= ${addDays(today, ALERT_DAYS_BEFORE)}::date and ${INSTALLMENT_REMAINING_SQL} > 0.004
    order by i.due_date, i.id`);
  const due = [...rows].map((r) => ({ id: Number(r.id), seq: r.seq, dueDate: r.due_date, plan: r.plan, remaining: n(r.remaining), stage: installmentStage(r.due_date, today) })).filter((r) => r.stage);
  if (!due.length) return { office: [] as number[], installments: 0 };
  const inserted = await db
    .insert(s.installmentAlertSends)
    .values(due.map((d) => ({ installmentId: d.id, stage: d.stage! })))
    .onConflictDoNothing()
    .returning({ id: s.installmentAlertSends.installmentId });
  const fresh = new Set(inserted.map((x) => x.id));
  const items = due.filter((d) => fresh.has(d.id));
  if (!items.length) return { office: [], installments: 0 };
  const line = (d: (typeof items)[number]) => `${d.plan} القسط ${d.seq} (${d.remaining.toFixed(2)}) ${d.dueDate < today ? `متأخر منذ ${d.dueDate}` : d.dueDate === today ? "يستحق اليوم" : `يستحق ${d.dueDate}`}`;
  const text = items.length === 1 ? `قسط مستحق: ${line(items[0])}` : `${items.length} أقساط مستحقة: ${items.map(line).join("، ")}`;
  const id = await notifyOffice(db, { kind: "installment_due", text, href: "/payments/installments" }, { push: false });
  return { office: [id], installments: items.length };
}

/** المهمة اليومية للأقساط: قيد تكاليف ما حلّ استحقاقه، ثم الإشعار. تعمل مرة في اليوم لكل شركة. */
export async function runDailyInstallments(db: Db, today: string) {
  const accrued = await accrueDueCosts(db, today);
  const sent = await sendInstallmentAlerts(db, today);
  return { accrued, sent };
}

/** خانة «السداد من» (القرار 6): الصناديق والبنوك وعهد الموظفين أولاً، و«عرض كل الشجرة» لباقي حسابات 1xxx و2xxx. */
export async function installmentPayFrom(db: Db) {
  const { payFromAccounts } = await import("@/lib/invoices");
  const suggested = await payFromAccounts(db);
  const all = await db
    .select({ id: s.accounts.id, code: s.accounts.code, nameAr: s.accounts.nameAr, currencyCode: s.accounts.currencyCode })
    .from(s.accounts)
    .where(and(eq(s.accounts.isPostable, true), eq(s.accounts.isActive, true), sql`(${s.accounts.code} like '1%' or ${s.accounts.code} like '2%')`))
    .orderBy(asc(s.accounts.code));
  return { suggested, all };
}

/** حسابات الدائنين لخانة الجدول: الالتزامات التفصيلية 2xxx. */
export async function creditorAccounts(db: Db) {
  return db
    .select({ id: s.accounts.id, code: s.accounts.code, nameAr: s.accounts.nameAr, currencyCode: s.accounts.currencyCode })
    .from(s.accounts)
    .where(and(eq(s.accounts.isPostable, true), eq(s.accounts.isActive, true), sql`${s.accounts.code} like '2%'`))
    .orderBy(asc(s.accounts.code));
}

/** سندات سداد الجدول (العادية والمبكر) للعرض في صفحته. */
export async function planPayments(db: Db, planId: number) {
  const [plan] = await db.select({ payoff: s.installmentPlans.payoffPaymentId }).from(s.installmentPlans).where(eq(s.installmentPlans.id, planId));
  const regular = await db
    .select({ id: s.payments.id, number: s.payments.number, date: s.payments.paymentDate, amount: s.payments.amount, status: s.payments.status, seq: s.installments.seq, entryId: s.payments.journalEntryId })
    .from(s.installmentPayments)
    .innerJoin(s.installments, and(eq(s.installments.id, s.installmentPayments.installmentId), eq(s.installments.planId, planId)))
    .innerJoin(s.payments, eq(s.payments.id, s.installmentPayments.paymentId))
    .orderBy(asc(s.payments.paymentDate), asc(s.payments.id));
  const payoff = plan?.payoff
    ? await db.select({ id: s.payments.id, number: s.payments.number, date: s.payments.paymentDate, amount: s.payments.amount, status: s.payments.status, entryId: s.payments.journalEntryId }).from(s.payments).where(eq(s.payments.id, plan.payoff))
    : [];
  return [...regular.map((r) => ({ ...r, amount: n(r.amount), payoff: false })), ...payoff.map((r) => ({ ...r, amount: n(r.amount), seq: null, payoff: true }))];
}
