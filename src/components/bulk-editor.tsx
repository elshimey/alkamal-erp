"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { DataGrid, GRID_HINT, useGridHistory, type GridColumn, type GridRow } from "./data-grid";
import { Icon, Truck } from "./icons";

export interface BulkRow {
  id: number;
  values: GridRow;
}
export type BulkSaveResult = { saved: number; deleted: number; errors: Record<number, string>; error?: string };

/**
 * التعديل الجماعي على طريقة وافق: كل السجلات في شيت واحد، الخلايا المعدّلة تُلوَّن،
 * ولا يُحفظ شيء حتى «حفظ التغييرات». الصفوف المرفوضة تبقى معدّلة مع سبب الرفض.
 */
export function BulkEditor({
  title,
  backHref,
  backLabel,
  columns,
  rows: initial,
  openHref,
  action,
  canDelete,
}: {
  title: string;
  backHref: string;
  backLabel: string;
  columns: GridColumn[];
  rows: BulkRow[];
  /** رابط فتح السجل كاملاً؛ {id} يُستبدل */
  openHref?: string;
  action: (changes: { id: number; values: GridRow }[], deletes: number[]) => Promise<BulkSaveResult>;
  canDelete?: boolean;
}) {
  const router = useRouter();
  const [ids, setIds] = useState(() => initial.map((r) => r.id));
  const [original, setOriginal] = useState(() => initial.map((r) => r.values));
  const history = useGridHistory(() => initial.map((r) => ({ ...r.values })));
  const rows = history.rows;
  const [deleted, setDeleted] = useState<Set<number>>(new Set());
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [message, setMessage] = useState<{ ok?: string; error?: string }>({});
  const [q, setQ] = useState("");
  const [saving, start] = useTransition();

  const changed = (i: number, key: string) => (rows[i]?.[key] ?? "") !== (original[i]?.[key] ?? "");
  const dirtyIdx = useMemo(() => rows.map((_, i) => i).filter((i) => columns.some((c) => (rows[i]?.[c.key] ?? "") !== (original[i]?.[c.key] ?? ""))), [rows, original, columns]);

  // البحث يعرض جزءاً من الصفوف؛ التعديل عليه يُعاد لمكانه في القائمة الكاملة
  const view = useMemo(() => {
    const t = q.trim().toLowerCase();
    return rows.map((_, i) => i).filter((i) => !t || columns.some((c) => (rows[i][c.key] ?? "").toLowerCase().includes(t) || (c.options?.find((o) => o.value === rows[i][c.key])?.label ?? "").toLowerCase().includes(t)));
  }, [rows, q, columns]);
  const viewRows = view.map((i) => rows[i]);
  const onViewChange = (next: GridRow[] | ((prev: GridRow[]) => GridRow[])) =>
    history.set((prev) => {
      const current = view.map((i) => prev[i]);
      const value = typeof next === "function" ? next(current) : next;
      const out = [...prev];
      view.forEach((i, k) => {
        if (value[k]) out[i] = value[k];
      });
      return out;
    });

  const pending = dirtyIdx.length + deleted.size;

  const save = () => {
    const changes = dirtyIdx
      .filter((i) => !deleted.has(ids[i]))
      .map((i) => ({ id: ids[i], values: Object.fromEntries(columns.filter((c) => changed(i, c.key)).map((c) => [c.key, rows[i][c.key] ?? ""])) }));
    start(async () => {
      const res = await action(changes, [...deleted]);
      const failed = new Set(Object.keys(res.errors).map(Number));
      // ما حُفظ يصبح هو الأصل؛ ما حُذف يُزال؛ المرفوض يبقى معدّلاً
      const keep = ids.map((id, i) => ({ id, i })).filter(({ id }) => !(deleted.has(id) && !failed.has(id)));
      setOriginal(keep.map(({ id, i }) => (failed.has(id) && !deleted.has(id) ? original[i] : rows[i])));
      setIds(keep.map(({ id }) => id));
      history.reset(keep.map(({ i }) => rows[i]));
      setDeleted(new Set([...deleted].filter((id) => failed.has(id))));
      setErrors(res.errors);
      setMessage({
        ok: res.saved || res.deleted ? [res.saved && `حُفظ ${res.saved} سجل`, res.deleted && `حُذف ${res.deleted}`].filter(Boolean).join(" · ") : undefined,
        error: res.error ?? (failed.size ? `لم يُحفظ ${failed.size} سجل؛ السبب بجانب كل صف` : undefined),
      });
      router.refresh();
    });
  };

  const cancel = () => {
    history.reset(original.map((r) => ({ ...r })));
    setDeleted(new Set());
    setErrors({});
    setMessage({});
  };

  const btn = "rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40";

  return (
    <div className="flex flex-col gap-3">
      <div className="sticky top-0 z-20 -mx-4 flex flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2.5 sm:mx-0 sm:rounded-xl sm:border">
        <nav className="flex items-center gap-1.5 text-sm">
          <Link href={backHref} className="text-gray-500 hover:text-gray-800">
            {backLabel}
          </Link>
          <span className="text-gray-400">›</span>
          <span className="font-semibold text-gray-800">{title}</span>
        </nav>
        <span className={`ms-2 text-xs ${pending ? "font-semibold text-amber-800" : "text-gray-500"}`}>
          {pending ? `${dirtyIdx.length ? `${dirtyIdx.length} صف معدّل` : ""}${dirtyIdx.length && deleted.size ? " · " : ""}${deleted.size ? `${deleted.size} للحذف` : ""}` : "لا توجد تغييرات بعد"}
        </span>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <button type="button" onClick={history.undo} disabled={!history.canUndo} className={btn}>
            ↶ تراجع
          </button>
          <button type="button" onClick={history.redo} disabled={!history.canRedo} className={btn}>
            ↷ إعادة
          </button>
          <button type="button" onClick={cancel} disabled={!pending} className={btn}>
            إلغاء
          </button>
          <button type="button" onClick={save} disabled={!pending || saving} className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-semibold text-brand-900 hover:bg-brand-500 disabled:opacity-50">
            {saving ? (
              <span className="flex items-center gap-2">
                <Truck className="w-7" spinning />
                جارٍ الحفظ…
              </span>
            ) : (
              "حفظ التغييرات"
            )}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="relative">
          <Icon name="search" className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="البحث" className="w-64 rounded-lg border border-gray-300 bg-white py-1.5 ps-8 pe-3 text-sm outline-none focus:border-brand-500" />
        </label>
        <span className="text-xs text-gray-400">
          {view.length} من {rows.length} · {GRID_HINT}
        </span>
      </div>

      <DataGrid
        columns={columns}
        rows={viewRows}
        onChange={onViewChange}
        onUndo={history.undo}
        onRedo={history.redo}
        rowClass={(k) => (deleted.has(ids[view[k]]) ? "bg-red-50 line-through opacity-60" : errors[ids[view[k]]] ? "bg-red-50/60" : "")}
        cellClass={(k, key) => (changed(view[k], key) ? "bg-amber-100/70" : "")}
        rowHeader={(k) => (
          <span title={errors[ids[view[k]]]} className={errors[ids[view[k]]] ? "font-bold text-red-600" : ""}>
            {errors[ids[view[k]]] ? "!" : view[k] + 1}
          </span>
        )}
        startColumn={
          openHref
            ? {
                label: "",
                render: (k) => (
                  <Link href={openHref.replace("{id}", String(ids[view[k]]))} title="فتح السجل" className="text-gray-400 hover:text-brand-700">
                    ⤢
                  </Link>
                ),
              }
            : undefined
        }
        rowEnd={
          canDelete
            ? (k) => (
                <button
                  type="button"
                  title={deleted.has(ids[view[k]]) ? "إلغاء الحذف" : "حذف"}
                  onClick={() =>
                    setDeleted((d) => {
                      const n = new Set(d);
                      const id = ids[view[k]];
                      if (n.has(id)) n.delete(id);
                      else n.add(id);
                      return n;
                    })
                  }
                  className={`px-2 ${deleted.has(ids[view[k]]) ? "text-red-600" : "text-gray-300 hover:text-red-600"}`}
                >
                  {deleted.has(ids[view[k]]) ? "↺" : "🗑"}
                </button>
              )
            : undefined
        }
      />

      {Object.keys(errors).length > 0 && (
        <ul className="list-inside list-disc rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
          {Object.entries(errors).map(([id, e]) => {
            const i = ids.indexOf(Number(id));
            return (
              <li key={id}>
                الصف {i + 1}
                {rows[i]?.[columns[0].key] ? ` (${rows[i][columns[0].key]})` : ""}: {e}
              </li>
            );
          })}
        </ul>
      )}
      {message.error && Object.keys(errors).length === 0 && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{message.error}</p>}
      {message.ok && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{message.ok}</p>}
    </div>
  );
}
