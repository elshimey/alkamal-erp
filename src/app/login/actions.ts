"use server";

import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { baseSql, db } from "@/db";
import { runInTenant } from "@/db/tenant";
import { schemaForLogin, tenantState } from "@/lib/platform";
import * as s from "@/db/schema";
import { createSession, destroySession } from "@/lib/auth";
import { verifyPassword } from "@/lib/password";
import { isDriverOnly } from "@/lib/driver-app";
import type { FormState } from "@/components/action-form";

/** يتحقق من الدخول وينشئ الجلسة في شركة المستخدم؛ يُرجع رسالة الخطأ أو أدواره. */
export async function signIn(loginName: string, password: string): Promise<{ error: string; locked?: boolean } | { roles: { key: string | null }[]; userId: number; schema: string }> {
  // اسم الدخول يحدد الشركة، فيدخل كل مستخدم إلى بيانات شركته فقط
  const schema = await schemaForLogin(baseSql, loginName);
  return runInTenant(schema, async () => {
    // اسم الدخول لا يفرّق بين الحروف الكبيرة والصغيرة (الجوال يكبّر الحرف الأول تلقائياً)
    const [user] = await db.select().from(s.users).where(sql`lower(${s.users.login}) = lower(${loginName})`).limit(1);
    const valid = user && user.isActive && (await verifyPassword(password, user.passwordHash));
    if (!valid) return { error: "اسم الدخول أو كلمة المرور غير صحيحة" };
    if (user.expiresAt && user.expiresAt <= new Date()) return { error: "انتهت الفترة التجريبية لهذا الحساب؛ تواصل مع مدير النظام لتمديدها", locked: true };
    const blocked = (await tenantState(baseSql, schema))?.blocked;
    if (blocked) return { error: blocked, locked: true };

    await createSession(user.id);
    const roles = await db.select({ key: s.roles.key }).from(s.userRoles).innerJoin(s.roles, eq(s.roles.id, s.userRoles.roleId)).where(eq(s.userRoles.userId, user.id));
    return { roles, userId: user.id, schema };
  });
}

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
