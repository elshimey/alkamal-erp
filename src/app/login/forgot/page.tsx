import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Field, Input } from "@/components/ui";
import { Logo } from "@/components/logo";
import { getBrand } from "@/lib/brand";
import { mailConfigured } from "@/lib/mailer";
import { requestAccess, requestResetLink } from "../actions";

const SUPPORT_PHONE = "966535443598";

/** نسيت كلمة المرور أو اسم الدخول: طلب لمدير النظام في الشركة، أو تواصل مباشر مع الدعم. */
export default async function ForgotPage() {
  const brand = await getBrand(true);
  const email = mailConfigured();
  const wa = `https://wa.me/${SUPPORT_PHONE}?text=${encodeURIComponent(`السلام عليكم، نسيت بيانات الدخول إلى ${brand.name}. اسمي: `)}`;
  return (
    <main className="flex min-h-screen items-center justify-center bg-concrete p-6">
      <div className="animate-page-in w-full max-w-md">
        <div className="mb-8">
          <Logo name={brand.name} logo={brand.logo} />
        </div>
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-brand-900">نسيت كلمة المرور أو اسم الدخول؟</h1>
          <p className="mt-1 mb-5 text-sm leading-relaxed text-gray-500">اسم الدخول هو غالباً رقم جوالك أو بريدك الذي سجّلك به مدير النظام.</p>
          {email && (
            <>
              <h2 className="mb-3 font-semibold text-gray-800">استرجاع عبر البريد</h2>
              <ActionForm action={requestResetLink} className="flex flex-col gap-4">
                <Field label="اسم الدخول أو البريد الإلكتروني">
                  <Input name="identifier" required dir="ltr" autoComplete="username" className="py-2.5" />
                </Field>
                <SubmitButton>أرسل رابط الاسترجاع</SubmitButton>
              </ActionForm>
              <div className="my-5 h-px bg-gray-200" />
            </>
          )}
          <h2 className="mb-1 font-semibold text-gray-800">{email ? "لا بريد مسجل لك؟ اطلب من مدير النظام" : "اطلب من مدير النظام"}</h2>
          <p className="mb-4 text-xs leading-relaxed text-gray-500">يصل طلبك لمدير النظام في شركتك، فيعيّن لك كلمة مرور جديدة ويتواصل معك.</p>
          <ActionForm action={requestAccess} className="flex flex-col gap-4">
            <Field label="اسم الدخول" hint="إن تذكرته؛ اتركه فارغاً إن نسيته">
              <Input name="login" dir="ltr" autoComplete="username" className="py-2.5" />
            </Field>
            <Field label="اسمك">
              <Input name="name" required autoComplete="name" className="py-2.5" />
            </Field>
            <Field label="كيف يتواصل معك المدير؟" hint="رقم جوالك أو بريدك، ليبلغك بكلمة المرور الجديدة">
              <Input name="contact" required dir="ltr" autoComplete="tel" className="py-2.5" />
            </Field>
            <SubmitButton>إرسال الطلب لمدير النظام</SubmitButton>
          </ActionForm>
          <div className="my-5 flex items-center gap-3 text-xs text-gray-400">
            <span className="h-px flex-1 bg-gray-200" />
            أو
            <span className="h-px flex-1 bg-gray-200" />
          </div>
          <a href={wa} target="_blank" rel="noopener noreferrer" className="flex w-full items-center justify-center gap-2 rounded-lg border border-green-600/30 bg-green-50 px-4 py-2.5 text-sm font-semibold text-green-800 hover:bg-green-100">
            تواصل مع الدعم عبر واتساب
          </a>
        </div>
        <Link href="/login" className="mt-5 block text-center text-sm text-brand-700 hover:underline">
          ← العودة لتسجيل الدخول
        </Link>
      </div>
    </main>
  );
}
