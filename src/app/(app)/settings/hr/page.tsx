import Link from "next/link";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getHrSettings, listCriteria, listLeaveTypes } from "@/lib/hr";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, Field, Input, PageHeader } from "@/components/ui";
import { saveCriterionAction, saveHrSettingsAction, saveLeaveTypeAction } from "../../hr/actions";

const check = "size-4 accent-brand-600";

export default async function HrSettingsPage() {
  const user = await requirePermission("settings", "view");
  const [st, criteria, types] = await Promise.all([getHrSettings(db), listCriteria(db), listLeaveTypes(db)]);
  const edit = can(user.perms, "settings", "update");
  const totalWeight = criteria.filter((c) => c.active).reduce((t, c) => t + c.weight, 0);

  return (
    <>
      <PageHeader title="إعدادات الموارد البشرية" description="نقاط الإنذار، والترقية، ونافذة مقدم العمولة وسقفه، ومعايير التقييم، وأنواع الإجازات.">
        <Link href="/settings" className="text-sm text-brand-700 hover:underline">
          → الإعدادات
        </Link>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="التقييم والانضباط ومقدم العمولة" className="lg:col-span-2">
          <ActionForm action={saveHrSettingsAction} resetOnSuccess={false} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="نقاط الإنذار الافتراضية" hint="تُخصم من تقييم الشهر عن كل إنذار">
              <Input type="number" name="warningPoints" min={0} max={50} defaultValue={st.warningPoints} disabled={!edit} />
            </Field>
            <Field label="درجة الترقية" hint="من 100">
              <Input type="number" name="promotionScore" min={50} max={100} defaultValue={st.promotionScore} disabled={!edit} />
            </Field>
            <Field label="أشهر متتالية للترقية">
              <Input type="number" name="promotionMonths" min={1} max={12} defaultValue={st.promotionMonths} disabled={!edit} />
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input type="checkbox" name="violationsAsWarnings" defaultChecked={st.violationsAsWarnings} disabled={!edit} className={check} />
              المخالفة المرورية تُحسب إنذاراً
            </label>
            <Field label="يوم فتح طلب مقدم العمولة">
              <Input type="number" name="advanceOpenDay" min={1} max={31} defaultValue={st.advanceOpenDay} disabled={!edit} />
            </Field>
            <Field label="يوم الإغلاق">
              <Input type="number" name="advanceCloseDay" min={1} max={31} defaultValue={st.advanceCloseDay} disabled={!edit} />
            </Field>
            <Field label="السقف الشهري – سائق داخلي">
              <Input type="number" name="advanceCapDomestic" min={0} step="0.01" defaultValue={Number(st.advanceCapDomestic)} disabled={!edit} />
            </Field>
            <Field label="السقف الشهري – سائق دولي">
              <Input type="number" name="advanceCapInternational" min={0} step="0.01" defaultValue={Number(st.advanceCapInternational)} disabled={!edit} />
            </Field>
            {edit && (
              <div className="sm:col-span-2 lg:col-span-4">
                <SubmitButton>حفظ الإعدادات</SubmitButton>
              </div>
            )}
          </ActionForm>
        </Card>

        <Card title={`معايير التقييم (مجموع الأوزان ${totalWeight})`}>
          <div className="space-y-2">
            {[...criteria, null].map((c) =>
              !c && !edit ? null : (
                <ActionForm key={c?.id ?? "new"} action={saveCriterionAction} resetOnSuccess={!c} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="id" value={c?.id ?? ""} />
                  <Input name="nameAr" required defaultValue={c?.nameAr ?? ""} placeholder="معيار جديد" disabled={!edit} className="min-w-0 flex-1" />
                  <Input type="number" name="weight" min={1} max={10} required defaultValue={c?.weight ?? 5} disabled={!edit} className="w-20" title="الوزن من 1 إلى 10" />
                  <label className="flex items-center gap-1 text-xs text-gray-600">
                    <input type="checkbox" name="active" defaultChecked={c?.active ?? true} disabled={!edit} className={check} />
                    فعّال
                  </label>
                  {edit && <SubmitButton variant={c ? "secondary" : "primary"}>{c ? "حفظ" : "إضافة"}</SubmitButton>}
                </ActionForm>
              ),
            )}
          </div>
          <p className="mt-3 text-xs text-gray-500">الوزن من 1 إلى 10 يحدد أهمية المعيار في الدرجة النهائية.</p>
        </Card>

        <Card title="أنواع الإجازات">
          <div className="space-y-2">
            {[...types, null].map((t) =>
              !t && !edit ? null : (
                <ActionForm key={t?.id ?? "new"} action={saveLeaveTypeAction} resetOnSuccess={!t} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="id" value={t?.id ?? ""} />
                  <Input name="nameAr" required defaultValue={t?.nameAr ?? ""} placeholder="نوع جديد" disabled={!edit} className="min-w-0 flex-1" />
                  {t?.isAnnual ? (
                    <span className="w-24 text-center text-xs text-gray-500">21 / 30 يوماً</span>
                  ) : (
                    <Input type="number" name="yearlyDays" min={1} max={365} defaultValue={t?.yearlyDays ?? ""} placeholder="بلا رصيد" disabled={!edit} className="w-24" title="الرصيد السنوي بالأيام" />
                  )}
                  <label className="flex items-center gap-1 text-xs text-gray-600">
                    <input type="checkbox" name="paid" defaultChecked={t?.paid ?? true} disabled={!edit} className={check} />
                    مدفوعة
                  </label>
                  <label className="flex items-center gap-1 text-xs text-gray-600">
                    <input type="checkbox" name="active" defaultChecked={t?.active ?? true} disabled={!edit} className={check} />
                    فعّال
                  </label>
                  {edit && <SubmitButton variant={t ? "secondary" : "primary"}>{t ? "حفظ" : "إضافة"}</SubmitButton>}
                </ActionForm>
              ),
            )}
          </div>
          <p className="mt-3 text-xs text-gray-500">السنوية حسب نظام العمل: 21 يوماً، و30 بعد خمس سنوات. غير المدفوعة تُخصم من الراتب في المسير.</p>
        </Card>
      </div>
    </>
  );
}
