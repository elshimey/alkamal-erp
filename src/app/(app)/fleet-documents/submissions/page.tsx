import Link from "next/link";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listSubmissions } from "@/lib/documents";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, EmptyRow, Field, Input, PageHeader, Table, Td } from "@/components/ui";
import { approveSubmissionAction, rejectSubmissionAction } from "../actions";

const STATUS = { pending: ["بانتظار الاعتماد", "amber"], approved: ["معتمدة", "green"], rejected: ["مرفوضة", "red"] } as const;

export default async function SubmissionsPage() {
  const user = await requirePermission("fleet_documents", "view");
  const canReview = can(user.perms, "fleet_documents", "update");
  const [pending, recent] = await Promise.all([listSubmissions(db, { status: "pending" }), listSubmissions(db, { limit: 30 })]);
  const reviewed = recent.filter((r) => r.sub.status !== "pending");

  return (
    <>
      <PageHeader title="وثائق رفعها السائقون" description="يرفع السائق صورة الوثيقة بعد تجديدها من تطبيقه. راجع الصورة وأكّد الرقم وتاريخ الانتهاء ثم اعتمد، فتُسجَّل وثيقة جديدة وتبقى السابقة في التاريخ.">
        <Link href="/fleet-documents" className="text-sm text-brand-700 hover:underline">
          → سجل الوثائق
        </Link>
      </PageHeader>

      <div className="grid gap-4">
        {pending.length === 0 && <Card>لا توجد طلبات بانتظار الاعتماد.</Card>}
        {pending.map(({ sub, type, plate, driverName, attachmentId }) => (
          <section key={sub.id} className="grid gap-4 rounded-2xl border border-amber-200 bg-white p-4 shadow-sm md:grid-cols-[180px_1fr]">
            {attachmentId ? (
              <a href={`/files/${attachmentId}`} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-gray-200 bg-gray-50" title="فتح الصورة كاملة">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/files/${attachmentId}`} alt={type.nameAr} className="h-44 w-full object-cover md:h-full" />
              </a>
            ) : (
              <div className="grid h-32 place-items-center rounded-xl bg-gray-50 text-xs text-gray-400">بلا صورة</div>
            )}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-brand-900">{type.nameAr}</span>
                <Badge tone="blue">{type.ownerKind === "vehicle" ? `مركبة ${plate ?? ""}` : "السائق"}</Badge>
                <span className="text-sm text-gray-600">رفعها: {driverName}</span>
                <span className="ltr-nums text-xs text-gray-400">{sub.createdAt.toISOString().slice(0, 16).replace("T", " ")}</span>
              </div>
              {sub.note && <p className="mt-1 text-sm text-gray-600">ملاحظة السائق: {sub.note}</p>}
              {canReview ? (
                <>
                  <ActionForm action={approveSubmissionAction} className="mt-3 grid gap-3 sm:grid-cols-2">
                    <input type="hidden" name="id" value={sub.id} />
                    <Field label="الرقم">
                      <Input name="number" defaultValue={sub.number ?? ""} dir="ltr" />
                    </Field>
                    <Field label="تاريخ الإصدار">
                      <Input name="issueDate" type="date" className="w-full" />
                    </Field>
                    <Field label="تاريخ الانتهاء">
                      <Input name="expiryDate" type="date" defaultValue={sub.expiryDate ?? ""} className="w-full" />
                    </Field>
                    <Field label="رسوم التجديد">
                      <Input name="cost" type="number" step="0.01" min="0" dir="ltr" />
                    </Field>
                    <div className="sm:col-span-2">
                      <SubmitButton>اعتماد وتسجيل الوثيقة</SubmitButton>
                    </div>
                  </ActionForm>
                  <ActionForm action={rejectSubmissionAction} className="mt-3 flex flex-wrap items-center gap-2 border-t border-dashed border-gray-200 pt-3">
                    <input type="hidden" name="id" value={sub.id} />
                    <Input name="reason" required placeholder="سبب الرفض (يظهر للسائق)، مثل: الصورة غير واضحة" className="min-w-56 flex-1" />
                    <SubmitButton variant="secondary">رفض</SubmitButton>
                  </ActionForm>
                </>
              ) : (
                <p className="mt-2 text-sm text-gray-500">الاعتماد لمن لديه صلاحية تعديل الوثائق.</p>
              )}
            </div>
          </section>
        ))}
      </div>

      <h2 className="mb-3 mt-8 font-semibold text-brand-900">آخر ما رُوجع</h2>
      <Table head={["الوثيقة", "السائق", "المركبة", "الحالة", "ملاحظة المراجعة", "الصورة"]}>
        {reviewed.length === 0 && <EmptyRow cols={6}>لا يوجد بعد</EmptyRow>}
        {reviewed.map(({ sub, type, plate, driverName, attachmentId }) => (
          <tr key={sub.id}>
            <Td className="font-medium">{type.nameAr}</Td>
            <Td>{driverName}</Td>
            <Td>{plate ?? "—"}</Td>
            <Td>
              <Badge tone={STATUS[sub.status][1]}>{STATUS[sub.status][0]}</Badge>
            </Td>
            <Td className="text-xs text-gray-600">{sub.reviewNote ?? "—"}</Td>
            <Td>
              {attachmentId ? (
                <a href={`/files/${attachmentId}`} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">
                  📎
                </a>
              ) : (
                "—"
              )}
            </Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
