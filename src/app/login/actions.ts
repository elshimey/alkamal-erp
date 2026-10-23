"use server";

import { redirect } from "next/navigation";
import { destroySession } from "@/lib/auth";
import { signIn } from "@/lib/sign-in";
import { isDriverOnly } from "@/lib/driver-app";
import type { FormState } from "@/components/action-form";

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
