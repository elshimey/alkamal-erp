"use client";

// شيت إدخال على طريقة وافق: تكتب الصفوف مباشرة أو تلصقها من Excel، ثم تحفظ الكل دفعة واحدة.
// الصفوف المحفوظة تُزال، والصفوف المرفوضة تبقى مع سبب الرفض لتصحيحها.

import { useRef, useState, useTransition, type ClipboardEvent, type KeyboardEvent } from "react";
import { parseDelimited, toCsv, type SheetResult } from "@/lib/sheet";

export interface SheetColumn {
  key: string;
  label: string;
  type?: "text" | "number" | "date" | "select";
  options?: { value: string; label: string }[];
  required?: boolean;
  ltr?: boolean;
  width?: string;
  placeholder?: string;
}

type Row = Record<string, string>;

const emptyRow = (columns: SheetColumn[]): Row => Object.fromEntries(columns.map((c) => [c.key, ""]));
const isEmpty = (row: Row) => Object.values(row).every((v) => !v.trim());

/** يحوّل النص الملصوق إلى قيمة العمود؛ في القوائم يقبل الاسم الظاهر أو القيمة. */
function normalize(col: SheetColumn, raw: string) {
  const v = raw.trim();
  if (col.type === "select" && v) {
    const hit = col.options?.find((o) => o.value === v || o.label === v);
    return hit ? hit.value : v;
  }
  if (col.type === "number") return v.replace(/[,\s]/g, "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  return v;
}

export function SheetEditor({
  columns,
  action,
  templateName,
  initialRows = 5,
}: {
  columns: SheetColumn[];
  action: (rows: Row[]) => Promise<SheetResult>;
  templateName: string;
  initialRows?: number;
}) {
  const [rows, setRows] = useState<Row[]>(() => Array.from({ length: initialRows }, () => emptyRow(columns)));
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [message, setMessage] = useState<{ ok?: string; error?: string }>({});
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);

  const setCell = (r: number, key: string, value: string) =>
    setRows((prev) => prev.map((row, i) => (i === r ? { ...row, [key]: value } : row)));

  /** يملأ الشيت من جدول ملصوق ابتداءً من الخلية (r, c)، ويضيف صفوفاً عند الحاجة. */
  const fillFrom = (r: number, c: number, grid: string[][]) =>
    setRows((prev) => {
      const next = prev.map((row) => ({ ...row }));
      grid.forEach((cells, i) => {
        if (!next[r + i]) next[r + i] = emptyRow(columns);
        cells.forEach((cell, j) => {
          const col = columns[c + j];
          if (col) next[r + i][col.key] = normalize(col, cell);
        });
      });
      return next;
    });

  const onPaste = (e: ClipboardEvent, r: number, c: number) => {
    const text = e.clipboardData.getData("text/plain");
    if (!/[\t\n]/.test(text.trim())) return; // قيمة واحدة: لصق عادي
    e.preventDefault();
    fillFrom(r, c, parseDelimited(text, "\t"));
  };

  // التنقل بالأسهم و Enter بين الخلايا كما في الشيت
  const onKeyDown = (e: KeyboardEvent, r: number, c: number) => {
    const moves: Record<string, [number, number]> = { ArrowDown: [1, 0], ArrowUp: [-1, 0], Enter: [1, 0] };
    const m = moves[e.key];
    if (!m) return;
    const target = tableRef.current?.querySelector<HTMLElement>(`[data-cell="${r + m[0]}-${c + m[1]}"]`);
    if (target) {
      e.preventDefault();
      target.focus();
    } else if (e.key === "Enter" && r === rows.length - 1) {
      e.preventDefault();
      setRows((prev) => [...prev, emptyRow(columns)]);
    }
  };

  const downloadTemplate = () => {
    const blob = new Blob(["﻿" + toCsv([columns.map((c) => c.label)])], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `قالب-${templateName}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importFile = async (file: File) => {
    const text = (await file.text()).replace(/^﻿/, "");
    const grid = parseDelimited(text, text.includes("\t") ? "\t" : ",");
    if (!grid.length) return;
    // الصف الأول عناوين: نرتّب الأعمدة حسبها، فلا يلزم أن تطابق ترتيب الشيت
    const header = grid[0].map((h) => h.trim());
    const index = columns.map((c) => header.findIndex((h) => h === c.label || h === c.key));
    if (index.every((i) => i < 0)) {
      setMessage({ error: "عناوين الملف لا تطابق أعمدة الشيت؛ استخدم القالب" });
      return;
    }
    const imported = grid.slice(1).map((cells) =>
      Object.fromEntries(columns.map((c, j) => [c.key, index[j] >= 0 ? normalize(c, cells[index[j]] ?? "") : ""])),
    );
    setRows((prev) => [...prev.filter((r) => !isEmpty(r)), ...imported.filter((r) => !isEmpty(r))]);
    setErrors({});
    setMessage({ ok: `صفوف مقروءة من الملف: ${imported.length}؛ راجعها ثم اضغط «حفظ الكل»` });
  };

  const save = () => {
    const filled = rows.map((row, i) => ({ row, i })).filter(({ row }) => !isEmpty(row));
    if (!filled.length) {
      setMessage({ error: "الشيت فارغ" });
      return;
    }
    startTransition(async () => {
      const result = await action(filled.map((f) => f.row));
      const failed = new Set(Object.keys(result.rowErrors ?? {}).map(Number));
      const keep = filled.filter((_, k) => failed.has(k));
      const nextErrors: Record<number, string> = {};
      keep.forEach((_, k) => (nextErrors[k] = result.rowErrors![[...failed][k]]));
      setRows(keep.length ? [...keep.map((f) => f.row), emptyRow(columns)] : Array.from({ length: initialRows }, () => emptyRow(columns)));
      setErrors(nextErrors);
      setMessage({
        ok: result.saved ? `تم حفظ الصفوف: ${result.saved}` : undefined,
        error: result.error ?? (failed.size ? `صفوف لم تُحفظ: ${failed.size}؛ السبب تحت الشيت` : undefined),
      });
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button type="button" onClick={save} disabled={pending} className="rounded-lg bg-brand-600 px-4 py-2 font-semibold text-brand-900 hover:bg-brand-500 disabled:opacity-60">
          {pending ? "جارٍ الحفظ…" : "حفظ الكل"}
        </button>
        <button type="button" onClick={() => setRows((p) => [...p, ...Array.from({ length: 5 }, () => emptyRow(columns))])} className="rounded-lg border border-gray-300 bg-white px-3 py-2 hover:bg-gray-50">
          + 5 صفوف
        </button>
        <button type="button" onClick={downloadTemplate} className="rounded-lg border border-gray-300 bg-white px-3 py-2 hover:bg-gray-50">
          تنزيل القالب
        </button>
        <button type="button" onClick={() => fileRef.current?.click()} className="rounded-lg border border-gray-300 bg-white px-3 py-2 hover:bg-gray-50">
          استيراد ملف
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.txt"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importFile(f);
            e.target.value = "";
          }}
        />
        <span className="text-xs text-gray-400">انسخ الصفوف من Excel والصقها في أي خلية</span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table ref={tableRef} className="w-full border-collapse text-sm">
          <thead className="bg-gray-50 text-xs text-gray-600">
            <tr>
              <th className="w-10 border-b border-gray-200 px-2 py-2">#</th>
              {columns.map((c) => (
                <th key={c.key} className="border-b border-s border-gray-200 px-2 py-2 text-start font-medium whitespace-nowrap" style={{ minWidth: c.width ?? "8rem" }}>
                  {c.label}
                  {c.required && <span className="text-red-500"> *</span>}
                </th>
              ))}
              <th className="w-8 border-b border-gray-200" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r} className={errors[r] ? "bg-red-50/60" : ""}>
                <td className="border-b border-gray-100 px-2 text-center text-xs text-gray-400">{r + 1}</td>
                {columns.map((col, c) => {
                  const common = {
                    "data-cell": `${r}-${c}`,
                    value: row[col.key] ?? "",
                    onPaste: (e: ClipboardEvent) => onPaste(e, r, c),
                    onKeyDown: (e: KeyboardEvent) => onKeyDown(e, r, c),
                    className: "w-full bg-transparent px-2 py-1.5 outline-none focus:bg-brand-50",
                    "aria-label": `${col.label} — صف ${r + 1}`,
                  };
                  return (
                    <td key={col.key} className="border-b border-s border-gray-100 p-0">
                      {col.type === "select" ? (
                        <select {...common} onChange={(e) => setCell(r, col.key, e.target.value)}>
                          <option value="" />
                          {col.options?.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          {...common}
                          type={col.type === "date" ? "date" : "text"}
                          inputMode={col.type === "number" ? "decimal" : undefined}
                          dir={col.ltr || col.type === "number" ? "ltr" : undefined}
                          placeholder={r === 0 ? col.placeholder : undefined}
                          onChange={(e) => setCell(r, col.key, e.target.value)}
                        />
                      )}
                    </td>
                  );
                })}
                <td className="border-b border-gray-100 text-center">
                  <button type="button" aria-label="حذف الصف" onClick={() => setRows((p) => p.filter((_, i) => i !== r))} className="px-2 text-gray-300 hover:text-red-600">
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {Object.keys(errors).length > 0 && (
        <ul className="list-inside list-disc rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
          {Object.entries(errors).map(([r, e]) => (
            <li key={r}>
              الصف {Number(r) + 1}: {e}
            </li>
          ))}
        </ul>
      )}
      {message.error && Object.keys(errors).length === 0 && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{message.error}</p>}
      {message.ok && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{message.ok}</p>}
    </div>
  );
}
