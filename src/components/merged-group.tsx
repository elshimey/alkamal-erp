"use client";

import { useEffect, useRef, useState } from "react";
import { boxes, EVENT } from "./row-selection";

/**
 * صف الشحنات المدمجة (قرار أحمد 2026-11-24): سهم يفتح الشحنات تحت صف الفاتورة أو يطويها.
 * الأبناء صفوف عادية بـ data-kid-of، فتبقى مربعات تحديدها في النموذج وإن كانت مطوية.
 */
export function GroupToggle({ group, count, defaultOpen = false }: { group: string; count: number; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={`${open ? "إخفاء" : "عرض"} ${count} شحنات مدمجة`}
      title={open ? "إخفاء الشحنات" : "عرض الشحنات"}
      onClick={() => {
        const next = !open;
        setOpen(next);
        for (const el of document.querySelectorAll<HTMLElement>(`[data-kid-of="${group}"]`)) el.hidden = !next;
      }}
      className={`me-2 inline-grid size-7 shrink-0 place-items-center rounded-lg border text-[11px] transition ${open ? "-rotate-90 border-asphalt-900 bg-asphalt-900 text-brand-500" : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"}`}
    >
      ◀
    </button>
  );
}

/** مربع تحديد المجموعة: يحدد كل شحناتها، ويظهر نصف محدد إن حُدد بعضها. */
export function GroupCheck({ form, group }: { form: string; group: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    const update = () => {
      const kids = boxes(form).filter((b) => b.dataset.group === group);
      const on = kids.filter((b) => b.checked).length;
      setChecked(kids.length > 0 && on === kids.length);
      if (ref.current) ref.current.indeterminate = on > 0 && on < kids.length;
    };
    update();
    document.addEventListener(EVENT, update);
    return () => document.removeEventListener(EVENT, update);
  }, [form, group]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      aria-label="تحديد كل شحنات الفاتورة"
      className="size-4 accent-brand-600"
      onChange={(e) => {
        for (const b of boxes(form)) if (b.dataset.group === group) b.checked = e.currentTarget.checked;
        document.dispatchEvent(new Event(EVENT));
      }}
    />
  );
}
