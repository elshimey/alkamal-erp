"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useEffect, useSyncExternalStore } from "react";
import { crumbTrail, type CrumbPage } from "@/lib/breadcrumb";
import { Icon } from "./icons";

// عنوان الصفحة الحالية يأتي من رأسها (PageHeader)، فيظهر رقم المستند في المسار دون تمريره من كل صفحة
let current: { path: string; title: string } | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** يسجل عنوان الصفحة للمسار أعلى الشاشة. لا يرسم شيئاً. */
export function CrumbTitle({ title }: { title: string }) {
  const path = usePathname();
  useEffect(() => {
    const mine = { path, title };
    current = mine;
    emit();
    return () => {
      if (current === mine) {
        current = null;
        emit();
      }
    };
  }, [path, title]);
  return null;
}

function useTrail(pages: CrumbPage[]) {
  const path = usePathname();
  const title = useSyncExternalStore(
    subscribe,
    () => (current?.path === path ? current.title : null),
    () => null,
  );
  return crumbTrail(path, pages, title);
}

const isLatin = (s: string) => /^[A-Za-z0-9]/.test(s);

/** مسار الصفحة في الشريط العلوي (الكمبيوتر): البيت ثم القسم ثم القائمة، والصفحة الحالية في مربع داكن. */
export function Breadcrumbs({ pages }: { pages: CrumbPage[] }) {
  const trail = useTrail(pages);
  return (
    <nav aria-label="مسار الصفحة" className="hidden min-w-0 flex-1 overflow-hidden md:block">
      <ol className="flex min-w-0 items-center gap-1 text-[13.5px] whitespace-nowrap text-gray-500">
        <li className="shrink-0">
          <Link href="/" aria-label="لوحة القيادة" className="flex rounded-lg p-1.5 transition hover:bg-gray-100 hover:text-asphalt-900">
            <Icon name="home" className="size-4" />
          </Link>
        </li>
        {trail.map((c, i) => (
          <Fragment key={`${i}-${c.label}`}>
            <li aria-hidden="true" className={`shrink-0 text-gray-300 ${i === 0 && !c.href && trail.length > 2 ? "max-2xl:hidden" : ""}`}>
              <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m15 6-6 6 6 6" />
              </svg>
            </li>
            <li className={i === trail.length - 1 ? "min-w-0" : `shrink-0 ${i === 0 && !c.href && trail.length > 2 ? "max-2xl:hidden" : ""}`}>
              {i === trail.length - 1 ? (
                <span aria-current="page" dir={isLatin(c.label) ? "ltr" : undefined} className="block truncate rounded-lg bg-asphalt-900 px-2.5 py-1 font-semibold text-white">
                  {c.label}
                </span>
              ) : c.href ? (
                <Link href={c.href} className="rounded-lg px-2 py-1 transition hover:bg-gray-100 hover:text-asphalt-900">
                  {c.label}
                </Link>
              ) : (
                <span className="px-1">{c.label}</span>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}

/** رأس الجوال: زر رجوع للقائمة الأم، واسم القسم صغيراً فوق اسم الصفحة. */
export function MobileTitle({ pages, home }: { pages: CrumbPage[]; home: string }) {
  const trail = useTrail(pages);
  const cur = trail.at(-1);
  const up = [...trail.slice(0, -1)].reverse().find((c) => c.href);
  const parents = trail.slice(0, -1).map((c) => c.label);
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 md:hidden">
      {up?.href && (
        <Link href={up.href} data-back aria-label={`رجوع إلى ${up.label}`} className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-asphalt-900 active:bg-gray-100">
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m9 6 6 6-6 6" />
          </svg>
        </Link>
      )}
      <div className="min-w-0 flex-1 leading-tight">
        <small className="block truncate text-xs font-semibold text-brand-700">{parents.length ? parents.join(" · ") : home}</small>
        <b dir={cur && isLatin(cur.label) ? "ltr" : undefined} className="block truncate text-right font-display text-base font-semibold text-asphalt-900">
          {cur?.label ?? ""}
        </b>
      </div>
    </div>
  );
}
