"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { Icon } from "@/components/icons";

export interface DocSheetColumn {
  key: string;
  label: string;
  type?: "text" | "date" | "number" | "badge";
  editable?: boolean;
  width?: string;
  ltr?: boolean;
}

export interface DocSheetRow {
  id: number;
  href: string;
  /** المسودات فقط تُعدّل؛ غيرها للقراءة */
  editable: boolean;
  cells: Record<string, string | null>;
  badges?: Record<string, { label: string; tone: keyof typeof TONES }>;
}

export interface SheetChange {
  id: number;
  values: Record<string, string>;
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
const k = (id: number, col: string) => `${id}:${col}`;

/**
 * ورقة الفواتير بطريقة Excel: تنقل بالأسهم، تعديل بالكتابة أو Enter، لصق خلايا من Excel،
 * والتعديلات تُعلَّم بالأصفر حتى «حفظ». الحفظ يمر على قواعد المستند نفسها في الخادم.
 */
export function DocSheet({ columns, rows, action, emptyText }: { columns: DocSheetColumn[]; rows: DocSheetRow[]; action: (payload: string) => Promise<DocSheetResult>; emptyText: string }) {
  const router = useRouter();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [sel, setSel] = useState({ r: 0, c: 0 });
  // null = تنقل؛ caret = تحرير داخل النص (F2 أو Enter أو نقر مزدوج) فتتحرك الأسهم داخل الخلية
  const [editing, setEditing] = useState<{ value: string; caret: boolean } | null>(null);
  const [message, setMessage] = useState<string>();
  const [saving, start] = useTransition();
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const touched = useRef(false);

  const value = (row: DocSheetRow, col: string) => edits[k(row.id, col)] ?? row.cells[col] ?? "";
  const canEdit = (r: number, c: number) => !!rows[r]?.editable && !!columns[c]?.editable;
  const dirty = Object.keys(edits).length;

  // الخلية النشطة القابلة للتعديل تحمل حقل إدخال مركّزاً دائماً، فلا يضيع أي حرف يُكتب
  useEffect(() => {
    if (!touched.current) return;
    if (canEdit(sel.r, sel.c)) input.current?.focus();
    else box.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel.r, sel.c]);

  const setCell = (r: number, c: number, raw: string) => {
    const row = rows[r];
    const col = columns[c];
    if (!row || !col || !canEdit(r, c)) return;
    let v = raw;
    if (col.type === "date") {
      v = v.replace(/\//g, "-");
      const dmy = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(v);
      if (dmy) v = `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
    }
    setEdits((e) => {
      const next = { ...e };
      if (v === (row.cells[col.key] ?? "")) delete next[k(row.id, col.key)];
      else next[k(row.id, col.key)] = v;
      return next;
    });
  };

  const move = (dr: number, dc: number) => setSel(({ r, c }) => ({ r: Math.max(0, Math.min(rows.length - 1, r + dr)), c: Math.max(0, Math.min(columns.length - 1, c + dc)) }));

  const commit = () => {
    if (editing) setCell(sel.r, sel.c, editing.value.trim());
    setEditing(null);
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
      move(...arrows[e.key]);
    } else if (e.key === "Tab") {
      e.preventDefault();
      commit();
      move(0, e.shiftKey ? -1 : 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (editing) {
        commit();
        move(1, 0);
      } else if (editable) setEditing({ value: value(rows[sel.r], columns[sel.c].key), caret: true });
      else move(1, 0);
    } else if (e.key === "F2" && editable) {
      e.preventDefault();
      setEditing({ value: value(rows[sel.r], columns[sel.c].key), caret: true });
    } else if (e.key === "Escape") {
      setEditing(null);
    } else if ((e.key === "Delete" || e.key === "Backspace") && !editing && editable) {
      e.preventDefault();
      setCell(sel.r, sel.c, "");
    }
  };

  const onPaste = (text: string) => {
    const grid = text.replace(/\r/g, "").replace(/\n$/, "").split("\n").map((l) => l.split("\t"));
    let skipped = 0;
    grid.forEach((cells, dr) =>
      cells.forEach((v, dc) => {
        const r = sel.r + dr;
        const c = sel.c + dc;
        if (canEdit(r, c)) setCell(r, c, v.trim());
        else if (rows[r] && columns[c]) skipped++;
      }),
    );
    setEditing(null);
    setMessage(skipped ? `لُصقت الخلايا، وتُركت ${skipped} خلية لا تقبل التعديل` : undefined);
  };

  const save = () =>
    start(async () => {
      const byRow = new Map<number, Record<string, string>>();
      for (const [key, v] of Object.entries(edits)) {
        const [id, col] = key.split(":");
        byRow.set(Number(id), { ...byRow.get(Number(id)), [col]: v });
      }
      const changes: SheetChange[] = [...byRow].map(([id, values]) => ({ id, values }));
      const res = await action(JSON.stringify(changes));
      const failed = res.errors ?? {};
      setErrors(failed);
      setEdits((e) => Object.fromEntries(Object.entries(e).filter(([key]) => failed[Number(key.split(":")[0])])));
      setMessage(res.ok);
      router.refresh();
    });

  return (
    <div className="rounded-2xl border border-black/[0.06] bg-white shadow-[0_4px_16px_-8px_rgba(27,33,38,0.08)]">
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-2.5 text-xs text-gray-500">
        <span>
          اكتب أو اضغط Enter للتعديل، والأسهم للتنقل، والصق من Excel مباشرة. الخلايا البيضاء في المسودات فقط تقبل التعديل
          <Icon name="lock" className="ms-1 inline size-3.5 text-gray-400" /> والمُصدرة للقراءة.
        </span>
        {message && <span className="font-medium text-green-700">{message}</span>}
        <div className="ms-auto flex items-center gap-2">
          {dirty > 0 && (
            <button type="button" onClick={() => (setEdits({}), setErrors({}))} className="rounded-lg px-3 py-1.5 text-gray-600 hover:bg-gray-100">
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
        onPaste={(e) => {
          if (editing?.caret) return;
          e.preventDefault();
          onPaste(e.clipboardData.getData("text"));
        }}
        className="max-h-[70vh] overflow-auto outline-none"
      >
        <table data-report="الفواتير" className="w-max min-w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="sticky start-0 z-20 w-9 border-b border-e border-gray-200 bg-gray-50" />
              {columns.map((col) => (
                <th key={col.key} style={{ minWidth: col.width }} className="border-b border-e border-gray-200 bg-gray-50 px-2.5 py-2 text-start text-xs font-semibold whitespace-nowrap text-gray-600">
                  {col.label}
                  {col.editable && <span className="ms-1 text-brand-600">✎</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1} className="px-4 py-10 text-center text-gray-400">
                  {emptyText}
                </td>
              </tr>
            )}
            {rows.map((row, r) => (
              <tr key={row.id} className="group">
                <td className={`sticky start-0 z-[5] border-e border-b border-gray-100 px-1.5 text-center ${errors[row.id] ? "bg-red-50" : "bg-white"}`} title={errors[row.id]}>
                  <Link href={row.href} className="inline-flex text-gray-400 hover:text-brand-700" aria-label="فتح">
                    <Icon name={row.editable ? "expand" : "lock"} className="size-3.5" />
                  </Link>
                </td>
                {columns.map((col, c) => {
                  const active = sel.r === r && sel.c === c;
                  const editable = canEdit(r, c);
                  const isDirty = k(row.id, col.key) in edits;
                  const v = value(row, col.key);
                  const badge = row.badges?.[col.key];
                  return (
                    <td
                      key={col.key}
                      onMouseDown={() => {
                        touched.current = true;
                        if (!active) {
                          commit();
                          setSel({ r, c });
                        }
                      }}
                      onDoubleClick={() => editable && setEditing({ value: v, caret: true })}
                      className={`relative h-9 cursor-cell border-e border-b border-gray-100 px-2.5 whitespace-nowrap ${
                        isDirty ? "bg-brand-50" : editable ? "bg-white" : "bg-gray-50/60 text-gray-600"
                      } ${active ? "outline-2 -outline-offset-2 outline-brand-500" : ""} ${col.ltr || col.type === "number" || col.type === "date" ? "ltr-nums" : ""} ${col.type === "number" ? "text-end" : ""}`}
                    >
                      {active && editable ? (
                        <input
                          ref={input}
                          value={editing ? editing.value : v}
                          placeholder={col.type === "date" ? "YYYY-MM-DD" : undefined}
                          onChange={(e) => setEditing({ value: e.target.value, caret: editing?.caret ?? false })}
                          onFocus={(e) => !editing && e.currentTarget.select()}
                          onBlur={commit}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            onKey(e);
                          }}
                          onPaste={(e) => {
                            e.stopPropagation();
                            if (editing?.caret) return;
                            e.preventDefault();
                            onPaste(e.clipboardData.getData("text"));
                          }}
                          className={`absolute inset-0 w-full px-2.5 text-sm outline-none ${editing ? "bg-white outline-2 -outline-offset-2 outline-brand-600" : "bg-transparent"} ${col.ltr || col.type === "date" ? "ltr-nums" : ""}`}
                        />
                      ) : badge ? (
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONES[badge.tone]}`}>{badge.label}</span>
                      ) : col.type === "number" ? (
                        fmtNum(v)
                      ) : (
                        v || <span className="text-gray-300">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
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
