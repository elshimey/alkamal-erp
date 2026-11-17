"use client";

// نافذة «حساب جديد» من أي خانة حساب: الاسم، ثم الحساب الأب.
// الآباء المناسبون للخانة يظهرون أولاً، وزر «عرض كل الشجرة» يفتح الشجرة كاملة بمستوياتها.

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { accountParentsAction, quickAddAction } from "@/app/(app)/quick-add/actions";
import type { QuickOption } from "@/lib/quick-add-types";
import { norm } from "@/lib/filter-options";
import { Icon } from "./icons";

type Parent = { id: number; code: string; nameAr: string; level: number };

/** الآباء المقترحون: الرموز المعطاة للخانة، وإلا آباء الحسابات المعروضة فيها. */
function suggestedPrefixes(scope: string | undefined, options: QuickOption[]) {
  const given = (scope ?? "").split(",").filter((p) => /^\d+$/.test(p));
  if (given.length) return given;
  return [...new Set(options.map((o) => o.groupCode).filter((c): c is string => !!c))];
}

export function AccountAddDialog({
  scope,
  options,
  initial,
  onClose,
  onDone,
}: {
  scope?: string;
  options: QuickOption[];
  initial?: string;
  onClose: () => void;
  onDone: (o: QuickOption) => void;
}) {
  const [parents, setParents] = useState<Parent[] | null>(null);
  const [error, setError] = useState<string>();
  const [name, setName] = useState(initial ?? "");
  const [parentId, setParentId] = useState<number | null>(null);
  const [all, setAll] = useState(false);
  const [query, setQuery] = useState("");
  const [saving, start] = useTransition();
  const nameRef = useRef<HTMLInputElement>(null);
  const prefixes = useMemo(() => suggestedPrefixes(scope, options), [scope, options]);

  useEffect(() => {
    accountParentsAction().then((r) => {
      if ("error" in r) return setError(r.error);
      setParents(r);
      const suggested = r.filter((p) => prefixes.some((x) => p.code === x));
      if (suggested.length === 1) setParentId(suggested[0].id);
    });
  }, [prefixes]);

  // نافذة أصلية فوق كل شيء، حتى لو فُتحت من داخل نافذة أخرى (التأكيد مثلاً)
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    nameRef.current?.focus();
  }, []);

  // المقترح: الآباء المطابقون لرموز الخانة وما تحتها (دون المستوى الرابع)
  const suggested = (parents ?? []).filter((p) => prefixes.some((x) => p.code.startsWith(x)));
  const q = norm(query);
  const tree = (all || !suggested.length ? parents ?? [] : suggested).filter((p) => !q || norm(p.nameAr).includes(q) || p.code.startsWith(query.trim()));
  const minLevel = Math.min(...tree.map((p) => p.level));

  const submit = () => {
    if (!name.trim()) return setError("اكتب اسم الحساب");
    if (!parentId) return setError("اختر الحساب الأب");
    setError(undefined);
    start(async () => {
      const r = await quickAddAction("account", { nameAr: name.trim(), parentId: String(parentId) });
      if ("error" in r) return setError(r.error);
      onDone(r.option);
      onClose();
    });
  };

  return createPortal(
    <dialog
      ref={ref}
      aria-label="حساب جديد في شجرة الحسابات"
      onCancel={(e) => (e.preventDefault(), onClose())}
      onClick={(e) => (e.stopPropagation(), e.target === ref.current && onClose())}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
          e.preventDefault();
          submit();
        }
      }}
      className="animate-rise m-auto w-[min(32rem,calc(100%-2rem))] rounded-2xl bg-white p-0 text-sm text-gray-800 shadow-2xl backdrop:bg-asphalt-900/50 backdrop:backdrop-blur-[2px]"
    >
      <div className="p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="font-display text-lg font-semibold text-brand-900">حساب جديد في شجرة الحسابات</h3>
          <button type="button" onClick={onClose} aria-label="إغلاق" className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700">
            <Icon name="close" className="size-5" />
          </button>
        </div>

        <label className="mb-3 block">
          <span className="mb-1 block font-medium text-gray-700">اسم الحساب</span>
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="مثال: صندوق فرع الدمام"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          />
        </label>

        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="font-medium text-gray-700">تحت الحساب</span>
          {suggested.length > 0 && (
            <button type="button" onClick={() => setAll((v) => !v)} className="rounded-lg px-2 py-1 text-xs font-semibold text-brand-800 transition hover:bg-brand-50">
              {all ? "المناسب لهذه الخانة فقط" : "عرض كل الشجرة"}
            </button>
          )}
        </div>
        {(all || tree.length > 8) && (
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="🔍 ابحث بالاسم أو الرقم"
            aria-label="بحث في الحسابات الأب"
            className="mb-1.5 w-full rounded-lg border border-gray-300 px-3 py-1.5 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          />
        )}
        <div role="radiogroup" aria-label="الحساب الأب" className="max-h-64 overflow-y-auto rounded-xl border border-gray-200">
          {!parents && !error && <p className="p-3 text-center text-xs text-gray-400">جارٍ التحميل…</p>}
          {parents && tree.length === 0 && <p className="p-3 text-center text-xs text-gray-400">لا يوجد حساب بهذا الاسم</p>}
          {tree.map((p) => {
            const on = p.id === parentId;
            const head = p.level < 3;
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setParentId(p.id)}
                style={{ paddingInlineStart: `${0.75 + (p.level - minLevel) * 1.1}rem` }}
                className={`flex w-full items-center justify-between gap-3 border-b border-gray-50 py-2 pe-3 text-start transition last:border-0 ${on ? "bg-brand-50 text-brand-900" : "hover:bg-gray-50"} ${head ? "font-bold text-gray-800" : ""}`}
              >
                <span className="flex items-center gap-2">
                  <span aria-hidden className={`grid size-4 shrink-0 place-items-center rounded-full border ${on ? "border-brand-600 bg-brand-600 text-[10px] text-white" : "border-gray-300"}`}>
                    {on ? "✓" : ""}
                  </span>
                  {p.nameAr}
                </span>
                <span className="ltr-nums shrink-0 text-xs font-normal text-gray-400" dir="ltr">
                  {p.code}
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-xs text-gray-500">يأخذ الحساب رقماً تلقائياً تحت الأب، ونوعه وطبيعته منه. الأب يصبح تجميعياً، ويُرفض إن كانت عليه قيود.</p>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        <div className="mt-4 flex justify-end gap-2 border-t border-gray-100 pt-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 transition hover:bg-gray-50">
            إلغاء
          </button>
          <button type="button" onClick={submit} disabled={saving || !parents} className="rounded-lg bg-brand-600 px-4 py-2 font-semibold text-brand-900 transition hover:bg-brand-500 disabled:opacity-60">
            {saving ? "جارٍ الإضافة…" : "إضافة واختيار"}
          </button>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
