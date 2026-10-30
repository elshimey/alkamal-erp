"use client";

import { useEffect, useRef, useState } from "react";
import type { QuickKind, QuickOption } from "@/lib/quick-add-types";
import { ComboBox } from "./combo-box";

/**
 * قائمة بحث داخل نموذج عادي: القيمة في حقل مخفي باسم name، و«+ إضافة» للنوع إن وُجد.
 * تعود لقيمتها الأولى عند تفريغ النموذج (حفظ وإضافة أخرى)، وتُبلغ النموذج بالتغيير.
 */
export function FormCombo({
  name,
  options,
  defaultValue = "",
  create,
  scope,
  required,
  placeholder = "اكتب للبحث…",
  onChange,
}: {
  name: string;
  options: QuickOption[];
  defaultValue?: string;
  create?: QuickKind;
  scope?: string;
  required?: boolean;
  placeholder?: string;
  onChange?: (value: string) => void;
}) {
  const [value, setValue] = useState(defaultValue);
  const hidden = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const form = hidden.current?.form;
    const reset = () => {
      setValue(defaultValue);
      onChange?.(defaultValue);
    };
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, [defaultValue, onChange]);

  return (
    <>
      <input ref={hidden} type="hidden" name={name} value={value} />
      <ComboBox
        value={value}
        options={options}
        create={create}
        scope={scope}
        placeholder={placeholder}
        allowEmpty={!required}
        inputProps={{ required, "aria-required": required ? "true" : undefined } as never}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
        onChange={(v) => {
          setValue(v);
          onChange?.(v);
          // تحديث القيمة المخفية لا يُطلق حدث تغيير؛ نُبلغ النموذج (مؤشر «تعديلات لم تُحفظ» وغيره)
          queueMicrotask(() => hidden.current?.dispatchEvent(new Event("change", { bubbles: true })));
        }}
      />
    </>
  );
}
