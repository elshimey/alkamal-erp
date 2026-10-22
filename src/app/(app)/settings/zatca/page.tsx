import Link from "next/link";
import { db } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { getCompany } from "@/lib/company";
import { companyGaps, DOC_STATUS, ENV_LABEL, getSettings, pendingDocuments, recentDocuments, type OnboardStep } from "@/lib/zatca/service";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, EmptyRow, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { autoSendAction, disconnectAction, onboardAction, sendPendingAction, testAction } from "./actions";

export const maxDuration = 60;

function Steps({ steps }: { steps: OnboardStep[] }) {
  return (
    <ol className="mt-3 space-y-1.5 text-sm">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-2">
          <span className={s.ok ? "text-green-600" : "text-red-600"}>{s.ok ? "✓" : "✗"}</span>
          <span>
            <span className="text-gray-800">{s.step}</span>
            {s.detail && <span className="block text-xs break-all text-gray-500">{s.detail}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

export default async function ZatcaPage() {
  await requireAdmin();
  const [st, company, pending, recent] = await Promise.all([getSettings(db), getCompany(db), pendingDocuments(db), recentDocuments(db)]);
  const gaps = companyGaps(company);
  const connected = !!st?.token;
  const test = st?.sandboxTest as { at: string; ok: boolean; steps: OnboardStep[] } | null | undefined;
  const pendingCount = pending.invoices.length + pending.notes.length;

  return (
    <>
      <PageHeader title="الفوترة الإلكترونية (المرحلة الثانية)" description="ربط النظام ببوابة «فاتورة» لهيئة الزكاة والضريبة والجمارك؛ كل فاتورة ضريبية أو إشعار للعميل يُوقَّع ويُرسل للهيئة لتعتمده قبل تسليمه.">
        <Link href="/settings" className="text-sm text-brand-700 hover:underline">
          → الإعدادات
        </Link>
      </PageHeader>

      <div className="grid max-w-4xl gap-6">
        <Card title="حالة الربط">
          <div className="flex flex-wrap items-center gap-3 text-sm text-gray-700">
            {connected ? (
              <>
                <Badge tone={st!.environment === "production" ? "green" : "blue"}>مربوط: {ENV_LABEL[st!.environment]}</Badge>
                {st!.certificateExpiresAt && (
                  <span>
                    الشهادة سارية حتى <span className="ltr-nums">{st!.certificateExpiresAt.toLocaleDateString("en-GB")}</span>
                  </span>
                )}
                <span>
                  مستندات أُرسلت: <b className="ltr-nums">{st!.lastIcv}</b>
                </span>
              </>
            ) : (
              <>
                <Badge tone="amber">غير مربوط</Badge>
                <span>تظهر الفواتير برمز QR المرحلة الأولى حتى يتم الربط.</span>
              </>
            )}
          </div>
          {gaps.length > 0 && (
            <div className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              أكمل بيانات المنشأة قبل الربط: {gaps.join("، ")}.{" "}
              <Link href="/settings/company" className="font-medium underline">
                بيانات المنشأة
              </Link>
            </div>
          )}
        </Card>

        <Card title="1. تجربة على بيئة المطورين">
          <p className="text-sm leading-relaxed text-gray-600">
            تجربة كاملة على البيئة المفتوحة لدى الهيئة: إنشاء مفتاح الجهاز وطلب الشهادة، ثم توقيع فاتورة وإشعار دائن وإشعار مدين وإرسالها للفحص. لا تحتاج تسجيلاً، ولا تؤثر على فواتيرك.
          </p>
          <ActionForm action={testAction} resetOnSuccess={false} className="mt-3">
            <SubmitButton variant="secondary" pendingLabel="جارٍ التجربة مع الهيئة…">
              ابدأ التجربة
            </SubmitButton>
          </ActionForm>
          {test && (
            <div className="mt-4 rounded-lg border border-gray-200 p-3">
              <div className="flex items-center gap-2 text-sm">
                <Badge tone={test.ok ? "green" : "red"}>{test.ok ? "نجحت" : "لم تكتمل"}</Badge>
                <span className="ltr-nums text-gray-500">{new Date(test.at).toLocaleString("en-GB", { timeZone: "Asia/Riyadh" })}</span>
              </div>
              <Steps steps={test.steps} />
            </div>
          )}
        </Card>

        <Card title={connected ? "2. تجديد الربط أو تغيير البيئة" : "2. الربط برمز التفعيل"}>
          <p className="mb-3 text-sm leading-relaxed text-gray-600">
            ادخل بوابة فاتورة (fatoora.zatca.gov.sa) بحساب المنشأة، واختر «تسجيل وحدة حل جديدة» ثم «إنشاء رمز OTP»، وانسخ الرمز المكون من 6 أرقام هنا خلال ساعة. ابدأ بالمحاكاة إن أردت التأكد قبل الإنتاج.
          </p>
          <ActionForm action={onboardAction} resetOnSuccess={false} className="grid max-w-xl gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Field label="البيئة">
              <Select name="environment" defaultValue={st?.environment === "production" ? "production" : "simulation"} disabled={gaps.length > 0}>
                <option value="simulation">بوابة المحاكاة</option>
                <option value="production">الإنتاج (الفعلي)</option>
              </Select>
            </Field>
            <Field label="رمز التفعيل (OTP)">
              <Input name="otp" required inputMode="numeric" pattern="\d{6}" maxLength={6} dir="ltr" autoComplete="off" disabled={gaps.length > 0} />
            </Field>
            <SubmitButton pendingLabel="جارٍ الربط…">اربط</SubmitButton>
          </ActionForm>
        </Card>

        {connected && (
          <Card title="3. الإرسال">
            <div className="flex flex-wrap items-center gap-3">
              <ActionForm action={autoSendAction.bind(null, !st!.autoSend)} resetOnSuccess={false}>
                <SubmitButton variant="secondary">{st!.autoSend ? "إيقاف الإرسال التلقائي" : "تشغيل الإرسال التلقائي"}</SubmitButton>
              </ActionForm>
              <span className="text-sm text-gray-600">{st!.autoSend ? "يُرسل كل مستند للهيئة فور إصداره." : "الإرسال يدوي من صفحة الفاتورة أو الإشعار."}</span>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-4">
              <ActionForm action={sendPendingAction} resetOnSuccess={false}>
                <SubmitButton pendingLabel="جارٍ الإرسال…">أرسل غير المعتمد ({pendingCount})</SubmitButton>
              </ActionForm>
              <span className="text-sm text-gray-600">
                {pending.invoices.length} فاتورة و{pending.notes.length} إشعار صادرة لم تعتمدها الهيئة بعد.
              </span>
            </div>
            <div className="mt-4 border-t border-gray-100 pt-4">
              <ActionForm action={disconnectAction} resetOnSuccess={false}>
                <SubmitButton variant="secondary" className="!text-red-700">
                  إلغاء الربط
                </SubmitButton>
              </ActionForm>
            </div>
          </Card>
        )}

        <Card title="آخر ما أُرسل للهيئة">
          <Table head={["التسلسل", "المستند", "البيئة", "الحالة", "التاريخ", "ملاحظات الهيئة"]}>
            {recent.length === 0 && <EmptyRow cols={6}>لم يُرسل شيء بعد</EmptyRow>}
            {recent.map(({ d, invoice, note }) => (
              <tr key={d.id}>
                <Td className="ltr-nums">{d.icv}</Td>
                <Td>
                  {d.salesInvoiceId ? (
                    <Link href={`/invoices/${d.salesInvoiceId}`} className="text-brand-700 hover:underline">
                      <bdi>{invoice}</bdi>
                    </Link>
                  ) : (
                    <Link href={`/notes/sales?open=${d.noteId}`} className="text-brand-700 hover:underline">
                      <bdi>{note}</bdi>
                    </Link>
                  )}
                </Td>
                <Td>{ENV_LABEL[d.environment]}</Td>
                <Td>
                  <Badge tone={DOC_STATUS[d.status].tone}>{DOC_STATUS[d.status].label}</Badge>
                </Td>
                <Td className="ltr-nums">{d.createdAt.toLocaleString("en-GB", { timeZone: "Asia/Riyadh" })}</Td>
                <Td className="max-w-xs text-xs break-words text-gray-600">{[...(d.errors as string[]), ...d.warnings].join(" · ") || "—"}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </>
  );
}
