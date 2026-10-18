import "server-only";
import { cache } from "react";
import { db } from "@/db";
import { requireUser } from "@/lib/auth";
import { driverForUser } from "@/lib/driver-app";
import { DRIVER_DICT } from "@/data/driver-i18n";

/** المستخدم الحالي وسائقه ونصوص لغته؛ السائق null إن لم يُربط الحساب بسائق. */
export const getDriverContext = cache(async () => {
  const user = await requireUser();
  const driver = await driverForUser(db, user.id);
  const lang = driver?.appLanguage ?? "ar";
  return { user, driver, lang, t: DRIVER_DICT[lang] };
});

/** للصفحات والإجراءات التي تحتاج سائقاً مربوطاً. */
export async function requireDriver() {
  const ctx = await getDriverContext();
  if (!ctx.driver) throw new Error(ctx.t.notLinked);
  return { ...ctx, driver: ctx.driver };
}
