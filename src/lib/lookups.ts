import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";

// قوائم الاختيار المشتركة في الشيتات. الاسم الظاهر هو ما يُلصق من Excel.

export async function locationOptions() {
  const rows = await db.select().from(s.locations).orderBy(asc(s.locations.nameAr));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const label = (id: number): string => {
    const l = byId.get(id)!;
    if (l.level === "country" || !l.parentId) return l.nameAr;
    const parent = byId.get(l.parentId)!;
    return parent.level === "country" ? l.nameAr : `${parent.nameAr} / ${l.nameAr}`;
  };
  return rows
    .filter((r) => r.level !== "country")
    .map((r) => ({ value: String(r.id), label: label(r.id), countryCode: r.countryCode }))
    .sort((a, b) => a.label.localeCompare(b.label, "ar"));
}

export async function routeOptions() {
  const locs = new Map((await locationOptions()).map((l) => [l.value, l.label]));
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
