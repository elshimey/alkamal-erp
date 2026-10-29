"use client";

import { Truck } from "./icons";
import { newOpId } from "@/lib/op-id";
import { createContext, startTransition, useActionState, useContext, useEffect, useRef, type ReactNode } from "react";

export type FormState = { error?: string; ok?: string } | undefined;

export const PendingContext = createContext(false);

/** رسالة انقطاع الاتصال أثناء الإرسال: إعادة الضغط آمنة لأن معرّف الإرسال لا يتغير. */
export const RETRY_MESSAGE = "تعذّر الاتصال بالخادم؛ اضغط مرة أخرى، ولن تتكرر العملية إن كانت حُفظت";

export function SubmitButton({
  children,
  variant = "primary",
  pendingLabel = "جارٍ الحفظ…",
  className = "",
  op,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary";
  pendingLabel?: string;
  className?: string;
  /** لنموذج بعدة أزرار: يضع قيمته في حقل op المخفي قبل الإرسال */
  op?: string;
}) {
  const pending = useContext(PendingContext);
  const styles =
    variant === "primary"
      ? "bg-brand-600 font-semibold text-brand-900 hover:bg-brand-500"
      : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50";
  return (
    <button
      type="submit"
      disabled={pending}
      onClick={
        op
          ? (e) => {
              const field = e.currentTarget.form?.elements.namedItem("op");
              if (field instanceof HTMLInputElement) field.value = op;
            }
          : undefined
      }
      className={`rounded-lg px-4 py-2 text-sm font-medium shadow-sm transition active:scale-[0.98] disabled:opacity-70 ${styles} ${className}`}
    >
      {pending ? (
        <span className="flex items-center justify-center gap-2">
          <Truck className="w-7" spinning />
          {pendingLabel}
        </span>
      ) : (
        children
      )}
    </button>
  );
}

/** نموذج يستدعي إجراء خادم ويعرض رسالة الخطأ أو النجاح. */
export function ActionForm({
  action,
  children,
  className = "",
  resetOnSuccess = true,
  id,
}: {
  action: (state: FormState, data: FormData) => Promise<FormState>;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  /** لربط حقول خارج النموذج به عبر الخاصية form (مثل مربعات الاختيار في جدول) */
  id?: string;
}) {
  // انقطاع الاتصال لا يُسقط الصفحة: يظهر تنبيه ويبقى ما كُتب لإعادة الإرسال
  const [state, formAction, pending] = useActionState(async (prev: FormState, data: FormData): Promise<FormState> => {
    try {
      return await action(prev, data);
    } catch {
      return { error: RETRY_MESSAGE };
    }
  }, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  // معرّف الإرسال (_op): يبقى نفسه إن انقطع الرد فلا تُسجَّل العملية مرتين عند إعادة الضغط، ويتجدد بعد كل رد
  const op = useRef("");
  // الإرسال يدوياً حتى لا تُمسح الحقول عند الخطأ؛ تُمسح فقط عند النجاح
  useEffect(() => {
    if (state?.error !== RETRY_MESSAGE) op.current = "";
    if (resetOnSuccess && state?.ok) formRef.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <PendingContext.Provider value={pending}>
      <form
        ref={formRef}
        id={id}
        className={className}
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          op.current ||= newOpId();
          data.set("_op", op.current);
          startTransition(() => formAction(data));
        }}
      >
        {children}
        {state?.error && (
          <p role="alert" className="shake col-span-full basis-full mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm whitespace-pre-line text-red-700">
            {state.error}
          </p>
        )}
        {state?.ok && (
          <p role="status" className="saved-pop col-span-full basis-full mt-2 flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm whitespace-pre-line text-green-800">
            <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center rounded-full bg-green-600 text-xs text-white">✓</span>
            {state.ok}
          </p>
        )}
      </form>
    </PendingContext.Provider>
  );
}
