"use client";

import { useEffect, useState } from "react";

const boxes = (form: string) => Array.from(document.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name=ids][form="${form}"]`));

/** تحديد الكل في رأس الجدول. */
export function SelectAll({ form }: { form: string }) {
  return (
    <input
      type="checkbox"
      aria-label="تحديد الكل"
      className="size-4 accent-brand-600"
      onChange={(e) => {
        for (const b of boxes(form)) b.checked = e.currentTarget.checked;
        document.dispatchEvent(new Event("violations-selection"));
      }}
    />
  );
}

export function RowCheck({ form, id, amount }: { form: string; id: number; amount: string }) {
  return (
    <input
      type="checkbox"
      name="ids"
      value={id}
      form={form}
      data-amount={amount}
      aria-label="تحديد"
      className="size-4 accent-brand-600"
      onChange={() => document.dispatchEvent(new Event("violations-selection"))}
    />
  );
}

/** عدد المحدد وإجماليه، يتحدث مع كل تحديد. */
export function SelectionTotal({ form }: { form: string }) {
  const [sel, setSel] = useState({ count: 0, total: 0 });
  useEffect(() => {
    const update = () => {
      const on = boxes(form).filter((b) => b.checked);
      setSel({ count: on.length, total: on.reduce((t, b) => t + Number(b.dataset.amount), 0) });
    };
    document.addEventListener("violations-selection", update);
    return () => document.removeEventListener("violations-selection", update);
  }, [form]);
  return (
    <div className="text-sm">
      <span className="text-gray-500">المحدد: </span>
      <span className="ltr-nums font-semibold">{sel.count}</span>
      <span className="text-gray-500"> مخالفة بإجمالي </span>
      <span className="ltr-nums font-semibold text-brand-900">{sel.total.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
    </div>
  );
}
