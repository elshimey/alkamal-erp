import type { ReactNode } from "react";
import { fmt } from "@/lib/format";

// أجزاء نافذة الإضافة على طريقة وافق: أقسام تنطوي وتنفتح، وحقول عنوانها بجانبها.
// النافذة (RecordPanel) تقرأ الأقسام من data-panel-section فتبني الفهرس الجانبي وعلامة ✓ لكل قسم اكتمل،
// وتقرأ الحقول من data-pf فتضع ✓ بجانب عنوان كل خانة صحيحة.

/** قسم في النافذة: «مطلوب» مفتوح دائماً، و«اختياري» ينطوي ويُفتح بالضغط على عنوانه. */
export function PanelSection({ title, optional = false, open, children, hint }: { title: string; optional?: boolean; open?: boolean; children: ReactNode; hint?: string }) {
  return (
    <details
      open={open ?? !optional}
      data-panel-section={title}
      data-optional={optional ? "1" : undefined}
      className="panel-sec group mb-4 scroll-mt-16 rounded-2xl border border-black/[0.06] bg-white shadow-sm transition-[border-color,box-shadow] duration-300"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-2xl bg-gray-50/80 px-5 py-3 select-none group-open:rounded-b-none">
        <span className="font-display font-semibold text-gray-900">{title}</span>
        <span className="text-xs text-gray-500">{optional ? "اختياري" : "مطلوب"}</span>
        {hint && <span className="hidden text-xs text-gray-400 sm:inline">· {hint}</span>}
        <svg viewBox="0 0 24 24" className="ms-auto size-4 text-gray-500 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="@container flex flex-col gap-3 px-5 py-4">{children}</div>
    </details>
  );
}

/** علامة ✓ تظهر بنبضة حين تكون الخانة معبأة وصحيحة (تتحكم بها النافذة عبر data-ok). */
export function OkMark() {
  return (
    <span aria-hidden className="pf-ok ms-1 inline-grid size-4 place-items-center rounded-full bg-emerald-600 align-middle text-white">
      <svg viewBox="0 0 24 24" className="size-2.5" fill="none" stroke="currentColor" strokeWidth={3.4}>
        <path d="m5 12 5 5 9-10" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

/** حقل بعنوانه في عمود جانبي حين يتسع القسم، وفوقه حين يضيق (الجوال، نصف الشاشة، بجانب المعاينة). */
export function PanelField({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: ReactNode }) {
  return (
    <label data-pf="" data-req={required ? "1" : undefined} className="pf grid items-center gap-1.5 text-sm @md:grid-cols-[11rem_minmax(0,1fr)] @md:gap-4">
      <span className="font-medium text-gray-700 transition-colors">
        {label}
        {required && <span className="text-red-600">*</span>}
        <OkMark />
        {hint && <span className="block text-[11px] font-normal text-gray-400">{hint}</span>}
      </span>
      {/* الخانة لا تتجاوز عرض الشاشة على الجوال */}
      <span className="min-w-0 [&>input]:max-w-full [&>select]:max-w-full [&>textarea]:max-w-full">{children}</span>
    </label>
  );
}

/** اختيار من خيارين أو ثلاثة بأزرار متجاورة وخلفية تنزلق للمختار (على من؟ دُفعت؟…). */
export function Segmented<T extends string>({ value, options, onChange, label, tone }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string; tone?: (v: T) => "brand" | "amber" | "green" | "plain" }) {
  const i = Math.max(0, options.findIndex((o) => o.value === value));
  const t = tone?.(value) ?? "plain";
  const bg = t === "brand" ? "bg-brand-100" : t === "amber" ? "bg-amber-100" : t === "green" ? "bg-emerald-100" : "bg-white";
  return (
    <div role="radiogroup" aria-label={label} className="relative inline-grid rounded-xl border border-gray-200 bg-gray-100 p-0.5" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      <span aria-hidden className={`absolute inset-y-0.5 rounded-[10px] shadow-sm transition-all duration-300 ease-out ${bg}`} style={{ width: `calc((100% - 4px) / ${options.length})`, insetInlineStart: `calc(2px + ${i} * (100% - 4px) / ${options.length})` }} />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={`relative z-[1] rounded-[10px] px-3 py-1.5 text-xs whitespace-nowrap transition-colors ${o.value === value ? "font-semibold text-gray-900" : "text-gray-500 hover:text-gray-800"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** مجاميع المستند تحت الفهرس الجانبي؛ الأخير بخط أكبر. */
export function PanelTotals({ rows }: { rows: [string, number][] }) {
  return (
    <div className="grid gap-1.5 rounded-xl border border-black/[0.06] bg-white p-3 text-xs text-gray-600 shadow-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-2">
          <span>{k}</span>
          <b key={v} className="saved-pop ltr-nums font-semibold text-gray-900">{fmt(v)}</b>
        </div>
      ))}
    </div>
  );
}
