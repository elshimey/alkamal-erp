"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useTransition } from "react";
import { PAY_FILTERS, PERIODS, SORTS, listHref, type DocListParams } from "@/lib/doc-filters";
import { ExportButton } from "@/components/export-button";
import { Icon } from "@/components/icons";

const selectCls =
  "h-9 rounded-lg border border-gray-200 bg-white ps-2.5 pe-7 text-sm text-gray-700 shadow-sm transition hover:border-gray-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none";

/** شريط قائمة الفواتير: بحث فوري، فترة، حالة، سداد، ترتيب، وتبديل الجدول/الورقة. */
export function DocToolbar({
  base,
  params,
  statuses,
  exportName,
  count,
  noun = "فاتورة",
  allStatuses = "كل الحالات",
  pay = true,
  sorts = SORTS,
  views = true,
  period = true,
  placeholder = "ابحث بالرقم أو الاسم",
  exportable = true,
  extra,
}: {
  base: string;
  params: DocListParams;
  statuses: Record<string, string>;
  exportName: string;
  count: number;
  noun?: string;
  allStatuses?: string;
  pay?: boolean;
  sorts?: Record<string, string>;
  views?: boolean;
  period?: boolean;
  placeholder?: string;
  /** زر «تصدير» (CSV للجدول الظاهر)؛ يُخفى حين تملك الصفحة قائمة تصدير خاصة */
  exportable?: boolean;
  /** عناصر إضافية بجانب التبديل (قائمة ⋮ مثلاً) */
  extra?: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const go = (patch: Partial<Record<keyof DocListParams, string | undefined>>) =>
    start(() => router.replace(listHref(base, params, { ...patch, open: patch.open ?? (patch.view ? undefined : params.open) }), { scroll: false }));
  const view = params.view === "sheet" ? "sheet" : "table";
  const filtered = !!(params.q || params.status || params.pay || (params.period && params.period !== "all"));

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
      <label className="relative min-w-48 flex-1 sm:max-w-60">
        <span className="pointer-events-none absolute inset-y-0 start-2.5 flex items-center text-gray-400">
          <Icon name="search" className="size-4" />
        </span>
        <input
          type="search"
          defaultValue={params.q}
          placeholder={placeholder}
          className="h-9 w-full rounded-lg border border-gray-200 bg-white ps-8 pe-3 text-sm shadow-sm transition placeholder:text-gray-400 hover:border-gray-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
          onChange={(e) => {
            const q = e.currentTarget.value;
            clearTimeout(timer.current);
            timer.current = setTimeout(() => go({ q: q.trim() || undefined }), 350);
          }}
        />
      </label>
      {period && (
        <select aria-label="الفترة" className={selectCls} value={params.period ?? "all"} onChange={(e) => go({ period: e.target.value === "all" ? undefined : e.target.value })}>
          {Object.entries(PERIODS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      )}
      {Object.keys(statuses).length > 0 && (
        <select aria-label="الحالة" className={selectCls} value={params.status ?? ""} onChange={(e) => go({ status: e.target.value || undefined })}>
          <option value="">{allStatuses}</option>
          {Object.entries(statuses).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      )}
      {pay && (
        <select aria-label="السداد" className={selectCls} value={params.pay ?? ""} onChange={(e) => go({ pay: e.target.value || undefined })}>
          <option value="">كل حالات السداد</option>
          {Object.entries(PAY_FILTERS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      )}
{Object.keys(sorts).length > 1 && (
              <select aria-label="الترتيب" className={selectCls} value={params.sort ?? Object.keys(sorts)[0]} onChange={(e) => go({ sort: e.target.value === Object.keys(sorts)[0] ? undefined : e.target.value })}>
        {Object.entries(sorts).map(([k, v]) => (
          <option key={k} value={k}>
            ترتيب: {v}
          </option>
        ))}
      </select>
      )}
      {filtered && (
        <Link href={listHref(base, { view: params.view }, {})} scroll={false} className="text-xs text-brand-700 hover:underline">
          مسح الفلاتر
        </Link>
      )}
      <span className={`ltr-nums text-xs text-gray-400 transition ${pending ? "animate-pulse" : ""}`}>{count} {noun}</span>

      <div className="ms-auto flex items-center gap-2">
        {views && <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 text-sm shadow-sm" role="tablist">
          {(
            [
              ["table", "الجدول", "list"],
              ["sheet", "الورقة", "grid"],
            ] as const
          ).map(([k, label, icon]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={view === k}
              onClick={() => go({ view: k === "table" ? undefined : k })}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 transition ${view === k ? "bg-white font-semibold text-brand-900 shadow-sm" : "text-gray-500 hover:text-gray-800"}`}
            >
              <Icon name={icon} className="size-4" />
              {label}
            </button>
          ))}
        </div>}
        {exportable && <ExportButton filename={exportName} label="تصدير" />}
        {extra}
      </div>
    </div>
  );
}
