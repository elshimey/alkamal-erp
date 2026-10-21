"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { createSession, destroySession } from "@/lib/auth";
import { verifyPassword } from "@/lib/password";
import { isDriverOnly } from "@/lib/driver-app";
import type { FormState } from "@/components/action-form";

export async function login(_: FormState, data: FormData): Promise<FormState> {
  const loginName = String(data.get("login") ?? "").trim();
  const password = String(data.get("password") ?? "");
  if (!loginName || !password) return { error: "أدخل اسم الدخول وكلمة المرور" };

  const [user] = await db.select().from(s.users).where(eq(s.users.login, loginName));
  const valid = user && user.isActive && (await verifyPassword(password, user.passwordHash));
  if (!valid) return { error: "اسم الدخول أو كلمة المرور غير صحيحة" };
  if (user.expiresAt && user.expiresAt <= new Date()) return { error: "انتهت الفترة التجريبية لهذا الحساب؛ تواصل مع مدير النظام لتمديدها" };

  await createSession(user.id);
  const roles = await db.select({ key: s.roles.key }).from(s.userRoles).innerJoin(s.roles, eq(s.roles.id, s.userRoles.roleId)).where(eq(s.userRoles.userId, user.id));
  redirect(isDriverOnly(roles) ? "/driver" : "/");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
