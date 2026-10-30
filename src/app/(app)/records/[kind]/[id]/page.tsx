import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { isRecordKind, loadRecord, RECORDS, TABLE_NAME, withCustom } from "@/lib/records";
import { FieldInput } from "@/components/record-field";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { RecordHistory } from "@/components/record-history";
import { Card, Field, Input, PageHeader } from "@/components/ui";
import { deleteRecordAction, saveRecordAction } from "../../actions";

export default async function RecordPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id: raw } = await params;
  if (!isRecordKind(kind)) notFound();
  const def = RECORDS[kind];
  const user = await requirePermission(def.perm, "view");
  const id = Number(raw);
  if (!Number.isInteger(id)) notFound();
  const other = await def.redirect?.(id);
  if (other) redirect(other);
  const loaded = await loadRecord(kind, id);
  const row = loaded && withCustom(RECORDS[kind], loaded);
  if (!row) notFound();
  const canEdit = can(user.perms, def.perm, "update");
  const canDelete = can(user.perms, def.perm, "delete");

  return (
    <>
      <PageHeader title={await def.heading(row)} description={`تعديل بيانات ${def.noun} أو حذفه، مع سجل كل تعديل ومن قام به.`}>
        <Link href={def.listHref} className="text-sm font-medium text-brand-700 hover:underline">
          ← {def.listLabel}
        </Link>
      </PageHeader>

      <Card title={`بيانات ${def.noun}`} className="mb-6">
        <ActionForm action={saveRecordAction.bind(null, kind, id)} resetOnSuccess={false} className="grid gap-4 sm:grid-cols-3">
          {def.fields.map((f) => (
            <FieldInput key={f.key} f={f} value={row[f.key]} disabled={!canEdit || f.readOnly} />
          ))}
          {canEdit && (
            <div className="col-span-full">
              <SubmitButton>حفظ التعديلات</SubmitButton>
            </div>
          )}
        </ActionForm>
      </Card>

      <RecordHistory entity={TABLE_NAME[kind]} id={id} />

      {canDelete && (
        <Card title={`حذف ${def.noun}`}>
          <p className="mb-4 text-sm text-gray-600">
            يُحذف نهائياً فقط إن لم تكن له أي حركة أو ارتباط.{def.instead ? ` وإن كانت له حركات: ${def.instead}.` : ""}
          </p>
          <ActionForm action={deleteRecordAction.bind(null, kind, id)} className="grid items-end gap-4 sm:grid-cols-3">
            <Field label="اكتب «حذف» للتأكيد">
              <Input name="confirm" required autoComplete="off" />
            </Field>
            <SubmitButton variant="secondary" className="text-red-700">
              حذف نهائياً
            </SubmitButton>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
