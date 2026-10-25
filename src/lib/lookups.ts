import "server-only";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";

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

export async function vehicleOptions() {
  const rows = await db.select({ id: s.vehicles.id, plate: s.vehicles.plate }).from(s.vehicles).orderBy(asc(s.vehicles.plate));
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
