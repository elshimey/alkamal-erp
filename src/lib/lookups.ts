import "server-only";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { alias } from "drizzle-orm/pg-core";

// قوائم الاختيار المشتركة في الشيتات. الاسم الظاهر هو ما يُلصق من Excel.

/** المدن والمواقع؛ المخفية (غير المحفوظة للاستخدام لاحقاً) تُستبعد إلا عند طلبها لعرض أسماء المسارات. */
export async function locationOptions({ includeHidden = false } = {}) {
  const rows = await db.select().from(s.locations).orderBy(asc(s.locations.nameAr));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const label = (id: number): string => {
    const l = byId.get(id)!;
    if (l.level === "country" || !l.parentId) return l.nameAr;
    const parent = byId.get(l.parentId)!;
    return parent.level === "country" ? l.nameAr : `${parent.nameAr} / ${l.nameAr}`;
  };
  return rows
    .filter((r) => r.level !== "country" && (includeHidden || r.isActive))
    .map((r) => ({ value: String(r.id), label: label(r.id), countryCode: r.countryCode }))
    .sort((a, b) => a.label.localeCompare(b.label, "ar"));
}

export async function routeOptions() {
  const locs = new Map((await locationOptions({ includeHidden: true })).map((l) => [l.value, l.label]));
  const rows = await db.select().from(s.routes).where(eq(s.routes.isActive, true));
  return rows
    .map((r) => ({ value: String(r.id), label: `${locs.get(String(r.fromLocationId))} ← ${locs.get(String(r.toLocationId))}` }))
    .sort((a, b) => a.label.localeCompare(b.label, "ar"));
}

export async function customerOptions() {
  const rows = await db
    .select({ id: s.parties.id, nameAr: s.parties.nameAr })
    .from(s.parties)
    .innerJoin(s.partyRoles, eq(s.partyRoles.partyId, s.parties.id))
    .where(eq(s.partyRoles.role, "customer"))
    .orderBy(asc(s.parties.nameAr));
  return rows.map((r) => ({ value: String(r.id), label: r.nameAr }));
}

export async function vehicleTypeOptions() {
  const rows = await db.select().from(s.vehicleTypes).orderBy(asc(s.vehicleTypes.nameAr));
  return rows.map((r) => ({ value: String(r.id), label: r.nameAr }));
}

/** المركبات: الكل (للمصروفات والصيانة)، أو الرؤوس فقط، أو المقطورات فقط (للشحنة). */
export async function vehicleOptions(kind?: "head" | "trailer") {
  const rows = await db
    .select({ id: s.vehicles.id, plate: s.vehicles.plate })
    .from(s.vehicles)
    .where(kind ? and(eq(s.vehicles.assetKind, kind), ne(s.vehicles.status, "sold")) : undefined)
    .orderBy(asc(s.vehicles.plate));
  return rows.map((r) => ({ value: String(r.id), label: r.plate }));
}

export async function countryOptions() {
  const rows = await db.select().from(s.locations).where(eq(s.locations.level, "country")).orderBy(asc(s.locations.nameAr));
  return rows.map((r) => ({ value: String(r.id), label: r.nameAr }));
}

export async function partyOptions(role: (typeof s.partyRoleType.enumValues)[number]) {
  const rows = await db
    .select({ id: s.parties.id, nameAr: s.parties.nameAr })
    .from(s.parties)
    .innerJoin(s.partyRoles, eq(s.partyRoles.partyId, s.parties.id))
    .where(eq(s.partyRoles.role, role))
    .orderBy(asc(s.parties.nameAr));
  return rows.map((r) => ({ value: String(r.id), label: r.nameAr }));
}

export async function driverOptions() {
  const rows = await db
    .select({ id: s.drivers.id, nameAr: s.employees.nameAr })
    .from(s.drivers)
    .innerJoin(s.employees, eq(s.employees.id, s.drivers.employeeId))
    .where(eq(s.drivers.status, "active"))
    .orderBy(asc(s.employees.nameAr));
  return rows.map((r) => ({ value: String(r.id), label: r.nameAr }));
}

export async function chargeTypeOptions() {
  const rows = await db.select().from(s.chargeTypes).where(eq(s.chargeTypes.isActive, true)).orderBy(asc(s.chargeTypes.id));
  return rows.map((r) => ({ value: String(r.id), label: r.nameAr }));
}

/** الموظفون على رأس العمل (إداريون وسائقون) بأسمائهم. */
export async function employeeOptions() {
  const rows = await db
    .select({ id: s.employees.id, nameAr: s.employees.nameAr })
    .from(s.employees)
    .where(inArray(s.employees.status, ["active", "on_leave"]))
    .orderBy(asc(s.employees.nameAr));
  return rows.map((r) => ({ value: String(r.id), label: r.nameAr }));
}

/** الأصناف لسطور الشراء، مع وصفها وسعر شرائها لتعبئة السطر. */
export async function productOptions() {
  const rows = await db
    .select({ id: s.products.id, code: s.products.code, nameAr: s.products.nameAr, price: s.products.purchasePrice, unit: s.products.unit })
    .from(s.products)
    .where(eq(s.products.isActive, true))
    .orderBy(asc(s.products.nameAr));
  return rows.map((p) => ({ value: String(p.id), label: `${p.code ? `${p.code} – ` : ""}${p.nameAr}`, fill: { description: p.nameAr, price: String(Number(p.price) || "") } }));
}

/** أسماء جهات الاتصال وما سبق كتابته في المرسل والمستلم، للبحث أثناء الكتابة. */
export async function shipperSuggestions() {
  const [parties, used] = await Promise.all([
    db.select({ n: s.parties.nameAr }).from(s.parties),
    db.execute(sql`select distinct x as n from (select shipper as x from waybills union select consignee from waybills) t where x is not null and x <> '' limit 500`) as unknown as Promise<{ n: string }[]>,
  ]);
  return [...new Set([...parties.map((p) => p.n), ...used.map((u) => u.n)])].sort((a, b) => a.localeCompare(b, "ar"));
}

/** بطاقات المرسلين والمستلمين: جوال ومدينة وعنوان من جهات الاتصال، ثم من آخر شحنة سُجّلوا فيها. */
export async function contactCards() {
  const [parties, used] = await Promise.all([
    db.select({ n: s.parties.nameAr, phone: s.parties.mobile, city: s.parties.city, address: s.parties.nationalAddress, street: s.parties.street, district: s.parties.district }).from(s.parties),
    db.execute(sql`
      select distinct on (n) n, phone, city, address from (
        select shipper as n, shipper_phone as phone, shipper_city as city, shipper_address as address, id from waybills
        union all
        select consignee, consignee_phone, consignee_city, delivery_address, id from waybills
      ) t
      where n <> '' and coalesce(phone, city, address) is not null
      order by n, id desc
      limit 1000`) as unknown as Promise<{ n: string; phone: string | null; city: string | null; address: string | null }[]>,
  ]);
  const cards: Record<string, { phone?: string | null; city?: string | null; address?: string | null }> = {};
  for (const u of used) cards[u.n] = { phone: u.phone, city: u.city, address: u.address };
  for (const p of parties) {
    const c = (cards[p.n] ??= {});
    c.phone ||= p.phone;
    c.city ||= p.city;
    c.address ||= p.address || [p.district, p.street].filter(Boolean).join("، ") || null;
  }
  return cards;
}

/** أسماء المدن المحفوظة لاقتراحها في مدينة المرسل والمستلم. */
export async function cityNames() {
  const rows = await db
    .select({ n: s.locations.nameAr })
    .from(s.locations)
    .where(and(eq(s.locations.level, "city"), eq(s.locations.isActive, true)))
    .orderBy(asc(s.locations.nameAr));
  return [...new Set(rows.map((r) => r.n))];
}

const ACCOUNT_TYPE_LABEL: Record<(typeof s.accountType.enumValues)[number], string> = {
  asset: "أصول",
  liability: "التزامات",
  equity: "حقوق ملكية",
  revenue: "إيراد",
  cost_of_revenue: "تكلفة إيراد",
  expense: "مصروف",
};

/**
 * الحسابات القابلة للترحيل تحت رمز (أو كل الدليل)، مجمّعة تحت حسابها الأب ليسهل التمييز بينها:
 * الرمز ثم الاسم، وتحت كل مجموعة عنوانها ونوع الحساب بجانبه.
 */
export async function accountOptions(prefix?: string) {
  const parent = alias(s.accounts, "parent");
  const rows = await db
    .select({ id: s.accounts.id, code: s.accounts.code, nameAr: s.accounts.nameAr, type: s.accounts.type, parentCode: parent.code, parentName: parent.nameAr })
    .from(s.accounts)
    .leftJoin(parent, eq(parent.id, s.accounts.parentId))
    .where(and(eq(s.accounts.isPostable, true), eq(s.accounts.isActive, true), prefix ? sql`${s.accounts.code} like ${`${prefix}%`}` : undefined))
    .orderBy(asc(s.accounts.code));
  return rows.map((r) => ({
    value: String(r.id),
    label: `${r.code} ${r.nameAr}`,
    group: r.parentCode ? `${r.parentCode} ${r.parentName}` : ACCOUNT_TYPE_LABEL[r.type],
    hint: ACCOUNT_TYPE_LABEL[r.type],
  }));
}
