"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Icon } from "@/components/icons";
import { globalSearch } from "@/app/(app)/search-actions";

export interface SearchPage {
  href: string;
  label: string;
  group: string;
  keywords?: string;
}
type Hit = { group: string; label: string; hint?: string; href: string };

// توحيد الحروف العربية ليجد «الاسعار» كلمة «الأسعار» و«فاتوره» كلمة «فاتورة»
const norm = (t: string) =>
  t
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .trim();

/** بحث شامل: كل الشاشات والإعدادات، والمستندات بالرقم، والعملاء والمركبات والسائقين بالاسم. Ctrl+K */
export function GlobalSearch({ pages }: { pages: SearchPage[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);
  const [loading, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "ك")) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 10);
  }, [open]);

  // المستندات من الخادم بعد توقف الكتابة قليلاً
  useEffect(() => {
    const term = q.trim();
    const id = ++seq.current;
    if (term.length < 2) return;
    const t = setTimeout(() => {
      start(async () => {
        const res = await globalSearch(term);
        if (id === seq.current) setHits(res);
      });
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  const pageHits = useMemo(() => {
    const words = norm(q).split(/\s+/).filter(Boolean);
    if (!words.length) return pages.slice(0, 8).map((p) => ({ ...p, hint: p.group }));
    return pages
      .filter((p) => {
        const hay = norm(`${p.label} ${p.group} ${p.keywords ?? ""}`);
        return words.every((w) => hay.includes(w));
      })
      .slice(0, 8)
      .map((p) => ({ ...p, hint: p.group }));
  }, [q, pages]);

  const results: Hit[] = [...pageHits.map((p) => ({ group: "الشاشات", label: p.label, hint: p.hint, href: p.href })), ...(q.trim().length >= 2 ? hits : [])];
  const go = (h: Hit) => {
    setOpen(false);
    setQ("");
    setHits([]);
    router.push(h.href);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-w-0 items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm text-gray-500 transition hover:border-brand-400 hover:bg-white md:w-80"
        aria-label="بحث شامل"
      >
        <Icon name="search" className="size-4 shrink-0" />
        <span className="hidden truncate sm:inline">ابحث عن شاشة أو شحنة أو فاتورة أو عميل…</span>
        <kbd className="ms-auto hidden rounded border border-gray-300 bg-white px-1.5 text-[10px] whitespace-nowrap text-gray-400 md:inline" dir="ltr">
          Ctrl K
        </kbd>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-asphalt-900/40 p-3 pt-[10vh] backdrop-blur-sm" onMouseDown={() => setOpen(false)}>
          <div className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 border-b border-gray-100 px-4">
              <Icon name="search" className="size-5 text-gray-400" />
              <input
                ref={input}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setActive(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setOpen(false);
                  else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActive((a) => Math.min(a + 1, results.length - 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActive((a) => Math.max(a - 1, 0));
                  } else if (e.key === "Enter" && results[active]) go(results[active]);
                }}
                placeholder="اكتب اسم شاشة، رقم شحنة أو فاتورة، اسم عميل، لوحة مركبة…"
                className="w-full bg-transparent py-4 text-base outline-none placeholder:text-gray-400"
              />
              {loading && <span className="size-4 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />}
            </div>
            <ul className="max-h-[60vh] overflow-y-auto p-2">
              {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-gray-500">{loading ? "جارٍ البحث…" : "لا توجد نتائج"}</li>}
              {results.map((h, i) => (
                <li key={`${h.href}-${h.label}-${i}`}>
                  {(i === 0 || results[i - 1].group !== h.group) && <div className="px-3 pt-3 pb-1 text-[11px] font-semibold text-gray-400">{h.group}</div>}
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(h)}
                    className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-start text-sm ${i === active ? "bg-brand-50 text-brand-900" : "text-gray-800"}`}
                  >
                    <span className="truncate font-medium">{h.label}</span>
                    {h.hint && <span className="shrink-0 truncate text-xs text-gray-400">{h.hint}</span>}
                  </button>
                </li>
              ))}
            </ul>
            <div className="border-t border-gray-100 px-4 py-2 text-[11px] text-gray-400">↑ ↓ للتنقل · Enter للفتح · Esc للإغلاق</div>
          </div>
        </div>
      )}
    </>
  );
}
