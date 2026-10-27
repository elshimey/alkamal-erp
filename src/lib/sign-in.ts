import "server-only";
import { eq, sql } from "drizzle-orm";
import { baseSql, db } from "@/db";
import { runInTenant } from "@/db/tenant";
import { clearLoginFailures, LOGIN_LOCK_MINUTES, loginThrottled, recordLoginFailure, schemaForCompany, tenantState } from "@/lib/platform";
import * as s from "@/db/schema";
import { createSession, type Surface } from "@/lib/auth";
import { isDriverOnly } from "@/lib/driver-app";
import { hashPassword, verifyPassword } from "@/lib/password";

// مقارنة وهمية حين لا يوجد المستخدم: يستغرق الرد نفس الوقت فلا يُعرف من سرعته أن الاسم غير موجود
let dummyHash: Promise<string> | null = null;

export type SignInResult = { error: string; locked?: boolean; throttled?: boolean } | { roles: { key: string | null }[]; userId: number; schema: string };

const WRONG = "رمز الشركة أو اسم الدخول أو كلمة المرور غير صحيحة";

/** يتحقق من بيانات الدخول (رمز الشركة واسم الدخول وكلمة المرور) وينشئ الجلسة. ليس إجراء خادم بذاته؛ تستدعيه صفحتا الدخول فقط. */
/** surface: أين تُحفظ الجلسة؛ «auto» يضع حساب السائق في تطبيق السائق وغيره في البرنامج. */
export async function signIn(companyCode: string, loginName: string, password: string, surface: Surface | "auto" = "auto"): Promise<SignInResult> {
  // المحاولات الخاطئة تُعد لكل اسم دخول داخل شركته
  const key = `${companyCode.trim().toLowerCase()}:${loginName}`;
  if (await loginThrottled(baseSql, key)) {
    return { error: `محاولات دخول خاطئة كثيرة؛ أعد المحاولة بعد ${LOGIN_LOCK_MINUTES} دقيقة`, throttled: true };
  }
  // رمز الشركة يحدد بياناتها، فيدخل كل مستخدم إلى شركته فقط ولو تشابهت الأسماء بين الشركات
  const schema = await schemaForCompany(baseSql, companyCode);
  if (!schema) {
    await verifyPassword(password, await (dummyHash ??= hashPassword("not-a-real-password")));
    await recordLoginFailure(baseSql, key);
    return { error: WRONG };
  }
  return runInTenant(schema, async () => {
    // اسم الدخول لا يفرّق بين الحروف الكبيرة والصغيرة (الجوال يكبّر الحرف الأول تلقائياً)
    const [user] = await db.select().from(s.users).where(sql`lower(${s.users.login}) = lower(${loginName})`).limit(1);
    if (!user) await verifyPassword(password, await (dummyHash ??= hashPassword("not-a-real-password")));
    const valid = user && user.isActive && (await verifyPassword(password, user.passwordHash));
    if (!valid) {
      await recordLoginFailure(baseSql, key);
      return { error: WRONG };
    }
    if (user.expiresAt && user.expiresAt <= new Date()) return { error: "انتهت الفترة التجريبية لهذا الحساب؛ تواصل مع مدير النظام لتمديدها", locked: true };
    const blocked = (await tenantState(baseSql, schema))?.blocked;
    if (blocked) return { error: blocked, locked: true };

    await clearLoginFailures(baseSql, key);
    const roles = await db.select({ key: s.roles.key }).from(s.userRoles).innerJoin(s.roles, eq(s.roles.id, s.userRoles.roleId)).where(eq(s.userRoles.userId, user.id));
    await createSession(user.id, surface === "auto" ? (isDriverOnly(roles) ? "driver" : "office") : surface);
    return { roles, userId: user.id, schema };
  });
}
