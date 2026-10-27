import { redirect } from "next/navigation";
import { destroySession, getCurrentUser, hasDriverSession, moveSessionToDriver } from "@/lib/auth";
import { isDriverOnly } from "@/lib/driver-app";

/**
 * رابط البرنامج فُتح بجلسة سائق محفوظة باسم المكتب (من قبل فصل الجلستين): تنتقل الجلسة لتطبيق السائق،
 * أو تُغلق إن كان للتطبيق جلسته أصلاً، ثم تظهر صفحة دخول المكتب.
 */
export async function GET() {
  if (await hasDriverSession()) await destroySession("office");
  else {
    const user = await getCurrentUser();
    if (user && isDriverOnly(user.roles)) await moveSessionToDriver();
  }
  redirect("/login?driver=1");
}
