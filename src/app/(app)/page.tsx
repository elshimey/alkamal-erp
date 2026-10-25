import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { db } from "@/db";
import { requireUser } from "@/lib/auth";
import { can, scopeFor } from "@/lib/permissions";
import { daysBetween, todayRiyadh } from "@/lib/dates";
import { setupSteps } from "@/lib/setup";
import { alertKindsFor } from "@/lib/documents";
import { PERIODS, alertCounts, cashFlow, balances, collected, financials, fleetStatus, monthlyTrend, operations, receivablesAging, resolvePeriod, topCustomers, unbilledTrips, vehicleProfit, type Period } from "@/lib/dashboard";
import { incomeStatement } from "@/lib/reports";
import type { Entity } from "@/lib/permissions";
import { WAYBILL_STATUS, type WaybillStatus } from "@/data/waybills";
import { CountUp } from "@/components/count-up";
import { Icon, Truck, type IconName } from "@/components/icons";
import { DateInput } from "@/components/date-input";

const money = (v: number) => Math.round(v).toLocaleString("en");
const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);
// الهامش بلا معنى إن كان الإيراد صفراً أو سالباً (إشعارات دائنة تفوق الفواتير)
const marginNote = (part: number, revenue: number) => (revenue > 0 ? `هامش ${pct(part, revenue)}%` : "هامش —");
const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const delay = (i: number) => ({ "--i": i }) as CSSProperties;

// ألوان مراحل الرحلة على الشريط
const STAGE_COLOR: Record<WaybillStatus, string> = {
  draft: "bg-gray-300",
  in_transit: "bg-sky-500",
  delivered: "bg-brand-500",
  approved: "bg-emerald-500",
  invoiced: "bg-asphalt-700",
  rejected: "bg-red-400",
};

type Tab = "overview" | "income" | "cash";
const TABS: { key: Tab; label: string; icon: IconName }[] = [
  { key: "overview", label: "نظرة عامة", icon: "home" },
  { key: "income", label: "قائمة الدخل", icon: "chart" },
  { key: "cash", label: "التدفق النقدي", icon: "cash" },
];

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{
    denied?: string;
    p?: string;
    from?: string;
    to?: string;
    tab?: string;
  }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const { denied } = sp;
  const today = todayRiyadh();
  const period = resolvePeriod(sp, today);
  const range = period;

  const canFinance = can(user.perms, "accounts", "view");
  const canReports = can(user.perms, "financial_reports", "view");
  const canOps = can(user.perms, "waybills", "view");
  const canFleet = can(user.perms, "vehicles", "view");
  const canSales = can(user.perms, "sales_invoices", "view");
  const ownOnly = scopeFor(user.perms, "waybills", "view") === "own";
  const tab: Tab = (sp.tab === "income" || sp.tab === "cash") && canFinance ? sp.tab : "overview";
  const ov = tab === "overview";

  const [fin, prevTrend, bal, aging, coll, ops, prevOps, vehicles, fleet, customers, alerts, unbilled, income, cash] = await Promise.all([
    canFinance ? financials(db, range) : null,
    canFinance && ov ? monthlyTrend(db, today) : null,
    canFinance ? balances(db, today) : null,
    canSales && ov ? receivablesAging(db, today) : null,
    canSales && ov ? collected(db, range.from, range.to) : null,
    canOps ? operations(db, range.from, range.to, ownOnly ? user.id : undefined) : null,
    canOps && ov ? operations(db, range.prevFrom, range.prevTo, ownOnly ? user.id : undefined) : null,
    canFinance && ov ? vehicleProfit(db, range.from, range.to) : null,
    canFleet && ov ? fleetStatus(db) : null,
    canSales && ov ? topCustomers(db, range.from, range.to) : null,
    alertCounts(db, today, alertKindsFor(user.perms)),
    canSales && ov ? unbilledTrips(db) : null,
    tab === "income"
      ? incomeStatement(db, {
          from: range.from,
          to: range.to,
          compareFrom: range.prevFrom,
          compareTo: range.prevTo,
        })
      : null,
    tab === "cash" ? cashFlow(db, range.from, range.to) : null,
  ]);
  // رابط إعدادات القسم يظهر لمن يملك صلاحية فتحها فقط
  const setting = (href: string, entity?: Entity) => (!entity || can(user.perms, entity, "view") ? href : undefined);

  const now = new Date();
  const gregorian = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Riyadh",
  }).format(now);
  const hijri = new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura-nu-latn", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Riyadh",
  }).format(now);

  // معالج الإعداد يظهر لمدير النظام حتى تكتمل خطواته
  const setup = user.perms.isAdmin ? await setupSteps(db) : [];
  const setupDone = setup.filter((x) => x.done).length;

  // التنبيهات: ما يحتاج تدخلاً، كل واحد يفتح القسم المعني
  const kwdStale = !alerts.kwdRateDate || daysBetween(alerts.kwdRateDate, today) > 30;
  const alertList: {
    show: boolean;
    tone: "red" | "amber" | "blue";
    icon: IconName;
    text: string;
    href: string;
  }[] = [
    {
      show: !!bal && bal.cash < 0,
      tone: "red",
      icon: "cash",
      text: `رصيد النقدية بالسالب (${money(bal?.cash ?? 0)} ر.س): سندات صرف أكثر من المقبوض`,
      href: "/payments",
    },
    ...alerts.docsCritical.map((d) => ({
      show: true,
      tone: "red" as const,
      icon: "shield" as const,
      text: `${d.name} للمنشأة ${d.expiryDate < today ? `منتهٍ منذ ${d.expiryDate}` : `ينتهي في ${d.expiryDate}`}: جدّده فوراً`,
      href: "/fleet-documents/owner/company-0",
    })),
    {
      show: can(user.perms, "fleet_documents", "view") && alerts.docsExpired > 0,
      tone: "red",
      icon: "document",
      text: `${alerts.docsExpired} وثيقة منتهية لم تُجدَّد`,
      href: "/fleet-documents",
    },
    {
      show: can(user.perms, "fleet_documents", "update") && alerts.pendingDocUploads > 0,
      tone: "amber",
      icon: "document",
      text: `${alerts.pendingDocUploads} وثيقة مجددة رفعها السائقون بانتظار الاعتماد`,
      href: "/fleet-documents/submissions",
    },
    {
      show: canSales && alerts.overdue > 0,
      tone: "red",
      icon: "invoice",
      text: `${alerts.overdue} فاتورة متأخرة السداد`,
      href: "/invoices",
    },
    {
      show: canOps && alerts.toApprove > 0,
      tone: "amber",
      icon: "waybill",
      text: `${alerts.toApprove} شحنة مسلّمة بانتظار الاعتماد`,
      href: "/waybills?status=delivered",
    },
    {
      show: canSales && alerts.toInvoice > 0,
      tone: "amber",
      icon: "invoice",
      text: `${alerts.toInvoice} شحنة معتمدة لم تُفوتر`,
      href: "/invoices",
    },
    {
      show: can(user.perms, "fleet_documents", "view") && alerts.docsExpiring > 0,
      tone: "amber",
      icon: "calendar",
      text: `${alerts.docsExpiring} وثيقة تقترب من الانتهاء`,
      href: "/fleet-documents",
    },
    {
      show: canOps && alerts.longTransit > 0,
      tone: "amber",
      icon: "truck",
      text: `${alerts.longTransit} رحلة في الطريق منذ أكثر من 7 أيام`,
      href: "/waybills?status=in_transit",
    },
    {
      show: canSales && alerts.draftInvoices > 0,
      tone: "blue",
      icon: "invoice",
      text: `${alerts.draftInvoices} فاتورة مسودة لم تُصدر`,
      href: "/invoices",
    },
    {
      show: can(user.perms, "receipts", "approve") && alerts.draftReceipts > 0,
      tone: "blue",
      icon: "cash",
      text: `${alerts.draftReceipts} سند قبض بانتظار الترحيل`,
      href: "/receipts",
    },
    {
      show: canOps && alerts.staleDrafts > 0,
      tone: "blue",
      icon: "waybill",
      text: `${alerts.staleDrafts} شحنة مسودة منذ أكثر من يومين`,
      href: "/waybills?status=draft",
    },
    {
      show: canFinance && kwdStale,
      tone: "blue",
      icon: "exchange",
      text: alerts.kwdRateDate ? `آخر سعر للدينار الكويتي بتاريخ ${alerts.kwdRateDate}` : "لا يوجد سعر صرف للدينار الكويتي",
      href: "/exchange-rates",
    },
    {
      show: can(user.perms, "payments", "view") && alerts.overduePurchases > 0,
      tone: "red",
      icon: "invoice",
      text: `${alerts.overduePurchases} فاتورة مورد تجاوزت استحقاقها`,
      href: "/purchases",
    },
    {
      show: can(user.perms, "expenses", "approve") && alerts.pendingExpenses > 0,
      tone: "amber",
      icon: "fuel",
      text: `${alerts.pendingExpenses} مصروف بانتظار الاعتماد`,
      href: "/expenses?status=pending",
    },
    {
      show: can(user.perms, "payments", "view") && alerts.dueWeek > 0,
      tone: "amber",
      icon: "cash",
      text: `مستحق للموردين خلال 7 أيام: ${money(alerts.dueWeek)} ر.س`,
      href: "/payments",
    },
    {
      show: can(user.perms, "payments", "view") && alerts.negativeCustody > 0,
      tone: "blue",
      icon: "driver",
      text: `${alerts.negativeCustody} سائق صرف من جيبه (عهدة بالسالب)`,
      href: "/expenses",
    },
    {
      show: can(user.perms, "purchase_invoices", "approve") && alerts.draftPurchases > 0,
      tone: "blue",
      icon: "invoice",
      text: `${alerts.draftPurchases} فاتورة مورد مسودة لم تُرحّل`,
      href: "/purchases",
    },
    {
      show: can(user.perms, "maintenance", "update") && alerts.pendingBreakdowns > 0,
      tone: "red",
      icon: "wrench",
      text: `${alerts.pendingBreakdowns} بلاغ عطل بانتظار المراجعة أو الاعتماد`,
      href: "/maintenance/requests",
    },
    {
      show: can(user.perms, "maintenance", "create") && alerts.approvedBreakdowns > 0,
      tone: "amber",
      icon: "wrench",
      text: `${alerts.approvedBreakdowns} عطل معتمد لم يُفتح له أمر صيانة`,
      href: "/maintenance/requests",
    },
    {
      show: can(user.perms, "maintenance", "view") && alerts.plansDue > 0,
      tone: "amber",
      icon: "calendar",
      text: `${alerts.plansDue} صيانة دورية متأخرة أو مستحقة خلال 7 أيام`,
      href: "/maintenance/plans",
    },
    {
      show: can(user.perms, "maintenance", "view") && alerts.openMaintenance > 0,
      tone: "blue",
      icon: "wrench",
      text: `${alerts.openMaintenance} مركبة في الورشة (أمر صيانة تحت التنفيذ)`,
      href: "/maintenance?status=approved",
    },
    {
      show: can(user.perms, "maintenance", "approve") && alerts.draftMaintenance > 0,
      tone: "blue",
      icon: "wrench",
      text: `${alerts.draftMaintenance} أمر صيانة مسودة لم يُعتمد`,
      href: "/maintenance?status=draft",
    },
    {
      show: can(user.perms, "payroll", "create") && alerts.lastMonthRunMissing,
      tone: "amber",
      icon: "calendar",
      text: "لم يُنشأ مسير رواتب الشهر الماضي",
      href: "/payroll",
    },
    {
      show: can(user.perms, "payroll", "approve") && alerts.draftPayroll > 0,
      tone: "blue",
      icon: "cash",
      text: `${alerts.draftPayroll} مسير رواتب مسودة لم يُعتمد`,
      href: "/payroll",
    },
    {
      show: can(user.perms, "payroll", "approve") && alerts.unpaidPayroll > 0,
      tone: "amber",
      icon: "cash",
      text: `${alerts.unpaidPayroll} مسير معتمد لم تُصرف رواتبه`,
      href: "/payroll",
    },
    {
      show: can(user.perms, "payroll", "approve") && alerts.pendingAdvances > 0,
      tone: "blue",
      icon: "cash",
      text: `${alerts.pendingAdvances} سلفة بانتظار الصرف`,
      href: "/payroll/advances",
    },
    {
      show: can(user.perms, "violations", "approve") && alerts.unpaidViolations > 0,
      tone: "amber",
      icon: "ticket",
      text: `${alerts.unpaidViolations} مخالفة مرورية لم تُسدد للمرور`,
      href: "/violations?status=posted",
    },
    {
      show: canFleet && alerts.unassigned > 0,
      tone: "blue",
      icon: "handover",
      text: `${alerts.unassigned} مركبة عاملة بلا سائق مسند`,
      href: "/assignments",
    },
  ];
  const activeAlerts = alertList.filter((a) => a.show);

  const cur = fin?.current;
  const prev = fin?.previous;

  return (
    <>
      {/* لوحة القيادة: طريق تعبره شاحنة */}
      <section className="relative z-10 mb-4 rounded-2xl bg-asphalt-900 px-5 pt-6 pb-16 text-white shadow-lg sm:px-7 sm:pt-7">
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-sm text-brand-500">
              <span className="rounded-md bg-brand-500 px-2 py-0.5 text-xs font-semibold text-asphalt-900">لوحة القيادة</span>
              {gregorian}
            </p>
            <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">أهلاً، {user.name}</h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/60">
              {ops ? `${ops.trips} رحلة · ${period.label}` : "لوحة البداية"}
              {cur ? ` · إيراد ${money(cur.revenue)} ر.س${cur.revenue > 0 ? ` · مجمل ربح ${pct(cur.gross, cur.revenue)}%` : ""}` : ""}
              {activeAlerts.length ? ` · ${activeAlerts.length} تنبيه يحتاج متابعة` : ""}
            </p>
          </div>
          <div className="flex flex-col items-start gap-3 sm:items-end">
            <div className="flex items-center gap-2 rounded-full bg-white/[0.06] px-4 py-2 text-xs text-white/70">
              <Icon name="calendar" className="size-4 text-brand-500" />
              {hijri}
            </div>
            <PeriodPicker period={period} tab={tab} />
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-0 h-12 overflow-hidden rounded-b-2xl bg-asphalt-800">
          <div className="road-line-h road-moving-h absolute inset-x-0 bottom-3 opacity-80" />
          <div className="drive-across absolute bottom-2">
            <Truck className="truck-bump w-16" spinning />
          </div>
        </div>
      </section>
      {denied && <p className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">ليست لديك صلاحية لفتح الصفحة المطلوبة.</p>}
      {setupDone < setup.length && (
        <Link
          href="/setup"
          className="mb-6 flex flex-wrap items-center gap-4 rounded-2xl border border-brand-500/60 bg-brand-50 p-4 shadow-sm transition hover:border-brand-600 hover:shadow"
        >
          <span className="flex size-10 items-center justify-center rounded-full bg-brand-600 text-brand-900">
            <Icon name="settings" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-asphalt-900">أكمل إعداد شركتك ({setupDone} من {setup.length} خطوات)</div>
            <div className="text-sm text-gray-600">الخطوة التالية: {setup.find((x) => !x.done)?.title}</div>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-white sm:w-40">
            <div className="h-full rounded-full bg-brand-600" style={{ width: `${Math.round((setupDone / setup.length) * 100)}%` }} />
          </div>
          <span className="text-sm font-semibold text-brand-700">متابعة الإعداد ←</span>
        </Link>
      )}

      {canFinance && (
        <nav className="mb-6 flex gap-1 overflow-x-auto rounded-xl border border-black/[0.06] bg-white p-1 shadow-sm">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={dashHref(period, t.key)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm whitespace-nowrap transition sm:flex-none sm:px-4 ${t.key === tab ? "bg-asphalt-900 font-semibold text-brand-500 shadow" : "text-gray-600 hover:bg-concrete hover:text-brand-900"}`}
            >
              <Icon name={t.icon} className="size-4" />
              {t.label}
            </Link>
          ))}
        </nav>
      )}

      {income && <IncomeTab r={income} period={period} costs={fin?.costs ?? []} canReports={canReports} settings={setting("/accounts", "accounts")} />}
      {cash && <CashTab r={cash} period={period} canReports={canReports} settings={setting("/bank-accounts", "accounts")} />}

      {ov && (
        <>
          {/* المؤشرات المالية الرئيسية */}
          {cur && prev && (
            <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Kpi i={0} label="الإيرادات المفوترة" value={cur.revenue} prev={prev.revenue} icon="chart" href="/invoices" unit="ر.س" note={ops ? `قيمة رحلات الفترة ${money(ops.value)}` : undefined} />
              <Kpi i={1} label="تكاليف التشغيل" value={cur.directCost} prev={prev.directCost} icon="truck" href="/waybills?status=approved" unit="ر.س" invert />
              <Kpi i={2} label="مجمل الربح" value={cur.gross} prev={prev.gross} icon="target" href={canReports ? "/reports/income" : undefined} unit="ر.س" note={marginNote(cur?.gross ?? 0, cur?.revenue ?? 0)} />
              <Kpi i={3} label="صافي الربح" value={cur.net} prev={prev.net} icon="ledger" href={canReports ? "/reports/income" : "/accounts"} unit="ر.س" note={`بعد مصروفات إدارية ${money(cur.admin)}`} />
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <div className="flex min-w-0 flex-col gap-6 xl:col-span-2">
              {/* الرحلات والشحنات */}
              {ops && prevOps && (
                <Panel i={4} title="الرحلات والشحنات" icon="waybill" settings={setting("/routes", "routes")} href="/waybills" more="كل الشحنات">
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <Stat label="الرحلات" value={ops.trips} prev={prevOps.trips} />
                    <Stat label="دولية (الكويت)" value={ops.international} sub={`${pct(ops.international, ops.trips)}%`} />
                    <Stat label="الكيلومترات" value={ops.km} prev={prevOps.km} />
                    <Stat label="الأطنان المنقولة" value={Math.round(ops.tons)} sub={`${ops.customers} عميل`} />
                  </div>
                  {ops.trips + (ops.byStatus.rejected ?? 0) > 0 && (
                    <>
                      <div className="mt-5 flex h-3 overflow-hidden rounded-full bg-gray-100">
                        {(Object.keys(WAYBILL_STATUS) as WaybillStatus[]).map((st, k) =>
                          ops.byStatus[st] ? (
                            <div
                              key={st}
                              className={`grow-x ${STAGE_COLOR[st]}`}
                              style={{
                                ...delay(k),
                                width: `${pct(ops.byStatus[st], ops.trips + (ops.byStatus.rejected ?? 0))}%`,
                              }}
                            />
                          ) : null,
                        )}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs">
                        {(Object.keys(WAYBILL_STATUS) as WaybillStatus[]).map((st) => (
                          <Link key={st} href={`/waybills?status=${st}`} className="flex items-center gap-1.5 text-gray-600 hover:text-brand-700">
                            <span className={`size-2.5 rounded-full ${STAGE_COLOR[st]}`} />
                            {WAYBILL_STATUS[st].label}
                            <span className="ltr-nums font-semibold text-gray-800">{ops.byStatus[st] ?? 0}</span>
                          </Link>
                        ))}
                      </div>
                    </>
                  )}
                  {ops.carrier > 0 && <p className="mt-3 text-xs text-gray-500">منها {ops.carrier} رحلة بناقلين خارجيين.</p>}
                </Panel>
              )}

              {/* الإيراد والتكلفة شهرياً */}
              {prevTrend && (
                <Panel i={5} title="الإيراد والتكاليف آخر 6 أشهر" icon="chart" settings={setting("/accounts", "accounts")}>
                  <TrendChart data={prevTrend} />
                </Panel>
              )}

              {/* الديزل والمصروفات */}
              {fin && (
                <Panel i={6} title="أين تذهب التكاليف" icon="fuel" settings={setting("/accounts", "accounts")} sub={period.label}>
                  {fin.costs.length === 0 ? (
                    <Empty>لا توجد تكاليف مرحّلة في هذه الفترة.</Empty>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {fin.costs
                        .sort((a, b) => b.amount - a.amount)
                        .map((c, k) => (
                          <Bar key={c.key} i={k} label={c.label} value={c.amount} total={cur!.directCost} highlight={c.key === "fuel"} />
                        ))}
                    </div>
                  )}
                  {ops && ops.liters > 0 && (
                    <div className="mt-5 grid grid-cols-3 gap-3 rounded-xl bg-brand-50/70 p-4 text-center text-sm">
                      <MiniStat label="لترات الديزل" value={money(ops.liters)} />
                      <MiniStat label="متوسط سعر اللتر" value={(ops.fuelCost / ops.liters).toFixed(2)} />
                      <MiniStat label="ديزل لكل كم" value={ops.km ? (ops.fuelCost / ops.km).toFixed(2) : "—"} />
                    </div>
                  )}
                </Panel>
              )}

              {/* ربحية المركبات */}
              {vehicles && (
                <Panel
                  i={7}
                  title="ربحية المركبات"
                  icon="truck"
                  settings={setting("/cost-centers", "cost_centers")}
                  href={canReports ? "/reports/cost-centers" : "/vehicles"}
                  more={canReports ? "تقرير الربحية" : "المركبات"}
                  sub={period.label}
                >
                  {vehicles.length === 0 ? (
                    <Empty>تظهر بعد اعتماد الشحنات وإصدار فواتيرها.</Empty>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="text-xs text-gray-500">
                          <tr>
                            {["المركبة", "الرحلات", "الإيراد", "التكلفة", "منها ديزل", "الربح", "الهامش"].map((h) => (
                              <th key={h} className="px-2 py-2 text-start font-medium">
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {vehicles.slice(0, 10).map((v) => (
                            <tr key={v.id} className="hover:bg-brand-50/50">
                              <td className="px-2 py-2 font-medium">{v.name}</td>
                              <td className="ltr-nums px-2 py-2">{v.trips || "—"}</td>
                              <td className="ltr-nums px-2 py-2">{money(v.revenue)}</td>
                              <td className="ltr-nums px-2 py-2">{money(v.cost)}</td>
                              <td className="ltr-nums px-2 py-2 text-gray-500">{money(v.fuel)}</td>
                              <td className={`ltr-nums px-2 py-2 font-semibold ${v.profit < 0 ? "text-red-600" : "text-emerald-700"}`}>{money(v.profit)}</td>
                              <td className="ltr-nums px-2 py-2 text-gray-500">{v.revenue > 0 ? `${pct(v.profit, v.revenue)}%` : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Panel>
              )}
            </div>

            {/* على الجوال تظهر التنبيهات والوضع المالي أولاً */}
            <div className="order-first flex flex-col gap-6 xl:order-none">
              {/* التنبيهات */}
              <Panel i={4} title="التنبيهات" icon="alert" settings={setting("/settings")} sub={activeAlerts.length ? `${activeAlerts.length}` : undefined}>
                {activeAlerts.length === 0 ? (
                  <Empty>لا شيء يحتاج تدخلاً الآن.</Empty>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {activeAlerts.map((a) => (
                      <li key={a.text}>
                        <Link
                          href={a.href}
                          className={`group flex items-center gap-3 rounded-xl border-s-4 px-3 py-2.5 text-sm transition hover:-translate-x-1 ${
                            a.tone === "red" ? "border-red-500 bg-red-50 text-red-800" : a.tone === "amber" ? "border-brand-600 bg-brand-50 text-amber-900" : "border-sky-400 bg-sky-50 text-sky-900"
                          }`}
                        >
                          <Icon name={a.icon} className="size-4 shrink-0" />
                          <span className="flex-1">{a.text}</span>
                          <span className="opacity-0 transition group-hover:opacity-100">←</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              {/* الوضع المالي */}
              {bal && (
                <Panel i={5} title="الوضع المالي الآن" icon="cash" settings={setting("/bank-accounts", "accounts")} href={canReports ? "/reports/balance-sheet" : undefined} more={canReports ? "المركز المالي" : undefined}>
                  <dl className="flex flex-col divide-y divide-gray-100 text-sm">
                    <Line label="النقدية في الصناديق والبنوك" value={bal.cash} strong href="/receipts" />
                    <Line label="مستحق من العملاء" value={bal.receivable} href="/invoices" />
                    {unbilled && unbilled.count > 0 && <Line label={`رحلات منفذة لم تُفوتر (${unbilled.count})`} value={unbilled.value} href="/invoices" />}
                    <Line label="عهد السائقين والموظفين" value={bal.custody} href="/expenses" />
                    <Line label="مستحق للموردين والناقلين" value={bal.payable} href="/payments" />
                    <Line label="ضريبة القيمة المضافة المستحقة" value={bal.vat} />
                  </dl>
                  {coll && (
                    <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                      حُصّل {period.label}: {money(coll.total)} ر.س في {coll.count} سند.
                    </p>
                  )}
                </Panel>
              )}

              {/* أعمار الذمم */}
              {aging && aging.notDue + aging.d30 + aging.d60 + aging.d90 > 0 && (
                <Panel i={6} title="أعمار ذمم العملاء" icon="invoice" settings={setting("/contracts", "contracts")} href="/invoices" more="الفواتير">
                  <div className="flex flex-col gap-3">
                    {[
                      {
                        label: "لم تستحق بعد",
                        value: aging.notDue,
                        color: "bg-emerald-500",
                      },
                      {
                        label: "متأخرة حتى 30 يوماً",
                        value: aging.d30,
                        color: "bg-brand-500",
                      },
                      {
                        label: "31 إلى 60 يوماً",
                        value: aging.d60,
                        color: "bg-orange-500",
                      },
                      {
                        label: "أكثر من 60 يوماً",
                        value: aging.d90,
                        color: "bg-red-500",
                      },
                    ].map((b, k) => (
                      <Bar key={b.label} i={k} label={b.label} value={b.value} total={aging.notDue + aging.d30 + aging.d60 + aging.d90} color={b.color} />
                    ))}
                  </div>
                </Panel>
              )}

              {/* الأسطول */}
              {fleet && (
                <Panel i={7} title="حالة الأسطول" icon="truck" settings={setting("/assignments", "vehicles")} href="/vehicles" more="المركبات">
                  <div className="grid grid-cols-2 gap-3">
                    <Tile label="مركبات عاملة" value={fleet.active} of={fleet.total} tone="green" href="/vehicles" />
                    <Tile label="في رحلة الآن" value={fleet.onTrip} of={fleet.active} tone="blue" href="/waybills?status=in_transit" />
                    <Tile label="في الصيانة" value={fleet.maintenance} tone="amber" href="/vehicles" />
                    <Tile label="متوقفة" value={fleet.stopped} tone="red" href="/vehicles" />
                  </div>
                  <p className="mt-3 text-xs text-gray-500">
                    {fleet.assigned} مركبة مسندة لسائق · {fleet.drivers} سائق نشط
                    {fleet.idleDrivers ? ` منهم ${fleet.idleDrivers} بلا مركبة` : ""}.
                  </p>
                </Panel>
              )}

              {/* أكبر العملاء */}
              {customers && customers.length > 0 && (
                <Panel i={8} title="أكبر العملاء" icon="people" settings={setting("/customers", "parties")} sub={period.label}>
                  <ol className="flex flex-col gap-2.5 text-sm">
                    {customers.map((c, k) => (
                      <li key={c.id} className="flex items-center gap-3">
                        <span className="flex size-6 items-center justify-center rounded-full bg-asphalt-900 font-display text-xs text-brand-500">{k + 1}</span>
                        <span className="flex-1 truncate">{c.name}</span>
                        <span className="ltr-nums font-semibold">{money(c.revenue)}</span>
                        {c.outstanding > 0.5 && <span className="ltr-nums text-xs text-amber-700">متبقي {money(c.outstanding)}</span>}
                      </li>
                    ))}
                  </ol>
                </Panel>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ───────────── عناصر اللوحة ─────────────

function Kpi({ i, label, value, prev, icon, href, unit, note, invert = false }: { i: number; label: string; value: number; prev: number; icon: IconName; href?: string; unit: string; note?: string; invert?: boolean }) {
  const change = prev ? Math.round(((value - prev) / Math.abs(prev)) * 100) : null;
  // للتكاليف: الزيادة سيئة
  const good = change === null ? null : invert ? change <= 0 : change >= 0;
  const body = (
    <div className="group relative h-full overflow-hidden rounded-2xl border border-black/[0.06] bg-white p-5 shadow-[0_4px_16px_-8px_rgba(27,33,38,0.1)] transition duration-300 hover:-translate-y-1 hover:shadow-lg">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm text-gray-500">{label}</div>
        <span className="flex size-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700 transition group-hover:bg-brand-600 group-hover:text-brand-900">
          <Icon name={icon} />
        </span>
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <CountUp value={Math.round(value)} className={`font-display text-3xl font-semibold ${value < 0 ? "text-red-600" : "text-brand-900"}`} />
        <span className="text-xs text-gray-400">{unit}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        {change !== null && (
          <span className={`ltr-nums rounded-full px-2 py-0.5 font-medium ${good ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
            {change > 0 ? "▲" : change < 0 ? "▼" : "■"} {Math.abs(change)}%
          </span>
        )}
        <span className="text-gray-400">{note ?? (change !== null ? "عن الفترة السابقة" : "لا مقارنة بعد")}</span>
      </div>
      <div className="road-line-h absolute inset-x-0 bottom-0 h-1 origin-right scale-x-0 transition-transform duration-500 group-hover:scale-x-100" />
    </div>
  );
  return (
    <div className="animate-rise stagger" style={delay(i)}>
      {href ? (
        <Link href={href} className="block h-full">
          {body}
        </Link>
      ) : (
        body
      )}
    </div>
  );
}

function Panel({ i, title, icon, href, more, sub, settings, children }: { i: number; title: string; icon: IconName; href?: string; more?: string; sub?: string; settings?: string; children: ReactNode }) {
  return (
    <section className="animate-rise stagger rounded-2xl border border-black/[0.06] bg-white p-5 shadow-[0_4px_16px_-8px_rgba(27,33,38,0.08)]" style={delay(i)}>
      <header className="mb-4 flex flex-wrap items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-lg bg-asphalt-900 text-brand-500">
          <Icon name={icon} className="size-4" />
        </span>
        <h2 className="font-semibold text-brand-900">{title}</h2>
        {sub && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">{sub}</span>}
        <span className="ms-auto flex items-center gap-3">
          {href && (
            <Link href={href} className="text-xs text-brand-700 hover:underline">
              {more ?? "فتح"} ←
            </Link>
          )}
          {settings && <SettingsLink href={settings} />}
        </span>
      </header>
      {children}
    </section>
  );
}

function Stat({ label, value, prev, sub }: { label: string; value: number; prev?: number; sub?: string }) {
  const change = prev ? Math.round(((value - prev) / prev) * 100) : null;
  return (
    <div className="rounded-xl bg-concrete/70 p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <CountUp value={value} className="mt-1 block font-display text-2xl font-semibold text-brand-900" />
      <div className="ltr-nums text-[11px] text-gray-500">{sub ?? (change === null ? "—" : `${change > 0 ? "▲" : change < 0 ? "▼" : "■"} ${Math.abs(change)}%`)}</div>
    </div>
  );
}

function Bar({ i, label, value, total, highlight = false, color }: { i: number; label: string; value: number; total: number; highlight?: boolean; color?: string }) {
  const share = pct(value, total);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className={highlight ? "font-semibold text-brand-900" : "text-gray-700"}>{label}</span>
        <span className="ltr-nums text-gray-600">
          {money(value)} <span className="text-xs text-gray-400">({share}%)</span>
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-gray-100">
        <div className={`grow-x h-full rounded-full ${color ?? (highlight ? "bg-brand-600" : "bg-asphalt-600")}`} style={{ ...delay(i), width: `${Math.max(share, 1)}%` }} />
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="ltr-nums font-display text-lg font-semibold text-brand-900">{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}

function Line({ label, value, strong = false, href }: { label: string; value: number; strong?: boolean; href?: string }) {
  const inner = (
    <>
      <dt className="text-gray-600">{label}</dt>
      <dd className={`ltr-nums ${strong ? "font-display text-lg font-semibold text-brand-900" : "font-medium"} ${value < 0 ? "text-red-600" : ""}`}>{money(value)}</dd>
    </>
  );
  return href ? (
    <Link href={href} className="flex items-center justify-between py-2.5 hover:text-brand-700">
      {inner}
    </Link>
  ) : (
    <div className="flex items-center justify-between py-2.5">{inner}</div>
  );
}

function Tile({ label, value, of, tone, href }: { label: string; value: number; of?: number; tone: "green" | "blue" | "amber" | "red"; href: string }) {
  const tones = {
    green: "text-emerald-700 bg-emerald-50",
    blue: "text-sky-700 bg-sky-50",
    amber: "text-amber-800 bg-brand-50",
    red: "text-red-700 bg-red-50",
  };
  return (
    <Link href={href} className={`rounded-xl p-3 transition hover:-translate-y-0.5 hover:shadow ${tones[tone]}`}>
      <div className="flex items-baseline gap-1">
        <CountUp value={value} className="font-display text-2xl font-semibold" />
        {of !== undefined && <span className="ltr-nums text-xs opacity-60">/ {of}</span>}
      </div>
      <div className="text-xs">{label}</div>
    </Link>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl bg-concrete/60 px-4 py-6 text-center text-sm text-gray-500">{children}</p>;
}

/** أعمدة مزدوجة: الإيراد (أصفر) مقابل التكلفة (أسفلت) لكل شهر. */
function TrendChart({ data }: { data: { month: string; revenue: number; cost: number }[] }) {
  const max = Math.max(1, ...data.flatMap((d) => [d.revenue, d.cost]));
  return (
    <div>
      <div className="flex h-48 items-end gap-3 border-b border-gray-200 pb-px sm:gap-6">
        {data.map((d, k) => {
          const profit = d.revenue - d.cost;
          return (
            <div key={d.month} className="group relative flex h-full flex-1 flex-col justify-end">
              <div className="pointer-events-none absolute -top-2 left-1/2 z-10 hidden -translate-x-1/2 -translate-y-full rounded-lg bg-asphalt-900 px-3 py-2 text-xs whitespace-nowrap text-white shadow-lg group-hover:block">
                <div>إيراد {money(d.revenue)}</div>
                <div>تكلفة {money(d.cost)}</div>
                <div className={profit < 0 ? "text-red-300" : "text-brand-500"}>ربح {money(profit)}</div>
              </div>
              <div className="flex h-full items-end justify-center gap-1">
                <div className="grow-y w-1/2 max-w-7 rounded-t-md bg-brand-500" style={{ ...delay(k), height: `${(d.revenue / max) * 100}%` }} />
                <div className="grow-y w-1/2 max-w-7 rounded-t-md bg-asphalt-600" style={{ ...delay(k), height: `${(d.cost / max) * 100}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-3 sm:gap-6">
        {data.map((d) => (
          <div key={d.month} className="flex-1 text-center text-xs text-gray-500">
            {MONTHS[Number(d.month.slice(5)) - 1]}
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-4 text-xs text-gray-600">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-brand-500" /> الإيراد
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-asphalt-600" /> التكاليف والمصروفات
        </span>
      </div>
    </div>
  );
}

// ───────────── الفترة والتبويبات ─────────────

/** رابط اللوحة بنفس الفترة والتبويب، مع تغيير ما يُطلب. */
function dashHref(period: Period, tab: Tab, over: { p?: string } = {}) {
  const q = new URLSearchParams();
  const p = over.p ?? period.key;
  if (p !== "month") q.set("p", p);
  if (p === "custom") {
    q.set("from", period.from);
    q.set("to", period.to);
  }
  if (tab !== "overview") q.set("tab", tab);
  const s = q.toString();
  return s ? `/?${s}` : "/";
}

function PeriodPicker({ period, tab }: { period: Period; tab: Tab }) {
  return (
    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
      <nav className="flex rounded-full bg-white/[0.06] p-1 text-xs">
        {(Object.keys(PERIODS) as (keyof typeof PERIODS)[]).map((k) => (
          <Link key={k} href={dashHref(period, tab, { p: k })} className={`rounded-full px-2.5 py-1.5 whitespace-nowrap transition sm:px-3.5 ${k === period.key ? "bg-brand-500 font-semibold text-asphalt-900" : "text-white/70 hover:text-white"}`}>
            {PERIODS[k]}
          </Link>
        ))}
      </nav>
      {/* فترة مخصصة: من تاريخ إلى تاريخ */}
      <details className="group relative">
        <summary
          className={`flex cursor-pointer list-none items-center gap-1.5 rounded-full px-3.5 py-2 text-xs transition ${period.key === "custom" ? "bg-brand-500 font-semibold text-asphalt-900" : "bg-white/[0.06] text-white/70 hover:text-white"}`}
        >
          <Icon name="calendar" className="size-3.5" />
          {period.key === "custom" ? <span className="ltr-nums">{period.label}</span> : "فترة مخصصة"}
        </summary>
        <form action="/" className="absolute start-0 z-20 mt-2 flex w-64 sm:start-auto sm:end-0 flex-col gap-3 rounded-xl bg-white p-4 text-sm text-gray-700 shadow-xl">
          <input type="hidden" name="p" value="custom" />
          {tab !== "overview" && <input type="hidden" name="tab" value={tab} />}
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">من تاريخ</span>
            <DateInput name="from" required defaultValue={period.from} className="rounded-lg border border-gray-200 px-3 py-2 focus:border-brand-500 focus:outline-none" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">إلى تاريخ</span>
            <DateInput name="to" required defaultValue={period.to} className="rounded-lg border border-gray-200 px-3 py-2 focus:border-brand-500 focus:outline-none" />
          </label>
          <button className="rounded-lg bg-asphalt-900 py-2 font-semibold text-brand-500 transition hover:bg-asphalt-800">عرض الفترة</button>
        </form>
      </details>
    </div>
  );
}

function SettingsLink({ href }: { href: string }) {
  return (
    <Link href={href} title="إعدادات القسم" aria-label="إعدادات القسم" className="flex size-7 items-center justify-center rounded-lg text-gray-400 transition hover:rotate-45 hover:bg-brand-50 hover:text-brand-700">
      <Icon name="settings" className="size-4" />
    </Link>
  );
}

const change = (cur: number, prev: number | null | undefined) => (prev ? Math.round(((cur - prev) / Math.abs(prev)) * 100) : null);

function Delta({ cur, prev, invert = false }: { cur: number; prev: number | null | undefined; invert?: boolean }) {
  const c = change(cur, prev);
  if (c === null) return <span className="text-xs text-gray-300">—</span>;
  const good = invert ? c <= 0 : c >= 0;
  return (
    <span className={`ltr-nums rounded-full px-2 py-0.5 text-[11px] font-medium ${good ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
      {c > 0 ? "▲" : c < 0 ? "▼" : "■"} {Math.abs(c)}%
    </span>
  );
}

// ───────────── تبويب قائمة الدخل ─────────────

type Income = Awaited<ReturnType<typeof incomeStatement>>;

function IncomeTab({ r, period, costs, canReports, settings }: { r: Income; period: Period; costs: { key: string; label: string; amount: number }[]; canReports: boolean; settings?: string }) {
  const sec = (k: string) => r.sections.find((x) => x.key === k)!;
  const revenue = sec("revenue").current;
  const prevRevenue = sec("revenue").previous ?? 0;
  const p = r.previous;
  const subtotal: Record<string, { label: string; cur: number; prev: number | null }> = {
    cost: { label: "مجمل الربح", cur: r.current.gross, prev: p?.gross ?? null },
    admin: {
      label: "الربح التشغيلي",
      cur: r.current.operating,
      prev: p?.operating ?? null,
    },
    finance: {
      label: "الربح قبل الزكاة",
      cur: r.current.beforeZakat,
      prev: p?.beforeZakat ?? null,
    },
    zakat: { label: "صافي الربح", cur: r.current.net, prev: p?.net ?? null },
  };
  const totalCost = costs.reduce((t, c) => t + c.amount, 0);
  const full = canReports ? `/reports/income?from=${period.from}&to=${period.to}` : undefined;
  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi i={0} label="الإيرادات" value={revenue} prev={prevRevenue} icon="chart" href="/invoices" unit="ر.س" />
        <Kpi i={1} label="مجمل الربح" value={r.current.gross} prev={p?.gross ?? 0} icon="target" unit="ر.س" note={marginNote(r.current.gross, revenue)} />
        <Kpi i={2} label="الربح التشغيلي" value={r.current.operating} prev={p?.operating ?? 0} icon="truck" unit="ر.س" note={marginNote(r.current.operating, revenue)} />
        <Kpi i={3} label="صافي الربح" value={r.current.net} prev={p?.net ?? 0} icon="ledger" unit="ر.س" note={marginNote(r.current.net, revenue)} />
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2">
          <Panel i={4} title="قائمة الدخل" icon="ledger" sub={period.label} href={full} more="التقرير الكامل" settings={settings}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-gray-500">
                  <tr>
                    <th className="px-2 py-2 text-start font-medium">البند</th>
                    <th className="px-2 py-2 text-end font-medium">الفترة</th>
                    <th className="px-2 py-2 text-end font-medium">الفترة السابقة</th>
                    <th className="px-2 py-2 text-end font-medium">التغير</th>
                    <th className="px-2 py-2 text-end font-medium">من الإيراد</th>
                  </tr>
                </thead>
                <tbody>
                  {r.sections.map((s) => {
                    const sub = subtotal[s.key];
                    const invert = s.key !== "revenue";
                    if (!s.lines.length && !sub) return null;
                    return (
                      <SectionRows key={s.key}>
                        {s.lines.length > 0 && (
                          <>
                            <tr className="bg-concrete/60">
                              <td colSpan={5} className="px-2 py-1.5 text-xs font-semibold text-asphalt-700">
                                {s.label}
                              </td>
                            </tr>
                            {s.lines.map((l) => (
                              <tr key={l.code} className="border-b border-gray-50 hover:bg-brand-50/40">
                                <td className="px-2 py-1.5 ps-4 text-gray-700">
                                  <span className="ltr-nums inline-block w-12 text-xs text-gray-400">{l.code}</span>
                                  {l.name}
                                </td>
                                <td className="ltr-nums px-2 py-1.5 text-end">{money(l.current)}</td>
                                <td className="ltr-nums px-2 py-1.5 text-end text-gray-500">{money(l.previous ?? 0)}</td>
                                <td className="px-2 py-1.5 text-end">
                                  <Delta cur={l.current} prev={l.previous} invert={invert} />
                                </td>
                                <td className="ltr-nums px-2 py-1.5 text-end text-xs text-gray-500">{revenue ? `${pct(l.current, revenue)}%` : "—"}</td>
                              </tr>
                            ))}
                            <tr className="text-gray-600">
                              <td className="px-2 py-1.5 ps-4 text-xs">إجمالي {s.label}</td>
                              <td className="ltr-nums px-2 py-1.5 text-end font-medium">{money(s.current)}</td>
                              <td className="ltr-nums px-2 py-1.5 text-end text-gray-500">{money(s.previous ?? 0)}</td>
                              <td className="px-2 py-1.5 text-end">
                                <Delta cur={s.current} prev={s.previous} invert={invert} />
                              </td>
                              <td />
                            </tr>
                          </>
                        )}
                        {sub && (
                          <tr className={`border-y-2 ${s.key === "zakat" ? "border-brand-500 bg-brand-50" : "border-gray-100"}`}>
                            <td className="px-2 py-2.5 font-semibold text-brand-900">{sub.label}</td>
                            <td className={`ltr-nums px-2 py-2.5 text-end font-display text-base font-semibold ${sub.cur < 0 ? "text-red-600" : "text-brand-900"}`}>{money(sub.cur)}</td>
                            <td className="ltr-nums px-2 py-2.5 text-end text-gray-500">{money(sub.prev ?? 0)}</td>
                            <td className="px-2 py-2.5 text-end">
                              <Delta cur={sub.cur} prev={sub.prev} />
                            </td>
                            <td className="ltr-nums px-2 py-2.5 text-end text-xs font-medium text-gray-600">{revenue ? `${pct(sub.cur, revenue)}%` : "—"}</td>
                          </tr>
                        )}
                      </SectionRows>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-gray-400">
              الأرقام من القيود المرحّلة فقط. المقارنة بالفترة{" "}
              <span className="ltr-nums">
                {period.prevFrom} ← {period.prevTo}
              </span>
              .
            </p>
          </Panel>
        </div>
        <div className="flex flex-col gap-6">
          <Panel i={5} title="هوامش الربح" icon="target">
            <div className="flex flex-col gap-4">
              {[
                {
                  label: "هامش مجمل الربح",
                  v: pct(r.current.gross, revenue),
                  pv: pct(p?.gross ?? 0, prevRevenue),
                },
                {
                  label: "هامش الربح التشغيلي",
                  v: pct(r.current.operating, revenue),
                  pv: pct(p?.operating ?? 0, prevRevenue),
                },
                {
                  label: "هامش صافي الربح",
                  v: pct(r.current.net, revenue),
                  pv: pct(p?.net ?? 0, prevRevenue),
                },
              ].map((m, k) => (
                <div key={m.label}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="text-gray-700">{m.label}</span>
                    <span className="ltr-nums font-display font-semibold text-brand-900">
                      {m.v}% <span className="text-xs font-normal text-gray-400">كان {m.pv}%</span>
                    </span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-gray-100">
                    <div
                      className={`grow-x h-full rounded-full ${m.v < 0 ? "bg-red-500" : "bg-brand-500"}`}
                      style={{
                        ...delay(k),
                        width: `${Math.min(100, Math.max(Math.abs(m.v), 1))}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Panel>
          <Panel i={6} title="تكاليف التشغيل" icon="fuel" href={canReports ? `/reports/cost-centers?from=${period.from}&to=${period.to}` : undefined} more="حسب المركبة">
            {costs.length === 0 ? (
              <Empty>لا توجد تكاليف مرحّلة في هذه الفترة.</Empty>
            ) : (
              <div className="flex flex-col gap-3">
                {[...costs]
                  .sort((a, b) => b.amount - a.amount)
                  .map((c, k) => (
                    <Bar key={c.key} i={k} label={c.label} value={c.amount} total={totalCost} highlight={c.key === "fuel"} />
                  ))}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

function SectionRows({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

// ───────────── تبويب التدفق النقدي ─────────────

type Cash = Awaited<ReturnType<typeof cashFlow>>;

function CashTab({ r, period, canReports, settings }: { r: Cash; period: Period; canReports: boolean; settings?: string }) {
  const ledger = (id: number) => (canReports ? `/reports/ledger?from=${period.from}&to=${period.to}&account=${id}` : undefined);
  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <CashKpi i={0} label="رصيد أول الفترة" value={r.opening} icon="cash" />
        <CashKpi i={1} label="المقبوضات" value={r.inflow} icon="cash" tone="in" />
        <CashKpi i={2} label="المدفوعات" value={r.outflow} icon="invoice" tone="out" />
        <CashKpi i={3} label="رصيد آخر الفترة" value={r.closing} icon="ledger" note={`صافي التغير ${r.net > 0 ? "+" : ""}${money(r.net)}`} />
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 xl:col-span-2">
          <Panel i={4} title="قائمة التدفق النقدي" icon="exchange" sub={period.label} settings={settings}>
            {r.sections.every((s) => s.items.length === 0) ? (
              <Empty>لا توجد حركة على الصناديق أو البنوك في هذه الفترة.</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-gray-500">
                    <tr>
                      <th className="px-2 py-2 text-start font-medium">البند</th>
                      <th className="px-2 py-2 text-end font-medium">داخل</th>
                      <th className="px-2 py-2 text-end font-medium">خارج</th>
                      <th className="px-2 py-2 text-end font-medium">الصافي</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-gray-100">
                      <td className="px-2 py-2 text-gray-600">رصيد النقدية أول الفترة</td>
                      <td />
                      <td />
                      <td className="ltr-nums px-2 py-2 text-end font-medium">{money(r.opening)}</td>
                    </tr>
                    {r.sections
                      .filter((s) => s.items.length)
                      .map((s) => (
                        <SectionRows key={s.key}>
                          <tr className="bg-concrete/60">
                            <td colSpan={4} className="px-2 py-1.5 text-xs font-semibold text-asphalt-700">
                              {s.label}
                            </td>
                          </tr>
                          {s.items.map((l) => (
                            <tr key={l.key} className="border-b border-gray-50 hover:bg-brand-50/40">
                              <td className="px-2 py-1.5 ps-4">
                                {l.href ? (
                                  <Link href={l.href} className="text-gray-700 hover:text-brand-700">
                                    {l.label}
                                  </Link>
                                ) : (
                                  l.label
                                )}
                              </td>
                              <td className="ltr-nums px-2 py-1.5 text-end text-emerald-700">{l.in ? money(l.in) : "—"}</td>
                              <td className="ltr-nums px-2 py-1.5 text-end text-red-600">{l.out ? money(l.out) : "—"}</td>
                              <td className={`ltr-nums px-2 py-1.5 text-end font-medium ${l.net < 0 ? "text-red-600" : ""}`}>{money(l.net)}</td>
                            </tr>
                          ))}
                          <tr className="border-y-2 border-gray-100">
                            <td className="px-2 py-2 font-semibold text-brand-900">صافي النقد من {s.label}</td>
                            <td />
                            <td />
                            <td className={`ltr-nums px-2 py-2 text-end font-semibold ${s.net < 0 ? "text-red-600" : "text-brand-900"}`}>{money(s.net)}</td>
                          </tr>
                        </SectionRows>
                      ))}
                    <tr className="border-y-2 border-brand-500 bg-brand-50">
                      <td className="px-2 py-2.5 font-semibold text-brand-900">رصيد النقدية آخر الفترة</td>
                      <td className="ltr-nums px-2 py-2.5 text-end text-emerald-700">{money(r.inflow)}</td>
                      <td className="ltr-nums px-2 py-2.5 text-end text-red-600">{money(r.outflow)}</td>
                      <td className={`ltr-nums px-2 py-2.5 text-end font-display text-base font-semibold ${r.closing < 0 ? "text-red-600" : "text-brand-900"}`}>{money(r.closing)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-xs text-gray-400">التحويل بين الصناديق والبنوك لا يظهر هنا لأنه لا يغيّر رصيد النقدية.</p>
          </Panel>
          <Panel i={5} title={r.daily ? "المقبوضات والمدفوعات يومياً" : "المقبوضات والمدفوعات شهرياً"} icon="chart">
            {r.series.length === 0 ? <Empty>لا توجد حركة في هذه الفترة.</Empty> : <CashChart data={r.series} daily={r.daily} />}
          </Panel>
        </div>
        <div className="flex flex-col gap-6">
          <Panel i={6} title="الصناديق والبنوك" icon="building" href="/bank-accounts" more="الحسابات" settings={settings}>
            {r.accounts.length === 0 ? (
              <Empty>لا توجد حسابات نقدية بحركة بعد.</Empty>
            ) : (
              <ul className="flex flex-col divide-y divide-gray-100 text-sm">
                {r.accounts.map((a) => {
                  const href = ledger(a.id);
                  const body = (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-gray-800">{a.name}</span>
                        <span className={`ltr-nums font-display font-semibold ${a.closing < 0 ? "text-red-600" : "text-brand-900"}`}>{money(a.closing)}</span>
                      </div>
                      <div className="ltr-nums mt-1 flex gap-3 text-[11px] text-gray-500">
                        <span>أول {money(a.opening)}</span>
                        {a.in > 0 && <span className="text-emerald-700">+{money(a.in)}</span>}
                        {a.out > 0 && <span className="text-red-600">−{money(a.out)}</span>}
                      </div>
                    </>
                  );
                  return (
                    <li key={a.code} className="py-2.5">
                      {href ? (
                        <Link href={href} className="block hover:text-brand-700">
                          {body}
                        </Link>
                      ) : (
                        body
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
          <Panel i={7} title="من أين جاء النقد وأين ذهب" icon="target">
            <FlowSplit sections={r.sections} />
          </Panel>
        </div>
      </div>
    </>
  );
}

function CashKpi({ i, label, value, icon, tone, note }: { i: number; label: string; value: number; icon: IconName; tone?: "in" | "out"; note?: string }) {
  return (
    <div className="animate-rise stagger" style={delay(i)}>
      <div className="relative h-full overflow-hidden rounded-2xl border border-black/[0.06] bg-white p-5 shadow-[0_4px_16px_-8px_rgba(27,33,38,0.1)]">
        <div className="flex items-start justify-between gap-3">
          <div className="text-sm text-gray-500">{label}</div>
          <span className={`flex size-10 items-center justify-center rounded-xl ${tone === "in" ? "bg-emerald-50 text-emerald-700" : tone === "out" ? "bg-red-50 text-red-600" : "bg-brand-50 text-brand-700"}`}>
            <Icon name={icon} />
          </span>
        </div>
        <div className="mt-2 flex items-baseline gap-1.5">
          <CountUp value={Math.round(value)} className={`font-display text-3xl font-semibold ${value < 0 ? "text-red-600" : "text-brand-900"}`} />
          <span className="text-xs text-gray-400">ر.س</span>
        </div>
        {note && <div className="ltr-nums mt-2 text-xs text-gray-500">{note}</div>}
      </div>
    </div>
  );
}

/** نسبة كل نشاط من المقبوضات والمدفوعات. */
function FlowSplit({ sections }: { sections: Cash["sections"] }) {
  const items = sections.flatMap((s) => s.items);
  const tin = items.reduce((t, l) => t + l.in, 0);
  const tout = items.reduce((t, l) => t + l.out, 0);
  if (!tin && !tout) return <Empty>لا توجد حركة في هذه الفترة.</Empty>;
  return (
    <div className="flex flex-col gap-5">
      {[
        {
          title: "المقبوضات",
          total: tin,
          pick: (l: (typeof items)[number]) => l.in,
          color: "bg-emerald-500",
        },
        {
          title: "المدفوعات",
          total: tout,
          pick: (l: (typeof items)[number]) => l.out,
          color: "bg-asphalt-600",
        },
      ].map((g) => (
        <div key={g.title}>
          <div className="mb-2 text-xs font-semibold text-gray-500">{g.title}</div>
          <div className="flex flex-col gap-3">
            {items
              .filter((l) => g.pick(l) > 0)
              .sort((a, b) => g.pick(b) - g.pick(a))
              .slice(0, 5)
              .map((l, k) => (
                <Bar key={l.key} i={k} label={l.label} value={g.pick(l)} total={g.total} color={g.color} />
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function CashChart({ data, daily }: { data: { key: string; in: number; out: number }[]; daily: boolean }) {
  const max = Math.max(1, ...data.flatMap((d) => [d.in, d.out]));
  const label = (k: string) => (daily ? String(Number(k.slice(8))) : MONTHS[Number(k.slice(5, 7)) - 1]);
  return (
    <div>
      <div className={`flex h-48 items-end border-b border-gray-200 pb-px ${daily ? "gap-1" : "gap-3 sm:gap-6"}`}>
        {data.map((d, k) => (
          <div key={d.key} className="group relative flex h-full flex-1 flex-col justify-end">
            <div className="pointer-events-none absolute -top-2 left-1/2 z-10 hidden -translate-x-1/2 -translate-y-full rounded-lg bg-asphalt-900 px-3 py-2 text-xs whitespace-nowrap text-white shadow-lg group-hover:block">
              <div className="ltr-nums text-white/60">{d.key}</div>
              <div>مقبوض {money(d.in)}</div>
              <div>مدفوع {money(d.out)}</div>
              <div className={d.in - d.out < 0 ? "text-red-300" : "text-brand-500"}>صافي {money(d.in - d.out)}</div>
            </div>
            <div className="flex h-full items-end justify-center gap-0.5">
              <div className="grow-y w-1/2 max-w-7 rounded-t-md bg-emerald-500" style={{ ...delay(k % 12), height: `${(d.in / max) * 100}%` }} />
              <div className="grow-y w-1/2 max-w-7 rounded-t-md bg-asphalt-600" style={{ ...delay(k % 12), height: `${(d.out / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className={`mt-2 flex ${daily ? "gap-1" : "gap-3 sm:gap-6"}`}>
        {data.map((d) => (
          <div key={d.key} className="ltr-nums flex-1 text-center text-[11px] text-gray-500">
            {label(d.key)}
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-4 text-xs text-gray-600">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-emerald-500" /> المقبوضات
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-asphalt-600" /> المدفوعات
        </span>
      </div>
    </div>
  );
}
