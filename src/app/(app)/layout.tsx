import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { isDriverOnly } from "@/lib/driver-app";
import { getTenant, requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { EXTRA_PAGES, NAV, NAV_KEYWORDS } from "@/data/nav";
import { GlobalSearch, type SearchPage } from "@/components/global-search";
import { BrandMark, Logo } from "@/components/logo";
import { getBrand } from "@/lib/brand";
import { MobileNav, NavLinks, type NavGroup } from "@/components/nav-links";
import { TourRunner } from "@/components/tour";
import { TruckRoad } from "@/components/truck-road";
import { Sidebar } from "@/components/sidebar";
import { SIDEBAR_COOKIE } from "@/components/sidebar-cookie";
import { ExpiryBanner } from "@/components/expiry-banner";
import { alertKindsFor, expiryCounts } from "@/lib/documents";
import { todayRiyadh } from "@/lib/dates";
import { db } from "@/db";
import { logout } from "../login/actions";
import { LogoutButton } from "@/components/logout-button";
import { WelcomeToast } from "@/components/welcome-toast";
import { NotificationBell } from "@/components/notification-bell";
import { WELCOME_COOKIE, welcomeMessage } from "@/lib/welcome";

// الدعم الفني (واتساب واتصال)
const SUPPORT_PHONE = "966535443598";
const FOOTER: NavGroup[] = [
  { title: "الإعدادات", icon: "settings", items: [{ href: "/settings", label: "الإعدادات", icon: "settings" }] },
  {
    title: "المساعدة",
    icon: "help",
    items: [
      { href: "/help", label: "دليل استخدام النظام", icon: "book" },
      { href: `https://wa.me/${SUPPORT_PHONE}?text=${encodeURIComponent("مرحباً، أحتاج مساعدة في البرنامج")}`, label: "الدعم الفني (واتساب)", icon: "chat", external: true },
      { href: `tel:+${SUPPORT_PHONE}`, label: "اتصال بالدعم", icon: "phone", external: true, hint: `+${SUPPORT_PHONE}` },
      { href: `https://wa.me/${SUPPORT_PHONE}?text=${encodeURIComponent("اقتراح ميزة جديدة للبرنامج: ")}`, label: "طلب ميزة جديدة", icon: "sparkle", external: true },
    ],
  },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // السائق يعمل من تطبيقه فقط: جلسته القديمة تُنقل للتطبيق ويظهر للبرنامج دخول المكتب
  if (isDriverOnly(user.roles)) redirect("/driver/session/move");
  const tenant = await getTenant();
  const brand = await getBrand();
  const today = todayRiyadh();
  const docKinds = alertKindsFor(user.perms);
  const expiry = docKinds.length ? await expiryCounts(db, today, docKinds) : null;
  const trialDays = tenant.tenant?.status === "trial" ? Math.max(tenant.daysLeft ?? 0, 0) : null;
  const groups: NavGroup[] = NAV.map((g) => ({
    title: g.title,
    icon: g.icon,
    items: g.items.filter((n) => !n.entity || can(user.perms, n.entity, "view")).map(({ href, label, icon }) => ({ href, label, icon })),
  })).filter((g) => g.items.length);
  // كل شاشة يحق للمستخدم فتحها، للبحث الشامل
  const pages: SearchPage[] = [
    ...groups.flatMap((g) => g.items.map((i) => ({ href: i.href, label: i.label, group: g.title, keywords: NAV_KEYWORDS[i.href] }))),
    ...EXTRA_PAGES.filter((p) => (!p.admin || user.perms.isAdmin) && (!p.entity || can(user.perms, p.entity, "view"))).map(({ href, label, group, keywords }) => ({ href, label, group, keywords })),
  ];

  const jar = await cookies();
  const welcome = jar.get(WELCOME_COOKIE) ? welcomeMessage(user.name) : null;

  return (
    <div className="flex min-h-screen">
      {welcome && <WelcomeToast cookie={WELCOME_COOKIE} title={welcome.title} text={welcome.text} />}
      <Sidebar initialPinned={jar.get(SIDEBAR_COOKIE)?.value !== "collapsed"}>
        <div className="border-b border-white/5 py-5 ps-5 pe-10">
          <Logo light name={brand.name} logo={brand.logo} />
        </div>
        <nav className="flex flex-1 flex-col p-3 pt-4">
          <NavLinks groups={groups} footer={FOOTER} />
        </nav>
      </Sidebar>
      <div className="flex min-w-0 flex-1 flex-col overflow-x-clip">
        <header className="sticky top-0 z-30 flex print:hidden items-center justify-between gap-3 border-b border-black/5 bg-white/85 px-3 py-2 backdrop-blur md:gap-4 md:px-6 md:py-3">
          <MobileNav groups={[...groups, ...FOOTER]} brand={{ name: brand.name, logo: brand.logo }} />
          <Link href="/" className="md:hidden" aria-label="لوحة القيادة">
            <BrandMark logo={brand.logo} size={30} />
          </Link>
          <GlobalSearch pages={pages} />
          <div className="ms-auto flex items-center gap-2 text-sm md:gap-4">
            <NotificationBell />
            <Link href="/account" className="flex items-center gap-2 text-gray-700 hover:text-brand-700">
              <span className="flex size-9 items-center justify-center rounded-full bg-asphalt-900 font-display font-semibold text-brand-500 ring-2 ring-brand-600/40">{user.name.trim()[0]}</span>
              <span className="hidden sm:inline">
                {user.name}
                <span className="ms-2 text-xs text-gray-400">{user.roles.map((r) => r.nameAr).join("، ")}</span>
              </span>
            </Link>
            <LogoutButton action={logout} />
          </div>
        </header>
        {trialDays !== null && (
          <div className="flex flex-wrap items-center justify-center gap-x-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-900 print:hidden">
            <span>
              نسخة تجريبية: باقي <b className="ltr-nums">{trialDays}</b> {trialDays > 10 ? "يوماً" : "أيام"}، ثم يتوقف الدخول وتبقى بياناتك محفوظة حتى الاشتراك.
            </span>
            {user.perms.isAdmin && (
              <Link href="/settings/subscription" className="font-semibold underline underline-offset-2">
                تفاصيل الاشتراك
              </Link>
            )}
          </div>
        )}
        {expiry && <ExpiryBanner expired={expiry.expired} soon={expiry.soon} critical={expiry.critical} today={today} />}
        <main className="flex-1 p-4 pb-24 sm:p-6 md:pb-6 lg:p-8 print:p-0">{children}</main>
        <TruckRoad />
        <TourRunner />
      </div>
    </div>
  );
}
