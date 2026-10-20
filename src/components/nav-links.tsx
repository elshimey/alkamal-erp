"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./icons";

export interface NavGroup {
  title: string;
  icon: IconName;
  items: {
    href: string;
    label: string;
    icon: IconName;
    external?: boolean;
    hint?: string;
  }[];
}

const matches = (path: string, href: string) =>
  href === "/" ? path === "/" : path === href || path.startsWith(href + "/");

/** الرابط النشط هو أطول رابط يطابق المسار، حتى لا تُضاء «أوامر الصيانة» في صفحة «طلبات العطل». */
function activeHref(path: string, groups: NavGroup[]) {
  return groups
    .flatMap((g) => g.items.map((i) => i.href))
    .filter((h) => matches(path, h))
    .sort((a, b) => b.length - a.length)[0];
}

// القائمة الجانبية على طريقة وافق: الضغط على القسم يفتح قائمته منبثقة بجانبه،
// ورابط الصفحة الحالية يبقى مميزاً في قسمه
export function NavLinks({
  groups,
  footer = [],
}: {
  groups: NavGroup[];
  footer?: NavGroup[];
}) {
  const path = usePathname();
  const active = activeHref(path, [...groups, ...footer]);
  const current = [...groups, ...footer].find((g) =>
    g.items.some((i) => i.href === active),
  )?.title;
  const [opened, setOpen] = useState<{
    title: string;
    top: number;
    edge: number;
    path: string;
  } | null>(null);
  // تُغلق القائمة بالانتقال لصفحة أخرى
  const open = opened?.path === path ? opened : null;
  const panel = useRef<HTMLDivElement>(null);

  // وبالضغط خارجها أو بزر Esc
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (
        e instanceof KeyboardEvent
          ? e.key === "Escape"
          : !panel.current?.contains(e.target as Node) &&
            !(e.target as Element).closest("[data-nav-group]")
      )
        setOpen(null);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    window.addEventListener("resize", () => setOpen(null), { once: true });
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);

  const toggle = (title: string, count: number, el: HTMLElement) => {
    if (open?.title === title) return setOpen(null);
    const r = el.getBoundingClientRect();
    const rtl =
      document.dir === "rtl" || document.documentElement.dir === "rtl";
    // تُفتح بجانب الشريط الجانبي، ولا تخرج من أسفل الشاشة
    setOpen({
      title,
      path,
      top: Math.max(
        8,
        Math.min(r.top - 6, window.innerHeight - (count * 38 + 52)),
      ),
      edge: rtl ? window.innerWidth - r.left + 10 : r.right + 10,
    });
  };

  const row = (g: NavGroup) => {
    const first = g.items[0];
    // قسم برابط واحد (الرئيسية) يبقى رابطاً مباشراً
    if (g.items.length === 1 && !first.external) {
      const on = first.href === active;
      return (
        <Link
          key={g.title}
          href={first.href}
          className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-200 ${
            on
              ? "bg-white/[0.08] font-semibold text-brand-500"
              : "text-white/75 hover:bg-white/[0.05] hover:text-white"
          }`}
        >
          <span
            className={`absolute inset-y-1.5 start-0 w-1 rounded-full bg-brand-600 transition-transform duration-300 ${on ? "scale-y-100" : "scale-y-0"}`}
          />
          <span
            className={
              on ? "text-brand-500" : "text-white/45 group-hover:text-brand-500"
            }
          >
            <Icon name={g.icon} className="size-[18px]" />
          </span>
          {first.label}
        </Link>
      );
    }
    const isOpen = open?.title === g.title;
    const hasActive = g.title === current;
    return (
      <button
        key={g.title}
        type="button"
        data-nav-group
        onClick={(e) => toggle(g.title, g.items.length, e.currentTarget)}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        className={`group relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-200 ${
          isOpen
            ? "bg-white/[0.1] text-white"
            : hasActive
              ? "bg-white/[0.06] font-semibold text-white"
              : "text-white/75 hover:bg-white/[0.05] hover:text-white"
        }`}
      >
        <span
          className={`absolute inset-y-1.5 start-0 w-1 rounded-full bg-brand-600 transition-transform duration-300 ${hasActive ? "scale-y-100" : "scale-y-0"}`}
        />
        <span
          className={
            hasActive || isOpen
              ? "text-brand-500"
              : "text-white/45 group-hover:text-brand-500"
          }
        >
          <Icon name={g.icon} className="size-[18px]" />
        </span>
        <span className="flex-1 text-start">{g.title}</span>
        <svg
          viewBox="0 0 24 24"
          className={`size-4 text-white/35 transition-transform duration-200 rtl:rotate-180 ${isOpen ? "translate-x-[-2px] text-brand-500" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    );
  };

  const openGroup = [...groups, ...footer].find((g) => g.title === open?.title);

  return (
    <>
      <div className="flex flex-col gap-1">{groups.map(row)}</div>
      {footer.length > 0 && (
        <div className="mt-auto flex flex-col gap-1 border-t border-white/5 pt-3">
          {footer.map(row)}
        </div>
      )}
      {open &&
        openGroup &&
        // يُرسم خارج الشريط الجانبي حتى لا تغطيه محتويات الصفحة
        createPortal(
          <div
            ref={panel}
            role="menu"
            style={{ top: open.top, insetInlineStart: open.edge }}
            className="animate-flyout fixed z-50 w-60 rounded-xl border border-black/5 bg-white p-1.5 text-sm shadow-[0_12px_40px_-12px_rgba(27,33,38,0.35)]"
          >
            <div className="px-3 pt-1.5 pb-1 text-[11px] font-semibold tracking-wide text-gray-400">
              {openGroup.title}
            </div>
            {openGroup.items.map((n) => {
              const on = n.href === active;
              const cls = `flex items-center gap-2.5 rounded-lg px-3 py-2 transition-colors ${on ? "bg-brand-50 font-semibold text-brand-800" : "text-gray-700 hover:bg-gray-50"}`;
              const inner = (
                <>
                  <Icon
                    name={n.icon}
                    className={`size-4 ${on ? "text-brand-600" : "text-gray-400"}`}
                  />
                  <span className="flex-1">{n.label}</span>
                  {n.hint && (
                    <span className="ltr-nums text-[11px] text-gray-400">
                      {n.hint}
                    </span>
                  )}
                </>
              );
              return n.external ? (
                <a
                  key={n.href}
                  href={n.href}
                  {...(n.href.startsWith("http")
                    ? { target: "_blank", rel: "noopener noreferrer" }
                    : {})}
                  role="menuitem"
                  className={cls}
                >
                  {inner}
                </a>
              ) : (
                <Link
                  key={n.href}
                  href={n.href}
                  role="menuitem"
                  className={cls}
                >
                  {inner}
                </Link>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}

export function MobileNav({ groups }: { groups: NavGroup[] }) {
  const path = usePathname();
  const active = activeHref(path, groups);
  return (
    <nav className="flex gap-2 overflow-x-auto text-sm md:hidden">
      {groups
        .flatMap((g) => g.items)
        .filter((n) => !n.external)
        .map((n) => (
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
