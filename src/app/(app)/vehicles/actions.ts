"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { createVehicle } from "@/lib/fleet";
import { saveOwnerDocumentFields } from "@/lib/documents";
import { parseForm, RECORDS, saveRecord } from "@/lib/records";
import { errorMessage } from "@/lib/errors";
import { cell, saveSheetRows, type SheetRow } from "@/lib/sheet-server";
import type { PanelResult } from "@/components/record-panel";

export async function saveVehicles(rows: SheetRow[]) {
  await requirePermission("vehicles", "create");
  const result = await saveSheetRows(rows, async (r) => {
    const year = cell.number(r.year, "سنة الصنع");
    if (year != null && (year < 1980 || year > 2100)) throw new Error("سنة الصنع غير صالحة");
    const assetAccountId = Number(cell.required(r.assetAccountId, "حساب الأصل"));
    await createVehicle(db, {
      assetAccountId,
      plate: cell.required(r.plate, "اللوحة"),
      chassis: cell.required(r.chassis, "رقم الشاسيه"),
      vehicleTypeId: r.vehicleTypeId ? Number(r.vehicleTypeId) : null,
      make: cell.text(r.make),
      model: cell.text(r.model),
      year,
      ownership: r.ownership === "leased" ? "leased" : "owned",
      odometer: cell.number(r.odometer, "العداد") ?? 0,
      assetKind: r.assetKind === "trailer" ? "trailer" : "head",
    });
  });
  revalidatePath("/vehicles");
  return result;
}

/** حفظ مركبة واحدة من نافذة الإضافة أو التعديل، مع وثائقها في المعاملة نفسها. */
export async function saveVehicleAction(id: number | null, data: FormData): Promise<PanelResult> {
  const user = await requirePermission("vehicles", id ? "update" : "create");
  try {
    const v = parseForm(RECORDS.vehicles, data);
    const plate = String(v.plate).trim();
    const chassis = String(v.chassis).trim();
    if (v.year != null && ((v.year as number) < 1980 || (v.year as number) > 2100)) throw new Error("سنة الصنع غير صالحة");
    if (!v.assetAccountId) throw new Error("حساب الأصل: إلزامي");
    const [dupPlate] = await db.select({ id: s.vehicles.id }).from(s.vehicles).where(and(eq(s.vehicles.plate, plate), id ? ne(s.vehicles.id, id) : undefined));
    if (dupPlate) throw new Error(`اللوحة «${plate}» مسجلة لمركبة أخرى`);
    const [dupChassis] = await db.select({ plate: s.vehicles.plate }).from(s.vehicles).where(and(eq(s.vehicles.chassis, chassis), id ? ne(s.vehicles.id, id) : undefined));
    if (dupChassis) throw new Error(`رقم الشاسيه مسجل للمركبة ${dupChassis.plate}`);
    const owner = (vid: number) => ({ kind: v.assetKind === "trailer" ? ("trailer" as const) : ("vehicle" as const), id: vid });

    let savedId = id;
    if (id) {
      await saveRecord("vehicles", id, v, async (tx) => {
        await saveOwnerDocumentFields(tx, owner(id), data, user.id);
      });
    } else {
      savedId = await db.transaction(async (tx) => {
        const row = await createVehicle(tx, {
          assetAccountId: v.assetAccountId as number,
          plate,
          chassis,
          vehicleTypeId: (v.vehicleTypeId as number | null) ?? null,
          make: v.make as string | null,
          model: v.model as string | null,
          year: v.year as number | null,
          ownership: v.ownership === "leased" ? "leased" : "owned",
          odometer: (v.odometer as number | null) ?? 0,
          assetKind: v.assetKind === "trailer" ? "trailer" : "head",
        });
        await tx
          .update(s.vehicles)
          .set({
            color: v.color as string | null,
            serialNumber: v.serialNumber as string | null,
            registrationType: v.registrationType as string | null,
            plateType: v.plateType as string | null,
            ownershipDate: v.ownershipDate as string | null,
            customsDocument: v.customsDocument as string | null,
          })
          .where(eq(s.vehicles.id, row.id));
        await saveOwnerDocumentFields(tx, owner(row.id), data, user.id);
        return row.id;
      });
    }
    revalidatePath("/vehicles");
    revalidatePath("/fleet-documents", "layout");
    return { ok: id ? `حُفظت المركبة ${plate}` : `أُضيفت المركبة ${plate}`, id: savedId!, label: plate };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}
