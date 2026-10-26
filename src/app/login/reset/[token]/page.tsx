import Link from "next/link";
import { baseSql } from "@/db";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { PasswordInput } from "@/components/password-input";
import { Field } from "@/components/ui";
import { Logo } from "@/components/logo";
import { getBrand } from "@/lib/brand";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";
import { resetTarget } from "@/lib/password-reset";
import { completeReset } from "../../actions";

/** صفحة رابط الاسترجاع: كلمة مرور جديدة لصاحب الرابط إن كان صالحاً. */
export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [brand, target] = await Promise.all([getBrand(true), resetTarget(baseSql, token)]);
  return (
    <main className="flex min-h-screen items-center justify-center bg-concrete p-6">
      <div className="animate-page-in w-full max-w-md">
        <div className="mb-8">
          <Logo name={brand.name} logo={brand.logo} />
        </div>
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          {target ? (
            <>
              <h1 className="text-xl font-semibold text-brand-900">كلمة مرور جديدة</h1>
              <p className="mt-1 mb-5 text-sm text-gray-500">
                للحساب <span className="font-medium text-gray-800">{target.name}</span> · اسم الدخول{" "}
                <span className="ltr-nums font-medium text-gray-800" dir="ltr">
                  {target.login}
                </span>
              </p>
              <ActionForm action={completeReset.bind(null, token)} className="flex flex-col gap-4" resetOnSuccess={false}>
                <Field label="كلمة المرور الجديدة" hint={`${MIN_PASSWORD_LENGTH} أحرف على الأقل`}>
                  <PasswordInput name="password" required minLength={MIN_PASSWORD_LENGTH} dir="ltr" autoComplete="new-password" className="py-2.5" />
                </Field>
                <Field label="تأكيدها">
                  <PasswordInput name="confirm" required dir="ltr" autoComplete="new-password" className="py-2.5" />
                </Field>
                <SubmitButton>حفظ كلمة المرور</SubmitButton>
              </ActionForm>
            </>
          ) : (
            <>
              <h1 className="text-xl font-semibold text-brand-900">الرابط غير صالح</h1>
              <p className="mt-2 mb-5 text-sm leading-relaxed text-gray-500">انتهت مدة الرابط (ساعة واحدة) أو استُخدم من قبل. اطلب رابطاً جديداً.</p>
              <Link href="/login/forgot" className="block rounded-lg bg-brand-600 px-4 py-2.5 text-center text-sm font-semibold text-brand-900 hover:bg-brand-500">
                طلب رابط جديد
              </Link>
            </>
          )}
        </div>
        <Link href="/login" className="mt-5 block text-center text-sm text-brand-700 hover:underline">
          ← العودة لتسجيل الدخول
        </Link>
      </div>
    </main>
  );
}
