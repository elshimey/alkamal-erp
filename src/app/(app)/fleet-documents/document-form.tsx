"use client";

import { useState } from "react";
import { ActionForm, SubmitButton, type FormState } from "@/components/action-form";
import { ComboBox } from "@/components/combo-box";
import { DocumentFileInput } from "@/components/document-file-input";
import { Field, Input, Select } from "@/components/ui";

export interface FormType {
  id: number;
  nameAr: string;
  ownerKind: string;
  authority: string | null;
}

/** إضافة وثيقة أو تجديدها: الصاحب أولاً، ثم أنواع الوثائق التي تخصه فقط. */
export function DocumentForm({
  action,
  owners,
  types,
  defaultOwner = "",
  defaultType = "",
  fixedOwner = false,
}: {
  action: (state: FormState, data: FormData) => Promise<FormState>;
  owners: { value: string; label: string }[];
  types: FormType[];
  defaultOwner?: string;
  defaultType?: string;
  /** صفحة صاحب واحد: لا يُغيَّر الصاحب */
  fixedOwner?: boolean;
}) {
  const [owner, setOwner] = useState(defaultOwner);
  const [typeId, setTypeId] = useState(defaultType);
  const kind = owner.split(":")[0];
  const options = types.filter((t) => t.ownerKind === kind);
  const type = types.find((t) => String(t.id) === typeId);

  return (
    <ActionForm action={action} resetOnSuccess={false} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <input type="hidden" name="owner" value={owner} />
      {!fixedOwner && (
        <Field label="صاحب الوثيقة *">
          <ComboBox
            value={owner}
            options={owners}
            allowEmpty={false}
            placeholder="اكتب اللوحة أو الاسم…"
            onChange={(v) => {
              setOwner(v);
              if (v.split(":")[0] !== kind) setTypeId("");
            }}
          />
        </Field>
      )}
      <Field label="نوع الوثيقة *">
        <Select name="documentTypeId" required value={typeId} onChange={(e) => setTypeId(e.target.value)} disabled={!owner}>
          <option value="" disabled>
            {owner ? "اختر…" : "اختر الصاحب أولاً"}
          </option>
          {options.map((t) => (
            <option key={t.id} value={t.id}>
              {t.nameAr}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="رقم الوثيقة">
        <Input name="number" dir="ltr" />
      </Field>
      <Field label="جهة الإصدار">
        <Input key={typeId} name="authority" defaultValue={type?.authority ?? ""} />
      </Field>
      <Field label="تاريخ الإصدار">
        <Input name="issueDate" type="date" />
      </Field>
      <Field label="تاريخ الانتهاء" hint="اتركه فارغاً إن كانت لا تنتهي">
        <Input name="expiryDate" type="date" />
      </Field>
      <Field label="رسوم الإصدار أو التجديد">
        <Input name="cost" type="number" min={0} step="0.01" dir="ltr" />
      </Field>
      <Field label="المرفق">
        <DocumentFileInput />
      </Field>
      <Field label="ملاحظات">
        <Input name="notes" />
      </Field>
      <div className="flex items-end">
        <SubmitButton>حفظ الوثيقة</SubmitButton>
      </div>
    </ActionForm>
  );
}
