"use server";

import { redirect } from "next/navigation";
import { destroySession } from "@/lib/auth";
import { signIn } from "@/lib/sign-in";
import { isDriverOnly } from "@/lib/driver-app";
import type { FormState } from "@/components/action-form";
import { baseSql } from "@/db";
import { createAccessRequest } from "@/lib/platform";
import { errorMessage } from "@/lib/errors";

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
