"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { signIn } from "@/lib/sign-in";
import { driverForUser, setDriverLanguage } from "@/lib/driver-app";
import { runInTenant } from "@/db/tenant";
import { DRIVER_DICT, DRIVER_LANG_COOKIE, DRIVER_LANGS, type DriverLang } from "@/data/driver-i18n";
import type { FormState } from "@/components/action-form";

export async function driverLogin(lang: DriverLang, _: FormState, data: FormData): Promise<FormState> {
  const t = DRIVER_DICT[DRIVER_LANGS.includes(lang) ? lang : "ar"];
  const company = String(data.get("company") ?? "").trim();
  const loginName = String(data.get("login") ?? "").trim();
  const password = String(data.get("password") ?? "");
  if (!company || !loginName || !password) return { error: t.wrongLogin };
  const result = await signIn(company, loginName, password, "driver");
  if ("error" in result) return { error: result.throttled ? t.tooManyAttempts : result.locked ? t.accountLocked : t.wrongLogin };

  // اللغة التي اختارها في صفحة الدخول تصبح لغة تطبيقه
  await runInTenant(result.schema, async () => {
    const driver = await driverForUser(db, result.userId);
    if (driver && driver.appLanguage !== lang) await setDriverLanguage(db, driver.id, lang);
  });
  redirect("/driver");
}

export async function chooseLanguage(lang: DriverLang) {
  if (!DRIVER_LANGS.includes(lang)) return;
  (await cookies()).set(DRIVER_LANG_COOKIE, lang, { path: "/driver", maxAge: 365 * 24 * 60 * 60, sameSite: "lax" });
  revalidatePath("/driver/login");
}
