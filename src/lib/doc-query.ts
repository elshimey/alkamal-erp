import { and, asc, desc, eq, gte, ilike, lte, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import type { DocFilter } from "@/lib/doc-filters";

// شروط وترتيب قوائم الفواتير، مشتركة بين فواتير المبيعات وفواتير الموردين.
export interface DocColumns {
  number: AnyColumn;
  date: AnyColumn;
  due: AnyColumn;
  total: AnyColumn;
  paid: AnyColumn;
  status: AnyColumn;
  party: AnyColumn;
  /** أعمدة إضافية يشملها البحث (رقم فاتورة المورد، الملاحظات…) */
  search?: AnyColumn[];
}

export function docWhere(c: DocColumns, f: DocFilter, finalStatus: string): SQL | undefined {
  const where: (SQL | undefined)[] = [];
  if (f.q) {
    const like = `%${f.q.replace(/[%_\\]/g, "\\$&")}%`;
    where.push(or(...[c.number, c.party, ...(c.search ?? [])].map((col) => ilike(col, like))));
  }
  if (f.status) where.push(eq(c.status, f.status));
  if (f.from) where.push(gte(c.date, f.from));
  if (f.to) where.push(lte(c.date, f.to));
  if (f.pay) {
    const final = eq(c.status, finalStatus);
    if (f.pay === "unpaid") where.push(and(final, sql`${c.paid} = 0`));
    if (f.pay === "partial") where.push(and(final, sql`${c.paid} > 0 and ${c.paid} < ${c.total}`));
    if (f.pay === "paid") where.push(and(final, sql`${c.paid} >= ${c.total}`));
    if (f.pay === "overdue") where.push(and(final, sql`${c.paid} < ${c.total}`, sql`${c.due} < ${f.today}`));
  }
  const parts = where.filter((w): w is SQL => !!w);
  return parts.length ? and(...parts) : undefined;
}

export function docOrder(c: DocColumns & { id: AnyColumn }, sort: DocFilter["sort"]): SQL[] {
  switch (sort) {
    case "date_asc":
      return [asc(c.date), asc(c.id)];
    case "amount_desc":
      return [desc(c.total), desc(c.id)];
    case "amount_asc":
      return [asc(c.total), desc(c.id)];
    case "due_asc":
      return [asc(c.due), asc(c.id)];
    case "party_asc":
      return [asc(c.party), desc(c.date), desc(c.id)];
    default:
      return [desc(c.date), desc(c.id)];
  }
}
