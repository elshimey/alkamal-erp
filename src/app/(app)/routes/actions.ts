"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { createLocation, createRoute } from "@/lib/operations";
import { cell, saveSheetRows, type SheetRow } from "@/lib/sheet-server";

export async function saveLocations(rows: SheetRow[]) {
  await requirePermission("routes", "create");
  const result = await saveSheetRows(rows, async (r) => {
    const countryId = Number(cell.required(r.countryId, "الدولة"));
    const cityName = cell.required(r.city, "المدينة");
    const site = cell.text(r.site);
    let [city] = await db
      .select()
      .from(s.locations)
      .where(and(eq(s.locations.parentId, countryId), eq(s.locations.nameAr, cityName)));
    if (!city) city = await createLocation(db, { parentId: countryId, nameAr: cityName, isBorderCrossing: !site && r.border === "yes" });
    else if (!site) throw new Error(`المدينة ${cityName} مسجلة مسبقاً`);
    if (site) await createLocation(db, { parentId: city.id, nameAr: site, isBorderCrossing: r.border === "yes" });
  });
  revalidatePath("/routes");
  return result;
}

export async function saveRoutes(rows: SheetRow[]) {
  await requirePermission("routes", "create");
  const result = await saveSheetRows(rows, async (r) => {
    await createRoute(db, {
      fromLocationId: Number(cell.required(r.from, "من")),
      toLocationId: Number(cell.required(r.to, "إلى")),
      distanceKm: cell.number(r.distanceKm, "المسافة"),
      driverCommission: cell.number(r.driverCommission, "عمولة السائق") ?? 0,
      estimatedDieselLiters: cell.number(r.diesel, "الديزل التقديري"),
    });
  });
  revalidatePath("/routes");
  return result;
}
