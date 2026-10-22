"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { createDriver, deleteDriver, updateDriver, type DriverStatus } from "@/lib/fleet";
import { cell, saveSheetRows, type SheetRow } from "@/lib/sheet-server";
import { createDriverLogin, removeDriverLogin, resetDriverPassword } from "@/lib/driver-app";
import { errorMessage } from "@/lib/errors";
import type { FormState } from "@/components/action-form";

const LANGS = ["ar", "ur", "hi", "en"] as const;

export async function saveDrivers(rows: SheetRow[]) {
  await requirePermission("drivers", "create");
  const result = await saveSheetRows(rows, async (r) => {
    const appLanguage = (LANGS as readonly string[]).includes(r.appLanguage) ? (r.appLanguage as (typeof LANGS)[number]) : "ar";
    await createDriver(db, {
      nameAr: cell.required(r.nameAr, "الاسم"),
      mobile: cell.text(r.mobile),
      nationality: cell.text(r.nationality),
      nationalId: cell.text(r.nationalId),
      residencyNumber: cell.text(r.residencyNumber),
      licenseNumber: cell.text(r.licenseNumber),
      transportCardNumber: cell.text(r.transportCardNumber),
      appLanguage,
      commissionClass: r.commissionClass === "international" ? "international" : "domestic",
      hireDate: cell.date(r.hireDate, "تاريخ التعيين"),
      basicSalary: cell.number(r.basicSalary, "الراتب الأساسي") ?? 0,
      custodyLimit: cell.number(r.custodyLimit, "سقف العهدة"),
    });
  });
  revalidatePath("/drivers");
  return result;
}

export async function createDriverLoginAction(_: FormState, data: FormData): Promise<FormState> {
  await requirePermission("users", "create");
  try {
    const login = String(data.get("login") ?? "");
    await createDriverLogin(db, { driverId: Number(data.get("driverId")), login, password: String(data.get("password") ?? "") });
    revalidatePath("/drivers");
    revalidatePath(`/drivers/${Number(data.get("driverId"))}`);
    return { ok: `أُنشئ حساب الدخول «${login.trim()}»؛ يفتح السائق التطبيق من /driver` };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

const STATUSES: DriverStatus[] = ["active", "on_leave", "terminated"];
const str = (d: FormData, k: string) => String(d.get(k) ?? "").trim();
const optNum = (d: FormData, k: string, label: string) => {
  const v = str(d, k).replace(/,/g, "");
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${label}: رقم غير صحيح`);
  return n;
};

export async function updateDriverAction(id: number, _: FormState, data: FormData): Promise<FormState> {
  await requirePermission("drivers", "update");
  try {
    const lang = str(data, "appLanguage");
    const status = str(data, "status") as DriverStatus;
    await updateDriver(db, id, {
      nameAr: str(data, "nameAr"),
      mobile: str(data, "mobile"),
      nationality: str(data, "nationality"),
      nationalId: str(data, "nationalId"),
      residencyNumber: str(data, "residencyNumber"),
      licenseNumber: str(data, "licenseNumber"),
      transportCardNumber: str(data, "transportCardNumber"),
      birthDate: str(data, "birthDate") || null,
      hireDate: str(data, "hireDate") || null,
      appLanguage: (LANGS as readonly string[]).includes(lang) ? (lang as (typeof LANGS)[number]) : undefined,
      commissionClass: str(data, "commissionClass") === "international" ? "international" : "domestic",
      basicSalary: optNum(data, "basicSalary", "الراتب الأساسي") ?? undefined,
      custodyLimit: optNum(data, "custodyLimit", "سقف العهدة"),
      status: STATUSES.includes(status) ? status : "active",
    });
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath("/drivers");
  revalidatePath(`/drivers/${id}`);
  return { ok: "حُفظت بيانات السائق" };
}

export async function deleteDriverAction(id: number, _: FormState, data: FormData): Promise<FormState> {
  await requirePermission("drivers", "delete");
  let name: string;
  try {
    if (str(data, "confirm") !== "حذف") throw new Error("اكتب كلمة «حذف» للتأكيد");
    name = await deleteDriver(db, id);
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath("/drivers");
  redirect(`/drivers?deleted=${encodeURIComponent(name)}`);
}

export async function resetDriverPasswordAction(id: number, _: FormState, data: FormData): Promise<FormState> {
  await requirePermission("users", "update");
  try {
    await resetDriverPassword(db, id, String(data.get("password") ?? ""));
  } catch (err) {
    return { error: errorMessage(err) };
  }
  return { ok: "تغيّرت كلمة المرور؛ أرسلها للسائق ليدخل بها" };
}

export async function removeDriverLoginAction(id: number): Promise<FormState> {
  await requirePermission("users", "update");
  try {
    await removeDriverLogin(db, id);
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath("/drivers");
  revalidatePath(`/drivers/${id}`);
  return { ok: "حُذف حساب الدخول؛ يمكنك إنشاء حساب جديد له" };
}
