"use server";

import { redirect } from "next/navigation";
import { destroySession } from "@/lib/auth";
import { signIn } from "@/lib/sign-in";
import { isDriverOnly } from "@/lib/driver-app";
import type { FormState } from "@/components/action-form";
import { baseSql } from "@/db";
import { createAccessRequest } from "@/lib/platform";
import { errorMessage } from "@/lib/errors";
import { headers } from "next/headers";
import { completePasswordReset, requestPasswordReset } from "@/lib/password-reset";

/** يتحقق من الدخول وينشئ الجلسة في شركة المستخدم؛ يُرجع رسالة الخطأ أو أدواره. */
export async function login(_: FormState, data: FormData): Promise<FormState> {
  const loginName = String(data.get("login") ?? "").trim();
  const password = String(data.get("password") ?? "");
  if (!loginName || !password) return { error: "أدخل اسم الدخول وكلمة المرور" };
  const result = await signIn(loginName, password);
  if ("error" in result) return { error: result.error };
  redirect(isDriverOnly(result.roles) ? "/driver" : "/");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}

/** «نسيت كلمة المرور أو اسم الدخول»: الطلب يصل لمدير النظام في شركة المستخدم. */
export async function requestAccess(_: FormState, data: FormData): Promise<FormState> {
  const get = (k: string) => String(data.get(k) ?? "").trim();
  try {
    await createAccessRequest(baseSql, { login: get("login"), name: get("name"), contact: get("contact") });
  } catch (err) {
    return { error: errorMessage(err) };
  }
  return { ok: `وصل طلبك. سيعيّن لك مدير النظام كلمة مرور جديدة ويتواصل معك على ${get("contact")}.` };
}

/** رابط الاسترجاع على البريد. الرد واحد سواء وُجد الحساب أم لا، فلا يُعرف منه من له حساب. */
export async function requestResetLink(_: FormState, data: FormData): Promise<FormState> {
  const identifier = String(data.get("identifier") ?? "").trim();
  if (!identifier) return { error: "اكتب اسم الدخول أو البريد" };
  // عنوان الموقع من الإعداد لا من رأس الطلب، فلا يُصنع رابط يشير لموقع آخر
  const fixed = process.env.APP_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null);
  const h = await headers();
  const origin = (fixed ?? `http://${h.get("host")}`).replace(/\/$/, "");
  try {
    await requestPasswordReset(baseSql, identifier, origin);
  } catch (err) {
    console.error("password reset request failed", err);
  }
  return { ok: "إن كان لهذا الحساب بريد مسجل فسيصله رابط الاسترجاع خلال دقائق (راجع مجلد الرسائل غير المرغوبة أيضاً). لم يصلك؟ أرسل طلباً لمدير النظام أدناه." };
}

export async function completeReset(token: string, _: FormState, data: FormData): Promise<FormState> {
  const password = String(data.get("password") ?? "");
  if (password !== String(data.get("confirm") ?? "")) return { error: "تأكيد كلمة المرور غير مطابق" };
  try {
    await completePasswordReset(baseSql, token, password);
  } catch (err) {
    return { error: errorMessage(err) };
  }
  redirect("/login?reset=1");
}
