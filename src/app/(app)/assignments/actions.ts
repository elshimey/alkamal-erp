"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { createHandover, type HandoverItemInput, type HandoverKind } from "@/lib/handovers";
import { FUEL_LEVEL, HANDOVER_KIND, type FuelLevel } from "@/data/handovers";
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

/** محضر استلام أو تسليم: يسجل أثره على الإسناد ويحفظ المحضر برقمه ليُطبع. */
export async function saveHandoverAction(data: FormData): Promise<PanelResult> {
  const user = await requirePermission("vehicles", "update");
  const kind = String(data.get("kind") ?? "") as HandoverKind;
  if (!["receive", "return", "transfer"].includes(kind)) return { error: "اختر نوع المحضر" };
  const date = String(data.get("date") ?? "");
  if (!date) return { error: "أدخل التاريخ" };
  let items: HandoverItemInput[] = [];
  try {
    const raw = JSON.parse(String(data.get("items") || "[]"));
    if (Array.isArray(raw)) items = raw.map((r) => ({ name: String(r?.name ?? ""), qty: r?.qty == null ? null : Number(r.qty), condition: r?.condition ? String(r.condition) : null }));
  } catch {
    return { error: "بنود العدد والأدوات غير صحيحة" };
  }
  const fuel = text(data.get("fuelLevel"));
  const cond = text(data.get("condition"));
  try {
    const doc = await createHandover(
      db,
      {
        kind,
        vehicleId: num(data.get("vehicleId")),
        assignmentId: num(data.get("assignmentId")),
        driverId: num(data.get("driverId")),
        date,
        odometer: num(data.get("odometer")),
        fuelLevel: fuel && fuel in FUEL_LEVEL ? (fuel as FuelLevel) : null,
        condition: cond === "good" || cond === "notes" ? cond : null,
        companyRep: text(data.get("companyRep")),
        notes: text(data.get("notes")),
        items,
        userId: user.id,
      },
      { canOverride: hasSpecial(user.perms, "override_controls"), overrideReason: text(data.get("overrideReason")) },
    );
    const [v] = await db.select({ plate: s.vehicles.plate }).from(s.vehicles).where(eq(s.vehicles.id, doc.vehicleId));
    // دون إعادة تحميل المسار: تحديث الصفحة فوراً يغلق النافذة (المركبة لم تعد مسندة) قبل أن تنتقل لعرض المحضر؛
    // والانتقال إلى ?doc= يجلب الصفحة من جديد
    return { ok: `سُجّل ${HANDOVER_KIND[kind].title} ${v?.plate ?? ""} برقم ${doc.number}`, id: doc.id, label: doc.number };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}
