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
  createOrdersFrom,
  deleteMaintenanceOrder,
  rejectBreakdownRequest,
  removeMaintenanceLine,
  revertMaintenanceOrder,
  reviewBreakdownRequest,
  savePlan,
  updateDraftOrder,
  updatePlan,
} from "@/lib/maintenance";
import type { DocSheetResult, SheetChange } from "@/components/doc-sheet";
import { MAINTENANCE_TYPES, PRIORITIES, type MaintenanceType } from "@/data/maintenance";
import type { FormState } from "@/components/action-form";
import type { PanelResult } from "@/components/record-panel";

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

type PanelLine = Record<string, string | undefined>;

/** نافذة أمر الصيانة: الرأس والبنود في حفظ واحد؛ أي خطأ في بند يُلغي الأمر كله فلا تبقى مسودة ناقصة. */
export async function saveOrderPanelAction(data: FormData): Promise<PanelResult> {
  const user = await requirePermission("maintenance", "create");
  const get = (k: string) => String(data.get(k) ?? "").trim();
  try {
    if (!get("vehicleId")) throw new Error("اختر المركبة");
    const provider = get("provider") === "internal" ? "internal" : "external";
    const raw = JSON.parse(get("lines") || "[]") as PanelLine[];
    const lines = raw
      .filter((r) => ["productId", "description", "unitPrice"].some((k) => (r[k] ?? "").trim()))
      .map((r, i) => {
        const n = i + 1;
        const productId = Number(r.productId) || null;
        const warehouseId = Number(r.warehouseId) || null;
        const num = (v: string | undefined, label: string) => {
          if (!(v ?? "").trim()) return null;
          const x = Number(String(v).replace(/,/g, ""));
          if (!Number.isFinite(x) || x < 0) throw new Error(`البند ${n}: ${label} غير صحيح`);
          return x;
        };
        const unitPrice = num(r.unitPrice, "السعر");
        if (unitPrice == null && !(productId && warehouseId)) throw new Error(`البند ${n}: السعر إلزامي (أو اختر الصنف والمستودع للصرف من المخزون)`);
        const quantity = num(r.quantity, "الكمية") ?? 1;
        if (!(quantity > 0)) throw new Error(`البند ${n}: الكمية يجب أن تكون أكبر من صفر`);
        return {
          kind: r.kind === "labor" ? ("labor" as const) : ("part" as const),
          productId,
          warehouseId,
          description: (r.description ?? "").trim(),
          quantity,
          unitPrice,
          vatRate: r.vat === "0" ? 0 : 15,
        };
      });
    const order = await db.transaction(async (tx) => {
      const o = await createMaintenanceOrder(tx, {
        vehicleId: Number(get("vehicleId")),
        orderDate: get("orderDate") || todayRiyadh(),
        type: typeOf(get("type")),
        provider,
        supplierId: provider === "external" ? optNum(get("supplierId")) : null,
        supplierInvoiceNo: provider === "external" ? get("supplierInvoiceNo") || null : null,
        cashAccountId: provider === "internal" ? optNum(get("cashAccountId")) : null,
        odometer: optNum(get("odometer")),
        breakdownRequestId: optNum(get("breakdownRequestId")),
        planId: optNum(get("planId")),
        notes: get("notes") || null,
        userId: user.id,
      });
      if (lines.length) await addMaintenanceLines(tx, o.id, lines);
      return o;
    });
    refresh(order.id);
    return { ok: `أُنشئ أمر الصيانة ${order.number}`, id: order.id, label: order.number };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function saveLines(orderId: number, rows: SheetRow[]) {
  await requirePermission("maintenance", "update");
  // كل صف بند مستقل؛ الصف المخالف يبقى في الشيت مع سبب رفضه
  const result = await saveSheetRows(rows, async (r) => {
    const productId = r.productId ? Number(r.productId) : null;
    const warehouseId = r.warehouseId ? Number(r.warehouseId) : null;
    const unitPrice = cell.number(r.unitPrice, "السعر");
    if (unitPrice == null && !(productId && warehouseId)) throw new Error("السعر إلزامي (أو اختر الصنف والمستودع للصرف من المخزون)");
    await addMaintenanceLines(db, orderId, [
      {
        kind: r.kind === "labor" ? "labor" : "part",
        productId,
        warehouseId,
        description: cell.text(r.description) ?? "",
        quantity: cell.number(r.quantity, "الكمية") ?? 1,
        unitPrice,
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

const priorityOf = (v: unknown) => (String(v ?? "") in PRIORITIES ? (String(v) as keyof typeof PRIORITIES) : "normal");

/** نافذة بلاغ عطل واحد. */
export async function saveRequestAction(data: FormData): Promise<PanelResult> {
  const user = await requirePermission("maintenance", "create");
  const get = (k: string) => String(data.get(k) ?? "").trim();
  try {
    if (!get("vehicleId")) throw new Error("اختر المركبة");
    const cost = get("estimatedCost").replace(/,/g, "");
    if (cost && !(Number(cost) >= 0)) throw new Error("التكلفة التقديرية غير صحيحة");
    const r = await createBreakdownRequest(db, {
      vehicleId: Number(get("vehicleId")),
      driverId: optNum(get("driverId")),
      reportDate: get("date") || todayRiyadh(),
      description: get("description"),
      priority: priorityOf(get("priority")),
      estimatedCost: cost ? Number(cost) : null,
      userId: user.id,
    });
    refresh();
    return { ok: `سُجل البلاغ ${r.number}`, id: r.id, label: r.number };
  } catch (err) {
    return { error: errorMessage(err) };
  }
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

/** نافذة الخطة الدورية: إضافة (أو تحديث خطة بنفس المركبة والاسم) أو تعديل خطة بعينها، أو إيقافها. */
export async function savePlanAction(id: number | null, data: FormData): Promise<PanelResult> {
  await requirePermission("maintenance", "update");
  const get = (k: string) => String(data.get(k) ?? "").trim();
  try {
    if (!get("vehicleId")) throw new Error("اختر المركبة");
    const interval = Number(get("intervalDays"));
    if (!Number.isInteger(interval) || interval < 1 || interval > 3650) throw new Error("المدة بالأيام بين 1 و 3650");
    const input = { vehicleId: Number(get("vehicleId")), type: typeOf(get("type")), title: get("title"), intervalDays: interval, lastDoneDate: get("lastDone") || null };
    const plan = id ? await updatePlan(db, id, { ...input, isActive: data.get("isActive") === "on" }) : await savePlan(db, input);
    refresh();
    return { ok: `حُفظت الخطة «${plan.title}»`, id: plan.id, label: plan.title };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

// ───────────── الإجراءات الجماعية (بآلية الفواتير) ─────────────

const ids = (fd: FormData) => fd.getAll("ids").map(Number).filter((n) => Number.isInteger(n) && n > 0);

/** يطبق الإجراء على كل مستند وحده؛ الخطأ في واحد لا يوقف الباقي. */
async function each(list: number[], noun: string, done: string, fn: (id: number) => Promise<unknown>): Promise<FormState> {
  if (!list.length) return { error: `حدد ${noun} من الجدول أولاً` };
  const errors: string[] = [];
  let ok = 0;
  for (const id of list) {
    try {
      await fn(id);
      ok++;
    } catch (err) {
      errors.push(errorMessage(err));
    }
  }
  refresh();
  if (!ok) return { error: errors.slice(0, 3).join(" · ") };
  return { ok: `${done} ${ok} من ${list.length}${errors.length ? `. لم يتم الباقي: ${errors.slice(0, 2).join(" · ")}` : ""}` };
}

export async function bulkOrders(_: FormState, fd: FormData): Promise<FormState> {
  const op = String(fd.get("op") || "");
  if (op === "approve") {
    const user = await requirePermission("maintenance", "approve");
    return each(ids(fd), "الأوامر", "اعتُمد ورُحّل", (id) => approveMaintenanceOrder(db, id, { userId: user.id }));
  }
  if (op === "complete") {
    await requirePermission("maintenance", "update");
    const date = String(fd.get("date") || todayRiyadh());
    return each(ids(fd), "الأوامر", "اكتمل", (id) => completeMaintenanceOrder(db, id, { completedDate: date }));
  }
  return { error: "اختر الإجراء" };
}

const ORDER_SHEET_FIELDS = { orderDate: "orderDate", supplierInvoiceNo: "supplierInvoiceNo", odometer: "odometer", notes: "notes" } as const;

export async function saveOrderSheet(payload: string): Promise<DocSheetResult> {
  await requirePermission("maintenance", "update");
  const changes = JSON.parse(payload) as SheetChange[];
  const errors: Record<number, string> = {};
  let saved = 0;
  for (const { id, values } of changes) {
    const patch: Record<string, string> = {};
    for (const [key, v] of Object.entries(values)) if (key in ORDER_SHEET_FIELDS) patch[key] = v;
    try {
      await updateDraftOrder(db, Number(id), patch);
      saved++;
    } catch (err) {
      errors[id] = errorMessage(err);
    }
  }
  refresh();
  return { ok: saved ? `حُفظت تعديلات ${saved} أمر` : undefined, errors };
}

export async function bulkRequests(_: FormState, fd: FormData): Promise<FormState> {
  const op = String(fd.get("op") || "");
  if (op === "review") {
    const user = await requirePermission("maintenance", "update");
    return each(ids(fd), "الطلبات", "روجع", (id) => reviewBreakdownRequest(db, id, { userId: user.id }));
  }
  if (op === "approve") {
    const user = await requirePermission("maintenance", "approve");
    return each(ids(fd), "الطلبات", "اعتُمد", (id) => approveBreakdownRequest(db, id, user.id));
  }
  if (op === "order") {
    const user = await requirePermission("maintenance", "create");
    const date = String(fd.get("date") || todayRiyadh());
    return each(ids(fd), "الطلبات", "أُنشئ أمر صيانة لـ", (id) => createOrdersFrom(db, { requests: [id] }, { orderDate: date, userId: user.id }));
  }
  return { error: "اختر الإجراء" };
}

export async function bulkPlanOrders(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requirePermission("maintenance", "create");
  const date = String(fd.get("date") || todayRiyadh());
  return each(ids(fd), "الخطط", "أُنشئ أمر صيانة لـ", (id) => createOrdersFrom(db, { plans: [id] }, { orderDate: date, userId: user.id }));
}
