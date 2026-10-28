import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import * as s from "@/db/schema";
import { PARTY_ROLES } from "@/data/operations";
import { SALES_ACCOUNTS } from "@/data/sales";
import { PAYABLE_BY_ROLE } from "@/data/purchases";

// جهات الاتصال على طريقة وافق: قائمة كاملة، ولكل جهة ملخص أرصدة وأشخاص وكشف حساب.

export type PartyRole = keyof typeof PARTY_ROLES;

/** حسابات الموردين حسب الدور (2101 مورد، 2102 ناقل… 2105)؛ بالأرقام نفسها لا بالبادئة، حتى لا تدخل 2109 الضريبة */
const payables = sql.join(PAYABLE_BY_ROLE.map((r) => sql`${r.code}`), sql`, `);
const isPayable = sql`a.code in (${payables})`;
const isReceivable = sql`a.code = ${SALES_ACCOUNTS.receivable}`;

export const CONTACT_TABS = {
  all: "الكل",
  customer: "العملاء",
  supplier: "الموردون",
  carrier: "الناقلون",
  workshop: "الورش",
  fuel_station: "المحطات",
  customs_broker: "المخلصون",
} as const;
export type ContactTab = keyof typeof CONTACT_TABS;

export const CONTACT_SORTS = {
  name: "الاسم (أ-ي)",
  newest: "الأحدث إضافة",
  oldest: "الأقدم إضافة",
} as const;

export interface ContactFilter {
  q?: string;
  tab?: ContactTab;
  country?: string;
  sort?: keyof typeof CONTACT_SORTS;
}

const like = (q: string) => `%${q.replace(/[%_\\]/g, "\\$&")}%`;

export async function listContacts(db: Db | Tx, f: ContactFilter) {
  const where: SQL[] = [];
  if (f.q) {
    const l = like(f.q);
    where.push(or(ilike(s.parties.nameAr, l), ilike(s.parties.nameEn, l), ilike(s.parties.vatNumber, l), ilike(s.parties.mobile, l), ilike(s.parties.email, l), ilike(s.parties.city, l))!);
  }
  if (f.tab && f.tab !== "all") where.push(sql`exists (select 1 from party_roles r where r.party_id = ${s.parties.id} and r.role = ${f.tab})`);
  if (f.country) where.push(eq(s.parties.country, f.country));
  const order = f.sort === "newest" ? [desc(s.parties.id)] : f.sort === "oldest" ? [asc(s.parties.id)] : [asc(s.parties.nameAr)];
  return db
    .select({
      p: s.parties,
      // "parties"."id" صراحة: في استعلام جدول واحد يُكتب العمود بلا اسم جدوله فيقرأه الاستعلام الداخلي من جدوله هو
      roles: sql<string[]>`coalesce((select array_agg(r.role::text order by r.role) from party_roles r where r.party_id = "parties"."id"), '{}')`,
      people: sql<number>`(select count(*)::int from party_contacts c where c.party_id = "parties"."id")`,
    })
    .from(s.parties)
    .where(where.length ? and(...where) : undefined)
    .orderBy(...order)
    .limit(2000);
}

/** الدول المستخدمة فعلاً (لفلتر البلد). */
export async function contactCountries(db: Db | Tx) {
  return (await db.selectDistinct({ c: s.parties.country }).from(s.parties).orderBy(asc(s.parties.country))).map((r) => r.c);
}

/** الأرصدة من القيود المرحّلة فقط: حساب العملاء (1103) وحسابات الموردين (2101–2105). */
export async function contactSummary(db: Db | Tx, partyId: number) {
  const [r] = (await db.execute(sql`
    select
      coalesce(sum(case when ${isReceivable} then l.debit_base - l.credit_base end), 0)::float8 as receivable,
      coalesce(sum(case when ${isPayable} then l.credit_base - l.debit_base end), 0)::float8 as payable
    from journal_lines l
    join journal_entries e on e.id = l.entry_id and e.status = 'posted'
    join accounts a on a.id = l.account_id
    where l.party_id = ${partyId}`)) as unknown as { receivable: number; payable: number }[];
  const receivable = Number(r?.receivable ?? 0);
  const payable = Number(r?.payable ?? 0);
  return { receivable, payable, net: receivable - payable };
}

/** كشف حساب الجهة: كل حركاتها المرحّلة على حساب العملاء والموردين برصيد تراكمي (مدين موجب). */
export async function contactStatement(db: Db | Tx, partyId: number, from: string, to: string) {
  const accountFilter = sql`(${isReceivable} or ${isPayable})`;
  const [open] = (await db.execute(sql`
    select coalesce(sum(l.debit_base - l.credit_base), 0)::float8 as bal
    from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted' join accounts a on a.id = l.account_id
    where l.party_id = ${partyId} and ${accountFilter} and e.entry_date < ${from}`)) as unknown as { bal: number }[];
  const lines = (await db.execute(sql`
    select e.id as entry_id, e.number, e.entry_date, coalesce(l.description, e.description) as description, a.code, a.name_ar as account,
      l.debit_base::float8 as debit, l.credit_base::float8 as credit
    from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted' join accounts a on a.id = l.account_id
    where l.party_id = ${partyId} and ${accountFilter} and e.entry_date between ${from} and ${to}
    order by e.entry_date, e.id, l.id`)) as unknown as { entry_id: number; number: string; entry_date: string; description: string | null; code: string; account: string; debit: number; credit: number }[];
  let bal = Number(open?.bal ?? 0);
  const opening = bal;
  const rows = lines.map((l) => {
    bal += Number(l.debit) - Number(l.credit);
    return { ...l, debit: Number(l.debit), credit: Number(l.credit), balance: bal };
  });
  return { opening, rows, closing: bal, debit: rows.reduce((a, r) => a + r.debit, 0), credit: rows.reduce((a, r) => a + r.credit, 0) };
}

// ───────────── الأشخاص ─────────────

export const listPeople = (db: Db | Tx, partyId: number) => db.select().from(s.partyContacts).where(eq(s.partyContacts.partyId, partyId)).orderBy(asc(s.partyContacts.id));

export interface PersonInput {
  name: string;
  position?: string | null;
  mobile?: string | null;
  email?: string | null;
  notes?: string | null;
}

function cleanPerson(p: PersonInput) {
  const name = p.name?.trim();
  if (!name) throw new Error("اسم الشخص إلزامي");
  const email = p.email?.trim() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("البريد الإلكتروني غير صحيح");
  return { name, position: p.position?.trim() || null, mobile: p.mobile?.trim() || null, email, notes: p.notes?.trim() || null };
}

export async function addPerson(db: Db | Tx, partyId: number, p: PersonInput) {
  const [party] = await db.select({ id: s.parties.id }).from(s.parties).where(eq(s.parties.id, partyId));
  if (!party) throw new Error("جهة الاتصال غير موجودة");
  const [row] = await db.insert(s.partyContacts).values({ partyId, ...cleanPerson(p) }).returning();
  return row;
}

export async function updatePerson(db: Db | Tx, id: number, p: PersonInput) {
  const [row] = await db.update(s.partyContacts).set(cleanPerson(p)).where(eq(s.partyContacts.id, id)).returning();
  if (!row) throw new Error("الشخص غير موجود");
  return row;
}

export async function removePerson(db: Db | Tx, id: number) {
  await db.delete(s.partyContacts).where(eq(s.partyContacts.id, id));
}
