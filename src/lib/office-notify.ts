import { desc, gt, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import * as s from "@/db/schema";
import { can, type Action, type Entity, type PermissionSet } from "@/lib/permissions";
import { queuePush } from "@/lib/push";
import type { IconName } from "@/components/icons";

// أحداث المكتب الفورية (قواعد الدورات، القسم 11): ما يفعله السائق، وطلب العطل المحوّل للمدير.
// كل حدث يُحفظ مرة واحدة بالصلاحية المطلوبة، ويظهر في جرس كل من يملكها، ويصله إشعاراً فورياً.

export const OFFICE_KINDS = {
  trip_accepted: { entity: "waybills", action: "update", icon: "waybill", tone: "blue" },
  trip_loaded: { entity: "waybills", action: "update", icon: "truck", tone: "blue" },
  trip_delivered: { entity: "waybills", action: "update", icon: "waybill", tone: "amber" },
  trip_undo: { entity: "waybills", action: "update", icon: "waybill", tone: "amber" },
  trip_started: { entity: "waybills", action: "create", icon: "truck", tone: "amber" },
  request_stage: { entity: "waybills", action: "create", icon: "truck", tone: "blue" },
  driver_expense: { entity: "expenses", action: "approve", icon: "fuel", tone: "amber" },
  driver_maintenance: { entity: "maintenance", action: "approve", icon: "wrench", tone: "amber" },
  breakdown_reported: { entity: "maintenance", action: "update", icon: "wrench", tone: "red" },
  breakdown_escalated: { entity: "maintenance", action: "approve", icon: "wrench", tone: "red" },
  doc_uploaded: { entity: "fleet_documents", action: "update", icon: "document", tone: "amber" },
  // تنبيه انتهاء الوثائق اليومي (30 و7 أيام ويوم الانتهاء ثم أسبوعياً): لكل جهة صلاحيتها
  doc_expiring: { entity: "fleet_documents", action: "view", icon: "document", tone: "red" },
  doc_expiring_hr: { entity: "employees", action: "view", icon: "document", tone: "red" },
  doc_expiring_company: { entity: "settings", action: "update", icon: "shield", tone: "red" },
  advance_requested: { entity: "payroll", action: "approve", icon: "cash", tone: "amber" },
  // جدول أقساط الدائنين: قبل الاستحقاق بثلاثة أيام، ويومه، ثم أسبوعياً حتى السداد
  installment_due: { entity: "payments", action: "create", icon: "cash", tone: "amber" },
} as const satisfies Record<string, { entity: Entity; action: Action; icon: IconName; tone: "red" | "amber" | "blue" }>;
export type OfficeKind = keyof typeof OFFICE_KINDS;

/** أحداث الوثائق تظهر في تبويب «الوثائق» بالجرس، والباقي في «التشغيل». */
export const isDocKind = (kind: string) => kind.startsWith("doc_");

/** يسجل حدثاً للمكتب ويجدول إشعاره الفوري (push: false لمن يرسله بنفسه). */
export async function notifyOffice(db: Db | Tx, n: { kind: OfficeKind; text: string; href: string; driverId?: number | null }, opts: { push?: boolean } = {}) {
  const k = OFFICE_KINDS[n.kind];
  const [row] = await db
    .insert(s.officeNotifications)
    .values({ kind: n.kind, text: n.text.trim().slice(0, 300), href: n.href, entity: k.entity, action: k.action, driverId: n.driverId ?? null })
    .returning({ id: s.officeNotifications.id });
  if (opts.push !== false) await queuePush({ kind: "office", id: row.id });
  return row.id;
}

/** اسم السائق كما يظهر في نص الحدث. */
export async function driverName(db: Db | Tx, driverId: number) {
  const r = await db.execute<{ name: string }>(sql`select e.name_ar as name from drivers d join employees e on e.id = d.employee_id where d.id = ${driverId}`);
  return [...r][0]?.name ?? "السائق";
}

const KEEP_DAYS = 7;

/** أحداث الأيام الأخيرة التي تخص هذا المستخدم حسب صلاحياته (الأحدث أولاً). */
export async function officeEvents(db: Db | Tx, perms: PermissionSet, limit = 30) {
  const since = new Date(Date.now() - KEEP_DAYS * 86_400_000);
  const rows = await db.select().from(s.officeNotifications).where(gt(s.officeNotifications.createdAt, since)).orderBy(desc(s.officeNotifications.id)).limit(200);
  return rows
    .filter((r) => can(perms, r.entity as Entity, r.action as Action))
    .slice(0, limit)
    .map((r) => {
      const k = OFFICE_KINDS[r.kind as OfficeKind];
      return { key: `ev:${r.id}`, group: isDocKind(r.kind) ? ("docs" as const) : ("ops" as const), tone: k?.tone ?? "blue", icon: (k?.icon ?? "bell") as IconName, text: r.text, href: r.href, at: r.createdAt };
    });
}

/** نبض الفحص الدوري: رقم آخر حدث، فلا يُعاد حساب الجرس كاملاً إلا عند جديد. */
export async function lastOfficeEventId(db: Db | Tx) {
  const [r] = await db.select({ id: sql<number>`coalesce(max(${s.officeNotifications.id}), 0)::int` }).from(s.officeNotifications);
  return r.id;
}
