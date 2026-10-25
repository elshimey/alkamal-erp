"use client";

// شيت إدخال على طريقة وافق: تكتب الصفوف مباشرة أو تلصقها من Excel، ثم تحفظ الكل دفعة واحدة.
// الصفوف المحفوظة تُزال، والصفوف المرفوضة تبقى مع سبب الرفض لتصحيحها.

import { useRef, useState, useTransition } from "react";
import { Truck } from "./icons";
import { DataGrid, emptyGridRow, GRID_HINT, isEmptyGridRow, normalizeCell, useGridHistory, type GridColumn } from "./data-grid";
import { parseDelimited, toCsv, type SheetResult } from "@/lib/sheet";
import { useUnsavedGuard } from "./unsaved-guard";

export type SheetColumn = GridColumn;

type Row = Record<string, string>;

const emptyRow = emptyGridRow;
const isEmpty = isEmptyGridRow;
const normalize = normalizeCell;

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
  const history = useGridHistory(() => Array.from({ length: initialRows }, () => emptyRow(columns)));
  const rows = history.rows;
  const setRows = history.set;
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [message, setMessage] = useState<{ ok?: string; error?: string }>({});
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  // صفوف مكتوبة لم تُحفظ: سؤال قبل مغادرة الصفحة
  useUnsavedGuard(rows.some((r) => !isEmpty(r)));

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
      history.reset(keep.length ? [...keep.map((f) => f.row), emptyRow(columns)] : Array.from({ length: initialRows }, () => emptyRow(columns)));
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
          {pending ? (
            <span className="flex items-center gap-2">
              <Truck className="w-7" spinning />
              جارٍ الحفظ…
            </span>
          ) : (
            "حفظ الكل"
          )}
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
        <button type="button" onClick={history.undo} disabled={!history.canUndo} className="rounded-lg border border-gray-300 bg-white px-3 py-2 hover:bg-gray-50 disabled:opacity-40">
          تراجع
        </button>
        <span className="text-xs text-gray-400">الصق من Excel في أي خلية. {GRID_HINT}</span>
      </div>
      <DataGrid
        columns={columns}
        rows={rows}
        onChange={setRows}
        onUndo={history.undo}
        onRedo={history.redo}
        onAppendRow={() => setRows((p) => [...p, emptyRow(columns)])}
        rowClass={(r) => (errors[r] ? "bg-red-50/60" : "")}
        rowEnd={(r) => (
          <button type="button" aria-label="حذف الصف" onClick={() => setRows((p) => p.filter((_, i) => i !== r))} className="px-2 text-gray-300 hover:text-red-600">
            ×
          </button>
        )}
      />
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
