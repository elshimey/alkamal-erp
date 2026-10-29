import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser, hasDriverSession } from "@/lib/auth";
import { getBrand } from "@/lib/brand";
import { DRIVER_DICT, DRIVER_LANG_COOKIE, DRIVER_LANGS, isRtl, LANG_NAMES, type DriverLang } from "@/data/driver-i18n";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { PasswordInput } from "@/components/password-input";
import { BrandMark } from "@/components/logo";
import { Truck } from "@/components/icons";
import { chooseLanguage, driverLogin } from "./actions";
import { lastCompanyCode } from "../../login/company-code";
import { ClearDriverPages } from "../offline";

export const viewport = { themeColor: "#1b2126" };

// صفحة دخول السائق: بلغته (عربي، أردو، هندي، إنجليزي)، وتفتح من رابط التطبيق مباشرة
export default async function DriverLoginPage() {
  // دخول المكتب على نفس الجهاز لا يغني عن دخول السائق
  if ((await hasDriverSession()) && (await getCurrentUser())) redirect("/driver");
  const saved = (await cookies()).get(DRIVER_LANG_COOKIE)?.value as DriverLang | undefined;
  const lang: DriverLang = saved && DRIVER_LANGS.includes(saved) ? saved : "ar";
  const t = DRIVER_DICT[lang];
  const brand = await getBrand(true);
  const code = await lastCompanyCode();

  return (
    <main dir={isRtl(lang) ? "rtl" : "ltr"} lang={lang} className="flex min-h-screen flex-col bg-concrete">
      <ClearDriverPages />
      <header className="relative overflow-hidden bg-asphalt-900 px-5 pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-16 text-white">
        <div className="absolute -top-24 -end-24 size-72 rounded-full bg-brand-600/15 blur-3xl" />
        <div className="relative mx-auto flex max-w-md items-center gap-3">
          <BrandMark logo={brand.logo} size={44} />
          <div className="min-w-0 leading-tight">
            <div className="truncate font-display text-lg font-semibold">{brand.known ? brand.name : t.appName}</div>
            {brand.known && <div className="text-xs text-white/55">{t.appName}</div>}
          </div>
        </div>
        <div className="road-line-h road-moving-h absolute inset-x-0 bottom-5 opacity-60" />
        <div className="drive-across absolute bottom-3">
          <Truck className="truck-bump w-20" spinning />
        </div>
      </header>

      <div className="mx-auto -mt-8 w-full max-w-md flex-1 px-4 pb-10">
        <section className="animate-rise rounded-3xl bg-white p-5 shadow-lg ring-1 ring-black/5">
          <h1 className="font-display text-2xl font-semibold text-asphalt-900">{t.loginTitle}</h1>
          <p className="mt-1 mb-5 text-sm text-gray-500">{t.loginHint}</p>
          <ActionForm action={driverLogin.bind(null, lang)} className="flex flex-col gap-4" resetOnSuccess={false}>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700">
              {t.companyCode}
              <input
                name="company"
                required
                dir="ltr"
                defaultValue={code}
                autoComplete="organization"
                autoCapitalize="none"
                className="rounded-xl border border-gray-300 bg-white px-4 py-3.5 text-base shadow-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/30"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700">
              {t.username}
              <input
                name="login"
                required
                dir="ltr"
                autoComplete="username"
                autoCapitalize="none"
                className="rounded-xl border border-gray-300 bg-white px-4 py-3.5 text-base shadow-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/30"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700">
              {t.password}
              <PasswordInput name="password" required autoComplete="current-password" className="rounded-xl !py-3.5 !text-base" />
            </label>
            <SubmitButton className="!rounded-xl !py-3.5 !text-base" pendingLabel={t.signingIn}>
              {t.signIn}
            </SubmitButton>
          </ActionForm>
          <p className="mt-4 text-center text-xs text-gray-500">{t.forgot}</p>
        </section>

        <section className="animate-rise stagger mt-5" style={{ "--i": 1 } as React.CSSProperties}>
          <div className="mb-2 text-center text-xs font-medium text-gray-500">{t.chooseLanguage}</div>
          <div className="grid grid-cols-4 gap-2">
            {DRIVER_LANGS.map((l) => (
              <form key={l} action={chooseLanguage.bind(null, l)}>
                <button
                  type="submit"
                  aria-pressed={l === lang}
                  className={`w-full rounded-xl px-2 py-2.5 text-sm font-medium transition ${l === lang ? "bg-asphalt-900 text-brand-500 shadow" : "bg-white text-gray-700 ring-1 ring-black/10 hover:ring-brand-600/50"}`}
                >
                  {LANG_NAMES[l]}
                </button>
              </form>
            ))}
          </div>
        </section>

        <p className="mt-6 rounded-2xl bg-brand-50 px-4 py-3 text-center text-xs leading-relaxed text-brand-900">{t.install}</p>
      </div>
    </main>
  );
}
