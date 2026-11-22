"use client";

import { useEffect, useRef, useState, type ClipboardEvent } from "react";
import { Icon } from "./icons";
import { fmt } from "@/lib/format";
import type { QuickKind } from "@/lib/quick-add-types";
import { useNarrow } from "@/lib/use-narrow";
import { ComboBox, useCreatedOptions } from "./combo-box";

// محرر سطور مستند (طلب شراء، أمر شراء، عرض سعر): إضافة وحذف ولصق من Excel، والإجمالي مباشرة.
// السطور تُرسل مع النموذج كنص JSON في حقل مخفي.

export interface LineOption {
  value: string;
  label: string;
  code?: string;
  group?: string;
  groupCode?: string;
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
  // زر «+ إضافة» في القائمة (مسار، صنف…)
  create?: QuickKind;
  // في عرض البطاقات: الخانة تأخذ عرض البطاقة كله (الصنف، الحساب، البيان)
  wide?: boolean;
}
type Row = Record<string, string>;

const toNum = (v: string | undefined) => {
  const n = Number((v ?? "").replace(/[,\s]/g, "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))));
  return Number.isFinite(n) ? n : 0;
};
const cell =
  "h-9 w-full rounded-md border border-gray-200 bg-white px-2 text-sm transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none";

export function LinesEditor({
  columns: baseColumns,
  initial,
  name = "lines",
  totals,
  minRows = 3,
  onChange,
  totalsVat,
  vatRateOf,
  layout = "table",
  addLabel = "+ سطر",
}: {
  columns: LineColumn[];
  initial?: Row[];
  name?: string;
  // مفاتيح الكمية والسعر ونسبة الضريبة لحساب الإجمالي (دون كمية: السعر هو مبلغ السطر)
  totals?: { qty?: string; price: string; vat?: string };
  minRows?: number;
  /** يُبلَّغ بالسطور المستخدمة بعد كل تعديل (للمعاينة المباشرة) */
  onChange?: (rows: Row[]) => void;
  /** نسبة الضريبة حين تكون خانة الضريبة في السطر فارغة («حسب نوع الشحن») */
  totalsVat?: number;
  /** نسبة ضريبة السطر حين تكون خانته نوع ضريبة لا نسبة (رقم النوع ← نسبته) */
  vatRateOf?: (row: Row) => number;
  /** «cards»: كل سطر بطاقة بخانات معنونة (فاتورة المورد). على الجوال البطاقات دائماً حتى لا تتداخل الخانات */
  layout?: "table" | "cards";
  addLabel?: string;
}) {
  const narrow = useNarrow();
  const cards = layout === "cards" || narrow;
  const withCreated = useCreatedOptions();
  const columns = baseColumns.map((c) => (c.create ? { ...c, options: withCreated(c.create, c.options) } : c));
  const empty = (): Row => Object.fromEntries(columns.map((c) => [c.key, c.defaultValue ?? (c.type === "select" && c.options?.length === 1 ? c.options[0].value : "")]));
  const start = () => {
    const base = initial?.length ? initial : [];
    return [...base, ...Array.from({ length: Math.max(0, minRows - base.length) }, empty)];
  };
  const [first] = useState<Row[]>(start);
  const [rows, setRows] = useState<Row[]>(first);
  // تفريغ النموذج («حفظ وإضافة أخرى») يعيد السطور لبدايتها
  const hidden = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const form = hidden.current?.form;
    const reset = () => setRows(first);
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, [first]);
  const set = (n: number, key: string, value: string, picked?: Record<string, string>) =>
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== n) return r;
        const col = columns.find((c) => c.key === key);
        const fill = picked ?? col?.options?.find((o) => o.value === value)?.fill ?? {};
        // التعبئة لا تكتب فوق ما أدخله المستخدم
        const patch = Object.fromEntries(Object.entries(fill).filter(([k]) => !r[k]?.trim()));
        return { ...r, ...patch, [key]: value };
      }),
    );
  // السطر المستخدم: فيه قيمة تختلف عن قيمته الأولية
  const blank = empty();
  const filled = rows.filter((r) => columns.some((c) => (r[c.key] ?? "").trim() && r[c.key] !== blank[c.key]));

  const json = JSON.stringify(filled);
  const report = useRef(onChange);
  useEffect(() => {
    report.current = onChange;
  });
  useEffect(() => {
    report.current?.(JSON.parse(json));
  }, [json]);

  const lineTotal = (r: Row) => (totals ? (totals.qty ? toNum(r[totals.qty]) : 1) * toNum(r[totals.price]) : 0);
  const sub = rows.reduce((t, r) => t + lineTotal(r), 0);
  const rate = (r: Row) => (vatRateOf ? vatRateOf(r) : (r[totals!.vat!] ?? "") === "" && totalsVat !== undefined ? totalsVat : toNum(r[totals!.vat!]));
  const vat = totals?.vat ? rows.reduce((t, r) => t + (lineTotal(r) * rate(r)) / 100, 0) : 0;

  const onPaste = (n: number, start: number) => (e: ClipboardEvent<HTMLElement>) => {
    if (!e.currentTarget.contains(e.target as Node)) return;
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
          row[col.key] = col.type === "select" ? (col.options?.find((o) => o.value === t || o.code === t || o.label === t || o.label.includes(t))?.value ?? "") : t;
        });
        next[n + gi] = row;
      });
      return next;
    });
  };

  const control = (r: Row, n: number, c: LineColumn, label?: string) =>
    c.type === "select" ? (
      <ComboBox value={r[c.key] ?? ""} options={c.options ?? []} create={c.create} placeholder={c.placeholder ?? "ابحث…"} onChange={(v, o) => set(n, c.key, v, o?.fill)} className={cell} />
    ) : (
      <input
        value={r[c.key] ?? ""}
        onChange={(e) => set(n, c.key, e.target.value)}
        inputMode={c.type === "number" ? "decimal" : undefined}
        placeholder={c.placeholder}
        aria-label={label}
        className={`${cell} ${c.type === "number" ? "ltr-nums text-end" : ""}`}
      />
    );
  const remove = (n: number) => setRows(rows.filter((_, i) => i !== n));

  // أقل عرض للجدول = مجموع أعمدته (والوصف 10rem على الأقل)، فإن ضاق المكان يُمرَّر الجدول أفقياً بدل أن تنضغط الخانات
  const minRem = 4 + (totals ? 7 : 0) + columns.reduce((sum, c) => sum + (c.width?.endsWith("rem") ? parseFloat(c.width) : 10), 0);

  return (
    <div>
      <input ref={hidden} type="hidden" name={name} value={json} />
      {cards ? (
        <div className="space-y-3" data-line-cards>
          {rows.map((r, n) => (
            <div key={n} className="rounded-xl border border-gray-200 bg-gray-50/60 p-3" data-line-card>
              <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
                <span>البند {n + 1}</span>
                {rows.length > 1 && (
                  <button type="button" onClick={() => remove(n)} className="rounded px-1.5 py-0.5 text-red-600 hover:bg-red-50">
                    حذف
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-x-2 gap-y-2.5 sm:grid-cols-4">
                {columns.map((c) => (
                  <label key={c.key} className={`block min-w-0 text-xs text-gray-500 ${c.wide ? "col-span-2" : ""}`}>
                    <span className="mb-1 block">
                      {c.label}
                      {c.required && <span className="text-red-500"> *</span>}
                    </span>
                    {control(r, n, c, c.label)}
                  </label>
                ))}
              </div>
              {totals?.qty && lineTotal(r) > 0 && <div className="ltr-nums mt-2 text-end text-sm font-medium">{fmt(lineTotal(r))}</div>}
            </div>
          ))}
        </div>
      ) : (
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth: `${Math.max(44, minRem)}rem` }}>
          <thead className="border-b border-gray-200 text-xs text-gray-500">
            <tr>
              <th className="w-8 py-2" />
              {columns.map((c) => (
                <th key={c.key} className="px-1 py-2 text-start font-medium" style={c.width ? { width: c.width } : { minWidth: "10rem" }}>
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
                    {control(r, n, c)}
                  </td>
                ))}
                {totals && <td className="ltr-nums px-1 text-end font-medium">{lineTotal(r) ? fmt(lineTotal(r)) : "—"}</td>}
                <td className="px-1">
                  {rows.length > 1 && (
                    <button type="button" aria-label="حذف السطر" onClick={() => remove(n)} className="p-1 text-gray-300 hover:text-red-600">
                      <Icon name="close" className="size-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <button type="button" onClick={() => setRows([...rows, empty()])} className={cards ? "w-full rounded-lg border border-dashed border-brand-500 bg-brand-50/60 px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50" : "rounded-lg px-2 py-1 text-sm font-medium text-brand-700 hover:bg-brand-50"}>
          {addLabel}
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
