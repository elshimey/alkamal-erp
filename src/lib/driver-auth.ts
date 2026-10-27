import "server-only";
import { cache } from "react";
import { db } from "@/db";
import { redirect } from "next/navigation";
import { getCurrentUser, hasDriverSession } from "@/lib/auth";
import { driverForUser, isDriverOnly } from "@/lib/driver-app";
import { cookies } from "next/headers";
import { DRIVER_DICT, DRIVER_LANG_COOKIE, DRIVER_LANGS, type DriverLang } from "@/data/driver-i18n";

/** المستخدم الحالي وسائقه ونصوص لغته؛ السائق null إن لم يُربط الحساب بسائق. */
export const getDriverContext = cache(async () => {
  const user = await getCurrentUser();
  if (!user) redirect("/driver/login"); // للسائق صفحة دخول خاصة بلغته
  // دخول المكتب على نفس الجهاز لا يفتح تطبيق السائق؛ للتطبيق دخوله الخاص
  if (!isDriverOnly(user.roles) && !(await hasDriverSession())) redirect("/driver/login");
  const driver = await driverForUser(db, user.id);
  const picked = (await cookies()).get(DRIVER_LANG_COOKIE)?.value as DriverLang | undefined;
  const lang = driver?.appLanguage ?? (picked && DRIVER_LANGS.includes(picked) ? picked : "ar");
  return { user, driver, lang, t: DRIVER_DICT[lang] };
});

/** للصفحات والإجراءات التي تحتاج سائقاً مربوطاً. */
export async function requireDriver() {
  const ctx = await getDriverContext();
  if (!ctx.driver) throw new Error(ctx.t.notLinked);
  return { ...ctx, driver: ctx.driver };
}
