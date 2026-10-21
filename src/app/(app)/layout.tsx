import Link from "next/link";
import { redirect } from "next/navigation";
import { isDriverOnly } from "@/lib/driver-app";
import { requireUser } from "@/lib/auth";
import { can, type Entity } from "@/lib/permissions";
import { Icon, type IconName } from "@/components/icons";
import { Logo } from "@/components/logo";
import { MobileNav, NavLinks, type NavGroup } from "@/components/nav-links";
import { TourRunner } from "@/components/tour";
import { logout } from "../login/actions";

// الدعم الفني (واتساب واتصال)
const SUPPORT_PHONE = "966535443598";
const FOOTER: NavGroup[] = [
  { title: "الإعدادات", icon: "settings", items: [{ href: "/settings", label: "الإعدادات", icon: "settings" }] },
  {
    title: "المساعدة",
    icon: "help",
    items: [
      { href: "/help", label: "دليل استخدام النظام", icon: "book" },
      { href: `https://wa.me/${SUPPORT_PHONE}?text=${encodeURIComponent("مرحباً، أحتاج مساعدة في نظام الكمال")}`, label: "الدعم الفني (واتساب)", icon: "chat", external: true },
      { href: `tel:+${SUPPORT_PHONE}`, label: "اتصال بالدعم", icon: "phone", external: true, hint: `+${SUPPORT_PHONE}` },
      { href: `https://wa.me/${SUPPORT_PHONE}?text=${encodeURIComponent("اقتراح ميزة جديدة لنظام الكمال: ")}`, label: "طلب ميزة جديدة", icon: "sparkle", external: true },
    ],
  },
];

const NAV: { title: string; icon: IconName; items: { href: string; label: string; icon: IconName; entity?: Entity }[] }[] = [
  { title: "عام",
    icon: "home", items: [{ href: "/", label: "لوحة القيادة", icon: "home" }] },
  {
    title: "الأسطول",
    icon: "truck",
    items: [
      { href: "/vehicles", label: "المركبات", icon: "truck", entity: "vehicles" },
      { href: "/drivers", label: "السائقون", icon: "driver", entity: "drivers" },
      { href: "/assignments", label: "الإسناد والتسليم", icon: "handover", entity: "vehicles" },
      { href: "/fleet-documents", label: "وثائق الأسطول", icon: "document", entity: "fleet_documents" },
      { href: "/violations", label: "المخالفات المرورية", icon: "ticket", entity: "violations" },
      { href: "/maintenance", label: "أوامر الصيانة", icon: "wrench", entity: "maintenance" },
      { href: "/maintenance/requests", label: "طلبات العطل", icon: "alert", entity: "maintenance" },
      { href: "/maintenance/plans", label: "الصيانة الدورية", icon: "calendar", entity: "maintenance" },
    ],
  },
  {
    title: "التشغيل والمبيعات",
    icon: "waybill",
    items: [
      { href: "/waybills", label: "البوالص", icon: "waybill", entity: "waybills" },
      { href: "/invoices", label: "الفواتير", icon: "invoice", entity: "sales_invoices" },
      { href: "/customers", label: "العملاء", icon: "people", entity: "parties" },
      { href: "/receipts", label: "سندات العملاء", icon: "cash", entity: "receipts" },
      { href: "/notes/sales", label: "إشعارات العملاء", icon: "document", entity: "sales_invoices" },
      { href: "/parties", label: "جهات الاتصال", icon: "people", entity: "parties" },
      { href: "/routes", label: "المواقع والمسارات", icon: "route", entity: "routes" },
      { href: "/contracts", label: "العقود والأسعار", icon: "contract", entity: "contracts" },
    ],
  },
  {
    title: "المشتريات والمصروفات",
    icon: "invoice",
    items: [
      { href: "/purchases", label: "فواتير الموردين", icon: "invoice", entity: "purchase_invoices" },
      { href: "/expenses", label: "المصروفات", icon: "fuel", entity: "expenses" },
      { href: "/payments", label: "سندات الصرف", icon: "cash", entity: "payments" },
      { href: "/notes/purchase", label: "إشعارات الموردين", icon: "document", entity: "purchase_invoices" },
    ],
  },
  {
    title: "الموظفون والرواتب",
    icon: "people",
    items: [
      { href: "/hr", label: "لوحة الموارد البشرية", icon: "chart", entity: "employees" },
      { href: "/employees", label: "الموظفون", icon: "people", entity: "employees" },
      { href: "/hr/custody", label: "العُهد", icon: "handover", entity: "custody" },
      { href: "/hr/discipline", label: "الإنذارات والجزاءات والحوافز", icon: "alert", entity: "hr_actions" },
      { href: "/hr/leaves", label: "الإجازات", icon: "calendar", entity: "leaves" },
      { href: "/hr/attendance", label: "الحضور", icon: "check", entity: "leaves" },
      { href: "/hr/evaluations", label: "التقييم والترقية", icon: "target", entity: "evaluations" },
      { href: "/hr/advances", label: "مقدم العمولة", icon: "cash", entity: "payroll" },
      { href: "/payroll", label: "مسيرات الرواتب", icon: "cash", entity: "payroll" },
      { href: "/payroll/advances", label: "السلف", icon: "handover", entity: "payroll" },
    ],
  },
  {
    title: "المخزون",
    icon: "wrench",
    items: [
      { href: "/products", label: "الأصناف والخدمات", icon: "list", entity: "inventory" },
      { href: "/inventory", label: "المخزون والمستودعات", icon: "building", entity: "inventory" },
      { href: "/inventory/docs", label: "التسويات والتحويل والجرد", icon: "exchange", entity: "inventory" },
    ],
  },
  {
    title: "المحاسبة",
    icon: "ledger",
    items: [
      { href: "/journal", label: "القيود اليومية", icon: "ledger", entity: "journal_entries" },
      { href: "/bank-accounts", label: "البنوك والصناديق", icon: "cash", entity: "accounts" },
      { href: "/fixed-assets", label: "الأصول الثابتة", icon: "building", entity: "fixed_assets" },
      { href: "/journal/reclassify", label: "إعادة التصنيف", icon: "exchange", entity: "journal_entries" },
      { href: "/accounts", label: "شجرة الحسابات", icon: "tree", entity: "accounts" },
      { href: "/cost-centers", label: "مراكز التكلفة", icon: "target", entity: "cost_centers" },
      { href: "/exchange-rates", label: "أسعار الصرف", icon: "exchange", entity: "accounts" },
    ],
  },
  {
    title: "التقارير",
    icon: "chart",
    items: [
      { href: "/reports", label: "كل التقارير", icon: "chart", entity: "financial_reports" },
      { href: "/reports/trial-balance", label: "ميزان المراجعة", icon: "ledger", entity: "financial_reports" },
      { href: "/reports/income", label: "قائمة الدخل", icon: "chart", entity: "financial_reports" },
      { href: "/reports/balance-sheet", label: "المركز المالي", icon: "tree", entity: "financial_reports" },
      { href: "/reports/ledger", label: "كشف حساب", icon: "document", entity: "financial_reports" },
      { href: "/reports/cost-centers", label: "ربحية المركبات", icon: "truck", entity: "financial_reports" },
      { href: "/reports/vat", label: "إقرار الضريبة", icon: "invoice", entity: "financial_reports" },
    ],
  },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // السائق يعمل من تطبيقه فقط
  if (isDriverOnly(user.roles)) redirect("/driver");
  const groups: NavGroup[] = NAV.map((g) => ({
    title: g.title,
    icon: g.icon,
    items: g.items.filter((n) => !n.entity || can(user.perms, n.entity, "view")).map(({ href, label, icon }) => ({ href, label, icon })),
  })).filter((g) => g.items.length);

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden print:hidden h-screen w-64 shrink-0 flex-col overflow-y-auto bg-asphalt-900 text-white md:flex">
        <div className="road-line absolute inset-y-0 end-0 opacity-70" />
        <div className="border-b border-white/5 px-5 py-5">
          <Logo light />
        </div>
        <nav className="flex flex-1 flex-col p-3 pt-4">
          <NavLinks groups={groups} footer={FOOTER} />
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex print:hidden items-center justify-between gap-4 border-b border-black/5 bg-white/85 px-6 py-3 backdrop-blur">
          <MobileNav groups={[...groups, FOOTER[0]]} />
          <div className="ms-auto flex items-center gap-4 text-sm">
            <Link href="/account" className="flex items-center gap-2 text-gray-700 hover:text-brand-700">
              <span className="flex size-9 items-center justify-center rounded-full bg-asphalt-900 font-display font-semibold text-brand-500 ring-2 ring-brand-600/40">{user.name.trim()[0]}</span>
              <span>
                {user.name}
                <span className="ms-2 text-xs text-gray-400">{user.roles.map((r) => r.nameAr).join("، ")}</span>
              </span>
            </Link>
            <form action={logout}>
              <button className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-gray-500 transition hover:bg-red-50 hover:text-red-600">
                <Icon name="logout" className="size-4" />
                خروج
              </button>
            </form>
          </div>
        </header>
        <main className="flex-1 p-6 lg:p-8 print:p-0">{children}</main>
        <TourRunner />
      </div>
    </div>
  );
}
