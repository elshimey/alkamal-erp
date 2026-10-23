import "server-only";
import { eq, sql } from "drizzle-orm";
import { baseSql, db } from "@/db";
import { runInTenant } from "@/db/tenant";
import { clearLoginFailures, LOGIN_LOCK_MINUTES, loginThrottled, recordLoginFailure, schemaForLogin, tenantState } from "@/lib/platform";
import * as s from "@/db/schema";
import { createSession } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/password";

// مقارنة وهمية حين لا يوجد المستخدم: يستغرق الرد نفس الوقت فلا يُعرف من سرعته أن الاسم غير موجود
let dummyHash: Promise<string> | null = null;

export type SignInResult = { error: string; locked?: boolean; throttled?: boolean } | { roles: { key: string | null }[]; userId: number; schema: string };

/** يتحقق من بيانات الدخول وينشئ الجلسة. ليس إجراء خادم بذاته؛ تستدعيه صفحتا الدخول فقط. */
export async function signIn(loginName: string, password: string): Promise<SignInResult> {
  if (await loginThrottled(baseSql, loginName)) {
    return { error: `محاولات دخول خاطئة كثيرة؛ أعد المحاولة بعد ${LOGIN_LOCK_MINUTES} دقيقة`, throttled: true };
  }
  // اسم الدخول يحدد الشركة، فيدخل كل مستخدم إلى بيانات شركته فقط
  const schema = await schemaForLogin(baseSql, loginName);
  return runInTenant(schema, async () => {
    // اسم الدخول لا يفرّق بين الحروف الكبيرة والصغيرة (الجوال يكبّر الحرف الأول تلقائياً)
    const [user] = await db.select().from(s.users).where(sql`lower(${s.users.login}) = lower(${loginName})`).limit(1);
    if (!user) await verifyPassword(password, await (dummyHash ??= hashPassword("not-a-real-password")));
    const valid = user && user.isActive && (await verifyPassword(password, user.passwordHash));
    if (!valid) {
      await recordLoginFailure(baseSql, loginName);
      return { error: "اسم الدخول أو كلمة المرور غير صحيحة" };
    }
    if (user.expiresAt && user.expiresAt <= new Date()) return { error: "انتهت الفترة التجريبية لهذا الحساب؛ تواصل مع مدير النظام لتمديدها", locked: true };
    const blocked = (await tenantState(baseSql, schema))?.blocked;
    if (blocked) return { error: blocked, locked: true };

    await clearLoginFailures(baseSql, loginName);
    await createSession(user.id);
    const roles = await db.select({ key: s.roles.key }).from(s.userRoles).innerJoin(s.roles, eq(s.roles.id, s.userRoles.roleId)).where(eq(s.userRoles.userId, user.id));
    return { roles, userId: user.id, schema };
  });
}
