"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission, type CurrentUser } from "@/lib/auth";
import { hasSpecial, scopeFor, type Action } from "@/lib/permissions";
import { errorMessage } from "@/lib/errors";
import { todayRiyadh } from "@/lib/dates";
import { cell, saveSheetRows, type SheetRow } from "@/lib/sheet-server";
import {
  addExpense,
  addFuel,
  approveWaybill,
  createWaybill,
  deleteWaybill,
  deleteWaybillItem,
  recordStage,
  rejectWaybill,
  revertWaybill,
  updateWaybill,
} from "@/lib/waybills";
import { EXPENSE_BILL_TO, EXPENSE_PAYERS, FUEL_SOURCES, TRIP_STAGES } from "@/data/waybills";
import type { FormState } from "@/components/action-form";
import type { DocSheetResult, SheetChange } from "@/components/doc-sheet";

/** صلاحية على شحنة محددة؛ صاحب النطاق «الخاص» (السائق) لا يصل إلا لشحناته. */
async function guard(action: Action, waybillId?: number): Promise<CurrentUser> {
  const user = await requirePermission("waybills", action);
  if (waybillId != null && scopeFor(user.perms, "waybills", action) === "own") {
    const [row] = await db
      .select({ userId: s.drivers.userId })
      .from(s.waybills)
      .innerJoin(s.drivers, eq(s.drivers.id, s.waybills.driverId))
      .where(eq(s.waybills.id, waybillId));
    if (row?.userId !== user.id) redirect("/?denied=1");
  }
  return user;
}

const refresh = (id?: number) => {
  revalidatePath("/waybills");
  if (id) revalidatePath(`/waybills/${id}`);
};

const optId = (v: string | undefined) => (v && v.trim() ? Number(v) : null);

export async function saveWaybills(rows: SheetRow[]) {
  const user = await guard("create");
  const prices = hasSpecial(user.perms, "view_prices");
  const result = await saveSheetRows(rows, async (r) => {
    await createWaybill(db, {
      // التاريخ الفارغ = اليوم، كما يظهر في الخلية
      waybillDate: cell.date(r.date, "التاريخ") ?? todayRiyadh(),
      customerId: Number(cell.required(r.customerId, "العميل")),
      routeId: Number(cell.required(r.routeId, "المسار")),
      shipper: cell.required(r.shipper, "المرسل"),
      consignee: cell.required(r.consignee, "المستلم"),
      vehicleId: optId(r.vehicleId),
      trailerId: optId(r.trailerId),
      driverId: optId(r.driverId),
      carrierId: optId(r.carrierId),
      carrierCost: cell.number(r.carrierCost, "تكلفة الناقل"),
      carrierPlate: cell.text(r.carrierPlate),
      // من لا يرى الأسعار لا يُدخلها؛ تؤخذ من العقد
      amount: prices ? cell.number(r.amount, "المبلغ") : null,
      driverCommission: cell.number(r.commission, "العمولة"),
      weightTons: cell.number(r.weight, "الوزن"),
      containerNumber: cell.text(r.container),
      notes: cell.text(r.notes),
      userId: user.id,
    });
  });
  refresh();
  return result;
}

/** إجراء جماعي على الشحنات المحددة في القائمة (تسليم أو اعتماد). */
export async function bulkWaybills(kind: "deliver" | "approve", ids: number[], overrideReason?: string) {
  const user = await guard(kind === "approve" ? "approve" : "update");
  const canOverride = hasSpecial(user.perms, "override_controls");
  const errors: Record<number, string> = {};
  let done = 0;
  for (const id of ids.slice(0, 500)) {
    try {
      if (kind === "approve") await approveWaybill(db, id, { userId: user.id, canOverride, overrideReason });
      else await recordStage(db, id, "delivery", { userId: user.id });
      done++;
    } catch (err) {
      errors[id] = errorMessage(err);
    }
  }
  refresh();
  return { done, errors };
}

const formNumber = (fd: FormData, key: string) => {
  const v = String(fd.get(key) ?? "").trim();
  if (!v) return null;
  const n = Number(v.replace(/,/g, ""));
  if (!Number.isFinite(n) || n < 0) throw new Error("رقم غير صالح");
  return n;
};

export async function saveWaybillDetails(id: number, _: FormState, fd: FormData): Promise<FormState> {
  const user = await guard("update", id);
  try {
    await updateWaybill(db, id, {
      amount: hasSpecial(user.perms, "view_prices") && fd.has("amount") ? (formNumber(fd, "amount") ?? 0) : undefined,
      driverCommission: fd.has("driverCommission") ? (formNumber(fd, "driverCommission") ?? 0) : undefined,
      carrierCost: fd.has("carrierCost") ? (formNumber(fd, "carrierCost") ?? 0) : undefined,
      trailerId: fd.has("trailerId") ? optId(String(fd.get("trailerId"))) : undefined,
      odometerStart: formNumber(fd, "odometerStart"),
      odometerEnd: formNumber(fd, "odometerEnd"),
      deliveryNoteNumber: String(fd.get("deliveryNoteNumber") ?? ""),
      customsDeclaration: String(fd.get("customsDeclaration") ?? ""),
      notes: String(fd.get("notes") ?? ""),
    });
    refresh(id);
    return { ok: "تم حفظ التعديلات" };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function addStage(id: number, _: FormState, fd: FormData): Promise<FormState> {
  const user = await guard("update", id);
  const stage = String(fd.get("stage")) as keyof typeof TRIP_STAGES;
  if (!(stage in TRIP_STAGES)) return { error: "اختر المرحلة" };
  try {
    await recordStage(db, id, stage, { odometer: formNumber(fd, "odometer"), note: String(fd.get("note") ?? ""), userId: user.id });
    refresh(id);
    return { ok: `تم تسجيل مرحلة «${TRIP_STAGES[stage]}»` };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function approveOne(id: number, _: FormState, fd: FormData): Promise<FormState> {
  const user = await guard("approve", id);
  try {
    const { entry } = await approveWaybill(db, id, {
      userId: user.id,
      canOverride: hasSpecial(user.perms, "override_controls"),
      overrideReason: String(fd.get("overrideReason") ?? ""),
    });
    refresh(id);
    return { ok: entry ? `اعتُمدت الشحنة ورُحّل القيد ${entry.number}` : "اعتُمدت الشحنة (بلا تكاليف تُقيد)" };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function rejectOne(id: number, _: FormState, fd: FormData): Promise<FormState> {
  await guard("approve", id);
  try {
    await rejectWaybill(db, id, String(fd.get("reason") ?? ""));
    refresh(id);
    return { ok: "رُفضت الشحنة وأُعيدت مع السبب" };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function revertOne(id: number): Promise<FormState> {
  await guard("revert", id);
  try {
    await revertWaybill(db, id);
    refresh(id);
    return { ok: "أُرجعت الشحنة وأُلغي قيدها" };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function deleteOne(id: number, _: FormState, fd: FormData): Promise<FormState> {
  const user = await guard("delete", id);
  try {
    await deleteWaybill(db, id, { reason: String(fd.get("reason") ?? ""), userId: user.id });
  } catch (err) {
    return { error: errorMessage(err) };
  }
  refresh();
  redirect("/waybills");
}

const pick = <T extends Record<string, string>>(map: T, v: string | undefined, label: string) => {
  const key = cell.required(v, label);
  if (!(key in map)) throw new Error(`${label} غير معروف`);
  return key as keyof T & string;
};

export async function saveFuel(id: number, rows: SheetRow[]) {
  await guard("update", id);
  const result = await saveSheetRows(rows, async (r) => {
    const amount = cell.number(r.amount, "المبلغ");
    if (!amount) throw new Error("المبلغ إلزامي");
    await addFuel(db, id, {
      source: pick(FUEL_SOURCES, r.source, "المصدر"),
      partyId: optId(r.partyId),
      liters: cell.number(r.liters, "اللترات"),
      amount,
      vatAmount: cell.number(r.vat, "الضريبة") ?? 0,
      currencyCode: r.currency === "KWD" ? "KWD" : "SAR",
      exchangeRate: cell.number(r.rate, "سعر الصرف"),
      odometer: cell.number(r.odometer, "العداد"),
      invoiceNumber: cell.text(r.invoice),
    });
  });
  refresh(id);
  return result;
}

export async function saveExpenses(id: number, rows: SheetRow[]) {
  await guard("update", id);
  const result = await saveSheetRows(rows, async (r) => {
    const amount = cell.number(r.amount, "المبلغ");
    if (!amount) throw new Error("المبلغ إلزامي");
    await addExpense(db, id, {
      chargeTypeId: Number(cell.required(r.chargeTypeId, "النوع")),
      amount,
      currencyCode: r.currency === "KWD" ? "KWD" : "SAR",
      exchangeRate: cell.number(r.rate, "سعر الصرف"),
      billTo: r.billTo ? pick(EXPENSE_BILL_TO, r.billTo, "على من") : undefined,
      payer: r.payer ? pick(EXPENSE_PAYERS, r.payer, "الدافع") : undefined,
      partyId: optId(r.partyId),
      note: cell.text(r.note),
    });
  });
  refresh(id);
  return result;
}

export async function removeItem(id: number, kind: "fuel" | "expense", itemId: number) {
  await guard("update", id);
  await deleteWaybillItem(db, id, kind, itemId);
  refresh(id);
}

/** حفظ ورقة الشحنات: الشحنات غير المعتمدة فقط، وكل خلية تمر على قواعد تعديل الشحنة نفسها. */
export async function saveWaybillSheet(payload: string): Promise<DocSheetResult> {
  const changes = JSON.parse(payload) as SheetChange[];
  const errors: Record<number, string> = {};
  let saved = 0;
  for (const { id, values: v } of changes) {
    try {
      const user = await guard("update", id);
      const n = (key: string, label: string) => (v[key] === undefined ? undefined : cell.number(v[key].replace(/[,\s]/g, ""), label));
      await updateWaybill(db, id, {
        amount: hasSpecial(user.perms, "view_prices") && v.amount !== undefined ? (n("amount", "المبلغ") ?? 0) : undefined,
        driverCommission: v.commission !== undefined ? (n("commission", "العمولة") ?? 0) : undefined,
        carrierCost: v.carrierCost !== undefined ? (n("carrierCost", "تكلفة الناقل") ?? 0) : undefined,
        shipper: v.shipper,
        consignee: v.consignee,
        weightTons: v.weight !== undefined ? (n("weight", "الوزن") ?? null) : undefined,
        containerNumber: v.container,
        deliveryNoteNumber: v.deliveryNote,
        notes: v.notes,
      });
      saved++;
    } catch (err) {
      errors[id] = errorMessage(err);
    }
  }
  revalidatePath("/waybills");
  return { ok: saved ? `حُفظت تعديلات ${saved} شحنة` : undefined, errors };
}
