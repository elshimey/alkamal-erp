"use client";

import { startTransition, useActionState, useState } from "react";
import { PendingContext, SubmitButton } from "@/components/action-form";
import { Field, Input, Select } from "@/components/ui";
import { PasswordInput } from "@/components/password-input";
import { waNumber } from "@/components/send-document";
import { createTenantAction, type CreateState } from "./actions";

/** رسالة جاهزة بالرابط وبيانات الدخول، تُنسخ أو تُرسل بواتساب. */
export function WelcomeMessage({ text, phone }: { text: string; phone?: string | null }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="col-span-full mt-3 rounded-xl border border-green-200 bg-white p-3">
      <div className="text-sm leading-relaxed break-words whitespace-pre-wrap text-gray-800">{text}</div>
      <div className="mt-3 flex flex-wrap gap-2">
        <a
          href={`https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}`}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-500"
        >
          إرسال بواتساب
        </a>
        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(text).then(() => setCopied(true))}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50"
        >
          {copied ? "نُسخت ✓" : "نسخ الرسالة"}
        </button>
      </div>
    </div>
  );
}

export function CreateTenantForm() {
  const [state, action, pending] = useActionState(createTenantAction, undefined);
  return (
    <PendingContext.Provider value={pending}>
      <form
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          startTransition(() => action(data));
        }}
      >
        <Field label="اسم الشركة">
          <Input name="name" required placeholder="مؤسسة النقل السريع" />
        </Field>
        <Field label="رمز الشركة" hint="يكتبه موظفوها عند الدخول: حروف إنجليزية صغيرة أو أرقام">
          <Input name="slug" required pattern="[a-z0-9]{2,30}" dir="ltr" placeholder="1001" />
        </Field>
        <Field label="نوع الاشتراك">
          <Select name="trialDays" defaultValue="15">
            <option value="15">تجربة 15 يوماً</option>
            <option value="30">تجربة 30 يوماً</option>
            <option value="0">اشتراك فعلي</option>
          </Select>
        </Field>
        <Field label="جوال المدير أو بريده" hint="لإرسال بيانات الدخول بواتساب">
          <Input name="contact" dir="ltr" inputMode="tel" />
        </Field>
        <Field label="اسم مدير الشركة">
          <Input name="adminName" required />
        </Field>
        <Field label="اسم دخول المدير" hint="بالإنجليزي، يكفي أن يكون فريداً داخل الشركة">
          <Input name="adminLogin" required dir="ltr" autoComplete="off" />
        </Field>
        <Field label="كلمة مرور المدير" hint="8 أحرف على الأقل؛ اضغط العين للتأكد منها">
          <PasswordInput name="adminPassword" required minLength={8} autoComplete="new-password" />
        </Field>
        <div className="flex items-end">
          <SubmitButton pendingLabel="جارٍ تجهيز الشركة…">إنشاء الشركة</SubmitButton>
        </div>
        {state?.error && (
          <p role="alert" className="col-span-full rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {state.error}
          </p>
        )}
        {state?.ok && (
          <div className="col-span-full rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
            {state.ok}
            {state.welcome && <WelcomeMessage text={state.welcome} phone={state.phone} />}
          </div>
        )}
      </form>
    </PendingContext.Provider>
  );
}

/** نموذج صغير لتعيين كلمة مرور جديدة لمدير شركة قائمة. */
export function ResetAdminForm({ action }: { action: (state: CreateState, data: FormData) => Promise<CreateState> }) {
  const [state, run, pending] = useActionState(action, undefined);
  return (
    <PendingContext.Provider value={pending}>
      <form
        className="mt-3 border-t border-gray-100 pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          startTransition(() => run(data));
        }}
      >
        <p className="mb-2 text-xs text-gray-600">لم تصل كلمة المرور أو نسيها المدير؟ عيّن واحدة جديدة:</p>
        <div className="flex gap-2">
          <PasswordInput name="password" required minLength={8} autoComplete="new-password" className="!py-1.5 text-xs" />
          <SubmitButton variant="secondary" className="shrink-0 !px-3 !py-1.5 text-xs whitespace-nowrap" pendingLabel="…">
            تعيين
          </SubmitButton>
        </div>
        {state?.error && <p className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">{state.error}</p>}
        {state?.ok && <p className="mt-2 text-xs text-green-800">{state.ok}</p>}
        {state?.welcome && <WelcomeMessage text={state.welcome} phone={state.phone} />}
      </form>
    </PendingContext.Provider>
  );
}
