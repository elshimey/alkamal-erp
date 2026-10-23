// التسوية البنكية: يُدخل رصيد كشف البنك في تاريخه، ويؤشر على الحركات التي ظهرت في الكشف.
// الرصيد المطابَق = كل الحركات المؤشر عليها حتى الآن (في التسويات المكتملة وهذه التسوية)،
// ويجب أن يساوي رصيد الكشف قبل الإكمال. ما لم يُؤشر عليه يبقى «معلقاً» للتسوية التالية.
// المبالغ بعملة الحساب (مبلغ السطر)، لأن كشف البنك بعملته.
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import * as s from "@/db/schema";
import { CASH_PARENTS } from "@/lib/banks";
import { createJournalEntryTx, nextDocumentNumber } from "@/lib/ledger";

const r2 = (v: number) => Math.round(v * 100) / 100 + 0;
const EPS = 0.005;

/** حسابات البنوك والصناديق التفصيلية المتاحة للتسوية. */
export async function reconcilableAccounts(db: Db | Tx) {
  const rows = await db
    .select({ id: s.accounts.id, code: s.accounts.code, nameAr: s.accounts.nameAr, currencyCode: s.accounts.currencyCode })
    .from(s.accounts)
    .where(and(eq(s.accounts.isPostable, true), sql`(${s.accounts.code} like ${`${CASH_PARENTS.bank}%`} or ${s.accounts.code} like ${`${CASH_PARENTS.cash}%`})`))
    .orderBy(s.accounts.code);
  return rows;
}

async function lockedRec(tx: Tx, id: number) {
  const [r] = await tx.select().from(s.bankReconciliations).where(eq(s.bankReconciliations.id, id)).for("update");
  if (!r) throw new Error("التسوية غير موجودة");
  return r;
}

export async function createReconciliation(db: Db, input: { accountId: number; statementDate: string; statementBalance: number; notes?: string; userId?: number }) {
  return db.transaction(async (tx) => {
    const accounts = await reconcilableAccounts(tx);
    if (!accounts.some((a) => a.id === input.accountId)) throw new Error("اختر حساب بنك أو صندوق تفصيلياً");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.statementDate)) throw new Error("حدد تاريخ الكشف");
    if (!Number.isFinite(input.statementBalance)) throw new Error("اكتب رصيد الكشف");
    const [draft] = await tx
      .select({ number: s.bankReconciliations.number })
      .from(s.bankReconciliations)
      .where(and(eq(s.bankReconciliations.accountId, input.accountId), eq(s.bankReconciliations.status, "draft")));
    if (draft) throw new Error(`للحساب تسوية مسودة ${draft.number}؛ أكملها أو احذفها أولاً`);
    const [last] = await tx
      .select({ date: s.bankReconciliations.statementDate })
      .from(s.bankReconciliations)
      .where(and(eq(s.bankReconciliations.accountId, input.accountId), eq(s.bankReconciliations.status, "completed")))
      .orderBy(desc(s.bankReconciliations.statementDate))
      .limit(1);
    if (last && input.statementDate < last.date) throw new Error(`آخر تسوية مكتملة بتاريخ ${last.date}؛ تاريخ الكشف يجب أن يكون بعده`);
    const number = await nextDocumentNumber(tx, "bank_reconciliation", "BR", Number(input.statementDate.slice(0, 4)));
    const [row] = await tx
      .insert(s.bankReconciliations)
      .values({
        number,
        accountId: input.accountId,
        statementDate: input.statementDate,
        statementBalance: String(r2(input.statementBalance)),
        notes: input.notes?.trim() || null,
        createdBy: input.userId,
      })
      .returning();
    return row;
  });
}

/** التسوية بحركاتها: المطابقة سابقاً مجمعة، والمتاحة للتأشير حتى تاريخ الكشف. */
export async function reconciliationView(db: Db | Tx, id: number) {
  const [rec] = await db
    .select({ r: s.bankReconciliations, account: s.accounts })
    .from(s.bankReconciliations)
    .innerJoin(s.accounts, eq(s.accounts.id, s.bankReconciliations.accountId))
    .where(eq(s.bankReconciliations.id, id));
  if (!rec) return null;
  const { r } = rec;
  const lines = (await db.execute(sql`
    select l.id, e.entry_date as date, e.number as entry, e.id as entry_id, coalesce(l.description, e.description) as description,
      l.debit::float8 as debit, l.credit::float8 as credit, i.reconciliation_id as rec_id, br.status as rec_status
    from journal_lines l
    join journal_entries e on e.id = l.entry_id and e.status = 'posted'
    left join bank_reconciliation_items i on i.journal_line_id = l.id
    left join bank_reconciliations br on br.id = i.reconciliation_id
    where l.account_id = ${r.accountId}
      and (e.entry_date <= ${r.statementDate} or i.reconciliation_id = ${r.id})
    order by e.entry_date, e.id, l.id`)) as unknown as {
    id: number;
    date: string;
    entry: string;
    entry_id: number;
    description: string | null;
    debit: number;
    credit: number;
    rec_id: number | null;
    rec_status: "draft" | "completed" | null;
  }[];
  // المطابق في تسويات مكتملة أخرى رصيد افتتاحي ثابت؛ والباقي يُعرض للتأشير
  const priorCleared = r2(lines.filter((l) => l.rec_status === "completed" && Number(l.rec_id) !== r.id).reduce((t, l) => t + l.debit - l.credit, 0));
  const items = lines
    .filter((l) => !(l.rec_status === "completed" && Number(l.rec_id) !== r.id) && !(l.rec_id != null && Number(l.rec_id) !== r.id))
    .map((l) => ({ id: Number(l.id), date: String(l.date).slice(0, 10), entry: l.entry, entryId: Number(l.entry_id), description: l.description ?? "", debit: Number(l.debit), credit: Number(l.credit), cleared: Number(l.rec_id) === r.id }));
  const book = r2(lines.filter((l) => String(l.date).slice(0, 10) <= r.statementDate).reduce((t, l) => t + l.debit - l.credit, 0));
  return { ...rec, priorCleared, items, book };
}

export function reconciliationTotals(v: { priorCleared: number; book: number; r: { statementBalance: string }; items: { debit: number; credit: number; cleared: boolean }[] }) {
  const cleared = r2(v.priorCleared + v.items.filter((i) => i.cleared).reduce((t, i) => t + i.debit - i.credit, 0));
  const statement = Number(v.r.statementBalance);
  const outstandingIn = r2(v.items.filter((i) => !i.cleared).reduce((t, i) => t + i.debit, 0));
  const outstandingOut = r2(v.items.filter((i) => !i.cleared).reduce((t, i) => t + i.credit, 0));
  return { cleared, statement, difference: r2(statement - cleared), outstandingIn, outstandingOut, book: v.book };
}

/** يحفظ الحركات المؤشر عليها في التسوية المسودة (يستبدل التأشير السابق). */
export async function saveCleared(db: Db, id: number, lineIds: number[]) {
  return db.transaction(async (tx) => {
    const r = await lockedRec(tx, id);
    if (r.status !== "draft") throw new Error("التسوية مكتملة؛ ألغِ إكمالها للتعديل");
    const ids = [...new Set(lineIds.filter((x) => Number.isInteger(x) && x > 0))];
    if (ids.length) {
      const ok = (await tx.execute(sql`
        select l.id from journal_lines l
        join journal_entries e on e.id = l.entry_id and e.status = 'posted'
        left join bank_reconciliation_items i on i.journal_line_id = l.id and i.reconciliation_id <> ${id}
        where l.account_id = ${r.accountId} and e.entry_date <= ${r.statementDate} and i.id is null
          and l.id in (${sql.join(ids.map((x) => sql`${x}`), sql`, `)})`)) as unknown as { id: number }[];
      if (ok.length !== ids.length) throw new Error("بعض الحركات ليست على هذا الحساب، أو بعد تاريخ الكشف، أو مطابقة في تسوية أخرى");
    }
    await tx.delete(s.bankReconciliationItems).where(eq(s.bankReconciliationItems.reconciliationId, id));
    if (ids.length) await tx.insert(s.bankReconciliationItems).values(ids.map((journalLineId) => ({ reconciliationId: id, journalLineId })));
  });
}

export async function updateStatement(db: Db, id: number, input: { statementDate: string; statementBalance: number }) {
  return db.transaction(async (tx) => {
    const r = await lockedRec(tx, id);
    if (r.status !== "draft") throw new Error("التسوية مكتملة");
    if (!Number.isFinite(input.statementBalance)) throw new Error("اكتب رصيد الكشف");
    await tx.update(s.bankReconciliations).set({ statementDate: input.statementDate, statementBalance: String(r2(input.statementBalance)) }).where(eq(s.bankReconciliations.id, id));
    // حركة مؤشر عليها بعد التاريخ الجديد تُزال
    await tx.execute(sql`
      delete from bank_reconciliation_items i using journal_lines l, journal_entries e
      where i.reconciliation_id = ${id} and l.id = i.journal_line_id and e.id = l.entry_id and e.entry_date > ${input.statementDate}`);
  });
}

export async function completeReconciliation(db: Db, id: number, userId?: number) {
  return db.transaction(async (tx) => {
    const r = await lockedRec(tx, id);
    if (r.status !== "draft") throw new Error("التسوية مكتملة مسبقاً");
    const v = (await reconciliationView(tx, id))!;
    const t = reconciliationTotals(v);
    if (Math.abs(t.difference) > EPS) throw new Error(`الفرق ${t.difference.toLocaleString("en")} لم يُسوَّ بعد؛ أشّر على الحركات أو سجّل الرسوم البنكية`);
    await tx.update(s.bankReconciliations).set({ status: "completed", completedAt: new Date(), completedBy: userId ?? null }).where(eq(s.bankReconciliations.id, id));
  });
}

/** إلغاء الإكمال: لآخر تسوية مكتملة على الحساب فقط، حتى لا تختل التسويات اللاحقة. */
export async function reopenReconciliation(db: Db, id: number) {
  return db.transaction(async (tx) => {
    const r = await lockedRec(tx, id);
    if (r.status !== "completed") throw new Error("التسوية ليست مكتملة");
    const [later] = await tx
      .select({ number: s.bankReconciliations.number })
      .from(s.bankReconciliations)
      .where(and(eq(s.bankReconciliations.accountId, r.accountId), sql`${s.bankReconciliations.id} <> ${id}`, sql`${s.bankReconciliations.statementDate} >= ${r.statementDate}`));
    if (later) throw new Error(`توجد تسوية لاحقة ${later.number}؛ ألغها أولاً`);
    await tx.update(s.bankReconciliations).set({ status: "draft", completedAt: null, completedBy: null }).where(eq(s.bankReconciliations.id, id));
  });
}

export async function deleteReconciliation(db: Db, id: number) {
  return db.transaction(async (tx) => {
    const r = await lockedRec(tx, id);
    if (r.status !== "draft") throw new Error("الحذف للمسودة فقط");
    await tx.delete(s.bankReconciliations).where(eq(s.bankReconciliations.id, id));
  });
}

export const BANK_ADJUSTMENTS = {
  fee: { label: "رسوم بنكية", account: "6108", side: "out" },
  interest: { label: "عائد أو إيراد بنكي", account: "4201", side: "in" },
} as const;

/** حركة في الكشف غير مسجلة في البرنامج (رسوم أو عائد): يُرحّل قيدها بتاريخ الكشف وتُطابق فوراً. */
export async function addBankAdjustment(db: Db, id: number, input: { kind: keyof typeof BANK_ADJUSTMENTS; amount: number; description?: string; userId?: number }) {
  return db.transaction(async (tx) => {
    const r = await lockedRec(tx, id);
    if (r.status !== "draft") throw new Error("التسوية مكتملة");
    if (!(input.amount > 0)) throw new Error("اكتب المبلغ");
    const kind = BANK_ADJUSTMENTS[input.kind];
    if (!kind) throw new Error("نوع الحركة غير صالح");
    const [bank] = await tx.select().from(s.accounts).where(eq(s.accounts.id, r.accountId));
    const [other] = await tx.select().from(s.accounts).where(eq(s.accounts.code, kind.account));
    const currencyCode = bank.currencyCode ?? "SAR";
    let exchangeRate = 1;
    if (currencyCode !== "SAR") {
      const [rate] = await tx
        .select({ rate: s.exchangeRates.rate })
        .from(s.exchangeRates)
        .where(and(eq(s.exchangeRates.currencyCode, currencyCode), sql`${s.exchangeRates.rateDate} <= ${r.statementDate}`))
        .orderBy(desc(s.exchangeRates.rateDate))
        .limit(1);
      if (!rate) throw new Error(`أدخل سعر صرف ${currencyCode} أولاً`);
      exchangeRate = Number(rate.rate);
    }
    const amount = r2(input.amount);
    const description = input.description?.trim() || `${kind.label} – كشف ${r.number}`;
    const bankLine = { accountId: bank.id, currencyCode, exchangeRate, description, ...(kind.side === "out" ? { credit: amount } : { debit: amount }) };
    const otherLine = { accountId: other.id, description, ...(kind.side === "out" ? { debit: r2(amount * exchangeRate) } : { credit: r2(amount * exchangeRate) }) };
    const entry = await createJournalEntryTx(tx, { entryDate: r.statementDate, description, post: true, userId: input.userId, lines: [bankLine, otherLine] });
    const [line] = await tx.select({ id: s.journalLines.id }).from(s.journalLines).where(and(eq(s.journalLines.entryId, entry.id), eq(s.journalLines.accountId, bank.id)));
    await tx.insert(s.bankReconciliationItems).values({ reconciliationId: id, journalLineId: line.id });
    return entry;
  });
}

export async function listReconciliations(db: Db | Tx) {
  const rows = await db
    .select({ r: s.bankReconciliations, account: s.accounts.nameAr, code: s.accounts.code, currency: s.accounts.currencyCode })
    .from(s.bankReconciliations)
    .innerJoin(s.accounts, eq(s.accounts.id, s.bankReconciliations.accountId))
    .orderBy(desc(s.bankReconciliations.statementDate), desc(s.bankReconciliations.id));
  return rows;
}

export const reconciledLineIds = (db: Db | Tx, lineIds: number[]) =>
  lineIds.length ? db.select({ id: s.bankReconciliationItems.journalLineId }).from(s.bankReconciliationItems).where(inArray(s.bankReconciliationItems.journalLineId, lineIds)) : Promise.resolve([]);
