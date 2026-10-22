import { redirect } from "next/navigation";
import { baseSql } from "@/db";
import { getTenant, requireAdmin } from "@/lib/auth";
import { listTenants } from "@/lib/platform";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { activateAction, createTenantAction, deleteAction, extendAction, suspendAction } from "./actions";

export const maxDuration = 60; // إنشاء شركة يبني جداولها كاملة

const date = (d: Date | null) => (d ? new Date(d).toLocaleDateString("en-GB") : "—");

export default async function OwnerPage() {
  await requireAdmin();
  if (!(await getTenant()).isHome) redirect("/?denied=1");
  const tenants = await listTenants(baseSql);
  const others = tenants.filter((t) => t.schema_name !== "public");

  return (
    <>
      <PageHeader title="الشركات المشتركة" description="كل شركة تدخل من نفس الرابط ببيانات منفصلة تماماً. التجربة تتوقف وحدها عند انتهاء مدتها، وتبقى بياناتها حتى تفعّلها أو تحذفها." />

      <Card title="إضافة شركة" className="mb-6">
        <ActionForm action={createTenantAction} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="اسم الشركة">
            <Input name="name" required placeholder="مؤسسة النقل السريع" />
          </Field>
          <Field label="رمز الشركة" hint="حروف إنجليزية صغيرة وأرقام، لا يتغير">
            <Input name="slug" required pattern="[a-z][a-z0-9]{1,29}" dir="ltr" placeholder="fasttrans" />
          </Field>
          <Field label="نوع الاشتراك">
            <Select name="trialDays" defaultValue="15">
              <option value="15">تجربة 15 يوماً</option>
              <option value="30">تجربة 30 يوماً</option>
              <option value="0">اشتراك فعلي</option>
            </Select>
          </Field>
          <Field label="جوال أو بريد للتواصل">
            <Input name="contact" dir="ltr" />
          </Field>
          <Field label="اسم مدير الشركة">
            <Input name="adminName" required />
          </Field>
          <Field label="اسم دخول المدير" hint="فريد على مستوى كل الشركات">
            <Input name="adminLogin" required dir="ltr" autoComplete="off" />
          </Field>
          <Field label="كلمة مرور المدير" hint="8 أحرف على الأقل">
            <Input name="adminPassword" required minLength={8} dir="ltr" autoComplete="new-password" />
          </Field>
          <div className="flex items-end">
            <SubmitButton pendingLabel="جارٍ تجهيز الشركة…">إنشاء الشركة</SubmitButton>
          </div>
        </ActionForm>
      </Card>

      <Table head={["الشركة", "الحالة", "التجربة تنتهي", "المستخدمون", "القيود", "آخر دخول", "إجراءات"]}>
        {tenants.map((t) => {
          const home = t.schema_name === "public";
          const left = t.daysLeft;
          const expired = t.status === "trial" && (left ?? 0) <= 0;
          return (
            <tr key={t.id}>
              <Td>
                <div className="font-semibold text-gray-800">{t.name}</div>
                <div className="ltr-nums text-xs text-gray-500" dir="ltr">
                  {home ? "شركة البداية" : t.slug}
                  {t.contact ? ` · ${t.contact}` : ""}
                </div>
              </Td>
              <Td>
                {t.status === "active" ? (
                  <Badge tone="green">{home ? "رئيسية" : "مشترك"}</Badge>
                ) : t.status === "suspended" ? (
                  <Badge tone="red">موقوف</Badge>
                ) : expired ? (
                  <Badge tone="red">انتهت التجربة</Badge>
                ) : (
                  <Badge tone="amber">تجربة · باقي {left} يوم</Badge>
                )}
              </Td>
              <Td className="ltr-nums">{date(t.trial_ends_at)}</Td>
              <Td className="ltr-nums">{t.users}</Td>
              <Td className="ltr-nums">{t.entries}</Td>
              <Td className="ltr-nums">{date(t.last_login)}</Td>
              <Td>
                {home ? (
                  <span className="text-xs text-gray-400">—</span>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {t.status !== "active" && (
                      <ActionForm action={activateAction.bind(null, t.id)} resetOnSuccess={false}>
                        <SubmitButton className="!px-3 !py-1.5 text-xs">تحويل لاشتراك فعلي</SubmitButton>
                      </ActionForm>
                    )}
                    {t.status !== "suspended" && t.status === "trial" && (
                      <ActionForm action={extendAction.bind(null, t.id)} resetOnSuccess={false}>
                        <SubmitButton variant="secondary" className="!px-3 !py-1.5 text-xs">تمديد 15 يوماً</SubmitButton>
                      </ActionForm>
                    )}
                    <ActionForm action={suspendAction.bind(null, t.id, t.status !== "suspended")} resetOnSuccess={false}>
                      <SubmitButton variant="secondary" className="!px-3 !py-1.5 text-xs">{t.status === "suspended" ? "إعادة التشغيل" : "إيقاف"}</SubmitButton>
                    </ActionForm>
                    <details className="relative">
                      <summary className="cursor-pointer list-none rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50">حذف</summary>
                      <div className="absolute end-0 z-20 mt-2 w-64 rounded-xl border border-red-200 bg-white p-3 shadow-lg">
                        <p className="mb-2 text-xs leading-relaxed text-gray-600">
                          تُحذف الشركة وكل بياناتها نهائياً ولا يمكن استرجاعها. اكتب <b dir="ltr">{t.slug}</b> للتأكيد.
                        </p>
                        <ActionForm action={deleteAction.bind(null, t.id)} resetOnSuccess={false} className="flex gap-2">
                          <Input name="confirm" required dir="ltr" className="!py-1.5 text-xs" />
                          <SubmitButton className="!bg-red-600 !px-3 !py-1.5 text-xs !text-white">حذف</SubmitButton>
                        </ActionForm>
                      </div>
                    </details>
                  </div>
                )}
              </Td>
            </tr>
          );
        })}
      </Table>
      {others.length === 0 && <p className="mt-4 text-sm text-gray-500">لا توجد شركات مشتركة بعد؛ أضف أول شركة من النموذج أعلاه.</p>}
    </>
  );
}
