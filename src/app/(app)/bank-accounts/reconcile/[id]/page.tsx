import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { BANK_ADJUSTMENTS, reconciliationView } from "@/lib/reconciliation";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Field, Input, PageHeader, Select } from "@/components/ui";
import { addAdjustmentAction, deleteReconciliationAction, reopenReconciliationAction, updateStatementAction } from "../actions";
import { ReconcileTable } from "./reconcile-table";

export default async function ReconciliationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("accounts", "view");
  const { id } = await params;
  const v = await reconciliationView(db, Number(id));
  if (!v) notFound();
  const { r, account } = v;
  const draft = r.status === "draft";
  const canEdit = draft && can(user.perms, "accounts", "update");
  const currency = account.currencyCode ?? "SAR";

  return (
    <>
      <PageHeader title={`التسوية ${r.number}`} description={`${account.code} – ${account.nameAr} · كشف بتاريخ ${r.statementDate} · المبالغ بـ ${currency}`}>
        {draft ? <Badge tone="amber">مسودة</Badge> : <Badge tone="green">مكتملة</Badge>}
        <Link href="/bank-accounts/reconcile" className="text-sm text-brand-700 hover:underline">
          كل التسويات
        </Link>
      </PageHeader>

      <ReconcileTable
        id={r.id}
        editable={canEdit}
        statement={Number(r.statementBalance)}
        priorCleared={v.priorCleared}
        book={v.book}
        items={v.items}
      />

      {canEdit && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card title="حركة في الكشف غير مسجلة">
            <p className="mb-3 text-sm text-gray-500">رسوم خصمها البنك أو عائد أضافه ولم يُسجل بعد: يُرحّل قيده بتاريخ الكشف ويُؤشر عليه مباشرة.</p>
            <ActionForm action={addAdjustmentAction.bind(null, r.id)} className="grid gap-3 sm:grid-cols-3">
              <Field label="النوع">
                <Select name="kind" defaultValue="fee">
                  {Object.entries(BANK_ADJUSTMENTS).map(([k, a]) => (
                    <option key={k} value={k}>
                      {a.label} ({a.account})
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="المبلغ">
                <Input name="amount" inputMode="decimal" required dir="ltr" placeholder="0.00" />
              </Field>
              <Field label="البيان">
                <Input name="description" placeholder="اختياري" />
              </Field>
              <div className="col-span-full">
                <SubmitButton>ترحيل وتأشير</SubmitButton>
              </div>
            </ActionForm>
          </Card>
          <Card title="بيانات الكشف">
            <ActionForm action={updateStatementAction.bind(null, r.id)} resetOnSuccess={false} className="grid gap-3 sm:grid-cols-2">
              <Field label="تاريخ الكشف">
                <Input name="statementDate" type="date" required defaultValue={r.statementDate} />
              </Field>
              <Field label="الرصيد في الكشف">
                <Input name="statementBalance" inputMode="decimal" required dir="ltr" defaultValue={r.statementBalance} />
              </Field>
              <div className="col-span-full flex flex-wrap items-center gap-3">
                <SubmitButton variant="secondary">تحديث</SubmitButton>
              </div>
            </ActionForm>
            {can(user.perms, "accounts", "delete") && (
              <ActionForm action={deleteReconciliationAction.bind(null, r.id)} className="mt-4 border-t border-gray-100 pt-3">
                <button type="submit" className="text-sm text-red-700 hover:underline">
                  حذف هذه المسودة
                </button>
              </ActionForm>
            )}
          </Card>
        </div>
      )}

      {!draft && can(user.perms, "accounts", "approve") && (
        <ActionForm action={reopenReconciliationAction.bind(null, r.id)} resetOnSuccess={false} className="mt-6">
          <SubmitButton variant="secondary">إلغاء الإكمال</SubmitButton>
        </ActionForm>
      )}
    </>
  );
}
