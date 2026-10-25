import type { ReactNode } from "react";

// أجزاء نافذة الإضافة على طريقة وافق: أقسام تنطوي وتنفتح، وحقول عنوانها بجانبها.

/** قسم في النافذة: «مطلوب» مفتوح دائماً، و«اختياري» ينطوي ويُفتح بالضغط على عنوانه. */
export function PanelSection({ title, optional = false, open, children, hint }: { title: string; optional?: boolean; open?: boolean; children: ReactNode; hint?: string }) {
  return (
    <details open={open ?? !optional} className="group mb-4 rounded-2xl border border-black/[0.06] bg-white shadow-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-2xl bg-gray-50/80 px-5 py-3 select-none group-open:rounded-b-none">
        <span className="font-semibold text-gray-900">{title}</span>
        <span className="text-xs text-gray-500">{optional ? "اختياري" : "مطلوب"}</span>
        {hint && <span className="hidden text-xs text-gray-400 sm:inline">· {hint}</span>}
        <svg viewBox="0 0 24 24" className="ms-auto size-4 text-gray-500 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="flex flex-col gap-3 px-5 py-4">{children}</div>
    </details>
  );
}

/** حقل بعنوانه في عمود جانبي (على الجوال فوقه). */
export function PanelField({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: ReactNode }) {
  return (
    <label className="grid items-center gap-1.5 text-sm sm:grid-cols-[11rem_1fr] sm:gap-4">
      <span className="font-medium text-gray-700">
        {label}
        {required && <span className="text-red-600">*</span>}
        {hint && <span className="block text-[11px] font-normal text-gray-400">{hint}</span>}
      </span>
      <span className="min-w-0">{children}</span>
    </label>
  );
}
