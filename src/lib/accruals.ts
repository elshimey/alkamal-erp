// الإيراد المستحق غير المفوتر (IFRS 15): رحلات معتمدة حتى آخر الشهر ولم تصدر فاتورتها بعد.
// قيد بآخر يوم في الشهر: مدين 1112 لكل عميل / دائن 4101 أو 4102 لكل مركبة،
// وقيد عكسي بأول يوم في الشهر التالي، فتعترف الفاتورة بالإيراد كاملاً عند صدورها دون ازدواج.
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import * as s from "@/db/schema";
import { SALES_ACCOUNTS } from "@/data/sales";
import { createJournalEntryTx, deleteEntryTx, type LineInput } from "@/lib/ledger";
import { openYear } from "@/lib/periods";

export const ACCRUAL_SOURCE = "revenue_accrual";
export const ACCRUAL_REVERSAL_SOURCE = "revenue_accrual_reversal";
export const UNBILLED_REVENUE = "1112";

const r2 = (v: number) => Math.round(v * 100) / 100 + 0;

/** "2026-10" ← آخر يوم في الشهر، وأول يوم في التالي، ومعرف المصدر 202610. */
export function accrualMonth(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("اختر الشهر");
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const next = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
  return {
    id: y * 100 + m,
    monthEnd: `${month}-${String(last).padStart(2, "0")}`,
    nextStart: `${next.y}-${String(next.m).padStart(2, "0")}-01`,
    nextYear: next.y,
  };
}

/** الشحنات المعتمدة حتى آخر الشهر التي لا تشملها فاتورة صادرة بتاريخ لا يتجاوزه. */
export async function unbilledWaybills(db: Db | Tx, monthEnd: string) {
  const rows = (await db.execute(sql`
    select w.id, w.number, w.waybill_date as date, w.customer_id, p.name_ar as customer, w.currency_code, w.amount::float8 as amount,
      w.is_international, v.cost_center_id as vehicle_cc
    from waybills w
    join parties p on p.id = w.customer_id
    left join vehicles v on v.id = w.vehicle_id
    where w.status in ('approved', 'invoiced') and w.waybill_date <= ${monthEnd}
      and not exists (
        select 1 from sales_invoice_lines l join sales_invoices i on i.id = l.invoice_id
        where l.waybill_id = w.id and l.kind = 'waybill' and i.status = 'issued' and i.invoice_date <= ${monthEnd})
    order by w.waybill_date, w.id`)) as unknown as {
    id: number;
    number: string;
    date: string;
    customer_id: number;
    customer: string;
    currency_code: string;
    amount: number;
    is_international: boolean;
    vehicle_cc: number | null;
  }[];
  const rates = new Map<string, number>([["SAR", 1]]);
  for (const code of new Set(rows.map((r) => r.currency_code))) {
    if (rates.has(code)) continue;
    const [rate] = await db
      .select({ rate: s.exchangeRates.rate })
      .from(s.exchangeRates)
      .where(and(eq(s.exchangeRates.currencyCode, code), sql`${s.exchangeRates.rateDate} <= ${monthEnd}`))
      .orderBy(desc(s.exchangeRates.rateDate))
      .limit(1);
    if (!rate) throw new Error(`أدخل سعر صرف ${code} حتى ${monthEnd}`);
    rates.set(code, Number(rate.rate));
  }
  return rows.map((r) => ({ ...r, amountBase: r2(Number(r.amount) * rates.get(r.currency_code)!) }));
}

export async function accrualPreview(db: Db, month: string) {
  const { monthEnd } = accrualMonth(month);
  const rows = await unbilledWaybills(db, monthEnd);
  const byCustomer = new Map<string, { customer: string; count: number; amount: number }>();
  for (const r of rows) {
    const c = byCustomer.get(r.customer) ?? { customer: r.customer, count: 0, amount: 0 };
    c.count++;
    c.amount = r2(c.amount + r.amountBase);
    byCustomer.set(r.customer, c);
  }
  return { count: rows.length, total: r2(rows.reduce((t, r) => t + r.amountBase, 0)), customers: [...byCustomer.values()] };
}

/** يرحّل قيد الاستحقاق وعكسه. */
export async function postRevenueAccrual(db: Db, month: string, userId?: number) {
  const m = accrualMonth(month);
  return db.transaction(async (tx) => {
    const [exists] = await tx
      .select({ number: s.journalEntries.number })
      .from(s.journalEntries)
      .where(and(eq(s.journalEntries.sourceType, ACCRUAL_SOURCE), eq(s.journalEntries.sourceId, m.id)));
    if (exists) throw new Error(`رُحّل استحقاق هذا الشهر بالقيد ${exists.number}`);
    const rows = await unbilledWaybills(tx, m.monthEnd);
    if (!rows.length) throw new Error("لا توجد رحلات معتمدة غير مفوترة حتى آخر الشهر");
    const codes = [UNBILLED_REVENUE, SALES_ACCOUNTS.domesticRevenue, SALES_ACCOUNTS.internationalRevenue];
    const accs = new Map((await tx.select({ id: s.accounts.id, code: s.accounts.code }).from(s.accounts).where(inArray(s.accounts.code, codes))).map((a) => [a.code, a.id]));
    const [ext] = await tx.select({ id: s.costCenters.id }).from(s.costCenters).where(eq(s.costCenters.code, "EXT"));
    const dr = new Map<number, number>();
    const cr = new Map<string, { accountId: number; costCenterId: number | null; amount: number }>();
    for (const r of rows) {
      dr.set(Number(r.customer_id), r2((dr.get(Number(r.customer_id)) ?? 0) + r.amountBase));
      const accountId = accs.get(r.is_international ? SALES_ACCOUNTS.internationalRevenue : SALES_ACCOUNTS.domesticRevenue)!;
      const costCenterId = r.vehicle_cc == null ? (ext?.id ?? null) : Number(r.vehicle_cc);
      const k = `${accountId}:${costCenterId}`;
      const c = cr.get(k) ?? { accountId, costCenterId, amount: 0 };
      c.amount = r2(c.amount + r.amountBase);
      cr.set(k, c);
    }
    const description = `إيراد مستحق غير مفوتر – ${rows.length} رحلة حتى ${m.monthEnd}`;
    const lines: LineInput[] = [
      ...[...dr].map(([partyId, amount]) => ({ accountId: accs.get(UNBILLED_REVENUE)!, partyId, debit: amount, description })),
      ...[...cr.values()].map((c) => ({ accountId: c.accountId, costCenterId: c.costCenterId, credit: c.amount, description })),
    ];
    const reversed = lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit, description: `عكس ${description}` }));
    const entry = await createJournalEntryTx(tx, { entryDate: m.monthEnd, description, source: { type: ACCRUAL_SOURCE, id: m.id }, post: true, userId, lines });
    await openYear(tx, m.nextYear);
    const reversal = await createJournalEntryTx(tx, { entryDate: m.nextStart, description: `عكس ${description}`, source: { type: ACCRUAL_REVERSAL_SOURCE, id: m.id }, post: true, userId, lines: reversed });
    return { entry, reversal, count: rows.length, total: r2(rows.reduce((t, r) => t + r.amountBase, 0)) };
  });
}

export async function undoRevenueAccrual(db: Db, month: string) {
  const m = accrualMonth(month);
  return db.transaction(async (tx) => {
    const entries = await tx
      .select({ id: s.journalEntries.id })
      .from(s.journalEntries)
      .where(and(inArray(s.journalEntries.sourceType, [ACCRUAL_SOURCE, ACCRUAL_REVERSAL_SOURCE]), eq(s.journalEntries.sourceId, m.id)));
    if (!entries.length) throw new Error("لا يوجد استحقاق مرحّل لهذا الشهر");
    for (const e of entries) await deleteEntryTx(tx, e.id);
  });
}

/** آخر قيود الاستحقاق المرحّلة. */
export async function listAccruals(db: Db) {
  const rows = await db
    .select({ id: s.journalEntries.id, sourceId: s.journalEntries.sourceId, number: s.journalEntries.number, date: s.journalEntries.entryDate, description: s.journalEntries.description })
    .from(s.journalEntries)
    .where(eq(s.journalEntries.sourceType, ACCRUAL_SOURCE))
    .orderBy(desc(s.journalEntries.entryDate))
    .limit(12);
  const totals = (await db.execute(sql`
    select l.entry_id, sum(l.debit_base)::float8 as total from journal_lines l
    join accounts a on a.id = l.account_id and a.code = ${UNBILLED_REVENUE}
    where l.entry_id in (${sql.join((rows.length ? rows.map((r) => r.id) : [0]).map((id) => sql`${id}`), sql`, `)}) group by l.entry_id`)) as unknown as { entry_id: number; total: number }[];
  return rows.map((r) => ({
    ...r,
    month: `${Math.floor(Number(r.sourceId) / 100)}-${String(Number(r.sourceId) % 100).padStart(2, "0")}`,
    total: Number(totals.find((t) => Number(t.entry_id) === r.id)?.total ?? 0),
  }));
}
