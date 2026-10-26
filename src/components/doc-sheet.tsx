"use client";

import { useUnsavedGuard } from "./unsaved-guard";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { Icon } from "@/components/icons";
import { isoToDmy } from "@/components/date-input";
import { ComboBox, useCreatedOptions } from "@/components/combo-box";
import { norm } from "@/lib/filter-options";
import type { QuickKind, QuickOption } from "@/lib/quick-add-types";

export interface DocSheetColumn {
  key: string;
  label: string;
  type?: "text" | "date" | "number" | "badge" | "select";
  editable?: boolean;
  width?: string;
  ltr?: boolean;
  /** خيارات خلية الاختيار (العميل، المسار…)، وتُبحث بالكتابة */
  options?: QuickOption[];
  /** زر «+ إضافة» في قائمة الاختيار */
  create?: QuickKind;
  /** "line": عمود من بنود المستند؛ غيره من الرأس ويظهر في أول سطر المستند فقط */
  scope?: "line";
  /** قيمة محسوبة من خلايا السطر الحالية (إجمالي البند مثلاً) فتتحدث أثناء التعديل */
  /** خلية محسوبة لا تُحرر: حاصل ضرب أعمدة، مع نسبة ضريبة اختيارية من عمود آخر (تمر من الخادم فلا تكون دالة). */
  calc?: { multiply: string[]; vatPercent?: string };
}

export interface DocSheetLine {
  id: number;
  cells: Record<string, string | null>;
}

export interface DocSheetRow {
  id: number;
  href: string;
  /** المسودات فقط تُعدّل؛ غيرها للقراءة */
  editable: boolean;
  cells: Record<string, string | null>;
  badges?: Record<string, { label: string; tone: keyof typeof TONES }>;
  /** بنود المستند: سطر لكل بند تحت الرأس */
  lines?: DocSheetLine[];
}

export interface SheetChange {
  id: number;
  values: Record<string, string>;
  /** تعديلات البنود: رقم البند ← قيمه */
  lines?: Record<number, Record<string, string>>;
}

export type DocSheetResult = { ok?: string; errors?: Record<number, string> };

const TONES = {
  gray: "bg-gray-100 text-gray-700",
  green: "bg-green-50 text-green-700",
  blue: "bg-sky-50 text-sky-700",
  amber: "bg-amber-50 text-amber-800",
  red: "bg-red-50 text-red-700",
} as const;

const fmtNum = (v: string | null) => (v == null || v === "" || isNaN(Number(v)) ? (v ?? "") : Number(v).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

interface VRow {
  doc: DocSheetRow;
  line?: DocSheetLine;
  /** أول سطر للمستند: يحمل خلايا الرأس */
  first: boolean;
}

const toIsoDate = (raw: string) => {
  const v = raw.trim().replace(/\//g, "-");
  const dmy = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(v);
  return dmy ? `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}` : v;
};

/**
 * ورقة المستندات بطريقة Excel: تنقل بالأسهم، تعديل بالكتابة أو Enter، تحديد مدى بـ Shift،
 * نسخ ولصق مع Excel، وخلايا اختيار بالبحث وخلايا تاريخ بالتقويم. المستند ذو البنود يظهر
 * سطراً لكل بند وبيانات رأسه في أول سطر. التعديلات تُعلَّم بالأصفر حتى «حفظ»، والحفظ يمر
 * على قواعد المستند نفسها في الخادم.
 */
export function DocSheet({ columns: baseColumns, rows, action, emptyText, openLabel = "اضغط لعرض الاستمارة" }: { columns: DocSheetColumn[]; rows: DocSheetRow[]; action: (payload: string) => Promise<DocSheetResult>; emptyText: string; openLabel?: string }) {
  const router = useRouter();
  const withCreated = useCreatedOptions();
  const columns = baseColumns.map((c) => (c.type === "select" ? { ...c, options: withCreated(c.create, c.options) } : c));
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [sel, setSel] = useState({ r: 0, c: 0 });
  const [anchor, setAnchor] = useState<{ r: number; c: number } | null>(null);
  // null = تنقل؛ caret = تحرير داخل النص (F2 أو Enter أو نقر مزدوج) فتتحرك الأسهم داخل الخلية
  const [editing, setEditing] = useState<{ value: string; caret: boolean } | null>(null);
  const [message, setMessage] = useState<string>();
  const [saving, start] = useTransition();
  const box = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const touched = useRef(false);
  // آخر تنشيط للخلية بالنقر: خلية الاختيار تفتح قائمتها مباشرة
  const [clicked, setClicked] = useState(false);

  const vrows = useMemo<VRow[]>(() => rows.flatMap((doc): VRow[] => (doc.lines?.length ? doc.lines.map((line, i) => ({ doc, line, first: i === 0 })) : [{ doc, first: true }])), [rows]);

  const keyOf = (vr: VRow, col: DocSheetColumn) => `${vr.doc.id}:${col.scope === "line" ? (vr.line?.id ?? "x") : "h"}:${col.key}`;
  const hasCell = (vr: VRow, col: DocSheetColumn) => (col.scope === "line" ? !!vr.line : vr.first);
  const original = (vr: VRow, col: DocSheetColumn) => (col.scope === "line" ? vr.line?.cells[col.key] : vr.doc.cells[col.key]) ?? "";
  const raw = (vr: VRow, col: DocSheetColumn) => (hasCell(vr, col) ? (edits[keyOf(vr, col)] ?? original(vr, col)) : "");
  const canEdit = (r: number, c: number) => {
    const vr = vrows[r];
    const col = columns[c];
    return !!vr && !!col && vr.doc.editable && !!col.editable && !col.calc && hasCell(vr, col);
  };
  const value = (vr: VRow, col: DocSheetColumn) => {
    if (col.calc && hasCell(vr, col)) {
      const get = (key: string) => {
        const other = columns.find((x) => x.key === key);
        return other ? raw(vr, other) : "";
      };
      const n = (key: string) => Number(get(key).replace(/[,\s]/g, "")) || 0;
      const base = col.calc.multiply.reduce((t, k) => t * n(k), 1);
      const total = base * (1 + (col.calc.vatPercent ? n(col.calc.vatPercent) : 0) / 100);
      return String(Math.round(total * 100) / 100);
    }
    return raw(vr, col);
  };
  // النص الظاهر (ويُنسخ): اسم الخيار لا رقمه، والتاريخ يوم/شهر/سنة
  const display = (vr: VRow, col: DocSheetColumn) => {
    const v = value(vr, col);
    if (col.type === "select") return col.options?.find((o) => o.value === v)?.label ?? v;
    if (col.type === "date") return isoToDmy(v);
    if (col.type === "badge") return vr.first ? (vr.doc.badges?.[col.key]?.label ?? "") : "";
    return v;
  };

  const dirty = Object.keys(edits).length;
  useUnsavedGuard(dirty > 0);

  const range = anchor ? { r1: Math.min(anchor.r, sel.r), r2: Math.max(anchor.r, sel.r), c1: Math.min(anchor.c, sel.c), c2: Math.max(anchor.c, sel.c) } : { r1: sel.r, r2: sel.r, c1: sel.c, c2: sel.c };
  const inRange = (r: number, c: number) => r >= range.r1 && r <= range.r2 && c >= range.c1 && c <= range.c2;

  // الخلية النشطة القابلة للتعديل تحمل حقل إدخال مركّزاً دائماً، فلا يضيع أي حرف يُكتب
  useEffect(() => {
    if (!touched.current) return;
    const el = box.current?.querySelector<HTMLInputElement>("[data-active-input]");
    if (el) el.focus();
    else box.current?.focus();
  }, [sel.r, sel.c]);

  /** يكتب في الخلية؛ يعيد false إن رُفضت القيمة (خيار غير موجود) */
  const setCell = (r: number, c: number, input: string) => {
    const vr = vrows[r];
    const col = columns[c];
    if (!vr || !col || !canEdit(r, c)) return false;
    let v = input;
    if (col.type === "date") v = toIsoDate(v);
    if (col.type === "select" && v) {
      const t = norm(v);
      const hit = col.options?.find((o) => o.value === v) ?? col.options?.find((o) => norm(o.label) === t) ?? col.options?.find((o) => norm(o.label).includes(t));
      if (!hit) return false;
      v = hit.value;
    }
    const key = keyOf(vr, col);
    setEdits((e) => {
      const next = { ...e };
      if (v === original(vr, col)) delete next[key];
      else next[key] = v;
      return next;
    });
    return true;
  };

  const move = (dr: number, dc: number, extend = false) => {
    setClicked(false);
    setClicked(false);
    if (extend) setAnchor((a) => a ?? sel);
    else setAnchor(null);
    setSel(({ r, c }) => ({ r: Math.max(0, Math.min(vrows.length - 1, r + dr)), c: Math.max(0, Math.min(columns.length - 1, c + dc)) }));
  };

  const commit = () => {
    if (editing) setCell(sel.r, sel.c, editing.value.trim());
    setEditing(null);
  };

  const clearRange = () => {
    for (let r = range.r1; r <= range.r2; r++) for (let c = range.c1; c <= range.c2; c++) setCell(r, c, "");
  };

  const copyText = () => {
    const out: string[] = [];
    for (let r = range.r1; r <= range.r2; r++) {
      const cells: string[] = [];
      for (let c = range.c1; c <= range.c2; c++) cells.push(display(vrows[r], columns[c]).replace(/[\t\n]/g, " "));
      out.push(cells.join("\t"));
    }
    return out.join("\n");
  };

  const onKey = (e: KeyboardEvent) => {
    touched.current = true;
    const editable = canEdit(sel.r, sel.c);
    // الجدول من اليمين لليسار: السهم الأيسر يتقدم للعمود التالي
    const arrows: Record<string, [number, number]> = { ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowLeft: [0, 1], ArrowRight: [0, -1] };
    if (arrows[e.key]) {
      if (editing?.caret) return;
      e.preventDefault();
      commit();
      move(...arrows[e.key], e.shiftKey);
    } else if (e.key === "Tab") {
      e.preventDefault();
      commit();
      move(0, e.shiftKey ? -1 : 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (editing) {
        commit();
        move(1, 0);
      } else if (editable && columns[sel.c].type !== "select") setEditing({ value: value(vrows[sel.r], columns[sel.c]), caret: true });
      else move(1, 0);
    } else if (e.key === "F2" && editable) {
      e.preventDefault();
      setEditing({ value: value(vrows[sel.r], columns[sel.c]), caret: true });
    } else if (e.key === "Escape") {
      setEditing(null);
      setAnchor(null);
    } else if ((e.key === "Delete" || e.key === "Backspace") && !editing && (editable || anchor)) {
      e.preventDefault();
      clearRange();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a" && !editing) {
      e.preventDefault();
      setAnchor({ r: 0, c: 0 });
      setSel({ r: vrows.length - 1, c: columns.length - 1 });
    }
  };

  const onPaste = (text: string) => {
    const grid = text.replace(/\r/g, "").replace(/\n$/, "").split("\n").map((l) => l.split("\t"));
    // خلية واحدة منسوخة تُلصق في كل المدى المحدد
    const fill = grid.length === 1 && grid[0].length === 1 && anchor;
    let skipped = 0;
    let rejected = 0;
    const put = (r: number, c: number, v: string) => {
      if (canEdit(r, c)) {
        if (!setCell(r, c, v.trim())) rejected++;
      } else if (vrows[r] && columns[c]) skipped++;
    };
    if (fill) {
      for (let r = range.r1; r <= range.r2; r++) for (let c = range.c1; c <= range.c2; c++) put(r, c, grid[0][0]);
    } else grid.forEach((cells, dr) => cells.forEach((v, dc) => put(range.r1 + dr, range.c1 + dc, v)));
    setEditing(null);
    const parts = [skipped && `تُركت ${skipped} خلية لا تقبل التعديل`, rejected && `${rejected} قيمة غير موجودة في القائمة`].filter(Boolean);
    setMessage(parts.length ? `لُصقت الخلايا، و${parts.join("، و")}` : undefined);
  };

  const save = () =>
    start(async () => {
      const byDoc = new Map<number, SheetChange>();
      for (const [key, v] of Object.entries(edits)) {
        const [id, line, col] = key.split(":");
        const change = byDoc.get(Number(id)) ?? { id: Number(id), values: {} };
        if (line === "h") change.values[col] = v;
        else {
          change.lines ??= {};
          change.lines[Number(line)] = { ...change.lines[Number(line)], [col]: v };
        }
        byDoc.set(Number(id), change);
      }
      const res = await action(JSON.stringify([...byDoc.values()]));
      const failed = res.errors ?? {};
      setErrors(failed);
      setEdits((e) => Object.fromEntries(Object.entries(e).filter(([key]) => failed[Number(key.split(":")[0])])));
      setMessage(res.ok);
      router.refresh();
    });

  const openPicker = () => {
    const el = picker.current;
    if (!el) return;
    el.value = value(vrows[sel.r], columns[sel.c]);
    try {
      el.showPicker();
    } catch {
      el.focus();
    }
  };

  const keyHandlers = {
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
      e.stopPropagation();
      onKey(e);
    },
    onPaste: (e: React.ClipboardEvent<HTMLInputElement>) => {
      e.stopPropagation();
      if (editing?.caret) return;
      e.preventDefault();
      onPaste(e.clipboardData.getData("text"));
    },
  };

  return (
    <div className="rounded-2xl border border-black/[0.06] bg-white shadow-[0_4px_16px_-8px_rgba(27,33,38,0.08)]">
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-2.5 text-xs text-gray-500">
        <span>
          اكتب أو اضغط Enter للتعديل، والأسهم للتنقل وShift لتحديد مدى، وانسخ والصق مع Excel. الخلايا البيضاء تقبل التعديل
          <Icon name="lock" className="ms-1 inline size-3.5 text-gray-400" /> والرمادية للقراءة.
        </span>
        {message && <span className="font-medium text-green-700">{message}</span>}
        <div className="ms-auto flex items-center gap-2">
          {dirty > 0 && (
            <button type="button" onClick={() => (setEdits({}), setErrors({}), setMessage(undefined))} className="rounded-lg px-3 py-1.5 text-gray-600 hover:bg-gray-100">
              تراجع
            </button>
          )}
          <button
            type="button"
            disabled={!dirty || saving}
            onClick={save}
            className="rounded-lg bg-brand-500 px-4 py-1.5 text-sm font-semibold text-brand-900 shadow-sm transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? "جارٍ الحفظ…" : `حفظ التعديلات${dirty ? ` (${dirty})` : ""}`}
          </button>
        </div>
      </div>
      <div
        ref={box}
        tabIndex={0}
        onKeyDown={onKey}
        onCopy={(e) => {
          if (editing?.caret) return;
          e.preventDefault();
          e.clipboardData.setData("text/plain", copyText());
          setMessage(`نُسخت ${(range.r2 - range.r1 + 1) * (range.c2 - range.c1 + 1)} خلية`);
        }}
        onPaste={(e) => {
          if (editing?.caret) return;
          e.preventDefault();
          onPaste(e.clipboardData.getData("text"));
        }}
        className="max-h-[70vh] overflow-auto outline-none"
      >
        {/* منتقي التاريخ الأصلي للخلية النشطة */}
        <input
          ref={picker}
          type="date"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            if (e.target.value) setCell(sel.r, sel.c, e.target.value);
            setEditing(null);
          }}
          className="pointer-events-none fixed h-px w-px opacity-0"
          style={{ top: 0, left: 0 }}
        />
        <table data-report="الورقة" className="w-max min-w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="sticky start-0 z-20 w-9 border-b border-e border-gray-200 bg-gray-50" />
              {columns.map((col) => (
                <th key={col.key} style={{ minWidth: col.width }} className="border-b border-e border-gray-200 bg-gray-50 px-2.5 py-2 text-start text-xs font-semibold whitespace-nowrap text-gray-600">
                  {col.label}
                  {col.editable && !col.calc && <span className="ms-1 text-brand-600">✎</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {vrows.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1} className="px-4 py-10 text-center text-gray-400">
                  {emptyText}
                </td>
              </tr>
            )}
            {vrows.map((vr, r) => {
              const lastOfDoc = vrows[r + 1]?.doc.id !== vr.doc.id;
              return (
                <tr key={`${vr.doc.id}:${vr.line?.id ?? "h"}`} className="group">
                  <td className={`sticky start-0 z-[5] border-e border-gray-100 px-1.5 text-center ${lastOfDoc ? "border-b border-b-gray-200" : ""} ${errors[vr.doc.id] ? "bg-red-50" : "bg-white"}`} title={errors[vr.doc.id]}>
                    {vr.first && (
                      <Link href={vr.doc.href} scroll={false} className="inline-flex text-gray-400 hover:text-brand-700" aria-label={openLabel} title={openLabel}>
                        <Icon name={vr.doc.editable ? "expand" : "lock"} className="size-3.5" />
                      </Link>
                    )}
                  </td>
                  {columns.map((col, c) => {
                    const active = sel.r === r && sel.c === c;
                    const selected = !active && anchor && inRange(r, c);
                    const editable = canEdit(r, c);
                    const isDirty = hasCell(vr, col) && keyOf(vr, col) in edits;
                    const v = value(vr, col);
                    const badge = vr.first ? vr.doc.badges?.[col.key] : undefined;
                    const numeric = col.ltr || col.type === "number" || col.type === "date";
                    return (
                      <td
                        key={col.key}
                        onMouseDown={(e) => {
                          touched.current = true;
                          if (e.shiftKey) {
                            e.preventDefault();
                            setAnchor((a) => a ?? sel);
                            setSel({ r, c });
                            return;
                          }
                          setAnchor(null);
                          if (!active) {
                            // خلية القائمة: نمنع المتصفح من نقل التركيز للجدول بعد أن يأخذه حقل البحث فتُغلق القائمة
                            if (editable && col.type === "select") e.preventDefault();
                            commit();
                            setClicked(true);
                            setSel({ r, c });
                          }
                        }}
                        onDoubleClick={() => editable && col.type !== "select" && setEditing({ value: v, caret: true })}
                        className={`relative h-9 cursor-cell border-e border-gray-100 px-2.5 whitespace-nowrap ${lastOfDoc ? "border-b border-b-gray-200" : ""} ${
                          isDirty ? "bg-brand-50" : selected ? "bg-sky-50" : editable ? "bg-white" : "bg-gray-50/60 text-gray-600"
                        } ${active ? "outline-2 -outline-offset-2 outline-brand-500" : ""} ${numeric ? "ltr-nums" : ""} ${col.type === "number" ? "text-end" : ""}`}
                      >
                        {active && editable && col.type === "select" ? (
                          <>
                            <ComboBox
                              value={v}
                              options={col.options ?? []}
                              create={col.create}
                              allowEmpty
                              autoOpen={clicked}
                              placeholder="ابحث…"
                              onChange={(next) => setCell(r, c, next)}
                              onKeyDownClosed={(e) => {
                                if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", "Tab", "Escape"].includes(e.key)) keyHandlers.onKeyDown(e);
                                else e.stopPropagation();
                              }}
                              inputProps={{ "data-active-input": "1", onPaste: keyHandlers.onPaste }}
                              className="absolute inset-0 w-full bg-white px-2.5 pe-6 text-sm outline-2 -outline-offset-2 outline-brand-600"
                            />
                            <span className="pointer-events-none absolute end-1.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-400">▼</span>
                          </>
                        ) : active && editable ? (
                          <>
                            <input
                              data-active-input="1"
                              value={editing ? editing.value : col.type === "date" ? isoToDmy(v) : v}
                              placeholder={col.type === "date" ? "dd/mm/yyyy" : undefined}
                              onChange={(e) => setEditing({ value: e.target.value, caret: editing?.caret ?? false })}
                              onFocus={(e) => !editing && e.currentTarget.select()}
                              onBlur={commit}
                              {...keyHandlers}
                              className={`absolute inset-0 w-full px-2.5 text-sm outline-none ${editing ? "bg-white outline-2 -outline-offset-2 outline-brand-600" : "bg-transparent"} ${numeric ? "ltr-nums" : ""} ${col.type === "date" ? "pe-7" : ""} ${col.type === "number" ? "text-end" : ""}`}
                            />
                            {col.type === "date" && (
                              <button
                                type="button"
                                tabIndex={-1}
                                aria-label="اختر من التقويم"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={openPicker}
                                className="absolute end-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:text-brand-700"
                              >
                                <Icon name="calendar" className="size-3.5" />
                              </button>
                            )}
                          </>
                        ) : badge ? (
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONES[badge.tone]}`}>{badge.label}</span>
                        ) : !hasCell(vr, col) ? null : col.type === "number" ? (
                          fmtNum(v)
                        ) : v ? (
                          <span className={editable && (col.type === "select" || col.type === "date") ? "pe-4" : ""}>{display(vr, col)}</span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                        {!active && editable && (col.type === "select" || col.type === "date") && (
                          <span className="pointer-events-none absolute end-1.5 top-1/2 -translate-y-1/2 text-gray-300">
                            {col.type === "select" ? <span className="text-[10px]">▼</span> : <Icon name="calendar" className="size-3" />}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {Object.keys(errors).length > 0 && (
        <ul className="space-y-1 border-t border-red-100 bg-red-50/60 px-4 py-2.5 text-xs text-red-700">
          {Object.entries(errors).map(([id, err]) => (
            <li key={id}>
              <span className="ltr-nums font-semibold">{rows.find((r) => r.id === Number(id))?.cells.number}</span>: {err}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
