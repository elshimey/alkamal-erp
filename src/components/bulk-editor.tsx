"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { DataGrid, emptyGridRow, GRID_HINT, isEmptyGridRow, useGridHistory, type GridColumn, type GridRow } from "./data-grid";
import { plateKey } from "@/lib/plates";
import { Icon, Truck } from "./icons";
import { confirmDiscard, useUnsavedGuard } from "./unsaved-guard";

export interface BulkRow {
  id: number;
  values: GridRow;
}
export type BulkSaveResult = { saved: number; deleted: number; errors: Record<number, string>; error?: string; created?: Record<number, number> };
type Change = { id: number; values: GridRow };

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
  canCreate,
  newRows = 0,
  unique,
}: {
  title: string;
  backHref: string;
  backLabel: string;
  columns: GridColumn[];
  rows: BulkRow[];
  /** رابط فتح السجل كاملاً؛ {id} يُستبدل */
  openHref?: string;
  action: (changes: Change[], deletes: number[], creates: Change[]) => Promise<BulkSaveResult>;
  canDelete?: boolean;
  /** صفوف فارغة أعلى الشيت لإضافة سجلات جديدة مع السجلات الموجودة */
  canCreate?: boolean;
  newRows?: number;
  /** عمود لا يتكرر (اللوحة): تنبيه فوري إن كُتبت قيمة مسجلة مسبقاً أو مكررة في الشيت */
  unique?: { key: string; label: string };
}) {
  const router = useRouter();
  // الصفوف الجديدة أرقامها سالبة حتى تُحفظ
  const startNew = canCreate ? newRows : 0;
  const nextNew = useRef(-(startNew + 1));
  const blank = () => emptyGridRow(columns);
  const freshIds = (n: number) => Array.from({ length: n }, () => nextNew.current--);
  const [ids, setIds] = useState(() => [...Array.from({ length: startNew }, (_, i) => -(i + 1)), ...initial.map((r) => r.id)]);
  const [original, setOriginal] = useState(() => [...Array.from({ length: startNew }, blank), ...initial.map((r) => r.values)]);
  const history = useGridHistory(() => [...Array.from({ length: startNew }, blank), ...initial.map((r) => ({ ...r.values }))]);
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

  const isNew = (i: number) => ids[i] < 0;
  const newCount = dirtyIdx.filter(isNew).length;
  const editCount = dirtyIdx.length - newCount;
  const pending = dirtyIdx.length + deleted.size;
  useUnsavedGuard(pending > 0);

  // القيمة المسجلة مسبقاً أو المكررة في الشيت (اللوحة مثلاً)
  const dupes = useMemo(() => {
    const out = new Map<number, string>();
    if (!unique) return out;
    const seen = new Map<string, number[]>();
    rows.forEach((r, i) => {
      const k = plateKey(r[unique.key]);
      if (k) seen.set(k, [...(seen.get(k) ?? []), i]);
    });
    for (const list of seen.values()) {
      if (list.length < 2) continue;
      const old = list.find((i) => ids[i] > 0);
      for (const i of list) if (isNew(i) || list.filter((j) => ids[j] > 0).length > 1) out.set(i, old != null && old !== i ? `${unique.label} «${rows[i][unique.key]}» مسجلة مسبقاً (الصف ${old + 1})` : `${unique.label} «${rows[i][unique.key]}» مكررة في الشيت`);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, ids, unique]);

  const addRows = () => {
    // الصفوف الجديدة أعلى الشيت؛ التراجع يبدأ من هنا
    setIds([...freshIds(5), ...ids]);
    setOriginal([...Array.from({ length: 5 }, blank), ...original]);
    history.reset([...Array.from({ length: 5 }, blank), ...rows]);
  };

  const save = () => {
    const values = (i: number, all: boolean) => Object.fromEntries(columns.filter((c) => all || changed(i, c.key)).map((c) => [c.key, rows[i][c.key] ?? ""]));
    const changes = dirtyIdx.filter((i) => !isNew(i) && !deleted.has(ids[i])).map((i) => ({ id: ids[i], values: values(i, false) }));
    const creates = dirtyIdx.filter((i) => isNew(i) && !isEmptyGridRow(rows[i])).map((i) => ({ id: ids[i], values: values(i, true) }));
    start(async () => {
      const res = await action(changes, [...deleted], creates);
      const failed = new Set(Object.keys(res.errors).map(Number));
      const created = res.created ?? {};
      // ما حُفظ يصبح هو الأصل؛ ما حُذف يُزال؛ المرفوض يبقى معدّلاً؛ الجديد المحفوظ يأخذ رقمه
      const keep = ids.map((id, i) => ({ id, i })).filter(({ id }) => !(deleted.has(id) && !failed.has(id)));
      setOriginal(keep.map(({ id, i }) => (failed.has(id) && !deleted.has(id) ? original[i] : rows[i])));
      setIds(keep.map(({ id }) => created[id] ?? id));
      history.reset(keep.map(({ i }) => rows[i]));
      setDeleted(new Set([...deleted].filter((id) => failed.has(id))));
      setErrors(res.errors);
      setMessage({
        ok: res.saved || res.deleted ? [res.saved && `حُفظ ${res.saved} سجل`, Object.keys(created).length && `منها ${Object.keys(created).length} جديد`, res.deleted && `حُذف ${res.deleted}`].filter(Boolean).join(" · ") : undefined,
        error: res.error ?? (failed.size ? `لم يُحفظ ${failed.size} سجل؛ السبب بجانب كل صف` : undefined),
      });
      router.refresh();
    });
  };

  const cancel = () => {
    if (!confirmDiscard(true, "تجاهل كل التعديلات غير المحفوظة والعودة للبيانات كما كانت؟")) return;
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
          {pending ? [newCount && `${newCount} صف جديد`, editCount && `${editCount} صف معدّل`, deleted.size && `${deleted.size} للحذف`].filter(Boolean).join(" · ") + " لم يُحفظ" : message.ok ? <span className="font-semibold text-green-700">✓ {message.ok}</span> : "لا توجد تغييرات بعد"}
        </span>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <Link href={backHref} className={`${btn} flex items-center gap-1`}>
            → العودة للجدول
          </Link>
          {canCreate && (
            <button type="button" onClick={addRows} className={btn}>
              + 5 صفوف جديدة
            </button>
          )}
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
              `حفظ التغييرات${pending ? ` (${pending})` : ""}`
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
        rowClass={(k) => (deleted.has(ids[view[k]]) ? "bg-red-50 line-through opacity-60" : errors[ids[view[k]]] || dupes.has(view[k]) ? "bg-red-50/60" : isNew(view[k]) ? "bg-green-50/40" : "")}
        cellClass={(k, key) => (unique?.key === key && dupes.has(view[k]) ? "!bg-red-100" : changed(view[k], key) ? (isNew(view[k]) ? "bg-green-100/60" : "bg-amber-100/70") : "")}
        rowHeader={(k) => (
          <span title={errors[ids[view[k]]] ?? dupes.get(view[k])} className={errors[ids[view[k]]] || dupes.has(view[k]) ? "font-bold text-red-600" : isNew(view[k]) ? "text-[10px] font-semibold text-green-700" : ""}>
            {errors[ids[view[k]]] || dupes.has(view[k]) ? "!" : isNew(view[k]) ? "جديد" : view[k] + 1}
          </span>
        )}
        startColumn={
          openHref
            ? {
                label: "",
                render: (k) =>
                  isNew(view[k]) ? null : (
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

      {dupes.size > 0 && (
        <ul role="alert" className="list-inside list-disc rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {[...dupes.entries()].map(([i, m]) => (
            <li key={i}>
              {isNew(i) ? "صف جديد" : `الصف ${i + 1}`}: {m}
            </li>
          ))}
        </ul>
      )}
      {Object.keys(errors).length > 0 && (
        <ul className="list-inside list-disc rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
          {Object.entries(errors).map(([id, e]) => {
            const i = ids.indexOf(Number(id));
            return (
              <li key={id}>
                {Number(id) < 0 ? "صف جديد" : `الصف ${i + 1}`}
                {rows[i]?.[columns[0].key] ? ` (${rows[i][columns[0].key]})` : ""}: {e}
              </li>
            );
          })}
        </ul>
      )}
      {message.error && Object.keys(errors).length === 0 && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{message.error}</p>}
      {message.ok && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">✓ {message.ok}</p>}
    </div>
  );
}
