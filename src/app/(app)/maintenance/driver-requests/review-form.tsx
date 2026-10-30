"use client";

import { useState } from "react";
import type { QuickOption } from "@/lib/quick-add-types";
import { ActionForm, SubmitButton, type FormState } from "@/components/action-form";
import { FormCombo } from "@/components/form-combo";
import { Field, Input, Select } from "@/components/ui";

const radio = "flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50";
const PAYERS = [
  { value: "custody", label: "السائق دفع من عهدته", hint: "تُخصم من عهدة السائق" },
  { value: "cash", label: "الشركة دفعت (صندوق أو بنك)", hint: "تُخصم من الصندوق أو البنك المختار" },
  { value: "supplier", label: "دين على الورشة", hint: "يُنشأ أمر صيانة خارجي، والورشة دائنة حتى سدادها بسند صرف" },
] as const;

/** مراجعة طلب صيانة السائق: نوع الصيانة (يحدد الحساب) ومن دفع، ثم الاعتماد. */
export function ReviewForm({
  action,
  kinds,
  defaultKind,
  suppliers,
  cashes,
  reportedPayer,
}: {
  action: (state: FormState, data: FormData) => Promise<FormState>;
  kinds: QuickOption[];
  defaultKind: string;
  suppliers: QuickOption[];
  cashes: { id: number; nameAr: string }[];
  reportedPayer: string | null;
}) {
  const [payer, setPayer] = useState<string>(reportedPayer === "company" ? "cash" : "custody");
  return (
    <ActionForm action={action} resetOnSuccess={false} className="space-y-4">
      <Field label="نوع الصيانة">
        <FormCombo name="type" options={kinds} create="maintenance_kind" defaultValue={defaultKind} required placeholder="اختر أو أضف نوعاً…" />
      </Field>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-gray-700">من دفع؟</legend>
        <div className="grid gap-2" onChange={(e) => setPayer((e.target as HTMLInputElement).value)}>
          {PAYERS.map((p) => (
            <label key={p.value} className={radio}>
              <input type="radio" name="payer" value={p.value} defaultChecked={p.value === payer} className="accent-brand-600" />
              <span>
                {p.label}
                <span className="block text-xs text-gray-500">{p.hint}</span>
              </span>
            </label>
          ))}
        </div>
        {reportedPayer && <p className="mt-1 text-xs text-gray-500">السائق قال: {reportedPayer === "company" ? "الشركة دفعت" : "دفعت من عهدتي"}</p>}
      </fieldset>
      {payer === "cash" && (
        <Field label="الصندوق أو البنك">
          <Select name="cashAccountId" required defaultValue="">
            <option value="">اختر…</option>
            {cashes.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nameAr}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {payer === "supplier" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="الورشة / المورد">
            <FormCombo name="supplierId" options={suppliers} create="workshop" required placeholder="ابحث عن الورشة…" />
          </Field>
          <Field label="رقم فاتورة الورشة">
            <Input name="supplierInvoiceNo" dir="ltr" />
          </Field>
        </div>
      )}
      <Field label="الضريبة في الفاتورة (إن وُجدت)">
        <Input name="vat" type="number" min={0} step="0.01" dir="ltr" placeholder="0" className="w-40" />
      </Field>
      <SubmitButton>اعتماد وترحيل القيد</SubmitButton>
    </ActionForm>
  );
}
