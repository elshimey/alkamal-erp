import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PasswordInput } from "@/components/password-input";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Field, Input } from "@/components/ui";
import { BrandMark, Logo } from "@/components/logo";
import { getBrand } from "@/lib/brand";
import { Truck } from "@/components/icons";
import { login } from "./actions";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");
  const brand = await getBrand(true);
  return (
    <main className="flex min-h-screen bg-concrete">
      {/* لوحة الهوية: الطريق والشاحنة */}
      <section className="relative hidden flex-1 flex-col justify-between overflow-hidden bg-asphalt-900 p-12 text-white lg:flex">
        <div className="absolute -top-32 -start-32 size-[28rem] rounded-full bg-brand-600/10 blur-3xl" />
        <div className="animate-rise relative flex items-center gap-4">
          <BrandMark logo={brand.logo} size={52} />
          <div>
            <div className="font-display text-2xl font-semibold">{brand.name}</div>
            {brand.known && <div className="text-sm text-white/50">نظام إدارة النقل والحسابات</div>}
          </div>
        </div>
        <div className="animate-rise stagger relative max-w-md" style={{ "--i": 2 } as React.CSSProperties}>
          <h1 className="text-4xl leading-snug font-semibold">
            كل رحلة، وكل ريال،
            <br />
            <span className="text-brand-500">في مكان واحد.</span>
          </h1>
          <p className="mt-4 leading-relaxed text-white/55">
            الأسطول والسائقون والعقود والبوالص والحسابات في نظام واحد، يربط كل مركبة بتكاليفها وإيراداتها.
          </p>
        </div>
        <div className="relative -mx-12 -mb-12 h-24 bg-asphalt-800">
          <div className="road-line-h road-moving-h absolute inset-x-0 bottom-8 opacity-80" />
          <div className="drive-across absolute bottom-6">
            <Truck className="truck-bump w-28" spinning />
          </div>
        </div>
      </section>

      {/* نموذج الدخول */}
      <section className="flex w-full items-center justify-center p-6 lg:max-w-xl">
        <div className="animate-page-in w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo name={brand.name} logo={brand.logo} />
          </div>
          <h2 className="text-2xl font-semibold text-brand-900">تسجيل الدخول</h2>
          <p className="mt-1 mb-7 text-sm text-gray-500">أدخل اسم الدخول وكلمة المرور للمتابعة.</p>
          <ActionForm action={login} className="flex flex-col gap-4" resetOnSuccess={false}>
            <Field label="اسم الدخول (الجوال أو البريد)">
              <Input name="login" autoComplete="username" required dir="ltr" className="py-2.5" />
            </Field>
            <Field label="كلمة المرور">
              <PasswordInput name="password" autoComplete="current-password" required dir="ltr" className="py-2.5" />
            </Field>
            <SubmitButton>دخول</SubmitButton>
          </ActionForm>
          <div className="road-line-h mt-10 opacity-40" />
        </div>
      </section>
    </main>
  );
}
