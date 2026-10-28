"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { requireDriver } from "@/lib/driver-auth";
import { destroySession, getCurrentUser, hasDriverSession } from "@/lib/auth";
import { acceptTrip, createDriverExpense, isDriverOnly, ownTrip, recordDriverStage, reportBreakdown, setDriverLanguage, undoDriverStage, updateDriverExpense, voidDriverExpense, type DriverExpenseInput, type DriverProfile, type TripStage } from "@/lib/driver-app";
import { requestCommissionAdvance } from "@/lib/hr";
import { submitRenewal } from "@/lib/documents";
import { addExpense, addFuel, deleteWaybillItem } from "@/lib/waybills";
import { todayRiyadh } from "@/lib/dates";
import { errorMessage } from "@/lib/errors";
import { onceForOp, saveDataUrl } from "@/lib/attachments";
import { DRIVER_EXPENSE_ACCOUNTS, DRIVER_LANGS, type DriverDict, type DriverExpenseType, type DriverLang } from "@/data/driver-i18n";
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

export async function stageAction(_: FormState, data: FormData): Promise<FormState> {
  const { user, driver, t } = await requireDriver();
  const waybillId = Number(str(data, "waybillId"));
  const stage = str(data, "stage") as TripStage;
  try {
    if (!STAGES.includes(stage)) throw new Error("اختر المرحلة");
    // التحميل والتسليم يُثبتان بصورة
    if ((stage === "loading" || stage === "delivery") && !photo(data)) throw new Error(t.x.photoMissing);
    await onceForOp(db, op(data), async () => {
      await recordDriverStage(db, driver.id, waybillId, stage, { odometer: num(data, "odometer"), note: str(data, "note") || null, userId: user.id });
      // صورة إجبارية وثانية اختيارية مع كل مرحلة
      for (const dataUrl of [photo(data), str(data, "photo2") || null]) {
        await saveDataUrl(db, { entity: "waybills", entityId: waybillId, kind: stage === "delivery" ? "pod" : "other", dataUrl, userId: user.id });
      }
    });
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath(`/driver/trips/${waybillId}`);
  revalidatePath("/driver");
  return { ok: t.stageDone };
}

export async function undoStageAction(waybillId: number): Promise<FormState> {
  const { user, driver, t } = await requireDriver();
  try {
    await undoDriverStage(db, driver.id, waybillId, user.id);
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath(`/driver/trips/${waybillId}`);
  revalidatePath("/driver");
  return { ok: t.x.undone };
}

export async function acceptTripAction(_: FormState, data: FormData): Promise<FormState> {
  const { driver, t } = await requireDriver();
  const waybillId = Number(str(data, "waybillId"));
  try {
    await onceForOp(db, op(data), () => acceptTrip(db, driver.id, waybillId));
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath(`/driver/trips/${waybillId}`);
  revalidatePath("/driver");
  return { ok: t.flow.accepted };
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

function readExpense(data: FormData, t: DriverDict, userId: number): DriverExpenseInput {
  const kind = str(data, "type") as DriverExpenseType;
  if (!(kind in DRIVER_EXPENSE_ACCOUNTS)) throw new Error("اختر نوع المصروف");
  const amount = num(data, "amount");
  if (!amount) throw new Error("المبلغ إلزامي");
  return {
    kind,
    amount,
    reportedPayer: str(data, "payer") === "company" ? "company" : "custody",
    waybillId: Number(str(data, "waybillId")) || null,
    maintenanceTypeId: kind === "maintenance" ? Number(str(data, "maintenanceTypeId")) || null : null,
    date: todayRiyadh(),
    userId,
  };
}

const saveReceipt = (expenseId: number, kind: DriverExpenseType, dataUrl: string | null, userId: number) =>
  saveDataUrl(db, { entity: "expenses", entityId: expenseId, kind: kind === "diesel" ? "fuel_receipt" : "expense_receipt", dataUrl, userId });

function refreshExpenses(waybillId?: number | null) {
  revalidatePath("/driver/expenses");
  revalidatePath("/driver/balance");
  revalidatePath("/expenses");
  if (waybillId) revalidatePath(`/driver/trips/${waybillId}`);
}

export async function expenseAction(_: FormState, data: FormData): Promise<FormState> {
  const { user, driver, t } = await requireDriver();
  let input: DriverExpenseInput;
  try {
    input = readExpense(data, t, user.id);
    // صورة الفاتورة أو الإيصال إجبارية
    if (!photo(data)) throw new Error(t.x.photoMissing);
    await onceForOp(db, op(data), async () => {
      const e = await createDriverExpense(db, driver, input);
      await saveReceipt(e.id, input.kind, photo(data), user.id);
    });
  } catch (err) {
    return { error: errorMessage(err) };
  }
  refreshExpenses(input.waybillId);
  return { ok: t.saved };
}

export async function editExpenseAction(id: number, _: FormState, data: FormData): Promise<FormState> {
  const { user, driver, t } = await requireDriver();
  let input: DriverExpenseInput;
  try {
    input = readExpense(data, t, user.id);
    await updateDriverExpense(db, driver as DriverProfile, id, input);
    // صورة جديدة تُضاف بجانب القديمة ولا تحل محلها
    await saveReceipt(id, input.kind, photo(data), user.id);
  } catch (err) {
    return { error: errorMessage(err) };
  }
  refreshExpenses(input.waybillId);
  return { ok: t.saved };
}

export async function voidExpenseAction(id: number, _: FormState, data: FormData): Promise<FormState> {
  const { driver, t } = await requireDriver();
  try {
    await voidDriverExpense(db, driver.id, id, str(data, "reason") || null);
  } catch (err) {
    return { error: errorMessage(err) };
  }
  refreshExpenses(Number(str(data, "waybillId")) || null);
  return { ok: t.x.voided };
}

export async function breakdownAction(_: FormState, data: FormData): Promise<FormState> {
  const { user, driver, t } = await requireDriver();
  try {
    const p = str(data, "priority");
    const maintenanceTypeId = Number(str(data, "maintenanceTypeId")) || null;
    if (!maintenanceTypeId) throw new Error(t.x.maintenanceType);
    if (!photo(data)) throw new Error(t.x.photoMissing);
    await onceForOp(db, op(data), async () => {
      const r = await reportBreakdown(db, driver, {
        date: todayRiyadh(),
        description: str(data, "description") || null,
        maintenanceTypeId,
        priority: p === "urgent" || p === "low" ? p : "normal",
        userId: user.id,
      });
      await saveDataUrl(db, { entity: "breakdown_requests", entityId: r.id, kind: "other", dataUrl: photo(data), userId: user.id });
    });
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath("/driver/breakdown");
  revalidatePath("/maintenance/requests");
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
    const source = str(data, "source") === "custody" ? "custody" : "cash";
    await requestCommissionAdvance(db, { driverId: driver.id, amount, source, notes: str(data, "notes") || null, today: todayRiyadh() });
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
  // يخرج من تطبيق السائق فقط ويبقى البرنامج على حاله؛ جلسة سائق قديمة باسم المكتب تُغلق أيضاً
  if (await hasDriverSession()) await destroySession("driver");
  else {
    const user = await getCurrentUser();
    if (user && isDriverOnly(user.roles)) await destroySession("office");
  }
  redirect("/driver/login");
}
