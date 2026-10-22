"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { baseSql, db } from "@/db";
import { getTenant, requireAdmin } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { activateTenant, createTenant, deleteTenant, extendTrial, setSuspended } from "@/lib/platform";
import type { FormState } from "@/components/action-form";

// لوحة المالك لمديري نظام شركة البداية فقط
async function requireOwner() {
  const user = await requireAdmin();
  if (!(await getTenant()).isHome) redirect("/?denied=1");
  return user;
}

const run = async (fn: () => Promise<unknown>, ok: string): Promise<FormState> => {
  await requireOwner();
  try {
    await fn();
    revalidatePath("/owner");
    return { ok };
  } catch (err) {
    return { error: errorMessage(err) };
  }
};

export async function createTenantAction(_: FormState, data: FormData): Promise<FormState> {
  const f = (k: string) => String(data.get(k) ?? "");
  return run(
    () =>
      createTenant(baseSql, db, {
        name: f("name"),
        slug: f("slug"),
        contact: f("contact"),
        trialDays: Number(f("trialDays")) || 0,
        adminName: f("adminName"),
        adminLogin: f("adminLogin"),
        adminPassword: f("adminPassword"),
      }),
    `أُنشئت الشركة؛ أرسل لمديرها رابط البرنامج واسم الدخول ${f("adminLogin").trim()} وكلمة المرور`,
  );
}

export const activateAction = async (id: number, _: FormState) => run(() => activateTenant(baseSql, id), "تحوّلت إلى اشتراك فعلي وبقيت كل بياناتها");
export const extendAction = async (id: number, _: FormState) => run(() => extendTrial(baseSql, id, 15), "مُدّدت التجربة 15 يوماً");
export const suspendAction = async (id: number, suspended: boolean, _: FormState) =>
  run(() => setSuspended(baseSql, id, suspended), suspended ? "أُوقف الدخول لهذه الشركة" : "أُعيد تشغيل الشركة");
export const deleteAction = async (id: number, _: FormState, data: FormData) =>
  run(() => deleteTenant(baseSql, id, String(data.get("confirm") ?? "")), "حُذفت الشركة وكل بياناتها نهائياً");
