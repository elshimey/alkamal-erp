import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PasswordInput } from "@/components/password-input";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Field, Input } from "@/components/ui";
import { BrandMark, Logo } from "@/components/logo";
import { getBrand } from "@/lib/brand";
import { Truck } from "@/components/icons";
import { login } from "./actions";
import { lastCompanyCode } from "./company-code";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reset?: string; driver?: string }> }) {
  if (await getCurrentUser()) redirect("/");
  const brand = await getBrand(true);
  const code = await lastCompanyCode();
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
            الأسطول والسائقون والعقود والشحنات والحسابات في نظام واحد، يربط كل مركبة بتكاليفها وإيراداتها.
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
          <p className="mt-1 mb-7 text-sm text-gray-500">أدخل رمز شركتك واسم الدخول وكلمة المرور للمتابعة.</p>
          {(await searchParams).reset === "1" && (
            <p role="status" className="-mt-3 mb-5 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
              عُيّنت كلمة المرور الجديدة؛ ادخل بها الآن.
            </p>
          )}
          {(await searchParams).driver === "1" && (
            <p role="status" className="-mt-3 mb-5 rounded-lg bg-brand-50 px-3 py-2 text-sm leading-relaxed text-brand-800">
              هذا الجهاز مسجّل في تطبيق السائق، ويبقى التطبيق يعمل كما هو. للدخول إلى البرنامج استخدم حساب المكتب.{" "}
              <Link href="/driver" className="font-semibold underline">
                فتح تطبيق السائق
              </Link>
            </p>
          )}
          <ActionForm action={login} className="flex flex-col gap-4" resetOnSuccess={false}>
            <Field label="رمز الشركة" hint="يصلك من مدير النظام في شركتك، ويُحفظ على هذا الجهاز">
              <Input name="company" autoComplete="organization" required dir="ltr" defaultValue={code} className="py-2.5" />
            </Field>
            <Field label="اسم الدخول (الجوال أو البريد)">
              <Input name="login" autoComplete="username" required dir="ltr" className="py-2.5" />
            </Field>
            <Field label="كلمة المرور">
              <PasswordInput name="password" autoComplete="current-password" required dir="ltr" className="py-2.5" />
            </Field>
            <Link href="/login/forgot" className="-mt-2 self-end text-xs text-brand-700 hover:underline">
              نسيت كلمة المرور أو اسم الدخول؟
            </Link>
            <SubmitButton>دخول</SubmitButton>
          </ActionForm>
          <div className="road-line-h mt-10 opacity-40" />
        </div>
      </section>
    </main>
  );
}
