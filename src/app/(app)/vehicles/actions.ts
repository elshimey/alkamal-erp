"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { createVehicle } from "@/lib/fleet";
import { cell, saveSheetRows, type SheetRow } from "@/lib/sheet-server";

export async function saveVehicles(rows: SheetRow[]) {
  await requirePermission("vehicles", "create");
  const result = await saveSheetRows(rows, async (r) => {
    const year = cell.number(r.year, "سنة الصنع");
    if (year != null && (year < 1980 || year > 2100)) throw new Error("سنة الصنع غير صالحة");
    await createVehicle(db, {
      plate: cell.required(r.plate, "اللوحة"),
      chassis: cell.required(r.chassis, "رقم الشاسيه"),
      vehicleTypeId: r.vehicleTypeId ? Number(r.vehicleTypeId) : null,
      make: cell.text(r.make),
      model: cell.text(r.model),
      year,
      ownership: r.ownership === "leased" ? "leased" : "owned",
      odometer: cell.number(r.odometer, "العداد") ?? 0,
    });
  });
  revalidatePath("/vehicles");
  return result;
}
