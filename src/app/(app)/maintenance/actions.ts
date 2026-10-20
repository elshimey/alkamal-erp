"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { todayRiyadh } from "@/lib/dates";
import { cell, saveSheetRows, type SheetRow } from "@/lib/sheet-server";
import {
  addMaintenanceLines,
  approveBreakdownRequest,
  approveMaintenanceOrder,
  completeMaintenanceOrder,
  createBreakdownRequest,
  createMaintenanceOrder,
  deleteMaintenanceOrder,
  rejectBreakdownRequest,
  removeMaintenanceLine,
  revertMaintenanceOrder,
  reviewBreakdownRequest,
  savePlan,
} from "@/lib/maintenance";
import { MAINTENANCE_TYPES, PRIORITIES, type MaintenanceType } from "@/data/maintenance";
import type { FormState } from "@/components/action-form";

const refresh = (id?: number) => {
  revalidatePath("/maintenance");
  revalidatePath("/maintenance/requests");
  revalidatePath("/maintenance/plans");
  revalidatePath("/vehicles");
  revalidatePath("/");
  if (id) revalidatePath(`/maintenance/${id}`);
};

const optNum = (v: FormDataEntryValue | null) => (v && String(v).trim() ? Number(v) : null);
const typeOf = (v: unknown) => {
  const t = String(v ?? "");
  if (!(t in MAINTENANCE_TYPES)) throw new Error("اختر نوع الصيانة");
  return t as MaintenanceType;
};

// ───────────── أوامر الصيانة ─────────────

export async function createOrder(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requirePermission("maintenance", "create");
  let id: number;
  try {
    const provider = fd.get("provider") === "external" ? "external" : "internal";
    id = (
      await createMaintenanceOrder(db, {
        vehicleId: Number(fd.get("vehicleId")) || 0,
        orderDate: String(fd.get("orderDate") || todayRiyadh()),
        type: typeOf(fd.get("type")),
        provider,
        supplierId: optNum(fd.get("supplierId")),
        supplierInvoiceNo: String(fd.get("supplierInvoiceNo") || "") || null,
        cashAccountId: optNum(fd.get("cashAccountId")),
        odometer: optNum(fd.get("odometer")),
        breakdownRequestId: optNum(fd.get("breakdownRequestId")),
        planId: optNum(fd.get("planId")),
        notes: String(fd.get("notes") || "") || null,
        userId: user.id,
      })
    ).id;
  } catch (err) {
    return { error: errorMessage(err) };
  }
  refresh();
  redirect(`/maintenance/${id}`);
}

export async function saveLines(orderId: number, rows: SheetRow[]) {
  await requirePermission("maintenance", "update");
  // كل صف بند مستقل؛ الصف المخالف يبقى في الشيت مع سبب رفضه
  const result = await saveSheetRows(rows, async (r) => {
    const productId = r.productId ? Number(r.productId) : null;
    const warehouseId = r.warehouseId ? Number(r.warehouseId) : null;
    const unitPrice = cell.number(r.unitPrice, "السعر");
    if (unitPrice == null && !warehouseId) throw new Error("السعر إلزامي (أو اختر الصنف والمستودع للصرف من المخزون)");
    await addMaintenanceLines(db, orderId, [
      {
        kind: r.kind === "labor" ? "labor" : "part",
        productId,
        warehouseId,
        description: cell.text(r.description) ?? "",
        quantity: cell.number(r.quantity, "الكمية") ?? 1,
        unitPrice: unitPrice ?? 0,
        vatRate: r.vat === "0" ? 0 : 15,
      },
    ]);
  });
  refresh(orderId);
  return result;
}

export async function removeLine(orderId: number, lineId: number) {
  await requirePermission("maintenance", "update");
  await removeMaintenanceLine(db, orderId, lineId);
  refresh(orderId);
}

export async function approveOrder(id: number, _: FormState, fd: FormData): Promise<FormState> {
  const user = await requirePermission("maintenance", "approve");
  try {
    const entry = await approveMaintenanceOrder(db, id, { cashAccountId: optNum(fd.get("cashAccountId")), userId: user.id });
    refresh(id);
    return { ok: `اعتُمد الأمر ورُحّل القيد ${entry.number}` };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function completeOrder(id: number, _: FormState, fd: FormData): Promise<FormState> {
  await requirePermission("maintenance", "update");
  try {
    await completeMaintenanceOrder(db, id, { completedDate: String(fd.get("completedDate") || todayRiyadh()), odometer: optNum(fd.get("odometer")) });
    refresh(id);
    return { ok: "اكتمل الأمر وعادت المركبة للعمل" };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function revertOrder(id: number): Promise<FormState> {
  await requirePermission("maintenance", "revert");
  try {
    await revertMaintenanceOrder(db, id);
    refresh(id);
    return { ok: "أُرجع الأمر لمسودة وأُلغي قيده" };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function deleteOrder(id: number, _: FormState, fd: FormData): Promise<FormState> {
  const user = await requirePermission("maintenance", "delete");
  try {
    await deleteMaintenanceOrder(db, id, { reason: String(fd.get("reason") || ""), userId: user.id });
  } catch (err) {
    return { error: errorMessage(err) };
  }
  refresh();
  redirect("/maintenance");
}

// ───────────── طلبات العطل ─────────────

export async function saveRequests(rows: SheetRow[]) {
  const user = await requirePermission("maintenance", "create");
  const result = await saveSheetRows(rows, async (r) => {
    const priority = r.priority && r.priority in PRIORITIES ? (r.priority as keyof typeof PRIORITIES) : "normal";
    await createBreakdownRequest(db, {
      vehicleId: Number(cell.required(r.vehicleId, "المركبة")),
      driverId: r.driverId ? Number(r.driverId) : null,
      reportDate: cell.date(r.date, "التاريخ") ?? todayRiyadh(),
      description: cell.required(r.description, "وصف العطل"),
      priority,
      estimatedCost: cell.number(r.estimatedCost, "التكلفة التقديرية"),
      userId: user.id,
    });
  });
  refresh();
  return result;
}

export async function reviewRequest(id: number, _: FormState, fd: FormData): Promise<FormState> {
  const user = await requirePermission("maintenance", "update");
  try {
    const r = await reviewBreakdownRequest(db, id, { estimatedCost: optNum(fd.get("estimatedCost")), userId: user.id });
    refresh();
    return { ok: r.status === "approved" ? "اعتُمد الطلب" : "حُوّل الطلب لاعتماد المدير لتجاوزه الحد" };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function approveRequest(id: number): Promise<FormState> {
  const user = await requirePermission("maintenance", "approve");
  try {
    await approveBreakdownRequest(db, id, user.id);
    refresh();
    return { ok: "اعتُمد الطلب" };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function rejectRequest(id: number, _: FormState, fd: FormData): Promise<FormState> {
  await requirePermission("maintenance", "update");
  try {
    await rejectBreakdownRequest(db, id, String(fd.get("reason") || ""));
    refresh();
    return { ok: "رُفض الطلب" };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

// ───────────── الخطة الدورية ─────────────

export async function savePlans(rows: SheetRow[]) {
  await requirePermission("maintenance", "update");
  const result = await saveSheetRows(rows, async (r) => {
    const interval = cell.number(r.intervalDays, "المدة بالأيام");
    if (!interval) throw new Error("المدة بالأيام إلزامية");
    await savePlan(db, {
      vehicleId: Number(cell.required(r.vehicleId, "المركبة")),
      type: typeOf(r.type),
      title: cell.required(r.title, "اسم الصيانة"),
      intervalDays: Math.round(interval),
      lastDoneDate: cell.date(r.lastDone, "آخر تنفيذ"),
    });
  });
  refresh();
  return result;
}
