// الفترات المحاسبية وإقفال السنة.
// - قفل الشهر يمنع (في قاعدة البيانات) ترحيل أي قيد بتاريخه أو إرجاع قيوده لمسودة.
// - إقفال السنة: قيد بتاريخ 31 ديسمبر يُصفّر حسابات الإيرادات والمصروفات (4–7) لكل حساب ومركز تكلفة،
//   والصافي إلى 3103 «الأرباح المبقاة»، ثم تُقفل أشهر السنة كلها. التقارير الدورية تستبعد هذا القيد.
import { and, asc, eq, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import * as s from "@/db/schema";
import { createJournalEntryTx, deleteEntryTx, type LineInput } from "@/lib/ledger";

export const YEAR_CLOSE_SOURCE = "year_close";
export const RETAINED_EARNINGS = "3103";

const r2 = (v: number) => Math.round(v * 100) / 100 + 0;

/** ينشئ أشهر السنة إن لم تكن موجودة (لا يغير الموجود). */
export async function openYear(db: Db | Tx, year: number) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error("السنة غير صالحة");
  await db
    .insert(s.fiscalPeriods)
    .values(
      Array.from({ length: 12 }, (_, i) => {
        const month = i + 1;
        const mm = String(month).padStart(2, "0");
        const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
        return { year, month, startDate: `${year}-${mm}-01`, endDate: `${year}-${mm}-${last}` };
      }),
    )
    .onConflictDoNothing();
}

/** أشهر كل سنة مع عدد القيود المرحّلة والمسودة، وحالة إقفال السنة. */
export async function listPeriods(db: Db) {
  const periods = await db.select().from(s.fiscalPeriods).orderBy(asc(s.fiscalPeriods.year), asc(s.fiscalPeriods.month));
  const counts = (await db.execute(sql`
    select fp.id,
      count(e.id) filter (where e.status = 'posted')::int as posted,
      count(e.id) filter (where e.status = 'draft')::int as drafts
    from fiscal_periods fp
    left join journal_entries e on e.entry_date between fp.start_date and fp.end_date
    group by fp.id`)) as unknown as { id: number; posted: number; drafts: number }[];
  const byId = new Map(counts.map((c) => [Number(c.id), c]));
  const closings = await db
    .select({ id: s.journalEntries.id, year: s.journalEntries.sourceId, number: s.journalEntries.number })
    .from(s.journalEntries)
    .where(eq(s.journalEntries.sourceType, YEAR_CLOSE_SOURCE));
  const years = [...new Set(periods.map((p) => p.year))].sort((a, b) => b - a);
  return years.map((year) => ({
    year,
    closing: closings.find((c) => c.year === year) ?? null,
    months: periods
      .filter((p) => p.year === year)
      .map((p) => ({ ...p, posted: byId.get(p.id)?.posted ?? 0, drafts: byId.get(p.id)?.drafts ?? 0 })),
  }));
}

export async function setPeriodStatus(db: Db, id: number, status: "open" | "closed", userId?: number) {
  const [p] = await db.select().from(s.fiscalPeriods).where(eq(s.fiscalPeriods.id, id));
  if (!p) throw new Error("الفترة غير موجودة");
  if (status === "open") {
    const [closing] = await db
      .select({ id: s.journalEntries.id })
      .from(s.journalEntries)
      .where(and(eq(s.journalEntries.sourceType, YEAR_CLOSE_SOURCE), eq(s.journalEntries.sourceId, p.year)));
    if (closing) throw new Error(`السنة ${p.year} مقفلة بقيد إقفال؛ ألغِ إقفال السنة أولاً`);
  }
  await db
    .update(s.fiscalPeriods)
    .set(status === "closed" ? { status, closedAt: new Date(), closedBy: userId ?? null } : { status, closedAt: null, closedBy: null })
    .where(eq(s.fiscalPeriods.id, id));
}

/** أرصدة الإيرادات والمصروفات للسنة لكل حساب ومركز تكلفة (قبل الإقفال). */
async function incomeBalances(tx: Db | Tx, year: number) {
  return (await tx.execute(sql`
    select l.account_id, l.cost_center_id, sum(l.debit_base - l.credit_base) as balance
    from journal_lines l
    join journal_entries e on e.id = l.entry_id and e.status = 'posted'
    join accounts a on a.id = l.account_id
    where a.code ~ '^[4-7]' and e.entry_date between ${`${year}-01-01`} and ${`${year}-12-31`}
      and e.source_type is distinct from ${YEAR_CLOSE_SOURCE}
    group by l.account_id, l.cost_center_id
    having abs(sum(l.debit_base - l.credit_base)) >= 0.005`)) as unknown as { account_id: number; cost_center_id: number | null; balance: string }[];
}

/** معاينة الإقفال: صافي الربح الذي سيُنقل للأرباح المبقاة. */
export async function yearClosePreview(db: Db, year: number) {
  const rows = await incomeBalances(db, year);
  const net = r2(rows.reduce((t, r) => t - Number(r.balance), 0));
  return { lines: rows.length, net };
}

/** إقفال السنة: قيد الإقفال بتاريخ 31 ديسمبر، ثم قفل أشهرها الاثني عشر. */
export async function closeYear(db: Db, year: number, userId?: number) {
  return db.transaction(async (tx) => {
    const periods = await tx.select().from(s.fiscalPeriods).where(eq(s.fiscalPeriods.year, year)).for("update");
    if (periods.length !== 12) throw new Error(`أشهر السنة ${year} غير مكتملة`);
    const dec = periods.find((p) => p.month === 12)!;
    if (dec.status === "closed") throw new Error("افتح شهر ديسمبر ليُرحّل فيه قيد الإقفال");
    const [drafts] = (await tx.execute(sql`
      select count(*)::int as n from journal_entries
      where status = 'draft' and entry_date between ${`${year}-01-01`} and ${`${year}-12-31`}`)) as unknown as { n: number }[];
    if (drafts.n > 0) throw new Error(`في السنة ${drafts.n} قيد مسودة؛ رحّلها أو احذفها قبل الإقفال`);
    const rows = await incomeBalances(tx, year);
    const [retained] = await tx.select().from(s.accounts).where(eq(s.accounts.code, RETAINED_EARNINGS));
    if (!retained) throw new Error("حساب الأرباح المبقاة 3103 غير موجود");
    const lines: LineInput[] = rows.map((r) => {
      const b = r2(Number(r.balance));
      return { accountId: Number(r.account_id), costCenterId: r.cost_center_id == null ? null : Number(r.cost_center_id), ...(b > 0 ? { credit: b } : { debit: -b }), description: `إقفال ${year}` };
    });
    const net = r2(lines.reduce((t, l) => t + (l.debit ?? 0) - (l.credit ?? 0), 0));
    if (Math.abs(net) >= 0.005) lines.push({ accountId: retained.id, ...(net > 0 ? { credit: net } : { debit: -net }), description: net > 0 ? `صافي ربح ${year}` : `صافي خسارة ${year}` });
    if (lines.length < 2) throw new Error("لا توجد إيرادات أو مصروفات في هذه السنة");
    const entry = await createJournalEntryTx(tx, {
      entryDate: `${year}-12-31`,
      description: `قيد إقفال السنة المالية ${year}`,
      source: { type: YEAR_CLOSE_SOURCE, id: year },
      post: true,
      userId,
      lines,
    });
    await tx.update(s.fiscalPeriods).set({ status: "closed", closedAt: new Date(), closedBy: userId ?? null }).where(eq(s.fiscalPeriods.year, year));
    return { entry, net };
  });
}

/** إلغاء إقفال السنة: يفتح ديسمبر ويحذف قيد الإقفال، وتبقى بقية الأشهر مقفلة. */
export async function reopenYear(db: Db, year: number) {
  return db.transaction(async (tx) => {
    const [closing] = await tx
      .select()
      .from(s.journalEntries)
      .where(and(eq(s.journalEntries.sourceType, YEAR_CLOSE_SOURCE), eq(s.journalEntries.sourceId, year)));
    if (!closing) throw new Error("السنة غير مقفلة بقيد إقفال");
    await tx.update(s.fiscalPeriods).set({ status: "open", closedAt: null, closedBy: null }).where(and(eq(s.fiscalPeriods.year, year), eq(s.fiscalPeriods.month, 12)));
    await deleteEntryTx(tx, closing.id);
  });
}
