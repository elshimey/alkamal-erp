"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Icon, type IconName } from "./icons";

export interface NavGroup {
  title: string;
  icon: IconName;
  items: { href: string; label: string; icon: IconName }[];
}

const matches = (path: string, href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));

/** الرابط النشط هو أطول رابط يطابق المسار، حتى لا تُضاء «أوامر الصيانة» في صفحة «طلبات العطل». */
function activeHref(path: string, groups: NavGroup[]) {
  return groups
    .flatMap((g) => g.items.map((i) => i.href))
    .filter((h) => matches(path, h))
    .sort((a, b) => b.length - a.length)[0];
}

// القائمة الجانبية: كل قسم رئيسي يفتح قائمة منسدلة بأقسامه الفرعية، وقسم الصفحة الحالية مفتوح دائماً
export function NavLinks({ groups }: { groups: NavGroup[] }) {
  const path = usePathname();
  const active = activeHref(path, groups);
  const current = groups.find((g) => g.items.some((i) => i.href === active))?.title;
  // ما فتحه المستخدم أو أغلقه بيده؛ وما عداه يُفتح إن كان فيه الصفحة الحالية
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const isOpenFor = (title: string) => toggled[title] ?? title === current;
  const toggle = (title: string) => setToggled((prev) => ({ ...prev, [title]: !isOpenFor(title) }));

  const link = (n: NavGroup["items"][number], nested: boolean) => {
    const on = n.href === active;
    return (
      <Link
        key={n.href}
        href={n.href}
        className={`group relative flex items-center gap-3 rounded-lg px-3 text-sm transition-colors duration-200 ${nested ? "py-1.5" : "py-2"} ${
          on ? "bg-white/[0.08] font-semibold text-brand-500" : "text-white/70 hover:bg-white/[0.05] hover:text-white"
        }`}
      >
        <span className={`absolute inset-y-1.5 start-0 w-1 rounded-full bg-brand-600 transition-transform duration-300 ${on ? "scale-y-100" : "scale-y-0"}`} />
        <span className={`transition-transform duration-200 group-hover:-translate-x-0.5 ${on ? "text-brand-500" : "text-white/40 group-hover:text-brand-500"}`}>
          <Icon name={n.icon} className={nested ? "size-4" : "size-[18px]"} />
        </span>
        {n.label}
      </Link>
    );
  };

  return (
    <div className="flex flex-col gap-1">
      {groups.map((g) => {
        // قسم برابط واحد (الرئيسية) يبقى رابطاً مباشراً
        if (g.items.length === 1) return <div key={g.title}>{link(g.items[0], false)}</div>;
        const isOpen = isOpenFor(g.title);
        const hasActive = g.title === current;
        return (
          <div key={g.title}>
            <button
              type="button"
              onClick={() => toggle(g.title)}
              aria-expanded={isOpen}
              className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-200 hover:bg-white/[0.05] ${
                hasActive ? "font-semibold text-white" : "text-white/75 hover:text-white"
              }`}
            >
              <span className={hasActive ? "text-brand-500" : "text-white/45 group-hover:text-brand-500"}>
                <Icon name={g.icon} className="size-[18px]" />
              </span>
              <span className="flex-1 text-start">{g.title}</span>
              <svg viewBox="0 0 24 24" className={`size-4 text-white/40 transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <div className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
              <div className="overflow-hidden">
                <div className="ms-5 mt-0.5 mb-1.5 border-s border-dashed border-white/15 ps-2">{g.items.map((n) => link(n, true))}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function MobileNav({ groups }: { groups: NavGroup[] }) {
  const path = usePathname();
  const active = activeHref(path, groups);
  return (
    <nav className="flex gap-2 overflow-x-auto text-sm md:hidden">
      {groups.flatMap((g) => g.items).map((n) => (
        <Link
          key={n.href}
          href={n.href}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1 whitespace-nowrap ${n.href === active ? "bg-brand-100 font-semibold text-brand-700" : "text-gray-600"}`}
        >
          <Icon name={n.icon} className="size-4" />
          {n.label}
        </Link>
      ))}
    </nav>
  );
}
