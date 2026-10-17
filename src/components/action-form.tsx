"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useRef, type ReactNode } from "react";

export type FormState = { error?: string; ok?: string } | undefined;

const PendingContext = createContext(false);

export function SubmitButton({ children, variant = "primary" }: { children: ReactNode; variant?: "primary" | "secondary" }) {
  const pending = useContext(PendingContext);
  const styles =
    variant === "primary"
      ? "bg-brand-600 font-semibold text-brand-900 hover:bg-brand-500"
      : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50";
  return (
    <button
      type="submit"
      disabled={pending}
      className={`rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-60 ${styles}`}
    >
      {pending ? "جارٍ الحفظ…" : children}
    </button>
  );
}

/** نموذج يستدعي إجراء خادم ويعرض رسالة الخطأ أو النجاح. */
export function ActionForm({
  action,
  children,
  className = "",
  resetOnSuccess = true,
}: {
  action: (state: FormState, data: FormData) => Promise<FormState>;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  // الإرسال يدوياً حتى لا تُمسح الحقول عند الخطأ؛ تُمسح فقط عند النجاح
  useEffect(() => {
    if (resetOnSuccess && state?.ok) formRef.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <PendingContext.Provider value={pending}>
      <form
        ref={formRef}
        className={className}
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          startTransition(() => formAction(data));
        }}
      >
        {children}
        {state?.error && (
          <p role="alert" className="col-span-full mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm whitespace-pre-line text-red-700">
            {state.error}
          </p>
        )}
        {state?.ok && <p className="col-span-full mt-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{state.ok}</p>}
      </form>
    </PendingContext.Provider>
  );
}
