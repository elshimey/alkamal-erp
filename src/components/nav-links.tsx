"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./icons";
import { Logo } from "./logo";
import { useSidebarMenu } from "./sidebar";

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
  const setMenuOpen = useSidebarMenu();
  useEffect(() => setMenuOpen(!!open), [open, setMenuOpen]);

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
          <span className="rail-hide whitespace-nowrap">{first.label}</span>
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
        <span className="rail-hide flex-1 whitespace-nowrap text-start">{g.title}</span>
        <svg
          viewBox="0 0 24 24"
          className={`rail-hide size-4 text-white/35 transition-transform duration-200 rtl:rotate-180 ${isOpen ? "translate-x-[-2px] text-brand-500" : ""}`}
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

// الجوال: شريط سفلي بأهم الصفحات، وزر «القائمة» يفتح درجاً جانبياً بكل الأقسام مطوية
const TABS = ["/", "/waybills", "/invoices", "/receipts"];

export function MobileNav({ groups, brand }: { groups: NavGroup[]; brand: { name: string; logo: string | null } }) {
  const path = usePathname();
  const active = activeHref(path, groups);
  const current = groups.find((g) => g.items.some((i) => i.href === active))?.title;
  const [state, setState] = useState<{ open: boolean; path: string; expanded?: string }>({ open: false, path });
  // يُغلق الدرج بالانتقال لصفحة أخرى
  const open = state.open && state.path === path;
  const expanded = state.expanded ?? current;
  const all = groups.flatMap((g) => g.items);
  // الشريط والدرج يُرسمان في body: رأس الصفحة ضبابي الخلفية فيحصر العناصر الثابتة داخله
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const tabs = TABS.map((h) => all.find((i) => i.href === h)).filter((i): i is NavGroup["items"][number] => !!i);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setState((x) => ({ ...x, open: false }));
    document.addEventListener("keydown", esc);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", esc);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setState({ open: true, path })}
        aria-label="القائمة"
        className="flex size-10 items-center justify-center rounded-xl text-asphalt-900 transition hover:bg-gray-100 md:hidden"
      >
        <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M4 7h16M4 12h16M4 17h10" />
        </svg>
      </button>

      {mounted &&
        createPortal(
          <>
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-black/5 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden print:hidden">
        {tabs.map((n) => {
          const on = n.href === active;
          return (
            <Link key={n.href} href={n.href} className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] transition ${on ? "font-semibold text-brand-700" : "text-gray-500"}`}>
              <span className={`flex h-7 w-12 items-center justify-center rounded-full transition ${on ? "bg-brand-100" : ""}`}>
                <Icon name={n.icon} className="size-5" />
              </span>
              {n.label.replace("فواتير المبيعات", "الفواتير")}
            </Link>
          );
        })}
        <button type="button" onClick={() => setState({ open: true, path })} className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] text-gray-500">
          <span className="flex h-7 w-12 items-center justify-center rounded-full">
            <Icon name="grid" className="size-5" />
          </span>
          المزيد
        </button>
      </nav>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden print:hidden" role="dialog" aria-modal="true">
          <button type="button" aria-label="إغلاق" onClick={() => setState((x) => ({ ...x, open: false }))} className="animate-fade-in absolute inset-0 bg-asphalt-900/50 backdrop-blur-[2px]" />
          <div className="animate-drawer-in absolute inset-y-0 start-0 flex w-[86%] max-w-sm flex-col overflow-hidden bg-asphalt-900 text-white shadow-2xl">
            <div className="road-line absolute inset-y-0 end-0 opacity-60" />
            <div className="flex items-center justify-between border-b border-white/5 px-5 py-4">
              <Logo light name={brand.name} logo={brand.logo} />
              <button type="button" onClick={() => setState((x) => ({ ...x, open: false }))} aria-label="إغلاق" className="rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white">
                <Icon name="close" className="size-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              {groups.map((g) => {
                const isOpen = expanded === g.title || g.items.length === 1;
                const single = g.items.length === 1 ? g.items[0] : null;
                const linkCls = (href: string) =>
                  `flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] transition ${href === active ? "bg-brand-600 font-semibold text-asphalt-900" : "text-white/80 active:bg-white/10"}`;
                if (single)
                  return single.external ? (
                    <a key={g.title} href={single.href} className={linkCls(single.href)}>
                      <Icon name={g.icon} className="size-5" />
                      {g.title}
                    </a>
                  ) : (
                    <Link key={g.title} href={single.href} className={linkCls(single.href)}>
                      <Icon name={g.icon} className="size-5" />
                      {single.label}
                    </Link>
                  );
                return (
                  <div key={g.title} className="mb-1">
                    <button
                      type="button"
                      onClick={() => setState((x) => ({ ...x, expanded: isOpen ? "" : g.title }))}
                      aria-expanded={isOpen}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] transition active:bg-white/10 ${g.title === current ? "text-brand-500" : "text-white/85"}`}
                    >
                      <Icon name={g.icon} className="size-5" />
                      <span className="flex-1 text-start font-medium">{g.title}</span>
                      <svg viewBox="0 0 24 24" className={`size-4 text-white/40 transition-transform ${isOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </button>
                    {isOpen && (
                      <div className="ms-5 flex flex-col gap-0.5 border-s border-white/10 ps-3 pt-1 pb-2">
                        {g.items.map((n) =>
                          n.external ? (
                            <a key={n.href} href={n.href} {...(n.href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})} className={linkCls(n.href)}>
                              <Icon name={n.icon} className="size-4 opacity-80" />
                              {n.label}
                            </a>
                          ) : (
                            <Link key={n.href} href={n.href} className={linkCls(n.href)}>
                              <Icon name={n.icon} className="size-4 opacity-80" />
                              {n.label}
                            </Link>
                          ),
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
          </>,
          document.body,
        )}
    </>
  );
}
