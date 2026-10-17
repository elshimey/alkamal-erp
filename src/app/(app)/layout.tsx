import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { can, type Entity } from "@/lib/permissions";
import { Logo } from "@/components/logo";
import { MobileNav, NavLinks, type NavGroup } from "@/components/nav-links";
import { logout } from "../login/actions";

const NAV: { title: string; items: { href: string; label: string; entity?: Entity }[] }[] = [
  { title: "عام", items: [{ href: "/", label: "الرئيسية" }] },
  {
    title: "الأسطول",
    items: [
      { href: "/vehicles", label: "المركبات", entity: "vehicles" },
      { href: "/drivers", label: "السائقون", entity: "drivers" },
      { href: "/assignments", label: "الإسناد والتسليم", entity: "vehicles" },
      { href: "/fleet-documents", label: "وثائق الأسطول", entity: "fleet_documents" },
    ],
  },
  {
    title: "التشغيل والمبيعات",
    items: [
      { href: "/parties", label: "جهات الاتصال", entity: "parties" },
      { href: "/routes", label: "المواقع والمسارات", entity: "routes" },
      { href: "/contracts", label: "العقود والأسعار", entity: "contracts" },
    ],
  },
  {
    title: "المحاسبة",
    items: [
      { href: "/accounts", label: "شجرة الحسابات", entity: "accounts" },
      { href: "/cost-centers", label: "مراكز التكلفة", entity: "cost_centers" },
    ],
  },
  {
    title: "الإدارة",
    items: [
      { href: "/users", label: "المستخدمون", entity: "users" },
      { href: "/roles", label: "الأدوار والصلاحيات", entity: "roles" },
    ],
  },
];

const COMING = ["البوالص والرحلات", "الفواتير والتحصيل", "المصروفات", "الصيانة", "الرواتب", "التقارير"];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const groups: NavGroup[] = NAV.map((g) => ({
    title: g.title,
    items: g.items.filter((n) => !n.entity || can(user.perms, n.entity, "view")).map(({ href, label }) => ({ href, label })),
  })).filter((g) => g.items.length);

  return (
    <div className="flex min-h-screen">
      <aside className="relative hidden w-64 shrink-0 flex-col bg-asphalt-900 text-white md:flex">
        <div className="road-line absolute inset-y-0 end-0 opacity-70" />
        <div className="px-5 py-5">
          <Logo light />
        </div>
        <nav className="flex flex-1 flex-col p-3 pt-1">
          <NavLinks groups={groups} />
          <div className="mt-2 px-3 pb-1 text-[11px] text-white/30">قريباً</div>
          {COMING.map((c) => (
            <span key={c} className="cursor-default px-3 py-1 text-sm text-white/25">
              {c}
            </span>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-black/5 bg-white px-6 py-3">
          <MobileNav groups={groups} />
          <div className="ms-auto flex items-center gap-4 text-sm">
            <Link href="/account" className="flex items-center gap-2 text-gray-700 hover:text-brand-700">
              <span className="flex size-8 items-center justify-center rounded-full bg-brand-100 font-bold text-brand-700">{user.name.trim()[0]}</span>
              <span>
                {user.name}
                <span className="ms-2 text-xs text-gray-400">{user.roles.map((r) => r.nameAr).join("، ")}</span>
              </span>
            </Link>
            <form action={logout}>
              <button className="text-gray-500 hover:text-red-600">خروج</button>
            </form>
          </div>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
