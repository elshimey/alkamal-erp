"use client";

import { useState } from "react";
import type { DriverDict, DriverExpenseType } from "@/data/driver-i18n";
import { DField, DInput, DSelect } from "./driver-ui";

export interface ExpenseDefaults {
  kind?: DriverExpenseType;
  amount?: string;
  payer?: "custody" | "company";
  waybillId?: number | null;
  maintenanceTypeId?: number | null;
}

/** حقول مصروف السائق: النوع (ونوع الصيانة إن كان صيانة)، والرحلة، والمبلغ الإجمالي، ومن دفع. */
export function ExpenseFields({
  t,
  types,
  maintenance,
  trips,
  defaults = {},
  idPrefix,
}: {
  t: DriverDict;
  types: DriverExpenseType[];
  maintenance: { value: number; label: string }[];
  trips: { value: number; label: string }[];
  defaults?: ExpenseDefaults;
  idPrefix: string;
}) {
  const [kind, setKind] = useState<DriverExpenseType>(defaults.kind ?? types[0]);
  return (
    <>
      <DField label={t.expenseType} group>
        <div className="grid grid-cols-3 gap-2">
          {types.map((k) => (
            <label key={k} className="cursor-pointer">
              <input type="radio" name="type" value={k} checked={kind === k} onChange={() => setKind(k)} className="peer sr-only" />
              <span className="block rounded-xl border border-gray-300 px-2 py-2.5 text-center text-sm font-medium peer-checked:border-asphalt-900 peer-checked:bg-asphalt-900 peer-checked:text-brand-500">
                {t.expenseTypes[k]}
              </span>
            </label>
          ))}
        </div>
      </DField>
      {kind === "maintenance" && (
        <DField label={t.x.maintenanceType}>
          <DSelect name="maintenanceTypeId" required defaultValue={defaults.maintenanceTypeId ?? ""}>
            <option value="" disabled>
              {t.choose}
            </option>
            {maintenance.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </DSelect>
        </DField>
      )}
      <DField label={t.x.trip}>
        <DSelect name="waybillId" defaultValue={defaults.waybillId ?? ""}>
          <option value="">{t.x.general}</option>
          {trips.map((w) => (
            <option key={w.value} value={w.value}>
              {w.label}
            </option>
          ))}
        </DSelect>
      </DField>
      <DField label={`${t.x.total} (${t.sar})`}>
        <DInput name="amount" inputMode="decimal" dir="ltr" required defaultValue={defaults.amount} />
      </DField>
      <DField label={t.x.payer} group>
        <div className="grid grid-cols-2 gap-2">
          {(["custody", "company"] as const).map((p) => (
            <label key={p} className="cursor-pointer" htmlFor={`${idPrefix}-${p}`}>
              <input id={`${idPrefix}-${p}`} type="radio" name="payer" value={p} defaultChecked={(defaults.payer ?? "custody") === p} className="peer sr-only" />
              <span className="block rounded-xl border border-gray-300 px-2 py-2.5 text-center text-sm font-medium peer-checked:border-asphalt-900 peer-checked:bg-asphalt-900 peer-checked:text-brand-500">
                {t.x.payers[p]}
              </span>
            </label>
          ))}
        </div>
      </DField>
    </>
  );
}
