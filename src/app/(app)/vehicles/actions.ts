"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { createVehicle } from "@/lib/fleet";
import { errorMessage } from "@/lib/errors";
import type { FormState } from "@/components/action-form";

const optionalInt = z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number().int().nonnegative().optional());

const VehicleSchema = z.object({
  plate: z.string().trim().min(1, "اللوحة إلزامية"),
  chassis: z.string().trim().min(1, "رقم الشاسيه إلزامي"),
  vehicleTypeId: optionalInt,
  make: z.string().trim().optional(),
  model: z.string().trim().optional(),
  year: optionalInt,
  ownership: z.enum(["owned", "leased"]),
  odometer: optionalInt,
});

export async function addVehicle(_: FormState, data: FormData): Promise<FormState> {
  await requirePermission("vehicles", "create");
  const parsed = VehicleSchema.safeParse(Object.fromEntries(data));
  if (!parsed.success) return { error: parsed.error.issues.map((i) => i.message).join("\n") };
  try {
    const v = await createVehicle(db, { ...parsed.data, make: parsed.data.make || null, model: parsed.data.model || null });
    revalidatePath("/vehicles");
    return { ok: `أُضيفت المركبة ${v.plate} ومركز تكلفتها` };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}
