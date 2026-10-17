"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavGroup {
  title: string;
  items: { href: string; label: string }[];
}

export function NavLinks({ groups }: { groups: NavGroup[] }) {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));
  return (
    <>
      {groups.map((g) => (
        <div key={g.title} className="mb-3">
          <div className="px-3 pb-1 text-[11px] font-medium tracking-wide text-white/40">{g.title}</div>
          {g.items.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`relative block rounded-md px-3 py-1.5 text-sm transition ${
                active(n.href) ? "bg-white/10 font-semibold text-brand-500" : "text-white/80 hover:bg-white/5 hover:text-white"
              }`}
            >
              {active(n.href) && <span className="absolute inset-y-1 start-0 w-1 rounded-full bg-brand-600" />}
              {n.label}
            </Link>
          ))}
        </div>
      ))}
    </>
  );
}

export function MobileNav({ groups }: { groups: NavGroup[] }) {
  const path = usePathname();
  return (
    <nav className="flex gap-3 overflow-x-auto text-sm md:hidden">
      {groups.flatMap((g) => g.items).map((n) => (
        <Link key={n.href} href={n.href} className={`whitespace-nowrap ${path === n.href ? "font-semibold text-brand-700" : "text-gray-600"}`}>
          {n.label}
        </Link>
      ))}
    </nav>
  );
}
