"use client";

import { useContext, useRef, type ReactNode } from "react";
import { PendingContext } from "./action-form";
import { Icon } from "./icons";

/**
 * زر في نموذج بعدة عمليات يسأل قبل التنفيذ: نافذة في وسط الشاشة بزر التأكيد و«إلغاء» و× وEsc
 * والضغط خارجها. عند التأكيد يضع العملية في حقل op ويرسل النموذج.
 */
export function ConfirmSubmit({
  op,
  children,
  title,
  text,
  submit,
  danger = false,
  fields,
  className = "",
}: {
  op: string;
  children: ReactNode;
  title: string;
  text: ReactNode;
  submit: string;
  danger?: boolean;
  /** حقول إضافية في النافذة (مثل سبب الحذف)؛ تُرسل مع النموذج */
  fields?: ReactNode;
  className?: string;
}) {
  const pending = useContext(PendingContext);
  const ref = useRef<HTMLDialogElement>(null);
  const close = () => ref.current?.close();
  const confirm = () => {
    const dialog = ref.current;
    const form = dialog?.closest("form");
    if (!dialog || !form) return;
    const field = form.elements.namedItem("op");
    if (field instanceof HTMLInputElement) field.value = op;
    // الحقول المطلوبة داخل النافذة تُفحص قبل الإرسال
    const invalid = dialog.querySelector<HTMLInputElement>("input:invalid, textarea:invalid");
    if (invalid) return invalid.reportValidity();
    close();
    form.requestSubmit();
  };
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => ref.current?.showModal()}
        className={`rounded-lg border px-4 py-1.5 text-sm font-medium shadow-sm transition active:scale-[0.98] disabled:opacity-70 ${danger ? "border-red-200 bg-white text-red-700 hover:bg-red-50" : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"} ${className}`}
      >
        {children}
      </button>
      <dialog
        ref={ref}
        onClick={(e) => e.target === ref.current && close()}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT" && (e.preventDefault(), confirm())}
        className="animate-rise m-auto w-[min(30rem,calc(100%-2rem))] rounded-2xl bg-white p-0 text-gray-800 shadow-2xl backdrop:bg-asphalt-900/50 backdrop:backdrop-blur-[2px]"
      >
        <div className="p-5 text-start">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className={`font-display text-lg font-semibold ${danger ? "text-red-700" : "text-brand-900"}`}>{title}</h3>
            <button type="button" onClick={close} aria-label="إغلاق" className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700">
              <Icon name="close" className="size-5" />
            </button>
          </div>
          <div className="text-sm leading-relaxed text-gray-600">{text}</div>
          {fields && <div className="mt-3 space-y-3">{fields}</div>}
          <div className="mt-5 flex justify-end gap-2 border-t border-gray-100 pt-3">
            <button type="button" onClick={close} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 transition hover:bg-gray-50">
              إلغاء
            </button>
            <button type="button" onClick={confirm} className={`rounded-lg px-4 py-2 text-sm font-semibold shadow-sm transition ${danger ? "bg-red-600 text-white hover:bg-red-700" : "bg-brand-600 text-brand-900 hover:bg-brand-500"}`}>
              {submit}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
