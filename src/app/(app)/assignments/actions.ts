"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { assignVehicle, releaseAssignment } from "@/lib/fleet";
import { errorMessage } from "@/lib/errors";
import { hasSpecial } from "@/lib/permissions";
import type { FormState } from "@/components/action-form";

const num = (v: FormDataEntryValue | null) => (v === null || v === "" ? null : Number(v));

export async function startAssignment(_: FormState, data: FormData): Promise<FormState> {
  const user = await requirePermission("vehicles", "update");
  const vehicleId = num(data.get("vehicleId"));
  const driverId = num(data.get("driverId"));
  const fromDate = String(data.get("fromDate") ?? "");
  if (!vehicleId || !driverId || !fromDate) return { error: "اختر المركبة والسائق وتاريخ الاستلام" };
  try {
    await assignVehicle(db, {
      vehicleId,
      driverId,
      fromDate,
      odometerStart: num(data.get("odometerStart")),
      notes: String(data.get("notes") ?? "") || null,
      userId: user.id,
    }, { canOverride: hasSpecial(user.perms, "override_controls"), overrideReason: String(data.get("overrideReason") ?? "") });
    revalidatePath("/assignments");
    return { ok: "سُجّل استلام السائق للمركبة" };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function endAssignment(assignmentId: number, _: FormState, data: FormData): Promise<FormState> {
  await requirePermission("vehicles", "update");
  const toDate = String(data.get("toDate") ?? "");
  if (!toDate) return { error: "أدخل تاريخ التسليم" };
  try {
    await releaseAssignment(db, { assignmentId, toDate, odometerEnd: num(data.get("odometerEnd")) });
    revalidatePath("/assignments");
    return { ok: "سُجّل التسليم" };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}
