"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { hashPassword, MIN_PASSWORD_LENGTH } from "@/lib/password";
import { linkUserToDriver } from "@/lib/driver-app";
import type { FormState } from "@/components/action-form";

const UserSchema = z.object({
  name: z.string().trim().min(2, "الاسم إلزامي"),
  login: z.string().trim().min(3, "اسم الدخول إلزامي (الجوال أو البريد)"),
  password: z.string().min(MIN_PASSWORD_LENGTH, `كلمة المرور ${MIN_PASSWORD_LENGTH} أحرف على الأقل`),
  roleIds: z.array(z.coerce.number().int().positive()).min(1, "اختر دوراً واحداً على الأقل"),
  trialDays: z.coerce.number().int().min(0).max(365),
  driverId: z.coerce.number().int().min(0),
});

const DAY = 24 * 60 * 60 * 1000;

export async function createUser(_: FormState, data: FormData): Promise<FormState> {
  await requirePermission("users", "create");
  const parsed = UserSchema.safeParse({
    name: data.get("name"),
    login: data.get("login"),
    password: data.get("password"),
    roleIds: data.getAll("roleIds"),
    trialDays: data.get("trialDays") ?? 0,
    driverId: data.get("driverId") || 0,
  });
  if (!parsed.success) return { error: parsed.error.issues.map((i) => i.message).join("\n") };
  const { name, login, password, roleIds, trialDays, driverId } = parsed.data;
  const expiresAt = trialDays ? new Date(Date.now() + trialDays * DAY) : null;
  try {
    await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(s.users)
        .values({ name, login, passwordHash: await hashPassword(password), expiresAt })
        .returning({ id: s.users.id });
      await tx.insert(s.userRoles).values(roleIds.map((roleId) => ({ userId: user.id, roleId })));
      // حساب بدور «سائق» لا يعمل في تطبيق السائق إلا مربوطاً بسائقه
      const [driverRole] = await tx.select({ id: s.roles.id }).from(s.roles).where(eq(s.roles.key, "driver"));
      const isDriver = driverRole && roleIds.includes(driverRole.id);
      if (isDriver && !driverId) throw new Error("حساب السائق يجب ربطه بسائق: اختر السائق من خانة «ربط بسائق»");
      if (driverId) await linkUserToDriver(tx, user.id, driverId);
    });
    revalidatePath("/users");
    return { ok: trialDays ? `أُنشئ المستخدم ${name} بحساب تجريبي ${trialDays} يوماً` : `أُنشئ المستخدم ${name}` };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function setUserActive(userId: number, active: boolean) {
  const me = await requirePermission("users", "update");
  if (userId === me.id) return;
  if (!active) {
    // لا يُوقَف آخر مدير نظام نشط
    const admins = await db
      .select({ id: s.users.id })
      .from(s.users)
      .innerJoin(s.userRoles, eq(s.userRoles.userId, s.users.id))
      .innerJoin(s.roles, eq(s.roles.id, s.userRoles.roleId))
      .where(and(eq(s.roles.key, "admin"), eq(s.users.isActive, true), ne(s.users.id, userId)));
    if (admins.length === 0) return;
  }
  await db.update(s.users).set({ isActive: active, updatedAt: new Date() }).where(eq(s.users.id, userId));
  if (!active) await db.delete(s.sessions).where(inArray(s.sessions.userId, [userId]));
  revalidatePath("/users");
}

/** يمدد الحساب التجريبي (من اليوم أو من نهايته إن لم تنتهِ)، أو يجعله دائماً بـ days = 0. */
export async function setUserTrial(userId: number, days: number) {
  const me = await requirePermission("users", "update");
  if (userId === me.id && days > 0) return;
  const [u] = await db.select({ expiresAt: s.users.expiresAt }).from(s.users).where(eq(s.users.id, userId));
  if (!u) return;
  const from = u.expiresAt && u.expiresAt > new Date() ? u.expiresAt.getTime() : Date.now();
  await db.update(s.users).set({ expiresAt: days ? new Date(from + days * DAY) : null, updatedAt: new Date() }).where(eq(s.users.id, userId));
  revalidatePath("/users");
}

/** ربط حساب مستخدم موجود بسائق (لحساب أُنشئ بدور سائق دون ربط). */
export async function linkDriverAccount(_: FormState, data: FormData): Promise<FormState> {
  await requirePermission("users", "update");
  try {
    const userId = Number(data.get("userId"));
    const driverId = Number(data.get("driverId"));
    if (!userId || !driverId) throw new Error("اختر الحساب والسائق");
    await linkUserToDriver(db, userId, driverId);
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath("/users");
  revalidatePath("/drivers");
  return { ok: "رُبط الحساب بالسائق؛ يدخل الآن تطبيق السائق ويرى رحلاته" };
}
