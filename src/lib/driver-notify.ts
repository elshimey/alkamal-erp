import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import * as s from "@/db/schema";

// إشعارات تطبيق السائق: تُكتب عند كل قرار من المكتب يخصه، وتظهر في الجرس بعدد غير المقروء.
// العنوان يُترجم في التطبيق حسب نوع الإشعار ولغة السائق؛ والنص رقم المستند والمبلغ أو سبب الرفض.

export const NOTIFY_KINDS = ["trip_sent", "trip_unsent", "expense_approved", "expense_rejected", "maint_approved", "maint_rejected", "advance_approved", "advance_rejected"] as const;
export type NotifyKind = (typeof NOTIFY_KINDS)[number];

const TITLE_AR: Record<NotifyKind, string> = {
  trip_sent: "رحلة جديدة",
  trip_unsent: "أُلغي إرسال رحلة",
  expense_approved: "اعتُمد مصروفك",
  expense_rejected: "رُفض مصروفك",
  maint_approved: "اعتُمد طلب الصيانة",
  maint_rejected: "رُفض طلب الصيانة",
  advance_approved: "اعتُمد طلب السلفة",
  advance_rejected: "رُفض طلب السلفة",
};

export async function notifyDriver(db: Db | Tx, driverId: number | null | undefined, n: { kind: NotifyKind; body?: string | null; href?: string | null }) {
  if (!driverId) return;
  await db.insert(s.driverNotifications).values({ driverId, kind: n.kind, title: TITLE_AR[n.kind], body: n.body?.trim() || null, href: n.href ?? null });
}

export async function driverNotifications(db: Db | Tx, driverId: number, limit = 50) {
  return db.select().from(s.driverNotifications).where(eq(s.driverNotifications.driverId, driverId)).orderBy(desc(s.driverNotifications.createdAt), desc(s.driverNotifications.id)).limit(limit);
}

export async function unreadCount(db: Db | Tx, driverId: number) {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.driverNotifications)
    .where(and(eq(s.driverNotifications.driverId, driverId), isNull(s.driverNotifications.readAt)));
  return r.n;
}

export async function markNotificationsRead(db: Db | Tx, driverId: number) {
  await db.update(s.driverNotifications).set({ readAt: new Date() }).where(and(eq(s.driverNotifications.driverId, driverId), isNull(s.driverNotifications.readAt)));
}
