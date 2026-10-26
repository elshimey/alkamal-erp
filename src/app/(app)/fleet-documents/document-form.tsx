"use client";

import { useState } from "react";
import { DocumentFileInput } from "@/components/document-file-input";
import { FormCombo } from "@/components/form-combo";
import { PanelField, PanelSection } from "@/components/panel-ui";
import { Input, Select } from "@/components/ui";

export interface FormType {
  id: number;
  nameAr: string;
  ownerKind: string;
  authority: string | null;
}

export interface DocValues {
  documentTypeId: number;
  number: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  authority: string | null;
  cost: string | null;
  notes: string | null;
  attachmentId: number | null;
}

/**
 * حقول نافذة الوثيقة: الصاحب أولاً ثم أنواع الوثائق التي تخصه فقط، فالرقم والتواريخ والمرفق.
 * fixedOwner: الصاحب معروف (صفحة صاحب واحد أو تعديل وثيقة) فيُعرض نصاً.
 */
export function DocumentFields({
  owners,
  types,
  defaultOwner = "",
  defaultType = "",
  fixedOwner,
  doc,
}: {
  owners: { value: string; label: string }[];
  types: FormType[];
  defaultOwner?: string;
  defaultType?: string;
  fixedOwner?: string;
  doc?: DocValues;
}) {
  const [owner, setOwner] = useState(defaultOwner);
  const [typeId, setTypeId] = useState(doc ? String(doc.documentTypeId) : defaultType);
  const kind = owner.split(":")[0];
  const options = types.filter((t) => t.ownerKind === kind);
  const type = types.find((t) => String(t.id) === typeId);

  return (
    <>
      <PanelSection title="الوثيقة">
        {fixedOwner ? (
          <PanelField label="صاحب الوثيقة">
            <input type="hidden" name="owner" value={owner} />
            <span className="font-medium text-gray-900">{fixedOwner}</span>
          </PanelField>
        ) : (
          <PanelField label="صاحب الوثيقة" required hint="المركبة أو السائق أو الموظف أو العميل أو الشركة">
            <FormCombo
              name="owner"
              options={owners}
              defaultValue={defaultOwner}
              required
              placeholder="اكتب اللوحة أو الاسم…"
              onChange={(v) => {
                setOwner(v);
                if (v.split(":")[0] !== kind) setTypeId("");
              }}
            />
          </PanelField>
        )}
        <PanelField label="نوع الوثيقة" required>
          <Select name="documentTypeId" required value={typeId} onChange={(e) => setTypeId(e.target.value)} disabled={!owner} className="w-full">
            <option value="" disabled>
              {owner ? "اختر…" : "اختر الصاحب أولاً"}
            </option>
            {options.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nameAr}
              </option>
            ))}
          </Select>
        </PanelField>
        <PanelField label="رقم الوثيقة">
          <Input name="number" dir="ltr" defaultValue={doc?.number ?? ""} className="w-full" />
        </PanelField>
        <PanelField label="تاريخ الإصدار">
          <Input type="date" name="issueDate" defaultValue={doc?.issueDate ?? ""} className="w-full" />
        </PanelField>
        <PanelField label="تاريخ الانتهاء" hint="فارغ = لا تنتهي">
          <Input type="date" name="expiryDate" defaultValue={doc?.expiryDate ?? ""} className="w-full" />
        </PanelField>
        <PanelField label="المرفق" hint="صورة أو PDF">
          <div className="flex flex-wrap items-center gap-3">
            {doc?.attachmentId && (
              <a href={`/files/${doc.attachmentId}`} target="_blank" rel="noreferrer" data-no-guard className="text-sm text-brand-700 hover:underline">
                📎 المرفق الحالي
              </a>
            )}
            <DocumentFileInput label={doc?.attachmentId ? "استبدال المرفق" : "إرفاق صورة أو PDF"} />
          </div>
        </PanelField>
      </PanelSection>
      <PanelSection title="تفاصيل أخرى" optional open={!!doc && !!(doc.authority || doc.cost || doc.notes)}>
        <PanelField label="جهة الإصدار">
          <Input key={typeId} name="authority" defaultValue={doc?.authority ?? type?.authority ?? ""} className="w-full" />
        </PanelField>
        <PanelField label="رسوم الإصدار أو التجديد">
          <Input name="cost" type="number" min={0} step="0.01" dir="ltr" defaultValue={doc?.cost ?? ""} className="w-full" />
        </PanelField>
        <PanelField label="ملاحظات">
          <textarea name="notes" rows={2} defaultValue={doc?.notes ?? ""} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" />
        </PanelField>
      </PanelSection>
    </>
  );
}
