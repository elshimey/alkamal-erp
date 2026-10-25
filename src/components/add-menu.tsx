"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const primary = "bg-brand-600 text-sm font-semibold text-brand-900 shadow-sm transition hover:bg-brand-500";

/**
 * زر الإضافة على طريقة وافق: الجزء الكبير يضيف سجلاً واحداً مباشرة،
 * والسهم بجانبه (منفصل عنه) يفتح بقية الطرق: الإضافة الجماعية والاستيراد.
 */
export function AddMenu({ main, more, label = "إضافة" }: { main?: { href: string; label: string }; more: { href: string; label: string }[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);

  if (main && !more.length)
    return (
      <Link href={main.href} className={`${primary} rounded-lg px-4 py-2`}>
        + {main.label}
      </Link>
    );

  return (
    <div ref={box} className="relative flex">
      {main ? (
        <>
          <Link href={main.href} className={`${primary} rounded-s-lg px-4 py-2`}>
            + {main.label}
          </Link>
          <button
            type="button"
            aria-label="طرق إضافة أخرى"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className={`${primary} rounded-e-lg border-s border-brand-900/15 px-2.5`}
          >
            <svg viewBox="0 0 24 24" className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={2.2}>
              <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </>
      ) : (
        <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={`${primary} flex items-center gap-2 rounded-lg px-4 py-2`}>
          {label}
          <svg viewBox="0 0 24 24" className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={2.2}>
            <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      {open && (
        <div role="menu" className="animate-flyout absolute end-0 top-full z-30 mt-1 w-52 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 text-sm shadow-lg">
          {more.map((i) => (
            <Link key={i.href} href={i.href} role="menuitem" onClick={() => setOpen(false)} className="block px-4 py-2 text-gray-700 hover:bg-gray-50">
              {i.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
