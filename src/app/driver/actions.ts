"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { requireDriver } from "@/lib/driver-auth";
import { destroySession } from "@/lib/auth";
import { createDriverExpense, ownTrip, recordDriverStage, reportBreakdown, setDriverLanguage, startTrip, type TripStage } from "@/lib/driver-app";
import { requestCommissionAdvance } from "@/lib/hr";
import { submitRenewal } from "@/lib/documents";
import { addExpense, addFuel, deleteWaybillItem } from "@/lib/waybills";
import { todayRiyadh } from "@/lib/dates";
import { errorMessage } from "@/lib/errors";
import { onceForOp, saveDataUrl } from "@/lib/attachments";
import { DRIVER_EXPENSE_ACCOUNTS, DRIVER_LANGS, type DriverExpenseType, type DriverLang } from "@/data/driver-i18n";
import type { FormState } from "@/components/action-form";

const str = (d: FormData, k: string) => String(d.get(k) ?? "").trim();
const num = (d: FormData, k: string) => {
  const v = str(d, k).replace(/,/g, "");
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`رقم غير صحيح: ${v}`);
  return n;
};
// كل نموذج من تطبيق السائق يحمل _op؛ إن أُعيد إرساله بعد انقطاع الشبكة لا يُسجَّل مرتين
const op = (d: FormData) => str(d, "_op") || null;
const photo = (d: FormData) => str(d, "photo") || null;
const STAGES: TripStage[] = ["loading", "in_transit", "border", "delivery"];

export async function startTripAction(_: FormState, data: FormData): Promise<FormState> {
  const { user, driver } = await requireDriver();
  let id: number;
  try {
    const w = await startTrip(db, driver, {
      date: todayRiyadh(),
      customerId: Number(str(data, "customerId")),
      routeId: Number(str(data, "routeId")),
      shipper: str(data, "shipper"),
      consignee: str(data, "consignee"),
      containerNumber: str(data, "containerNumber") || null,
      weightTons: num(data, "weightTons"),
      odometer: num(data, "odometer"),
      notes: str(data, "notes") || null,
      userId: user.id,
    });
    id = w.id;
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath("/driver");
  redirect(`/driver/trips/${id}`);
}

export async function stageAction(_: FormState, data: FormData): Promise<FormState> {
  const { user, driver, t } = await requireDriver();
  const waybillId = Number(str(data, "waybillId"));
  const stage = str(data, "stage") as TripStage;
  try {
    if (!STAGES.includes(stage)) throw new Error("اختر المرحلة");
    await onceForOp(db, op(data), async () => {
      await recordDriverStage(db, driver.id, waybillId, stage, { odometer: num(data, "odometer"), note: str(data, "note") || null, userId: user.id });
      await saveDataUrl(db, { entity: "waybills", entityId: waybillId, kind: stage === "delivery" ? "pod" : "odometer", dataUrl: photo(data), userId: user.id });
    });
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath(`/driver/trips/${waybillId}`);
  revalidatePath("/driver");
  return { ok: t.stageDone };
}

export async function fuelAction(_: FormState, data: FormData): Promise<FormState> {
  const { user, driver, t } = await requireDriver();
  const waybillId = Number(str(data, "waybillId"));
  try {
    await ownTrip(db, driver.id, waybillId);
    const amount = num(data, "amount");
    if (!amount) throw new Error("المبلغ إلزامي");
    await onceForOp(db, op(data), async () => {
      await addFuel(db, waybillId, {
        source: str(data, "source") === "fuel_card" ? "fuel_card" : "custody",
        liters: num(data, "liters"),
        amount,
        vatAmount: num(data, "vatAmount") ?? 0,
        odometer: num(data, "odometer"),
        invoiceNumber: str(data, "invoiceNumber") || null,
      });
      await saveDataUrl(db, { entity: "waybills", entityId: waybillId, kind: "fuel_receipt", dataUrl: photo(data), userId: user.id });
    });
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath(`/driver/trips/${waybillId}`);
  return { ok: t.saved };
}

export async function tripExpenseAction(_: FormState, data: FormData): Promise<FormState> {
  const { user, driver, t } = await requireDriver();
  const waybillId = Number(str(data, "waybillId"));
  try {
    await ownTrip(db, driver.id, waybillId);
    const amount = num(data, "amount");
    if (!amount) throw new Error("المبلغ إلزامي");
    await onceForOp(db, op(data), async () => {
      await addExpense(db, waybillId, {
        chargeTypeId: Number(str(data, "chargeTypeId")),
        amount,
        currencyCode: str(data, "currencyCode") || "SAR",
        payer: "driver_custody",
        note: str(data, "note") || null,
      });
      await saveDataUrl(db, { entity: "waybills", entityId: waybillId, kind: "expense_receipt", dataUrl: photo(data), userId: user.id });
    });
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath(`/driver/trips/${waybillId}`);
  return { ok: t.saved };
}

export async function removeTripItem(waybillId: number, kind: "fuel" | "expense", itemId: number) {
  const { driver } = await requireDriver();
  await ownTrip(db, driver.id, waybillId);
  await deleteWaybillItem(db, waybillId, kind, itemId);
  revalidatePath(`/driver/trips/${waybillId}`);
}

export async function expenseAction(_: FormState, data: FormData): Promise<FormState> {
  const { user, driver, t } = await requireDriver();
  try {
    const type = str(data, "type") as DriverExpenseType;
    if (!(type in DRIVER_EXPENSE_ACCOUNTS)) throw new Error("اختر نوع المصروف");
    const amount = num(data, "amount");
    if (!amount) throw new Error("المبلغ إلزامي");
    await onceForOp(db, op(data), async () => {
      const e = await createDriverExpense(db, driver, {
        date: str(data, "date") || todayRiyadh(),
        type,
        description: str(data, "description") || t.expenseTypes[type],
        amount,
        vatAmount: num(data, "vatAmount") ?? 0,
        vendorName: str(data, "vendorName") || null,
        reference: str(data, "reference") || null,
        userId: user.id,
      });
      await saveDataUrl(db, { entity: "expenses", entityId: e.id, kind: type === "diesel" ? "fuel_receipt" : "expense_receipt", dataUrl: photo(data), userId: user.id });
    });
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath("/driver/expenses");
  revalidatePath("/driver/balance");
  return { ok: t.saved };
}

export async function breakdownAction(_: FormState, data: FormData): Promise<FormState> {
  const { user, driver, t } = await requireDriver();
  try {
    const p = str(data, "priority");
    await onceForOp(db, op(data), async () => {
      await reportBreakdown(db, driver, {
        date: todayRiyadh(),
        description: str(data, "description"),
        priority: p === "urgent" || p === "low" ? p : "normal",
        userId: user.id,
      });
    });
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath("/driver/breakdown");
  return { ok: t.saved };
}

export async function documentAction(_: FormState, data: FormData): Promise<FormState> {
  const { user, driver, t } = await requireDriver();
  try {
    const expiry = str(data, "expiryDate");
    if (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) throw new Error("تاريخ غير صحيح");
    await onceForOp(db, op(data), async () => {
      await submitRenewal(db, driver, {
        documentTypeId: Number(str(data, "documentTypeId")),
        number: str(data, "number"),
        expiryDate: expiry || null,
        photo: photo(data),
        userId: user.id,
      });
    });
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath("/driver/documents");
  return { ok: t.saved };
}

export async function advanceAction(_: FormState, data: FormData): Promise<FormState> {
  const { driver, t } = await requireDriver();
  try {
    const amount = num(data, "amount");
    if (!amount) throw new Error("المبلغ إلزامي");
    await requestCommissionAdvance(db, { driverId: driver.id, amount, notes: str(data, "notes") || null, today: todayRiyadh() });
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath("/driver/balance");
  revalidatePath("/hr/advances");
  return { ok: t.saved };
}

export async function languageAction(data: FormData) {
  const { driver } = await requireDriver();
  const lang = str(data, "lang") as DriverLang;
  if (DRIVER_LANGS.includes(lang)) await setDriverLanguage(db, driver.id, lang);
  revalidatePath("/driver", "layout");
}

export async function driverLogout() {
  await destroySession();
  redirect("/driver/login");
}
