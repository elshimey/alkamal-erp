"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { baseSql, db } from "@/db";
import { getTenant, isPlatformOwner, requireAdmin } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { activateTenant, createTenant, deleteTenant, extendTrial, resetTenantAdminPassword, setSuspended } from "@/lib/platform";
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

export type CreateState = { error?: string; ok?: string; welcome?: string; phone?: string } | undefined;

/** رسالة الترحيب ببيانات الدخول لإرسالها لمدير الشركة. */
async function welcomeText(company: string, admin: string, login: string, password?: string) {
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  return [
    `مرحباً ${admin}،`,
    `تم تجهيز حساب «${company}» في نظام إدارة النقل والحسابات.`,
    "",
    `رابط الدخول: ${origin}/login`,
    `اسم الدخول: ${login}`,
    password ? `كلمة المرور: ${password}` : "كلمة المرور: التي أُرسلت لك سابقاً",
    "",
    "يُرجى تغيير كلمة المرور بعد أول دخول من «حسابي».",
  ].join("\n");
}

export async function createTenantAction(_: CreateState, data: FormData): Promise<CreateState> {
  await requireOwner();
  const f = (k: string) => String(data.get(k) ?? "").trim();
  const input = { name: f("name"), slug: f("slug"), contact: f("contact"), trialDays: Number(f("trialDays")) || 0, adminName: f("adminName") || "مدير النظام", adminLogin: f("adminLogin"), adminPassword: String(data.get("adminPassword") ?? "") };
  try {
    await createTenant(baseSql, db, input);
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath("/owner");
  return {
    ok: `أُنشئت الشركة «${input.name}». أرسل لمديرها الرسالة التالية:`,
    welcome: await welcomeText(input.name, input.adminName, input.adminLogin, input.adminPassword),
    phone: input.contact,
  };
}

/** كلمة مرور جديدة لمدير الشركة، مع رسالة جاهزة بها. */
export async function resetAdminAction(id: number, contact: string | null, _: CreateState, data: FormData): Promise<CreateState> {
  await requireOwner();
  const password = String(data.get("password") ?? "");
  try {
    const r = await resetTenantAdminPassword(baseSql, db, id, password);
    return { ok: "تغيّرت كلمة المرور. أرسل الرسالة:", welcome: await welcomeText(r.company, r.name, r.login, password), phone: contact ?? undefined };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

/** رسالة الدخول لشركة قائمة (دون كلمة المرور، فهي لا تُحفظ إلا مشفرة). */
export async function tenantWelcome(company: string, admin: string, login: string) {
  await requireOwner();
  return welcomeText(company, admin, login);
}

export const activateAction = async (id: number, _: FormState) => run(() => activateTenant(baseSql, id), "تحوّلت إلى اشتراك فعلي وبقيت كل بياناتها");
export const extendAction = async (id: number, _: FormState) => run(() => extendTrial(baseSql, id, 15), "مُدّدت التجربة 15 يوماً");
export const suspendAction = async (id: number, suspended: boolean, _: FormState) =>
  run(() => setSuspended(baseSql, id, suspended), suspended ? "أُوقف الدخول لهذه الشركة" : "أُعيد تشغيل الشركة");
export const deleteAction = async (id: number, _: FormState, data: FormData) => {
  if (!(await isPlatformOwner(await requireOwner()))) return { error: "حذف الشركات لمالك المنصة فقط" };
  return run(() => deleteTenant(baseSql, id, String(data.get("confirm") ?? "")), "حُذفت الشركة وكل بياناتها نهائياً");
};
