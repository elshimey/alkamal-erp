import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Field, Input } from "@/components/ui";
import { Logo } from "@/components/logo";
import { login } from "./actions";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-asphalt-900 p-4">
      {/* خط الطريق يعبر الشاشة خلف بطاقة الدخول */}
      <div className="road-line-h absolute inset-x-0 top-1/2 opacity-60" />
      <div className="relative w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="h-1.5 bg-brand-600" />
        <div className="p-8">
        <div className="mb-7 flex justify-center">
          <Logo />
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
      </div>
    </main>
  );
}
