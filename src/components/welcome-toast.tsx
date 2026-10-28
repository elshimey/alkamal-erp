"use client";

import { useEffect, useState } from "react";
import { Truck } from "./icons";

/** ترحيب قصير بعد الدخول، يختفي وحده بعد ثوانٍ أو بزر الإغلاق، ولا يظهر مرة أخرى حتى الدخول التالي. */
export function WelcomeToast({ cookie, title, text }: { cookie: string; title: string; text: string }) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    document.cookie = `${cookie}=; path=/; max-age=0`;
    const t = setTimeout(() => setOpen(false), 6000);
    return () => clearTimeout(t);
  }, [cookie]);
  if (!open) return null;
  return (
    <div role="status" className="animate-rise fixed inset-x-3 bottom-20 z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-asphalt-900 px-4 py-3 text-white shadow-2xl md:bottom-6 print:hidden">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-500/15">
        <Truck className="w-9" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-display font-semibold text-brand-500">{title}</div>
        <div className="text-sm text-white/75">{text}</div>
      </div>
      <button type="button" onClick={() => setOpen(false)} aria-label="إغلاق" className="rounded-lg p-1.5 text-white/50 hover:bg-white/10 hover:text-white">
        ×
      </button>
    </div>
  );
}
