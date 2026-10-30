import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import * as s from "@/db/schema";
import type { requireUser } from "@/lib/auth";

type SessionUser = Awaited<ReturnType<typeof requireUser>>;
import { can } from "@/lib/permissions";
import { daysBetween } from "@/lib/dates";
import { alertKindsFor } from "@/lib/documents";
import { alertCounts, balances } from "@/lib/dashboard";
import type { IconName } from "@/components/icons";

// التنبيهات المحسوبة لكل مستخدم حسب صلاحياته: تظهر في لوحة القيادة وفي جرس التنبيهات أعلى الصفحة.

const money = (v: number) => Math.round(v).toLocaleString("en");

export type Alert = { key: string; tone: "red" | "amber" | "blue"; icon: IconName; text: string; href: string };

export function buildAlerts(
  user: Pick<SessionUser, "perms">,
  alerts: Awaited<ReturnType<typeof alertCounts>>,
  bal: { cash: number } | null,
  today: string,
): Alert[] {
  const canFinance = can(user.perms, "accounts", "view");
  const canOps = can(user.perms, "waybills", "view");
  const canFleet = can(user.perms, "vehicles", "view");
  const canSales = can(user.perms, "sales_invoices", "view");
  // التنبيهات: ما يحتاج تدخلاً، كل واحد يفتح القسم المعني
  const kwdStale = !alerts.kwdRateDate || daysBetween(alerts.kwdRateDate, today) > 30;
  const list: {
    key: string;
    show: boolean;
    tone: "red" | "amber" | "blue";
    icon: IconName;
    text: string;
    href: string;
  }[] = [
    {
      key: "cash_negative",
      show: !!bal && bal.cash < 0,
      tone: "red",
      icon: "cash",
      text: `رصيد النقدية بالسالب (${money(bal?.cash ?? 0)} ر.س): سندات صرف أكثر من المقبوض`,
      href: "/payments",
    },
    ...alerts.docsCritical.map((d) => ({
      key: `doc_critical:${d.name}`.slice(0, 60),
      show: true,
      tone: "red" as const,
      icon: "shield" as const,
      text: `${d.name} للمنشأة ${d.expiryDate < today ? `منتهٍ منذ ${d.expiryDate}` : `ينتهي في ${d.expiryDate}`}: جدّده فوراً`,
      href: "/fleet-documents/owner/company-0",
    })),
    {
      key: "docs_expired",
      show: can(user.perms, "fleet_documents", "view") && alerts.docsExpired > 0,
      tone: "red",
      icon: "document",
      text: `${alerts.docsExpired} وثيقة منتهية لم تُجدَّد`,
      href: "/fleet-documents",
    },
    {
      key: "doc_uploads",
      show: can(user.perms, "fleet_documents", "update") && alerts.pendingDocUploads > 0,
      tone: "amber",
      icon: "document",
      text: `${alerts.pendingDocUploads} وثيقة مجددة رفعها السائقون بانتظار الاعتماد`,
      href: "/fleet-documents/submissions",
    },
    {
      key: "invoices_overdue",
      show: canSales && alerts.overdue > 0,
      tone: "red",
      icon: "invoice",
      text: `${alerts.overdue} فاتورة متأخرة السداد`,
      href: "/invoices",
    },
    {
      key: "waybills_to_approve",
      show: canOps && alerts.toApprove > 0,
      tone: "amber",
      icon: "waybill",
      text: `${alerts.toApprove} شحنة مسلّمة بانتظار الاعتماد`,
      href: "/waybills?status=delivered",
    },
    {
      key: "waybills_to_invoice",
      show: canSales && alerts.toInvoice > 0,
      tone: "amber",
      icon: "invoice",
      text: `${alerts.toInvoice} شحنة معتمدة لم تُفوتر`,
      href: "/invoices",
    },
    {
      key: "docs_expiring",
      show: can(user.perms, "fleet_documents", "view") && alerts.docsExpiring > 0,
      tone: "amber",
      icon: "calendar",
      text: `${alerts.docsExpiring} وثيقة تقترب من الانتهاء`,
      href: "/fleet-documents",
    },
    {
      key: "long_transit",
      show: canOps && alerts.longTransit > 0,
      tone: "amber",
      icon: "truck",
      text: `${alerts.longTransit} رحلة في الطريق منذ أكثر من 7 أيام`,
      href: "/waybills?status=in_transit",
    },
    {
      key: "draft_invoices",
      show: canSales && alerts.draftInvoices > 0,
      tone: "blue",
      icon: "invoice",
      text: `${alerts.draftInvoices} فاتورة مسودة لم تُصدر`,
      href: "/invoices",
    },
    {
      key: "draft_receipts",
      show: can(user.perms, "receipts", "approve") && alerts.draftReceipts > 0,
      tone: "blue",
      icon: "cash",
      text: `${alerts.draftReceipts} سند قبض بانتظار الترحيل`,
      href: "/receipts",
    },
    {
      key: "stale_drafts",
      show: canOps && alerts.staleDrafts > 0,
      tone: "blue",
      icon: "waybill",
      text: `${alerts.staleDrafts} شحنة مسودة منذ أكثر من يومين`,
      href: "/waybills?status=draft",
    },
    {
      key: "kwd_rate",
      show: canFinance && kwdStale,
      tone: "blue",
      icon: "exchange",
      text: alerts.kwdRateDate ? `آخر سعر للدينار الكويتي بتاريخ ${alerts.kwdRateDate}` : "لا يوجد سعر صرف للدينار الكويتي",
      href: "/exchange-rates",
    },
    {
      key: "purchases_overdue",
      show: can(user.perms, "payments", "view") && alerts.overduePurchases > 0,
      tone: "red",
      icon: "invoice",
      text: `${alerts.overduePurchases} فاتورة مورد تجاوزت استحقاقها`,
      href: "/purchases",
    },
    {
      key: "pending_expenses",
      show: can(user.perms, "expenses", "approve") && alerts.pendingExpenses > 0,
      tone: "amber",
      icon: "fuel",
      text: `${alerts.pendingExpenses} مصروف بانتظار الاعتماد`,
      href: "/expenses?status=pending",
    },
    {
      key: "due_week",
      show: can(user.perms, "payments", "view") && alerts.dueWeek > 0,
      tone: "amber",
      icon: "cash",
      text: `مستحق للموردين خلال 7 أيام: ${money(alerts.dueWeek)} ر.س`,
      href: "/payments",
    },
    {
      key: "negative_custody",
      show: can(user.perms, "payments", "view") && alerts.negativeCustody > 0,
      tone: "blue",
      icon: "driver",
      text: `${alerts.negativeCustody} سائق صرف من جيبه (عهدة بالسالب)`,
      href: "/expenses",
    },
    {
      key: "draft_purchases",
      show: can(user.perms, "purchase_invoices", "approve") && alerts.draftPurchases > 0,
      tone: "blue",
      icon: "invoice",
      text: `${alerts.draftPurchases} فاتورة مورد مسودة لم تُرحّل`,
      href: "/purchases",
    },
    {
      key: "breakdowns_pending",
      show: can(user.perms, "maintenance", "update") && alerts.pendingBreakdowns > 0,
      tone: "red",
      icon: "wrench",
      text: `${alerts.pendingBreakdowns} بلاغ عطل بانتظار المراجعة أو الاعتماد`,
      href: "/maintenance/requests",
    },
    {
      key: "driver_maintenance",
      show: can(user.perms, "maintenance", "approve") && alerts.pendingDriverMaintenance > 0,
      tone: "amber",
      icon: "wrench",
      text: `${alerts.pendingDriverMaintenance} طلب صيانة من السائقين بانتظار الاعتماد`,
      href: "/maintenance/driver-requests",
    },
    {
      key: "breakdowns_approved",
      show: can(user.perms, "maintenance", "create") && alerts.approvedBreakdowns > 0,
      tone: "amber",
      icon: "wrench",
      text: `${alerts.approvedBreakdowns} عطل معتمد لم يُفتح له أمر صيانة`,
      href: "/maintenance/requests",
    },
    {
      key: "plans_due",
      show: can(user.perms, "maintenance", "view") && alerts.plansDue > 0,
      tone: "amber",
      icon: "calendar",
      text: `${alerts.plansDue} صيانة دورية متأخرة أو مستحقة خلال 7 أيام`,
      href: "/maintenance/plans",
    },
    {
      key: "open_maintenance",
      show: can(user.perms, "maintenance", "view") && alerts.openMaintenance > 0,
      tone: "blue",
      icon: "wrench",
      text: `${alerts.openMaintenance} مركبة في الورشة (أمر صيانة تحت التنفيذ)`,
      href: "/maintenance?status=approved",
    },
    {
      key: "draft_maintenance",
      show: can(user.perms, "maintenance", "approve") && alerts.draftMaintenance > 0,
      tone: "blue",
      icon: "wrench",
      text: `${alerts.draftMaintenance} أمر صيانة مسودة لم يُعتمد`,
      href: "/maintenance?status=draft",
    },
    {
      key: "payroll_missing",
      show: can(user.perms, "payroll", "create") && alerts.lastMonthRunMissing,
      tone: "amber",
      icon: "calendar",
      text: "لم يُنشأ مسير رواتب الشهر الماضي",
      href: "/payroll",
    },
    {
      key: "payroll_draft",
      show: can(user.perms, "payroll", "approve") && alerts.draftPayroll > 0,
      tone: "blue",
      icon: "cash",
      text: `${alerts.draftPayroll} مسير رواتب مسودة لم يُعتمد`,
      href: "/payroll",
    },
    {
      key: "payroll_unpaid",
      show: can(user.perms, "payroll", "approve") && alerts.unpaidPayroll > 0,
      tone: "amber",
      icon: "cash",
      text: `${alerts.unpaidPayroll} مسير معتمد لم تُصرف رواتبه`,
      href: "/payroll",
    },
    {
      key: "advances_pending",
      show: can(user.perms, "payroll", "approve") && alerts.pendingAdvances > 0,
      tone: "blue",
      icon: "cash",
      text: `${alerts.pendingAdvances} سلفة بانتظار الصرف`,
      href: "/payroll/advances",
    },
    {
      key: "violations_unpaid",
      show: can(user.perms, "violations", "approve") && alerts.unpaidViolations > 0,
      tone: "amber",
      icon: "ticket",
      text: `${alerts.unpaidViolations} مخالفة مرورية لم تُسدد للمرور`,
      href: "/violations?status=posted",
    },
    {
      key: "unassigned",
      show: canFleet && alerts.unassigned > 0,
      tone: "blue",
      icon: "handover",
      text: `${alerts.unassigned} مركبة عاملة بلا سائق مسند`,
      href: "/assignments",
    },
  ];
  return list.filter((a) => a.show).map(({ key, tone, icon, text, href }) => ({ key, tone, icon, text, href }));
}

/** تنبيهات المستخدم الآن (للجرس وصفحة كل التنبيهات). */
export async function userAlerts(db: Db, user: Pick<SessionUser, "perms">, today: string) {
  const canFinance = can(user.perms, "accounts", "view");
  const [alerts, bal] = await Promise.all([alertCounts(db, today, alertKindsFor(user.perms)), canFinance ? balances(db, today) : null]);
  return buildAlerts(user, alerts, bal, today);
}

// ───────────── المقروء: التنبيه يعود غير مقروء إذا تغيّر نصه (العدد) ─────────────

export async function withReadState(db: Db, userId: number, list: Alert[]) {
  const reads = list.length
    ? await db
        .select()
        .from(s.userAlertReads)
        .where(and(eq(s.userAlertReads.userId, userId), inArray(s.userAlertReads.key, list.map((a) => a.key))))
    : [];
  const sig = new Map(reads.map((r) => [r.key, r.sig]));
  return list.map((a) => ({ ...a, read: sig.get(a.key) === a.text }));
}

export async function markAlertsRead(db: Db, userId: number, list: Pick<Alert, "key" | "text">[]) {
  if (!list.length) return;
  await db
    .insert(s.userAlertReads)
    .values(list.map((a) => ({ userId, key: a.key, sig: a.text })))
    .onConflictDoUpdate({ target: [s.userAlertReads.userId, s.userAlertReads.key], set: { sig: sql`excluded.sig`, readAt: new Date() } });
}
