import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { can, type Entity } from "@/lib/permissions";
import { logout } from "../login/actions";

const NAV: { href: string; label: string; entity?: Entity }[] = [
  { href: "/", label: "الرئيسية" },
  { href: "/vehicles", label: "المركبات", entity: "vehicles" },
  { href: "/drivers", label: "السائقون", entity: "drivers" },
  { href: "/assignments", label: "الإسناد والتسليم", entity: "vehicles" },
  { href: "/fleet-documents", label: "وثائق الأسطول", entity: "fleet_documents" },
  { href: "/accounts", label: "شجرة الحسابات", entity: "accounts" },
  { href: "/cost-centers", label: "مراكز التكلفة", entity: "cost_centers" },
  { href: "/users", label: "المستخدمون", entity: "users" },
  { href: "/roles", label: "الأدوار والصلاحيات", entity: "roles" },
];

const COMING = ["البوالص والرحلات", "العقود والأسعار", "فواتير المبيعات والتحصيل", "المصروفات والمشتريات", "الصيانة", "الرواتب", "التقارير"];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const items = NAV.filter((n) => !n.entity || can(user.perms, n.entity, "view"));
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col bg-brand-900 text-white md:flex">
        <div className="border-b border-white/10 px-5 py-5">
          <div className="text-lg font-bold">الكمال للنقليات</div>
          <div className="text-xs text-white/60">نظام الإدارة</div>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 p-3 text-sm">
          {items.map((n) => (
            <Link key={n.href} href={n.href} className="rounded-lg px-3 py-2 hover:bg-white/10">
              {n.label}
            </Link>
          ))}
          <div className="mt-4 px-3 pb-1 text-xs text-white/40">قريباً</div>
          {COMING.map((c) => (
            <span key={c} className="cursor-default px-3 py-1.5 text-white/35">
              {c}
            </span>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-gray-200 bg-white px-6 py-3">
          <nav className="flex gap-3 overflow-x-auto text-sm md:hidden">
            {items.map((n) => (
              <Link key={n.href} href={n.href} className="whitespace-nowrap text-brand-700">
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ms-auto flex items-center gap-4 text-sm">
            <Link href="/account" className="text-gray-700 hover:text-brand-700">
              {user.name}
              <span className="ms-2 text-xs text-gray-400">{user.roles.map((r) => r.nameAr).join("، ")}</span>
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
