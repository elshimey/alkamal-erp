import { redirect } from "next/navigation";
import { baseSql } from "@/db";
import { getTenant, isPlatformOwner, requireAdmin } from "@/lib/auth";
import { listTenants } from "@/lib/platform";
import { recentErrors } from "@/lib/error-log";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Input, PageHeader, Table, Td } from "@/components/ui";
import { activateAction, codeAction, deleteAction, extendAction, resetAdminAction, suspendAction, tenantWelcome } from "./actions";
import { CreateTenantForm, ResetAdminForm, WelcomeMessage } from "./create-form";
import { AccessRequests } from "../users/access-requests";
import { DialogButton } from "@/components/dialog-button";

export const maxDuration = 60; // إنشاء شركة يبني جداولها كاملة

const date = (d: Date | null) => (d ? new Date(d).toLocaleDateString("en-GB") : "—");

export default async function OwnerPage() {
  const user = await requireAdmin();
  if (!(await getTenant()).isHome) redirect("/?denied=1");
  const canDelete = await isPlatformOwner(user);
  const [tenants, errors] = await Promise.all([listTenants(baseSql), recentErrors()]);
  const others = tenants.filter((t) => t.schema_name !== "public");
  const welcome = new Map(await Promise.all(others.filter((t) => t.admin_login).map(async (t) => [t.id, await tenantWelcome(t.name, t.slug, t.admin_name ?? "", t.admin_login!)] as const)));

  return (
    <>
      <PageHeader title="الشركات المشتركة" description="كل شركة تدخل من نفس الرابط ببيانات منفصلة تماماً. التجربة تتوقف وحدها عند انتهاء مدتها، وتبقى بياناتها حتى تفعّلها أو تحذفها." />

      <AccessRequests schema={null} />

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
                  رمز الدخول: <b className="text-gray-800">{t.slug}</b>
                  {home ? " · شركة البداية" : ""}
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
                <div className="flex flex-wrap gap-2">
                  <DialogButton label="تغيير الرمز" title={`رمز دخول «${t.name}»`}>
                    <p className="mb-3 text-sm leading-relaxed text-gray-600">يدخل موظفو الشركة بالرمز الجديد بدل القديم، وتبقى بياناتها كما هي. أبلغهم بالرمز الجديد بعد الحفظ.</p>
                    <ActionForm action={codeAction.bind(null, t.id)} resetOnSuccess={false} className="flex flex-wrap gap-2">
                      <Input name="code" required dir="ltr" defaultValue={t.slug} pattern="[a-z0-9]{2,30}" title="حروف إنجليزية صغيرة أو أرقام" className="min-w-0 flex-1" />
                      <SubmitButton>حفظ الرمز</SubmitButton>
                    </ActionForm>
                  </DialogButton>
                  {!home && (
                    <>
                      {welcome.has(t.id) && (
                        <DialogButton label="رسالة الدخول" title={`رسالة الدخول لمدير «${t.name}»`}>
                          <WelcomeMessage text={welcome.get(t.id)!} phone={t.contact} />
                          <ResetAdminForm action={resetAdminAction.bind(null, t.id, t.contact)} />
                        </DialogButton>
                      )}
                      {t.status !== "active" && (
                        <DialogButton label="تحويل لاشتراك فعلي" title="تحويل لاشتراك فعلي" className="!border-brand-600 !bg-brand-600 font-semibold !text-brand-900 hover:!bg-brand-500">
                          <p className="mb-3 text-sm leading-relaxed text-gray-600">تصبح «{t.name}» مشتركة دون مدة تجربة، وتبقى كل بياناتها.</p>
                          <ActionForm action={activateAction.bind(null, t.id)} resetOnSuccess={false}>
                            <SubmitButton>تأكيد التحويل</SubmitButton>
                          </ActionForm>
                        </DialogButton>
                      )}
                      {t.status === "trial" && (
                        <ActionForm action={extendAction.bind(null, t.id)} resetOnSuccess={false}>
                          <SubmitButton variant="secondary" className="!px-3 !py-1.5 text-xs">تمديد 15 يوماً</SubmitButton>
                        </ActionForm>
                      )}
                      <DialogButton label={t.status === "suspended" ? "إعادة التشغيل" : "إيقاف"} title={t.status === "suspended" ? "إعادة تشغيل الشركة" : "إيقاف الشركة"} danger={t.status !== "suspended"}>
                        <p className="mb-3 text-sm leading-relaxed text-gray-600">
                          {t.status === "suspended" ? `يعود موظفو «${t.name}» للدخول كالمعتاد.` : `يتوقف دخول كل موظفي «${t.name}» حتى تعيد تشغيلها، وتبقى بياناتها محفوظة.`}
                        </p>
                        <ActionForm action={suspendAction.bind(null, t.id, t.status !== "suspended")} resetOnSuccess={false}>
                          <SubmitButton className={t.status === "suspended" ? "" : "!bg-red-600 !text-white hover:!bg-red-500"}>{t.status === "suspended" ? "تأكيد إعادة التشغيل" : "تأكيد الإيقاف"}</SubmitButton>
                        </ActionForm>
                      </DialogButton>
                      {canDelete && (
                        <DialogButton label="حذف" title={`حذف «${t.name}» نهائياً`} danger>
                          <p className="mb-3 text-sm leading-relaxed text-gray-600">
                            تُحذف الشركة وكل بياناتها نهائياً ولا يمكن استرجاعها. اكتب <b dir="ltr">{t.slug}</b> للتأكيد.
                          </p>
                          <ActionForm action={deleteAction.bind(null, t.id)} resetOnSuccess={false} className="flex flex-wrap gap-2">
                            <Input name="confirm" required dir="ltr" className="min-w-0 flex-1" />
                            <SubmitButton className="!bg-red-600 !text-white hover:!bg-red-500">حذف نهائي</SubmitButton>
                          </ActionForm>
                        </DialogButton>
                      )}
                    </>
                  )}
                </div>
              </Td>
            </tr>
          );
        })}
      </Table>
      {others.length === 0 && <p className="mt-4 text-sm text-gray-500">لا توجد شركات مشتركة بعد؛ أضف أول شركة من النموذج أعلاه.</p>}

      <Card title="أخطاء البرنامج" className="mt-8">
        <p className="mb-3 text-sm text-gray-500">
          كل خطأ غير متوقع يُسجَّل هنا مع عدد مرات تكراره في اليوم، ويصلك بريد تنبيه أول مرة يظهر فيها. أرسل لقطة منه للدعم الفني إن تكرر.
        </p>
        {errors.length === 0 ? (
          <p className="text-sm text-green-700">لا أخطاء مسجلة. ✓</p>
        ) : (
          <Table head={["آخر مرة", "الشركة", "الصفحة", "الخطأ", "التكرار"]}>
            {errors.map((e) => (
              <tr key={e.id}>
                <Td className="ltr-nums whitespace-nowrap text-xs">
                  <span dir="ltr">{new Date(e.last_at).toLocaleString("en-GB", { timeZone: "Asia/Riyadh", dateStyle: "short", timeStyle: "short" })}</span>
                </Td>
                <Td className="text-xs">{tenants.find((t) => t.schema_name === e.schema_name)?.name ?? e.schema_name ?? "—"}</Td>
                <Td className="ltr-nums text-xs">
                  <span dir="ltr">{e.path ?? "—"}</span>
                </Td>
                <Td>
                  <details className="max-w-xl">
                    <summary className="cursor-pointer text-sm break-all text-gray-800">{e.message}</summary>
                    {e.stack && (
                      <pre className="mt-2 max-h-48 overflow-auto rounded bg-gray-50 p-2 text-start text-[11px] whitespace-pre-wrap break-all text-gray-600" dir="ltr">
                        {e.stack}
                      </pre>
                    )}
                  </details>
                </Td>
                <Td className="ltr-nums">{e.count}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
