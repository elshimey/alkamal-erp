"use client";

// شبكة خلايا على طريقة Excel، يشترك فيها شيت الإضافة وشيت التعديل الجماعي:
// تحديد مجموعة خلايا بالسحب أو Shift، نسخ ولصق داخل الشيت ومن Excel وإليه،
// ملء لأسفل (Ctrl+D)، مسح التحديد (Delete)، تراجع وإعادة (Ctrl+Z / Ctrl+Y).

import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from "react";
import { parseDelimited } from "@/lib/sheet";
import type { QuickKind } from "@/lib/quick-add-types";
import { ComboBox, useCreatedOptions } from "./combo-box";
import { isoToDmy } from "@/components/date-input";

export interface GridColumn {
  key: string;
  /** قيمة الصف الجديد (نوع الأصل «رأس» مثلاً) */
  defaultValue?: string;
  label: string;
  type?: "text" | "number" | "date" | "select";
  options?: { value: string; label: string }[];
  required?: boolean;
  ltr?: boolean;
  width?: string;
  placeholder?: string;
  readOnly?: boolean;
  /** زر «+ إضافة» في القائمة يفتح نافذة إضافة سريعة من هذا النوع */
  create?: QuickKind;
  /** نطاق الإضافة السريعة (رمز الحساب الأب مثلاً) */
  scope?: string;
  /**
   * خيارات تتغير حسب خلية أخرى في الصف نفسه (صاحب الوثيقة حسب جهتها)؛ تغيير تلك الخلية يفرّغ هذه.
   * create وprefix لكل قيمة: نوع الإضافة السريعة، وبادئة تُضاف لقيمة ما أُنشئ («vehicle:»).
   */
  dependsOn?: { key: string; options: Record<string, { value: string; label: string }[]>; create?: Record<string, QuickKind>; prefix?: Record<string, string> };
  /** نص حر مع اقتراحات أثناء الكتابة (مثل المرسل والمستلم من جهات الاتصال) */
  suggest?: string[];
}

export type GridRow = Record<string, string>;
type Cell = [number, number];

export const emptyGridRow = (columns: GridColumn[]): GridRow => Object.fromEntries(columns.map((c) => [c.key, c.defaultValue ?? ""]));
export const isEmptyGridRow = (row: GridRow) => Object.values(row).every((v) => !String(v ?? "").trim());

/** يحوّل النص الملصوق إلى قيمة العمود؛ في القوائم يقبل الاسم الظاهر أو القيمة. */
export function normalizeCell(col: GridColumn, raw: string) {
  const v = raw.trim();
  if (col.type === "select" && v) {
    const hit = col.options?.find((o) => o.value === v || o.label === v);
    return hit ? hit.value : v;
  }
  if (col.type === "number") return v.replace(/[,\s]/g, "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  return v;
}

/** القيمة كما تظهر للمستخدم (عند النسخ): اسم الخيار لا رمزه. */
const displayValue = (col: GridColumn, v: string) => (col.type === "select" ? (col.options?.find((o) => o.value === v)?.label ?? v) : v);

/** سجل تراجع وإعادة لمصفوفة الصفوف. */
export function useGridHistory(initial: () => GridRow[]) {
  const [state, setState] = useState(() => ({ past: [] as GridRow[][], present: initial(), future: [] as GridRow[][] }));
  const set = useCallback(
    (next: GridRow[] | ((prev: GridRow[]) => GridRow[])) =>
      setState((s) => {
        const value = typeof next === "function" ? next(s.present) : next;
        if (value === s.present) return s;
        return { past: [...s.past.slice(-99), s.present], present: value, future: [] };
      }),
    [],
  );
  const undo = useCallback(() => setState((s) => (s.past.length ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future] } : s)), []);
  const redo = useCallback(() => setState((s) => (s.future.length ? { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) } : s)), []);
  const reset = useCallback((rows: GridRow[]) => setState({ past: [], present: rows, future: [] }), []);
  return { rows: state.present, set, undo, redo, reset, canUndo: state.past.length > 0, canRedo: state.future.length > 0 };
}

export function DataGrid({
  columns: baseColumns,
  rows,
  onChange,
  onUndo,
  onRedo,
  onAppendRow,
  rowClass,
  cellClass,
  rowHeader,
  rowEnd,
  startColumn,
}: {
  columns: GridColumn[];
  rows: GridRow[];
  onChange: (next: GridRow[] | ((prev: GridRow[]) => GridRow[])) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  /** Enter في آخر صف يضيف صفاً */
  onAppendRow?: () => void;
  rowClass?: (r: number) => string;
  cellClass?: (r: number, key: string) => string;
  rowHeader?: (r: number) => ReactNode;
  rowEnd?: (r: number) => ReactNode;
  /** عمود ثابت إضافي قبل الأعمدة (مثل زر فتح السجل) */
  startColumn?: { label: string; render: (r: number) => ReactNode };
}) {
  const withCreated = useCreatedOptions();
  // ما أُضيف من نافذة الإضافة السريعة يدخل خيارات العمود (للصق والنسخ وبقية الصفوف)
  const columns = baseColumns.map((c) => (c.create ? { ...c, options: withCreated(c.create, c.options) } : c));
  const suggestions = new Map(baseColumns.filter((c) => c.suggest).map((c) => [c.key, c.suggest!.map((v) => ({ value: v, label: v }))]));
  const tableRef = useRef<HTMLTableElement>(null);
  const [anchor, setAnchor] = useState<Cell | null>(null);
  const [focus, setFocus] = useState<Cell | null>(null);
  const dragging = useRef(false);

  useEffect(() => {
    const up = () => (dragging.current = false);
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  const range = anchor && focus ? { r1: Math.min(anchor[0], focus[0]), r2: Math.max(anchor[0], focus[0]), c1: Math.min(anchor[1], focus[1]), c2: Math.max(anchor[1], focus[1]) } : null;
  const multi = !!range && (range.r1 !== range.r2 || range.c1 !== range.c2);
  const inRange = (r: number, c: number) => !!range && r >= range.r1 && r <= range.r2 && c >= range.c1 && c <= range.c2;

  const focusCell = (r: number, c: number) => tableRef.current?.querySelector<HTMLElement>(`[data-cell="${r}-${c}"]`)?.focus();

  /** يكتب قيماً في خلايا كثيرة دفعة واحدة (خطوة تراجع واحدة)، ويضيف صفوفاً عند الحاجة. */
  const writeCells = (fn: (put: (r: number, c: number, raw: string) => void) => void) =>
    onChange((prev) => {
      const next = prev.map((row) => ({ ...row }));
      fn((r, c, raw) => {
        const col = columns[c];
        if (!col || col.readOnly) return;
        while (!next[r]) next.push(emptyGridRow(columns));
        next[r][col.key] = normalizeCell(col, raw);
      });
      return next;
    });

  const onCopy = (e: ClipboardEvent) => {
    if (!range || !tableRef.current?.contains(e.target as Node)) return;
    const el = e.target as HTMLInputElement;
    // خلية واحدة فيها نص محدد جزئياً: نسخ عادي
    if (!multi && typeof el.selectionStart === "number" && el.selectionStart !== el.selectionEnd) return;
    const lines: string[] = [];
    for (let r = range.r1; r <= range.r2; r++) {
      const cells: string[] = [];
      for (let c = range.c1; c <= range.c2; c++) cells.push(displayValue(columns[c], rows[r]?.[columns[c].key] ?? ""));
      lines.push(cells.join("\t"));
    }
    e.clipboardData.setData("text/plain", lines.join("\n"));
    e.preventDefault();
  };

  const onPaste = (e: ClipboardEvent) => {
    if (!range || !tableRef.current?.contains(e.target as Node)) return;
    const text = e.clipboardData.getData("text/plain").replace(/\r?\n$/, "");
    const grid = /[\t\n]/.test(text) ? parseDelimited(text, "\t") : [[text]];
    const single = grid.length === 1 && grid[0].length === 1;
    if (single && !multi) return; // قيمة واحدة في خلية واحدة: لصق عادي داخل النص
    e.preventDefault();
    writeCells((put) => {
      if (single) {
        // قيمة واحدة على مجموعة محددة: تُملأ كلها
        for (let r = range.r1; r <= range.r2; r++) for (let c = range.c1; c <= range.c2; c++) put(r, c, grid[0][0]);
      } else {
        grid.forEach((cells, i) => cells.forEach((v, j) => put(range.r1 + i, range.c1 + j, v)));
        setFocus([range.r1 + grid.length - 1, Math.min(columns.length - 1, range.c1 + Math.max(...grid.map((g) => g.length)) - 1)]);
      }
    });
  };

  const onKeyDown = (e: KeyboardEvent, r: number, c: number) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z" && onUndo) {
      e.preventDefault();
      (e.shiftKey ? onRedo : onUndo)?.();
      return;
    }
    if (mod && e.key.toLowerCase() === "y" && onRedo) {
      e.preventDefault();
      onRedo();
      return;
    }
    if (mod && e.key.toLowerCase() === "d" && range) {
      // ملء لأسفل: قيمة الصف الأول من التحديد تُنسخ لبقية الصفوف
      e.preventDefault();
      writeCells((put) => {
        for (let cc = range.c1; cc <= range.c2; cc++) {
          const v = displayValue(columns[cc], rows[range.r1]?.[columns[cc].key] ?? "");
          for (let rr = range.r1 + 1; rr <= range.r2; rr++) put(rr, cc, v);
        }
      });
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && multi && range) {
      e.preventDefault();
      writeCells((put) => {
        for (let rr = range.r1; rr <= range.r2; rr++) for (let cc = range.c1; cc <= range.c2; cc++) put(rr, cc, "");
      });
      return;
    }
    const moves: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, Enter: 1 };
    const dr = moves[e.key];
    if (dr == null) return;
    const nr = r + dr;
    if (e.shiftKey && e.key !== "Enter") {
      // Shift + سهم: توسيع التحديد
      e.preventDefault();
      if (nr >= 0 && nr < rows.length) {
        setFocus([nr, c]);
        if (!anchor) setAnchor([r, c]);
      }
      return;
    }
    if (nr >= 0 && nr < rows.length) {
      e.preventDefault();
      setAnchor([nr, c]);
      setFocus([nr, c]);
      focusCell(nr, c);
    } else if (e.key === "Enter" && nr === rows.length && onAppendRow) {
      e.preventDefault();
      onAppendRow();
      setTimeout(() => focusCell(nr, c));
    }
  };

  const setCell = (r: number, key: string, value: string) =>
    onChange((prev) =>
      prev.map((row, i) => {
        if (i !== r) return row;
        const next = { ...row, [key]: value };
        // الخلايا التابعة لهذه الخلية تُفرَّغ إن تغيرت قيمتها
        if (row[key] !== value) for (const c of columns) if (c.dependsOn?.key === key) next[c.key] = "";
        return next;
      }),
    );

  return (
    <div className="overflow-x-auto rounded-2xl border border-black/[0.06] bg-white shadow-[0_4px_16px_-8px_rgba(27,33,38,0.08)]">
      <table ref={tableRef} className="w-full border-collapse text-sm select-none" onCopy={onCopy} onPaste={onPaste}>
        <thead className="sticky top-0 z-10 bg-asphalt-900 text-xs text-white/85">
          <tr>
            <th className="w-10 border-b border-gray-200 px-2 py-2">#</th>
            {startColumn && <th className="w-10 px-1">{startColumn.label}</th>}
            {columns.map((c) => (
              <th key={c.key} className="border-s border-white/10 px-2 py-2.5 text-start font-medium whitespace-nowrap" style={{ minWidth: c.width ?? "8rem" }}>
                {c.label}
                {c.required && <span className="text-brand-500"> *</span>}
              </th>
            ))}
            {rowEnd && <th className="w-8" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className={rowClass?.(r) ?? ""}>
              <td className="border-b border-gray-100 px-2 text-center text-xs text-gray-400">{rowHeader ? rowHeader(r) : r + 1}</td>
              {startColumn && <td className="border-b border-gray-100 px-1 text-center">{startColumn.render(r)}</td>}
              {columns.map((col, c) => {
                const selected = multi && inRange(r, c);
                const common = {
                  "data-cell": `${r}-${c}`,
                  value: row[col.key] ?? "",
                  readOnly: col.readOnly,
                  disabled: col.readOnly && col.type === "select",
                  onKeyDown: (e: KeyboardEvent) => onKeyDown(e, r, c),
                  onFocus: () => {
                    // الانتقال بلوحة المفاتيح (Tab) يلغي التحديد المتعدد ويبدأ من هذه الخلية
                    if (!dragging.current && !(focus && focus[0] === r && focus[1] === c)) {
                      setAnchor([r, c]);
                      setFocus([r, c]);
                    }
                  },
                  className: `w-full bg-transparent px-2 py-1.5 outline-none select-text focus:bg-brand-50 ${col.readOnly ? "text-gray-500" : ""}`,
                  "aria-label": `${col.label} — صف ${r + 1}`,
                };
                return (
                  <td
                    key={col.key}
                    className={`border-b border-s border-gray-100 p-0 ${selected ? "!bg-sky-100/80" : ""} ${cellClass?.(r, col.key) ?? ""}`}
                    onMouseDown={(e) => {
                      if (e.shiftKey && anchor) {
                        e.preventDefault();
                        setFocus([r, c]);
                        return;
                      }
                      dragging.current = true;
                      setAnchor([r, c]);
                      setFocus([r, c]);
                    }}
                    onMouseEnter={() => {
                      if (dragging.current) setFocus([r, c]);
                    }}
                  >
                    {col.type === "select" || col.suggest ? (
                      <ComboBox
                        value={row[col.key] ?? ""}
                        options={col.suggest ? (suggestions.get(col.key) ?? []) : col.dependsOn ? (col.dependsOn.options[row[col.dependsOn.key]] ?? []) : (col.options ?? [])}
                        free={!!col.suggest}
                        create={col.dependsOn ? col.dependsOn.create?.[row[col.dependsOn.key]] : col.create}
                        createPrefix={col.dependsOn?.prefix?.[row[col.dependsOn.key]]}
                        placeholder={col.dependsOn && !row[col.dependsOn.key] ? `اختر ${columns.find((x) => x.key === col.dependsOn!.key)?.label ?? ""} أولاً` : r === 0 ? col.placeholder : undefined}
                        scope={col.scope}
                        disabled={col.readOnly}
                        onChange={(v) => setCell(r, col.key, v)}
                        onKeyDownClosed={common.onKeyDown}
                        className={common.className}
                        inputProps={{ "data-cell": common["data-cell"], "aria-label": common["aria-label"], onFocus: common.onFocus, dir: col.ltr ? "ltr" : undefined }}
                      />
                    ) : (
                      <input
                        {...common}
                        type="text"
                        inputMode={col.type === "number" ? "decimal" : undefined}
                        dir={col.ltr || col.type === "number" || col.type === "date" ? "ltr" : undefined}
                        // التاريخ يُكتب يوم/شهر/سنة (أو يُلصق من Excel) مهما كانت لغة المتصفح
                        placeholder={col.type === "date" ? (r === 0 && col.placeholder ? isoToDmy(col.placeholder) : "dd/mm/yyyy") : r === 0 ? col.placeholder : undefined}
                        onChange={(e) => setCell(r, col.key, e.target.value)}
                      />
                    )}
                  </td>
                );
              })}
              {rowEnd && <td className="border-b border-gray-100 text-center">{rowEnd(r)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const GRID_HINT = "حدّد خلايا بالسحب أو Shift ثم انسخ والصق (Ctrl+C / Ctrl+V)، Ctrl+D للملء لأسفل، Ctrl+Z للتراجع";
