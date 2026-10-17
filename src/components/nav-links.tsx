"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./icons";

export interface NavGroup {
  title: string;
  items: { href: string; label: string; icon: IconName }[];
}

const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));

export function NavLinks({ groups }: { groups: NavGroup[] }) {
  const path = usePathname();
  return (
    <>
      {groups.map((g) => (
        <div key={g.title} className="mb-4">
          <div className="px-3 pb-1.5 text-[11px] font-medium text-white/35">{g.title}</div>
          {g.items.map((n) => {
            const active = isActive(path, n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-200 ${
                  active ? "bg-white/[0.08] font-semibold text-brand-500" : "text-white/75 hover:bg-white/[0.05] hover:text-white"
                }`}
              >
                <span
                  className={`absolute inset-y-1.5 start-0 w-1 rounded-full bg-brand-600 transition-transform duration-300 ${active ? "scale-y-100" : "scale-y-0"}`}
                />
                <span className={`transition-transform duration-200 group-hover:-translate-x-0.5 ${active ? "text-brand-500" : "text-white/45 group-hover:text-brand-500"}`}>
                  <Icon name={n.icon} className="size-[18px]" />
                </span>
                {n.label}
              </Link>
            );
          })}
        </div>
      ))}
    </>
  );
}

export function MobileNav({ groups }: { groups: NavGroup[] }) {
  const path = usePathname();
  return (
    <nav className="flex gap-2 overflow-x-auto text-sm md:hidden">
      {groups.flatMap((g) => g.items).map((n) => (
        <Link
          key={n.href}
          href={n.href}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1 whitespace-nowrap ${
            isActive(path, n.href) ? "bg-brand-100 font-semibold text-brand-700" : "text-gray-600"
          }`}
        >
          <Icon name={n.icon} className="size-4" />
          {n.label}
        </Link>
      ))}
    </nav>
  );
}
