"use client";

import { useState, type ClipboardEvent } from "react";
import { Icon } from "./icons";

// محرر سطور مستند (طلب شراء، أمر شراء، عرض سعر): إضافة وحذف ولصق من Excel، والإجمالي مباشرة.
// السطور تُرسل مع النموذج كنص JSON في حقل مخفي.

export interface LineOption {
  value: string;
  label: string;
  // قيم تُملأ في السطر عند اختيار هذا الخيار (مثل وصف الصنف وسعره)
  fill?: Record<string, string>;
}
export interface LineColumn {
  key: string;
  label: string;
  type?: "text" | "number" | "select";
  options?: LineOption[];
  placeholder?: string;
  width?: string;
  required?: boolean;
  // القيمة الأولية في السطر الجديد (مثل نسبة الضريبة 15)
  defaultValue?: string;
}
type Row = Record<string, string>;

const toNum = (v: string | undefined) => {
  const n = Number((v ?? "").replace(/[,\s]/g, "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))));
  return Number.isFinite(n) ? n : 0;
};
const fmt = (v: number) => v.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cell =
  "h-9 w-full rounded-md border border-gray-200 bg-white px-2 text-sm transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none";

export function LinesEditor({
  columns,
  initial,
  name = "lines",
  totals,
  minRows = 3,
}: {
  columns: LineColumn[];
  initial?: Row[];
  name?: string;
  // مفاتيح الكمية والسعر ونسبة الضريبة لحساب الإجمالي
  totals?: { qty: string; price: string; vat?: string };
  minRows?: number;
}) {
  const empty = (): Row => Object.fromEntries(columns.map((c) => [c.key, c.defaultValue ?? (c.type === "select" && c.options?.length === 1 ? c.options[0].value : "")]));
  const [rows, setRows] = useState<Row[]>(() => {
    const base = initial?.length ? initial : [];
    return [...base, ...Array.from({ length: Math.max(0, minRows - base.length) }, empty)];
  });
  const set = (n: number, key: string, value: string) =>
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== n) return r;
        const col = columns.find((c) => c.key === key);
        const fill = col?.options?.find((o) => o.value === value)?.fill ?? {};
        // التعبئة لا تكتب فوق ما أدخله المستخدم
        const patch = Object.fromEntries(Object.entries(fill).filter(([k]) => !r[k]?.trim()));
        return { ...r, ...patch, [key]: value };
      }),
    );
  // السطر المستخدم: فيه قيمة تختلف عن قيمته الأولية
  const blank = empty();
  const filled = rows.filter((r) => columns.some((c) => (r[c.key] ?? "").trim() && r[c.key] !== blank[c.key]));

  const lineTotal = (r: Row) => (totals ? toNum(r[totals.qty]) * toNum(r[totals.price]) : 0);
  const sub = rows.reduce((t, r) => t + lineTotal(r), 0);
  const vat = totals?.vat ? rows.reduce((t, r) => t + (lineTotal(r) * toNum(r[totals.vat!])) / 100, 0) : 0;

  const onPaste = (n: number, start: number) => (e: ClipboardEvent<HTMLElement>) => {
    const text = e.clipboardData.getData("text");
    if (!text.includes("\t") && !text.includes("\n")) return;
    e.preventDefault();
    const grid = text.replace(/\r/g, "").split("\n").filter((x) => x.trim()).map((x) => x.split("\t"));
    setRows((prev) => {
      const next = [...prev];
      grid.forEach((vals, gi) => {
        const row = { ...(next[n + gi] ?? empty()) };
        vals.forEach((v, vi) => {
          const col = columns[start + vi];
          if (!col) return;
          const t = v.trim();
          row[col.key] = col.type === "select" ? (col.options?.find((o) => o.value === t || o.label === t || o.label.includes(t))?.value ?? "") : t;
        });
        next[n + gi] = row;
      });
      return next;
    });
  };

  return (
    <div>
      <input type="hidden" name={name} value={JSON.stringify(filled)} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] text-sm">
          <thead className="border-b border-gray-200 text-xs text-gray-500">
            <tr>
              <th className="w-8 py-2" />
              {columns.map((c) => (
                <th key={c.key} className="px-1 py-2 text-start font-medium" style={c.width ? { width: c.width } : undefined}>
                  {c.label}
                  {c.required && <span className="text-red-500">*</span>}
                </th>
              ))}
              {totals && <th className="w-28 px-1 py-2 text-end font-medium">الإجمالي</th>}
              <th className="w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r, n) => (
              <tr key={n} className="group">
                <td className="ltr-nums py-1 text-center text-xs text-gray-400">{n + 1}</td>
                {columns.map((c, ci) => (
                  <td key={c.key} className="px-1 py-1" onPaste={onPaste(n, ci)}>
                    {c.type === "select" ? (
                      <select value={r[c.key] ?? ""} onChange={(e) => set(n, c.key, e.target.value)} className={cell}>
                        <option value="">{c.placeholder ?? "—"}</option>
                        {c.options?.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        value={r[c.key] ?? ""}
                        onChange={(e) => set(n, c.key, e.target.value)}
                        inputMode={c.type === "number" ? "decimal" : undefined}
                        placeholder={c.placeholder}
                        className={`${cell} ${c.type === "number" ? "ltr-nums text-end" : ""}`}
                      />
                    )}
                  </td>
                ))}
                {totals && <td className="ltr-nums px-1 text-end font-medium">{lineTotal(r) ? fmt(lineTotal(r)) : "—"}</td>}
                <td className="px-1">
                  {rows.length > 1 && (
                    <button type="button" aria-label="حذف السطر" onClick={() => setRows(rows.filter((_, i) => i !== n))} className="p-1 text-gray-300 hover:text-red-600">
                      <Icon name="close" className="size-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <button type="button" onClick={() => setRows([...rows, empty()])} className="rounded-lg px-2 py-1 text-sm font-medium text-brand-700 hover:bg-brand-50">
          + سطر
        </button>
        {totals && (
          <dl className="ltr-nums grid min-w-56 grid-cols-2 gap-x-6 gap-y-1 text-sm">
            <dt className="text-gray-500">قبل الضريبة</dt>
            <dd className="text-end">{fmt(sub)}</dd>
            {totals.vat && (
              <>
                <dt className="text-gray-500">الضريبة</dt>
                <dd className="text-end">{fmt(vat)}</dd>
              </>
            )}
            <dt className="font-semibold">الإجمالي</dt>
            <dd className="text-end font-semibold">{fmt(sub + vat)}</dd>
          </dl>
        )}
      </div>
    </div>
  );
}
