import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import * as s from "@/db/schema";
import { SALES_ACCOUNTS } from "@/data/sales";

// العملاء كما في وافق: الرصيد المستحق والمتأخر والرصيد الدائن لكل عميل، بالريال.

export const CUSTOMER_FILTERS = { balance: "عليهم رصيد", overdue: "لديهم متأخرات", credit: "لهم رصيد دائن", inactive: "غير نشطين" } as const;
export const CUSTOMER_SORTS = { party_asc: "حسب الاسم", amount_desc: "الأعلى رصيداً", due_asc: "الأعلى متأخرات", date_desc: "آخر فاتورة" } as const;
export type CustomerFilter = keyof typeof CUSTOMER_FILTERS;

export async function listCustomers(db: Db | Tx, f: { q?: string; filter?: CustomerFilter; sort?: keyof typeof CUSTOMER_SORTS; today: string }) {
  const inv = sql`sales_invoices i where i.customer_id = ${s.parties.id} and i.status = 'issued'`;
  const outstanding = sql<string>`coalesce((select sum((i.total - i.paid_amount) * i.exchange_rate) from ${inv}), 0)`;
  const overdue = sql<string>`coalesce((select sum((i.total - i.paid_amount) * i.exchange_rate) from ${inv} and i.due_date < ${f.today}), 0)`;
  const openCount = sql<number>`(select count(*) from ${inv} and i.paid_amount < i.total)::int`;
  const lastInvoice = sql<string | null>`(select max(i.invoice_date) from ${inv})`;
  // الرصيد الدائن: الدفعات المقدمة 2112 وأي رصيد دائن في حساب العملاء من القيود المرحّلة
  const ledger = (code: string, sign: SQL) =>
    sql<string>`coalesce((select sum(${sign}) from journal_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id
      where l.party_id = parties.id and e.status = 'posted' and a.code like ${`${code}%`}), 0)`;
  const advances = ledger(SALES_ACCOUNTS.customerAdvances, sql`l.credit_base - l.debit_base`);
  const receivable = ledger(SALES_ACCOUNTS.receivable, sql`l.debit_base - l.credit_base`);

  const where: (SQL | undefined)[] = [sql`exists (select 1 from party_roles r where r.party_id = ${s.parties.id} and r.role = 'customer')`];
  if (f.q) {
    const q = `%${f.q.replace(/[%_\\]/g, "\\$&")}%`;
    where.push(or(ilike(s.parties.nameAr, q), ilike(s.parties.nameEn, q), ilike(s.parties.vatNumber, q), ilike(s.parties.mobile, q)));
  }
  if (f.filter === "inactive") where.push(eq(s.parties.isActive, false));
  const rows = await db
    .select({ p: s.parties, outstanding, overdue, openCount, lastInvoice, advances, receivable })
    .from(s.parties)
    .where(and(...where))
    .orderBy(f.sort === "amount_desc" ? desc(outstanding) : f.sort === "due_asc" ? desc(overdue) : f.sort === "date_desc" ? sql`${lastInvoice} desc nulls last` : asc(s.parties.nameAr));
  const list = rows.map((r) => {
    const adv = Number(r.advances);
    const rec = Number(r.receivable);
    return { ...r, outstanding: Number(r.outstanding), overdue: Number(r.overdue), credit: Math.max(0, adv) + Math.max(0, -rec) };
  });
  if (f.filter === "balance") return list.filter((r) => r.outstanding > 0.005);
  if (f.filter === "overdue") return list.filter((r) => r.overdue > 0.005);
  if (f.filter === "credit") return list.filter((r) => r.credit > 0.005);
  return list;
}

/** ملخص العميل للمعاينة الجانبية: فواتيره المفتوحة وآخر سنداته. */
export async function customerActivity(db: Db | Tx, customerId: number) {
  const [invoices, receipts] = await Promise.all([
    db
      .select({ id: s.salesInvoices.id, number: s.salesInvoices.number, invoiceDate: s.salesInvoices.invoiceDate, dueDate: s.salesInvoices.dueDate, total: s.salesInvoices.total, paid: s.salesInvoices.paidAmount, currencyCode: s.salesInvoices.currencyCode, status: s.salesInvoices.status })
      .from(s.salesInvoices)
      .where(eq(s.salesInvoices.customerId, customerId))
      .orderBy(desc(s.salesInvoices.invoiceDate), desc(s.salesInvoices.id))
      .limit(12),
    db
      .select({ id: s.receipts.id, number: s.receipts.number, receiptDate: s.receipts.receiptDate, amount: s.receipts.amount, currencyCode: s.receipts.currencyCode, kind: s.receipts.kind, status: s.receipts.status })
      .from(s.receipts)
      .where(eq(s.receipts.customerId, customerId))
      .orderBy(desc(s.receipts.receiptDate), desc(s.receipts.id))
      .limit(8),
  ]);
  return { invoices, receipts };
}
