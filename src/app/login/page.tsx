import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Field, Input } from "@/components/ui";
import { login } from "./actions";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-900 to-brand-700 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-xl">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-brand-900">الكمال للنقليات</h1>
          <p className="mt-1 text-sm text-gray-500">نظام إدارة الشركة</p>
        </div>
        <ActionForm action={login} className="flex flex-col gap-4" resetOnSuccess={false}>
          <Field label="اسم الدخول (الجوال أو البريد)">
            <Input name="login" autoComplete="username" required dir="ltr" />
          </Field>
          <Field label="كلمة المرور">
            <Input name="password" type="password" autoComplete="current-password" required dir="ltr" />
          </Field>
          <SubmitButton>دخول</SubmitButton>
        </ActionForm>
      </div>
    </main>
  );
}
