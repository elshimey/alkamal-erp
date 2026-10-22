import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { isRecordKind, loadRecord, RECORDS, resolveOptions, TABLE_NAME, type FieldDef } from "@/lib/records";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { RecordHistory } from "@/components/record-history";
import { PasswordInput } from "@/components/password-input";
import { Card, Field, Input, PageHeader, Select } from "@/components/ui";
import { deleteRecordAction, saveRecordAction } from "../../actions";

const str = (v: unknown) => (v == null ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v));

async function FieldInput({ f, value, disabled }: { f: FieldDef; value: unknown; disabled: boolean }) {
  if (f.type === "bool")
    return (
      <label className="flex items-center gap-2 pt-7 text-sm font-medium text-gray-700">
        <input type="checkbox" name={f.key} defaultChecked={!!value} disabled={disabled} className="size-4" />
        {f.label}
      </label>
    );
  if (f.type === "multi") {
    const opts = await resolveOptions(f);
    const chosen = new Set((value as string[] | undefined) ?? []);
    return (
      <fieldset className="col-span-full">
        <legend className="mb-2 text-sm font-medium text-gray-700">{f.label}</legend>
        <div className="flex flex-wrap gap-4">
          {opts.map((o) => (
            <label key={o.value} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name={f.key} value={o.value} defaultChecked={chosen.has(o.value)} disabled={disabled} className="size-4" />
              {o.label}
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  let input;
  if (f.type === "select") {
    const opts = await resolveOptions(f);
    input = (
      <Select name={f.key} defaultValue={str(value)} required={f.required} disabled={disabled}>
        {!f.required && <option value="">—</option>}
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    );
  } else if (f.type === "textarea") {
    input = (
      <textarea name={f.key} defaultValue={str(value)} rows={2} disabled={disabled} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" />
    );
  } else if (f.type === "password") {
    input = <PasswordInput name={f.key} dir="ltr" autoComplete="new-password" disabled={disabled} />;
  } else {
    input = (
      <Input
        name={f.key}
        type={f.type === "date" ? "date" : "text"}
        inputMode={f.type === "number" ? "decimal" : undefined}
        defaultValue={str(value)}
        required={f.required}
        dir={f.ltr || f.type === "number" ? "ltr" : undefined}
        disabled={disabled}
      />
    );
  }
  return (
    <Field label={f.label} hint={f.hint}>
      {input}
    </Field>
  );
}

export default async function RecordPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id: raw } = await params;
  if (!isRecordKind(kind)) notFound();
  const def = RECORDS[kind];
  const user = await requirePermission(def.perm, "view");
  const id = Number(raw);
  if (!Number.isInteger(id)) notFound();
  const other = await def.redirect?.(id);
  if (other) redirect(other);
  const row = await loadRecord(kind, id);
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
            <FieldInput key={f.key} f={f} value={row[f.key]} disabled={!canEdit} />
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
