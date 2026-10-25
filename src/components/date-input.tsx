"use client";

import { useRef, useState, type ChangeEvent, type ComponentProps } from "react";
import { Icon } from "@/components/icons";

// حقل تاريخ يعرض يوم/شهر/سنة دائماً مهما كانت لغة المتصفح، ويُرسل القيمة بصيغة 2026-10-25 كالحقل الأصلي.
// الكتابة: 25/10/2026 أو 25-10-2026 أو 2026-10-25؛ وزر التقويم يفتح منتقي المتصفح.

export const isoToDmy = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};

export const dmyToIso = (text: string) => {
  const t = text.trim().replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (!m) return null;
  const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
};

type Props = Omit<ComponentProps<"input">, "type" | "value" | "defaultValue" | "onChange"> & {
  value?: string;
  defaultValue?: string;
  onChange?: (e: { target: { value: string } }) => void;
};

export function DateInput({ value, defaultValue, onChange, name, required, min, max, className, form, disabled, id, ...rest }: Props) {
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue ?? "");
  const iso = controlled ? value : inner;
  const [text, setText] = useState<string | null>(null); // نص أثناء الكتابة قبل أن يكتمل تاريخاً صحيحاً
  const picker = useRef<HTMLInputElement>(null);

  const commit = (next: string) => {
    if (!controlled) setInner(next);
    onChange?.({ target: { value: next } });
  };
  const type = (e: ChangeEvent<HTMLInputElement>) => {
    setText(e.target.value);
    const parsed = dmyToIso(e.target.value);
    if (parsed) commit(parsed);
    else if (!e.target.value.trim()) commit("");
  };

  return (
    <span className={`relative inline-flex items-center ${className?.includes("w-") ? "" : "w-full"}`}>
      <input
        {...rest}
        id={id}
        disabled={disabled}
        dir="ltr"
        inputMode="numeric"
        autoComplete="off"
        placeholder="dd/mm/yyyy"
        value={text ?? isoToDmy(iso)}
        onChange={type}
        onBlur={() => setText(null)}
        className={`${className ?? ""} ltr-nums ps-9 text-start`}
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        aria-label="اختر من التقويم"
        onClick={() => {
          try {
            picker.current?.showPicker();
          } catch {
            picker.current?.focus();
          }
        }}
        className="absolute end-2 rounded p-1 text-gray-400 hover:text-gray-700"
      >
        <Icon name="calendar" className="size-4" />
      </button>
      {/* الحقل الأصلي مخفي بصرياً: يحمل الاسم والقيمة للنموذج ويفتح منتقي التاريخ */}
      <input
        ref={picker}
        type="date"
        name={name}
        form={form}
        required={required}
        min={min}
        max={max}
        disabled={disabled}
        value={iso}
        onChange={(e) => {
          setText(null);
          commit(e.target.value);
        }}
        tabIndex={-1}
        aria-hidden
        className="pointer-events-none absolute bottom-0 start-0 h-px w-px opacity-0"
      />
    </span>
  );
}
