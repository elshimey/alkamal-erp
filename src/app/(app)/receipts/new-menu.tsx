"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";

/** زر «تسجيل دفعة فواتير» وبجانبه قائمة الدفعة المقدمة وسند الاسترداد، كما في وافق. */
export function NewReceiptMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div ref={ref} className="relative flex">
      <Link href="/receipts/new" className="rounded-s-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-brand-900 shadow-sm transition hover:bg-brand-500">
        تسجيل دفعة فواتير
      </Link>
      <button
        type="button"
        aria-label="أنواع أخرى"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="rounded-e-lg border-s border-brand-900/15 bg-brand-600 px-2 text-brand-900 shadow-sm transition hover:bg-brand-500"
      >
        <svg viewBox="0 0 24 24" className={`size-4 transition ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="animate-flyout absolute end-0 top-full z-30 mt-1.5 w-56 overflow-hidden rounded-xl border border-black/[0.06] bg-white py-1 shadow-lg">
          <Link href="/receipts/new?kind=advance" className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-gray-700 hover:bg-brand-50">
            <Icon name="cash" className="size-4 text-emerald-600" />
            تسجيل دفعة مقدمة لعميل
          </Link>
          <Link href="/receipts/new?kind=refund" className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-gray-700 hover:bg-brand-50">
            <Icon name="exchange" className="size-4 text-amber-600" />
            تسجيل سند استرداد لعميل
          </Link>
        </div>
      )}
    </div>
  );
}
