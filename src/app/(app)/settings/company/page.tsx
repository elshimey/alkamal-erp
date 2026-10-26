import Link from "next/link";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getCompany, invoiceReadiness } from "@/lib/company";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, Field, Input, PageHeader } from "@/components/ui";
import { LogoInput } from "./logo-input";
import { saveCompanyAction } from "./actions";

export default async function CompanyPage() {
  const user = await requirePermission("settings", "view");
  const c = await getCompany(db);
  const ready = invoiceReadiness(c);
  const edit = can(user.perms, "settings", "update");
  const v = (x: string | null) => x ?? "";

  return (
    <>
      <PageHeader title="بيانات المنشأة" description="الاسم والشعار والرقم الضريبي والعنوان الوطني. تظهر في رأس الفواتير الضريبية والتقارير المطبوعة.">
        <div className="flex items-center gap-4 text-sm">
          <Link href="/fleet-documents/owner/company-0" className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 font-medium text-brand-700 hover:bg-brand-50">
            وثائق المنشأة (السجل، الترخيص…)
          </Link>
          <Link href="/settings" className="text-brand-700 hover:underline">
            → الإعدادات
          </Link>
        </div>
      </PageHeader>

      <div className={`mb-6 flex items-center gap-4 rounded-2xl p-4 ${ready.missing.length ? "bg-amber-50" : "bg-green-50"}`}>
        <div className="relative size-14 shrink-0">
          <svg viewBox="0 0 36 36" className="size-14 -rotate-90">
            <circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" strokeWidth="3" className="text-black/5" />
            <circle
              cx="18"
              cy="18"
              r="15.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={`${(ready.percent / 100) * 97.4} 97.4`}
              className={ready.missing.length ? "text-amber-500" : "text-green-600"}
            />
          </svg>
          <span className="ltr-nums absolute inset-0 flex items-center justify-center text-xs font-semibold">{ready.percent}%</span>
        </div>
        <div className="text-sm">
          <div className="font-semibold text-gray-800">{ready.missing.length ? "جاهزية الفاتورة الضريبية" : "البيانات مكتملة للفاتورة الضريبية"}</div>
          {ready.missing.length > 0 && <div className="mt-0.5 text-gray-600">ينقص: {ready.missing.join("، ")}</div>}
        </div>
      </div>

      <ActionForm action={saveCompanyAction} resetOnSuccess={false} className="grid gap-6 xl:grid-cols-2">
        <fieldset disabled={!edit} className="contents">
          <Card title="الهوية">
            <div className="flex flex-col gap-4">
              <LogoInput initial={c.logo} />
              <Field label="اسم المنشأة بالعربي *">
                <Input name="nameAr" defaultValue={c.nameAr} required />
              </Field>
              <Field label="اسم المنشأة بالإنجليزي">
                <Input name="nameEn" defaultValue={v(c.nameEn)} dir="ltr" />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="الرقم الضريبي" hint="15 رقماً يبدأ وينتهي بـ 3">
                  <Input name="vatNumber" defaultValue={v(c.vatNumber)} dir="ltr" inputMode="numeric" maxLength={15} placeholder="3XXXXXXXXXXXXX3" />
                </Field>
                <Field label="السجل التجاري" hint="10 أرقام">
                  <Input name="crNumber" defaultValue={v(c.crNumber)} dir="ltr" inputMode="numeric" maxLength={10} />
                </Field>
                <Field label="رقم ترخيص النقل" hint="يظهر في وثيقة النقل">
                  <Input name="transportLicenseNo" defaultValue={v(c.transportLicenseNo)} dir="ltr" />
                </Field>
                <Field label="الرقم الموحد للمنشأة" hint="10 أرقام يبدأ بـ 7">
                  <Input name="establishmentNo" defaultValue={v(c.establishmentNo)} dir="ltr" inputMode="numeric" maxLength={10} placeholder="7XXXXXXXXX" />
                </Field>
              </div>
            </div>
          </Card>

          <Card title="العنوان الوطني والتواصل">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="رقم المبنى" hint="4 أرقام">
                <Input name="buildingNo" defaultValue={v(c.buildingNo)} dir="ltr" inputMode="numeric" maxLength={4} />
              </Field>
              <Field label="الشارع">
                <Input name="street" defaultValue={v(c.street)} />
              </Field>
              <Field label="الحي">
                <Input name="district" defaultValue={v(c.district)} />
              </Field>
              <Field label="المدينة">
                <Input name="city" defaultValue={v(c.city)} />
              </Field>
              <Field label="الرمز البريدي" hint="5 أرقام">
                <Input name="postalCode" defaultValue={v(c.postalCode)} dir="ltr" inputMode="numeric" maxLength={5} />
              </Field>
              <Field label="الرقم الإضافي" hint="4 أرقام">
                <Input name="additionalNo" defaultValue={v(c.additionalNo)} dir="ltr" inputMode="numeric" maxLength={4} />
              </Field>
              <Field label="الهاتف">
                <Input name="phone" defaultValue={v(c.phone)} dir="ltr" inputMode="tel" />
              </Field>
              <Field label="البريد الإلكتروني">
                <Input name="email" type="email" defaultValue={v(c.email)} dir="ltr" />
              </Field>
              <div className="sm:col-span-2">
                <Field label="الموقع الإلكتروني">
                  <Input name="website" defaultValue={v(c.website)} dir="ltr" placeholder="www.example.com" />
                </Field>
              </div>
            </div>
          </Card>
        </fieldset>
        {edit && (
          <div className="xl:col-span-2">
            <SubmitButton className="px-8">حفظ بيانات المنشأة</SubmitButton>
          </div>
        )}
      </ActionForm>
    </>
  );
}
