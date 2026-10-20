"use client";

import { useEffect, useState } from "react";

// تحديد صفوف جدول لإجراء جماعي: مربعات الصفوف تتبع نموذجاً بخاصية form فتُرسل معه.
const EVENT = "row-selection";
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
        document.dispatchEvent(new Event(EVENT));
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
      onChange={() => document.dispatchEvent(new Event(EVENT))}
    />
  );
}

/** عدد المحدد وإجماليه، يتحدث مع كل تحديد. */
export function SelectionTotal({ form, noun }: { form: string; noun: string }) {
  const [sel, setSel] = useState({ count: 0, total: 0 });
  useEffect(() => {
    const update = () => {
      const on = boxes(form).filter((b) => b.checked);
      setSel({ count: on.length, total: on.reduce((t, b) => t + Number(b.dataset.amount), 0) });
    };
    document.addEventListener(EVENT, update);
    return () => document.removeEventListener(EVENT, update);
  }, [form]);
  return (
    <div className="text-sm">
      <span className="text-gray-500">المحدد: </span>
      <span className="ltr-nums font-semibold">{sel.count}</span>
      <span className="text-gray-500"> {noun} بإجمالي </span>
      <span className="ltr-nums font-semibold text-brand-900">{sel.total.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
    </div>
  );
}
