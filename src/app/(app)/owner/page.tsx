import { redirect } from "next/navigation";
import { baseSql } from "@/db";
import { getTenant, requireAdmin } from "@/lib/auth";
import { listTenants } from "@/lib/platform";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Input, PageHeader, Table, Td } from "@/components/ui";
import { activateAction, deleteAction, extendAction, resetAdminAction, suspendAction, tenantWelcome } from "./actions";
import { CreateTenantForm, ResetAdminForm, WelcomeMessage } from "./create-form";

export const maxDuration = 60; // إنشاء شركة يبني جداولها كاملة

const date = (d: Date | null) => (d ? new Date(d).toLocaleDateString("en-GB") : "—");

export default async function OwnerPage() {
  await requireAdmin();
  if (!(await getTenant()).isHome) redirect("/?denied=1");
  const tenants = await listTenants(baseSql);
  const others = tenants.filter((t) => t.schema_name !== "public");
  const welcome = new Map(await Promise.all(others.filter((t) => t.admin_login).map(async (t) => [t.id, await tenantWelcome(t.name, t.admin_name ?? "", t.admin_login!)] as const)));

  return (
    <>
      <PageHeader title="الشركات المشتركة" description="كل شركة تدخل من نفس الرابط ببيانات منفصلة تماماً. التجربة تتوقف وحدها عند انتهاء مدتها، وتبقى بياناتها حتى تفعّلها أو تحذفها." />

      <Card title="إضافة شركة" className="mb-6">
        <CreateTenantForm />
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
                  {t.admin_login && !home ? ` · دخول المدير: ${t.admin_login}` : ""}
                </div>
              </Td>
              <Td>
                {t.broken ? (
                  <Badge tone="red">لم يكتمل إنشاؤها · احذفها أو أعد إنشاءها بنفس الرمز</Badge>
                ) : t.status === "active" ? (
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
                    {welcome.has(t.id) && (
                      <details className="relative w-full sm:w-auto">
                        <summary className="w-fit cursor-pointer list-none rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">رسالة الدخول</summary>
                        <div className="z-20 mt-2 w-full rounded-xl border border-gray-200 bg-white p-2 shadow-lg sm:absolute sm:end-0 sm:w-96">
                          <WelcomeMessage text={welcome.get(t.id)!} phone={t.contact} />
                          <ResetAdminForm action={resetAdminAction.bind(null, t.id, t.contact)} />
                        </div>
                      </details>
                    )}
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
