"use server";

import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { currentSessionId, requireUser } from "@/lib/auth";
import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from "@/lib/password";
import type { FormState } from "@/components/action-form";

export async function changePassword(_: FormState, data: FormData): Promise<FormState> {
  const me = await requireUser();
  const current = String(data.get("current") ?? "");
  const next = String(data.get("next") ?? "");
  if (next.length < MIN_PASSWORD_LENGTH) return { error: `كلمة المرور الجديدة ${MIN_PASSWORD_LENGTH} أحرف على الأقل` };
  if (next !== String(data.get("confirm") ?? "")) return { error: "تأكيد كلمة المرور غير مطابق" };
  const [user] = await db.select().from(s.users).where(eq(s.users.id, me.id));
  if (!(await verifyPassword(current, user.passwordHash))) return { error: "كلمة المرور الحالية غير صحيحة" };
  await db.update(s.users).set({ passwordHash: await hashPassword(next), updatedAt: new Date() }).where(eq(s.users.id, me.id));
  // تبقى هذه الجلسة فقط؛ أي جهاز آخر دخل بكلمة المرور القديمة يُخرج
  await db.delete(s.sessions).where(and(eq(s.sessions.userId, me.id), ne(s.sessions.id, (await currentSessionId()) ?? "")));
  return { ok: "تم تغيير كلمة المرور، وخرجت الأجهزة الأخرى" };
}
