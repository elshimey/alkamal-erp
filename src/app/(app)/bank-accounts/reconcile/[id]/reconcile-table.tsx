"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import type { FormState } from "@/components/action-form";
import { saveClearedAction } from "../actions";
import { fmt } from "@/lib/format";

type Item = { id: number; date: string; entry: string; entryId: number; description: string; debit: number; credit: number; cleared: boolean };

const r2 = (v: number) => Math.round(v * 100) / 100 + 0;

export function ReconcileTable(props: { id: number; editable: boolean; statement: number; priorCleared: number; book: number; items: Item[] }) {
  const { id, editable, statement, priorCleared, book, items } = props;
  const [checked, setChecked] = useState(() => new Set(items.filter((i) => i.cleared).map((i) => i.id)));
  const [filter, setFilter] = useState<"all" | "open" | "cleared">("all");
  const [state, setState] = useState<FormState>();
  const [pending, start] = useTransition();

  const t = useMemo(() => {
    const sel = items.filter((i) => checked.has(i.id));
    const open = items.filter((i) => !checked.has(i.id));
    const cleared = r2(priorCleared + sel.reduce((s, i) => s + i.debit - i.credit, 0));
    return {
      cleared,
      difference: r2(statement - cleared),
      outIn: r2(open.reduce((s, i) => s + i.debit, 0)),
      outOut: r2(open.reduce((s, i) => s + i.credit, 0)),
    };
  }, [checked, items, priorCleared, statement]);
  const balanced = Math.abs(t.difference) < 0.005;
  const shown = items.filter((i) => (filter === "all" ? true : filter === "open" ? !checked.has(i.id) : checked.has(i.id)));

  const toggle = (lineId: number) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });
  const submit = (complete: boolean) => start(async () => setState(await saveClearedAction(id, [...checked], complete)));

  const tiles = [
    { label: "رصيد الكشف", value: statement },
    { label: "المطابَق", value: t.cleared },
    { label: "الفرق", value: t.difference, tone: balanced ? "text-green-700" : "text-red-700" },
    { label: "رصيد الدفاتر", value: book, hint: `إيداعات معلقة ${fmt(t.outIn)} · مدفوعات معلقة ${fmt(t.outOut)}` },
  ];

  return (
    <>
      <div className="sticky top-0 z-10 -mx-1 mb-4 grid grid-cols-2 gap-3 bg-concrete px-1 py-2 lg:grid-cols-4">
        {tiles.map((x) => (
          <div key={x.label} className="rounded-2xl border border-black/[0.06] bg-white p-4 shadow-sm">
            <div className="text-xs text-gray-500">{x.label}</div>
            <div className={`ltr-nums font-display text-xl font-semibold ${x.tone ?? "text-brand-900"}`}>{fmt(x.value)}</div>
            {x.hint && <div className="ltr-nums mt-1 text-[11px] text-gray-400">{x.hint}</div>}
          </div>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {(
          [
            ["all", `الكل (${items.length})`],
            ["open", `غير مؤشر (${items.length - checked.size})`],
            ["cleared", `مؤشر (${checked.size})`],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            className={`rounded-full px-3 py-1 text-xs transition ${filter === k ? "bg-asphalt-900 text-white" : "bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50"}`}
          >
            {label}
          </button>
        ))}
        {editable && (
          <span className="ms-auto flex flex-wrap gap-2">
            <button type="button" onClick={() => setChecked(new Set(items.map((i) => i.id)))} className="text-xs text-brand-700 hover:underline">
              تأشير الكل
            </button>
            <button type="button" onClick={() => setChecked(new Set())} className="text-xs text-gray-500 hover:underline">
              إلغاء الكل
            </button>
          </span>
        )}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-black/[0.06] bg-white shadow-sm">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="w-10 px-3 py-2" />
              <th className="px-3 py-2 text-start font-medium">التاريخ</th>
              <th className="px-3 py-2 text-start font-medium">القيد</th>
              <th className="px-3 py-2 text-start font-medium">البيان</th>
              <th className="px-3 py-2 text-end font-medium">إيداع</th>
              <th className="px-3 py-2 text-end font-medium">سحب</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-gray-400">
                  لا حركات
                </td>
              </tr>
            )}
            {shown.map((i) => {
              const on = checked.has(i.id);
              return (
                <tr
                  key={i.id}
                  onClick={() => editable && toggle(i.id)}
                  className={`border-t border-gray-100 transition ${editable ? "cursor-pointer" : ""} ${on ? "bg-green-50/60" : "hover:bg-gray-50"}`}
                >
                  <td className="px-3 py-2 text-center">
                    <input type="checkbox" checked={on} disabled={!editable} onChange={() => toggle(i.id)} onClick={(e) => e.stopPropagation()} className="size-4 accent-brand-600" aria-label="تأشير" />
                  </td>
                  <td className="ltr-nums px-3 py-2 whitespace-nowrap">{i.date}</td>
                  <td className="px-3 py-2">
                    <Link href={`/journal?open=${i.entryId}`} onClick={(e) => e.stopPropagation()} className="ltr-nums text-brand-700 hover:underline">
                      {i.entry}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-gray-700">{i.description}</td>
                  <td className="ltr-nums px-3 py-2 text-end text-green-800">{i.debit ? fmt(i.debit) : ""}</td>
                  <td className="ltr-nums px-3 py-2 text-end text-red-800">{i.credit ? fmt(i.credit) : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {priorCleared !== 0 && <p className="ltr-nums mt-2 text-xs text-gray-400">يشمل المطابَق {fmt(priorCleared)} من تسويات سابقة مكتملة.</p>}

      {editable && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" disabled={pending} onClick={() => submit(false)} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-60">
            حفظ التأشير
          </button>
          <button
            type="button"
            disabled={pending || !balanced}
            onClick={() => submit(true)}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-brand-900 shadow-sm hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            إكمال التسوية
          </button>
          {!balanced && <span className="text-xs text-gray-500">يكتمل حين يصبح الفرق صفراً</span>}
        </div>
      )}
      {state?.error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      {state?.ok && <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{state.ok}</p>}
    </>
  );
}
