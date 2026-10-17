import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { can, type Entity } from "@/lib/permissions";
import { Icon, type IconName } from "@/components/icons";
import { Logo } from "@/components/logo";
import { MobileNav, NavLinks, type NavGroup } from "@/components/nav-links";
import { logout } from "../login/actions";

const NAV: { title: string; items: { href: string; label: string; icon: IconName; entity?: Entity }[] }[] = [
  { title: "عام", items: [{ href: "/", label: "الرئيسية", icon: "home" }] },
  {
    title: "الأسطول",
    items: [
      { href: "/vehicles", label: "المركبات", icon: "truck", entity: "vehicles" },
      { href: "/drivers", label: "السائقون", icon: "driver", entity: "drivers" },
      { href: "/assignments", label: "الإسناد والتسليم", icon: "handover", entity: "vehicles" },
      { href: "/fleet-documents", label: "وثائق الأسطول", icon: "document", entity: "fleet_documents" },
    ],
  },
  {
    title: "التشغيل والمبيعات",
    items: [
      { href: "/waybills", label: "البوالص", icon: "waybill", entity: "waybills" },
      { href: "/parties", label: "جهات الاتصال", icon: "people", entity: "parties" },
      { href: "/routes", label: "المواقع والمسارات", icon: "route", entity: "routes" },
      { href: "/contracts", label: "العقود والأسعار", icon: "contract", entity: "contracts" },
    ],
  },
  {
    title: "المحاسبة",
    items: [
      { href: "/accounts", label: "شجرة الحسابات", icon: "tree", entity: "accounts" },
      { href: "/cost-centers", label: "مراكز التكلفة", icon: "target", entity: "cost_centers" },
    ],
  },
  {
    title: "الإدارة",
    items: [
      { href: "/users", label: "المستخدمون", icon: "user", entity: "users" },
      { href: "/roles", label: "الأدوار والصلاحيات", icon: "shield", entity: "roles" },
    ],
  },
];

const COMING = ["الفواتير والتحصيل", "المصروفات", "الصيانة", "الرواتب", "التقارير"];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const groups: NavGroup[] = NAV.map((g) => ({
    title: g.title,
    items: g.items.filter((n) => !n.entity || can(user.perms, n.entity, "view")).map(({ href, label, icon }) => ({ href, label, icon })),
  })).filter((g) => g.items.length);

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col overflow-y-auto bg-asphalt-900 text-white md:flex">
        <div className="road-line absolute inset-y-0 end-0 opacity-70" />
        <div className="border-b border-white/5 px-5 py-5">
          <Logo light />
        </div>
        <nav className="flex flex-1 flex-col p-3 pt-4">
          <NavLinks groups={groups} />
          <div className="px-3 pb-1.5 text-[11px] font-medium text-white/30">قريباً</div>
          {COMING.map((c) => (
            <span key={c} className="flex cursor-default items-center gap-3 px-3 py-1.5 text-sm text-white/25">
              <Icon name="lock" className="size-4" />
              {c}
            </span>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-black/5 bg-white/85 px-6 py-3 backdrop-blur">
          <MobileNav groups={groups} />
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
        <main className="flex-1 p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
