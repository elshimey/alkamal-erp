"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requireUser } from "@/lib/auth";
import { todayRiyadh } from "@/lib/dates";
import { headers } from "next/headers";
import { markAlertsRead, userAlerts, withReadState } from "@/lib/alerts";
import { lastOfficeEventId } from "@/lib/office-notify";
import { scheduleDailyDocumentAlerts } from "@/lib/doc-alerts";
import { savePushSubscription, vapidPublicKey, type PushSubscriptionInput } from "@/lib/push";

/** حالة الجرس: التنبيهات بحالة القراءة، غير المقروء أولاً. */
export async function bellState() {
  const user = await requireUser();
  await scheduleDailyDocumentAlerts(todayRiyadh());
  const list = await withReadState(db, user.id, await userAlerts(db, user, todayRiyadh()));
  const items = [...list.filter((a) => !a.read), ...list.filter((a) => a.read)];
  const unreadOf = (g: "ops" | "docs") => list.filter((a) => !a.read && a.group === g).length;
  return { unread: list.filter((a) => !a.read).length, unreadOps: unreadOf("ops"), unreadDocs: unreadOf("docs"), items };
}

export async function markRead(key: string) {
  const user = await requireUser();
  const a = (await userAlerts(db, user, todayRiyadh())).find((x) => x.key === key);
  if (a) await markAlertsRead(db, user.id, [a]);
  revalidatePath("/notifications");
}

export async function markAllRead() {
  const user = await requireUser();
  await markAlertsRead(db, user.id, await userAlerts(db, user, todayRiyadh()));
  revalidatePath("/notifications");
}

/** نبض الفحص الدوري: رقم آخر حدث فقط، فلا يُعاد حساب الجرس كاملاً كل 15 ثانية. */
export async function bellPulse() {
  await requireUser();
  return lastOfficeEventId(db);
}

export async function officePushKey() {
  await requireUser();
  return vapidPublicKey();
}

/** يحفظ اشتراك متصفح هذا المستخدم في الإشعارات الفورية. */
export async function saveOfficePush(sub: PushSubscriptionInput) {
  const user = await requireUser();
  await savePushSubscription(db, user.id, "office", sub, (await headers()).get("user-agent"));
}
