"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { createDriver } from "@/lib/fleet";
import { cell, saveSheetRows, type SheetRow } from "@/lib/sheet-server";
import { createDriverLogin } from "@/lib/driver-app";
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
    return { ok: `أُنشئ حساب الدخول «${login.trim()}»؛ يفتح السائق التطبيق من /driver` };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}
