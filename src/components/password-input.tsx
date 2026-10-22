"use client";

import { useState, type ComponentProps } from "react";
import { Input } from "./ui";

/** حقل كلمة مرور بزر عين لإظهارها والتأكد منها قبل الإرسال. */
export function PasswordInput({ className = "", ...props }: Omit<ComponentProps<"input">, "type">) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative w-full" dir="ltr">
      <Input {...props} type={shown ? "text" : "password"} dir="ltr" className={`w-full pe-10 ${className}`} />
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        aria-label={shown ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
        title={shown ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
        className="absolute inset-y-0 end-0 flex w-10 items-center justify-center text-gray-400 transition hover:text-brand-700"
      >
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
          {shown && <path d="M3 3l18 18" />}
        </svg>
      </button>
    </div>
  );
}
