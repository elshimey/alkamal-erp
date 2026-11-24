"use client";

import { useMemo, useState } from "react";

/**
 * اختيار عدة عناصر بمربعات تحديد داخل قائمة منسدلة (فلتر تقرير): بحث، و«تحديد الكل» و«مسح».
 * القيمة في حقل مخفي واحد باسم name مفصولة بفواصل (1,4,9)، والفارغ = الكل.
 */
export function MultiCheck({
  name,
  options,
  defaultValue = [],
  allLabel,
  noun,
}: {
  name: string;
  options: { value: string; label: string }[];
  defaultValue?: string[];
  /** ما يظهر حين لا يُختار شيء، مثل «كل المركبات» */
  allLabel: string;
  /** اسم العدد، مثل «مركبة» */
  noun: string;
}) {
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(defaultValue));
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const t = q.trim();
    return t ? options.filter((o) => o.label.includes(t)) : options;
  }, [options, q]);
  const toggle = (v: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  const names = options.filter((o) => chosen.has(o.value)).map((o) => o.label);
  const summary = names.length === 0 ? allLabel : names.length <= 2 ? names.join("، ") : `${names.length} ${noun} محددة`;

  return (
    <details data-dropdown className="relative">
      <input type="hidden" name={name} value={[...chosen].join(",")} />
      <summary className="flex w-full cursor-pointer list-none items-center justify-between gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800">
        <span className={`truncate ${names.length ? "font-medium" : "text-gray-500"}`}>{summary}</span>
        <span aria-hidden className="text-xs text-gray-400">▾</span>
      </summary>
      <div className="absolute start-0 top-full z-40 mt-1 flex w-72 max-w-[calc(100vw-2rem)] flex-col rounded-xl border border-gray-200 bg-white p-2 shadow-lg">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
          placeholder="اكتب للبحث…"
          aria-label={`بحث في ${allLabel}`}
          className="mb-2 rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm"
        />
        <div className="mb-1 flex items-center justify-between gap-2 px-1 text-xs">
          <button type="button" onClick={() => setChosen((p) => new Set([...p, ...shown.map((o) => o.value)]))} className="text-brand-700 hover:underline">
            تحديد {q.trim() ? "الظاهر" : "الكل"}
          </button>
          <span className="text-gray-500">
            المحدد <b className="ltr-nums">{chosen.size}</b>
          </span>
          <button type="button" onClick={() => setChosen(new Set())} className="text-gray-600 hover:underline">
            مسح
          </button>
        </div>
        <div className="max-h-64 overflow-y-auto">
          {shown.length === 0 && <p className="px-2 py-3 text-center text-xs text-gray-500">لا نتائج</p>}
          {shown.map((o) => (
            <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-brand-50">
              <input type="checkbox" checked={chosen.has(o.value)} onChange={() => toggle(o.value)} className="size-4 accent-brand-600" />
              <span className="truncate">{o.label}</span>
            </label>
          ))}
        </div>
      </div>
    </details>
  );
}
