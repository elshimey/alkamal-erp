"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { assignVehicle, handoverVehicle, releaseAssignment } from "@/lib/fleet";
import { blockingDocumentIssues } from "@/lib/documents";
import { errorMessage } from "@/lib/errors";
import { hasSpecial } from "@/lib/permissions";
import type { PanelResult } from "@/components/record-panel";

const num = (v: FormDataEntryValue | null) => (v === null || v === "" ? null : Number(v));
const text = (v: FormDataEntryValue | null) => String(v ?? "").trim() || null;

/** الوثائق المانعة المنتهية للمركبة والسائق في تاريخ الاستلام، لتظهر في النافذة قبل الحفظ. */
export async function assignmentWarnings(vehicleId: number | null, driverId: number | null, onDate: string) {
  await requirePermission("vehicles", "view");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(onDate)) return [];
  const issues = await blockingDocumentIssues(
    db,
    [
      { kind: "vehicle", id: vehicleId },
      { kind: "driver", id: driverId },
    ],
    onDate,
    false,
  );
  return issues.map((i) => i.message);
}

export async function startAssignmentAction(data: FormData): Promise<PanelResult> {
  const user = await requirePermission("vehicles", "update");
  const vehicleId = num(data.get("vehicleId"));
  const driverId = num(data.get("driverId"));
  const fromDate = String(data.get("fromDate") ?? "");
  if (!vehicleId) return { error: "اختر المركبة" };
  if (!driverId) return { error: "اختر السائق" };
  if (!fromDate) return { error: "أدخل تاريخ الاستلام" };
  try {
    const row = await assignVehicle(
      db,
      { vehicleId, driverId, fromDate, odometerStart: num(data.get("odometerStart")), notes: text(data.get("notes")), userId: user.id },
      { canOverride: hasSpecial(user.perms, "override_controls"), overrideReason: text(data.get("overrideReason")) },
    );
    const [v] = await db.select({ plate: s.vehicles.plate }).from(s.vehicles).where(eq(s.vehicles.id, vehicleId));
    revalidatePath("/assignments");
    return { ok: `سُجّل استلام المركبة ${v?.plate ?? ""}`, id: row.id, label: v?.plate ?? "" };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function endAssignmentAction(assignmentId: number, data: FormData): Promise<PanelResult> {
  await requirePermission("vehicles", "update");
  const toDate = String(data.get("toDate") ?? "");
  if (!toDate) return { error: "أدخل تاريخ التسليم" };
  try {
    await releaseAssignment(db, { assignmentId, toDate, odometerEnd: num(data.get("odometerEnd")), notes: text(data.get("notes")) });
    revalidatePath("/assignments");
    revalidatePath("/vehicles");
    return { ok: "سُجّل التسليم", id: assignmentId, label: "" };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

/** تسليم المركبة من سائقها الحالي لسائق آخر (تسليم واستلام في خطوة واحدة). */
export async function handoverAssignmentAction(assignmentId: number, data: FormData): Promise<PanelResult> {
  const user = await requirePermission("vehicles", "update");
  const driverId = num(data.get("driverId"));
  const date = String(data.get("fromDate") ?? "");
  if (!driverId) return { error: "اختر السائق الجديد" };
  if (!date) return { error: "أدخل تاريخ التسليم" };
  try {
    const row = await handoverVehicle(
      db,
      { assignmentId, driverId, date, odometer: num(data.get("odometerStart")), notes: text(data.get("notes")), userId: user.id },
      { canOverride: hasSpecial(user.perms, "override_controls"), overrideReason: text(data.get("overrideReason")) },
    );
    const [v] = await db.select({ plate: s.vehicles.plate }).from(s.vehicles).where(eq(s.vehicles.id, row.vehicleId));
    revalidatePath("/assignments");
    revalidatePath("/vehicles");
    return { ok: `سُلّمت المركبة ${v?.plate ?? ""} للسائق الجديد`, id: row.id, label: v?.plate ?? "" };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}
