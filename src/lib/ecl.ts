import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import * as s from "@/db/schema";
import { createJournalEntryTx, deleteEntryTx } from "@/lib/ledger";

// مخصص الخسائر الائتمانية المتوقعة (IFRS 9، الطريقة المبسطة): نسبة لكل شريحة عمر من أرصدة العملاء
// المستحقة، والفرق بين المطلوب ورصيد 1104 الحالي يُقيد على 6112.
export const ECL_BUCKETS = [
  { key: "notDue", label: "غير مستحقة", rate: 1 },
  { key: "d30", label: "متأخرة 1–30 يوماً", rate: 3 },
  { key: "d90", label: "31–90 يوماً", rate: 10 },
  { key: "d180", label: "91–180 يوماً", rate: 25 },
  { key: "d365", label: "181–365 يوماً", rate: 50 },
  { key: "over", label: "أكثر من سنة", rate: 100 },
] as const;
export type EclBucket = (typeof ECL_BUCKETS)[number]["key"];
export const DEFAULT_ECL_RATES = Object.fromEntries(ECL_BUCKETS.map((b) => [b.key, b.rate])) as Record<EclBucket, number>;

const PROVISION = "1104";
const EXPENSE = "6112";
const round2 = (n: number) => Math.round(n * 100) / 100;

/** أرصدة العملاء المفتوحة بالريال حسب شريحة التأخير في تاريخ معين. */
export async function eclAging(db: Db, asOf: string) {
  const rows = (await db.execute(sql`
    select p.id, p.name_ar as name,
      coalesce(sum(o) filter (where due_date >= ${asOf}), 0)::float8 as "notDue",
      coalesce(sum(o) filter (where ${asOf}::date - due_date between 1 and 30), 0)::float8 as d30,
      coalesce(sum(o) filter (where ${asOf}::date - due_date between 31 and 90), 0)::float8 as d90,
      coalesce(sum(o) filter (where ${asOf}::date - due_date between 91 and 180), 0)::float8 as d180,
      coalesce(sum(o) filter (where ${asOf}::date - due_date between 181 and 365), 0)::float8 as d365,
      coalesce(sum(o) filter (where ${asOf}::date - due_date > 365), 0)::float8 as over
    from (select customer_id, due_date, (total - paid_amount) * exchange_rate as o from sales_invoices
          where status = 'issued' and paid_amount < total and invoice_date <= ${asOf}) x
    join parties p on p.id = x.customer_id
    group by p.id, p.name_ar
    order by sum(o) desc`)) as unknown as ({ id: number; name: string } & Record<EclBucket, number>)[];
  return rows;
}

async function accountId(db: Db, code: string) {
  const [a] = await db.select({ id: s.accounts.id }).from(s.accounts).where(eq(s.accounts.code, code));
  if (!a) throw new Error(`الحساب ${code} غير موجود في الشجرة`);
  return a.id;
}

/** رصيد المخصص الحالي (دائن) من القيود المرحّلة حتى التاريخ. */
export async function provisionBalance(db: Db, asOf: string) {
  const id = await accountId(db, PROVISION);
  const [r] = (await db.execute(sql`
    select coalesce(sum(l.credit_base - l.debit_base), 0)::float8 as v from journal_lines l join journal_entries e on e.id = l.entry_id
    where l.account_id = ${id} and e.status = 'posted' and e.entry_date <= ${asOf}`)) as unknown as { v: number }[];
  return Number(r.v);
}

export function eclCompute(aging: Awaited<ReturnType<typeof eclAging>>, rates: Record<EclBucket, number>) {
  const customers = aging.map((c) => {
    const total = ECL_BUCKETS.reduce((t, b) => t + c[b.key], 0);
    const provision = round2(ECL_BUCKETS.reduce((t, b) => t + (c[b.key] * rates[b.key]) / 100, 0));
    return { ...c, total, provision };
  });
  const buckets = ECL_BUCKETS.map((b) => {
    const amount = customers.reduce((t, c) => t + c[b.key], 0);
    return { ...b, rate: rates[b.key], amount, provision: round2((amount * rates[b.key]) / 100) };
  });
  return { customers, buckets, total: buckets.reduce((t, b) => t + b.amount, 0), required: round2(buckets.reduce((t, b) => t + b.provision, 0)) };
}

/** يقيد تسوية المخصص في التاريخ: الزيادة مصروف، والنقص رد للمصروف. */
export async function postEcl(db: Db, asOf: string, rates: Record<EclBucket, number>, userId?: number) {
  for (const b of ECL_BUCKETS) if (!(rates[b.key] >= 0 && rates[b.key] <= 100)) throw new Error(`نسبة «${b.label}» بين 0 و100`);
  const { required } = eclCompute(await eclAging(db, asOf), rates);
  const current = await provisionBalance(db, asOf);
  const diff = round2(required - current);
  if (diff === 0) throw new Error("المخصص الحالي يساوي المطلوب؛ لا حاجة لقيد");
  const sourceId = Number(asOf.replace(/-/g, ""));
  const [dup] = await db.select({ id: s.journalEntries.id }).from(s.journalEntries).where(and(eq(s.journalEntries.sourceType, "ecl"), eq(s.journalEntries.sourceId, sourceId)));
  if (dup) throw new Error("يوجد قيد مخصص بنفس التاريخ؛ احذفه أولاً أو اختر تاريخاً آخر");
  const [prov, exp] = [await accountId(db, PROVISION), await accountId(db, EXPENSE)];
  const ratesText = ECL_BUCKETS.map((b) => `${b.label} ${rates[b.key]}%`).join("، ");
  return db.transaction(async (tx) =>
    createJournalEntryTx(tx, {
      entryDate: asOf,
      description: `${diff > 0 ? "تكوين" : "رد"} مخصص الخسائر الائتمانية المتوقعة في ${asOf} (المطلوب ${required.toFixed(2)}، السابق ${current.toFixed(2)}) – النسب: ${ratesText}`,
      source: { type: "ecl", id: sourceId },
      post: true,
      userId,
      lines:
        diff > 0
          ? [
              { accountId: exp, debit: diff, description: "مصروف الخسائر الائتمانية المتوقعة" },
              { accountId: prov, credit: diff, description: "زيادة المخصص" },
            ]
          : [
              { accountId: prov, debit: -diff, description: "تخفيض المخصص" },
              { accountId: exp, credit: -diff, description: "رد مخصص الخسائر الائتمانية" },
            ],
    }),
  );
}

export async function eclEntries(db: Db) {
  return db
    .select({ id: s.journalEntries.id, number: s.journalEntries.number, date: s.journalEntries.entryDate, description: s.journalEntries.description })
    .from(s.journalEntries)
    .where(eq(s.journalEntries.sourceType, "ecl"))
    .orderBy(desc(s.journalEntries.entryDate));
}

export async function deleteEcl(db: Db, entryId: number) {
  return db.transaction(async (tx) => {
    const [e] = await tx.select().from(s.journalEntries).where(and(eq(s.journalEntries.id, entryId), eq(s.journalEntries.sourceType, "ecl")));
    if (!e) throw new Error("القيد غير موجود");
    await deleteEntryTx(tx, e.id);
  });
}
