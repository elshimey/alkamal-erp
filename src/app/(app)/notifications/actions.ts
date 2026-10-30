"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requireUser } from "@/lib/auth";
import { todayRiyadh } from "@/lib/dates";
import { markAlertsRead, userAlerts, withReadState } from "@/lib/alerts";

/** حالة الجرس: التنبيهات بحالة القراءة، غير المقروء أولاً. */
export async function bellState() {
  const user = await requireUser();
  const list = await withReadState(db, user.id, await userAlerts(db, user, todayRiyadh()));
  return { unread: list.filter((a) => !a.read).length, items: [...list.filter((a) => !a.read), ...list.filter((a) => a.read)] };
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
