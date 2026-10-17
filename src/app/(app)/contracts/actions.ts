"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { createContract, setContractStatus } from "@/lib/operations";
import { errorMessage } from "@/lib/errors";
import { cell, saveSheetRows, type SheetRow } from "@/lib/sheet-server";
import { PRICING_METHODS } from "@/data/operations";
import type { FormState } from "@/components/action-form";

export async function saveContracts(rows: SheetRow[]) {
  await requirePermission("contracts", "create");
  const result = await saveSheetRows(rows, async (r) => {
    await createContract(db, {
      customerId: Number(cell.required(r.customerId, "العميل")),
      number: cell.required(r.number, "رقم العقد"),
      fromDate: cell.date(r.fromDate, "من تاريخ") ?? cell.required("", "من تاريخ"),
      toDate: cell.date(r.toDate, "إلى تاريخ") ?? cell.required("", "إلى تاريخ"),
      currencyCode: r.currency === "KWD" ? "KWD" : "SAR",
      creditLimit: cell.number(r.creditLimit, "الحد الائتماني"),
      paymentTermsDays: cell.number(r.paymentTermsDays, "أيام السداد") ?? 30,
    });
  });
  revalidatePath("/contracts");
  return result;
}

export async function saveRates(contractId: number, rows: SheetRow[]) {
  await requirePermission("contracts", "update");
  const [contract] = await db.select().from(s.contracts).where(eq(s.contracts.id, contractId));
  if (!contract) return { saved: 0, error: "العقد غير موجود" };
  const result = await saveSheetRows(rows, async (r) => {
    const method = cell.required(r.method, "طريقة التسعير") as keyof typeof PRICING_METHODS;
    if (!(method in PRICING_METHODS)) throw new Error("طريقة التسعير غير معروفة");
    const price = cell.number(r.price, "السعر");
    if (!price) throw new Error("السعر إلزامي");
    const need = (v: string | undefined, label: string) => Number(cell.required(v, label));
    await db.insert(s.contractRates).values({
      contractId,
      method,
      routeId: ["route_fixed", "specific_vehicle", "car_transport"].includes(method) ? need(r.routeId, "المسار") : r.routeId ? Number(r.routeId) : null,
      vehicleTypeId: method === "per_km_vehicle_type" ? need(r.vehicleTypeId, "نوع المركبة") : null,
      vehicleId: method === "specific_vehicle" ? need(r.vehicleId, "المركبة") : null,
      price: String(price),
      unit: method === "per_quantity" ? cell.required(r.unit, "الوحدة") : null,
    });
  });
  revalidatePath(`/contracts/${contractId}`);
  return result;
}

export async function deleteRate(contractId: number, rateId: number) {
  await requirePermission("contracts", "update");
  await db.delete(s.contractRates).where(eq(s.contractRates.id, rateId));
  revalidatePath(`/contracts/${contractId}`);
}

export async function changeStatus(contractId: number, status: "active" | "suspended" | "draft"): Promise<FormState> {
  await requirePermission("contracts", "approve");
  try {
    await setContractStatus(db, contractId, status);
    revalidatePath(`/contracts/${contractId}`);
    return { ok: status === "active" ? "أصبح العقد سارياً" : "تم تغيير حالة العقد" };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}
