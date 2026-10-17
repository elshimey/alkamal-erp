"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { hashPassword, MIN_PASSWORD_LENGTH } from "@/lib/password";
import type { FormState } from "@/components/action-form";

const UserSchema = z.object({
  name: z.string().trim().min(2, "الاسم إلزامي"),
  login: z.string().trim().min(3, "اسم الدخول إلزامي (الجوال أو البريد)"),
  password: z.string().min(MIN_PASSWORD_LENGTH, `كلمة المرور ${MIN_PASSWORD_LENGTH} أحرف على الأقل`),
  roleIds: z.array(z.coerce.number().int().positive()).min(1, "اختر دوراً واحداً على الأقل"),
});

export async function createUser(_: FormState, data: FormData): Promise<FormState> {
  await requirePermission("users", "create");
  const parsed = UserSchema.safeParse({
    name: data.get("name"),
    login: data.get("login"),
    password: data.get("password"),
    roleIds: data.getAll("roleIds"),
  });
  if (!parsed.success) return { error: parsed.error.issues.map((i) => i.message).join("\n") };
  const { name, login, password, roleIds } = parsed.data;
  try {
    await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(s.users)
        .values({ name, login, passwordHash: await hashPassword(password) })
        .returning({ id: s.users.id });
      await tx.insert(s.userRoles).values(roleIds.map((roleId) => ({ userId: user.id, roleId })));
    });
    revalidatePath("/users");
    return { ok: `أُنشئ المستخدم ${name}` };
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
