"use client";

import { useState } from "react";
import type { QuickOption } from "@/lib/quick-add-types";
import { FormCombo } from "@/components/form-combo";
import { PanelField } from "@/components/panel-ui";
import { Input, Select } from "@/components/ui";

const radio = "flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50";

/** الجهة: ورشة خارجية (تصبح دائنة بقيمة الأمر) أو ورشة داخلية (القطع من صندوق)، وتظهر حقول الجهة المختارة فقط. */
export function OrderProviderFields({ suppliers, cashes }: { suppliers: QuickOption[]; cashes: { id: number; nameAr: string }[] }) {
  const [provider, setProvider] = useState<"external" | "internal">("external");
  return (
    <>
      <PanelField label="الجهة" required>
        <span
          className="flex flex-wrap gap-2"
          onChange={(e) => {
            const v = (e.target as HTMLInputElement).value;
            if (v === "external" || v === "internal") setProvider(v);
          }}
        >
          <label className={radio}>
            <input type="radio" name="provider" value="external" defaultChecked className="accent-brand-600" />
            ورشة خارجية
          </label>
          <label className={radio}>
            <input type="radio" name="provider" value="internal" className="accent-brand-600" />
            ورشة داخلية
          </label>
        </span>
      </PanelField>
      {provider === "external" ? (
        <>
          <PanelField label="الورشة / المورد" required hint="تصبح دائنة بقيمة الأمر عند الاعتماد">
            <FormCombo name="supplierId" options={suppliers} create="workshop" required placeholder="ابحث عن الورشة أو المورد…" />
          </PanelField>
          <PanelField label="رقم فاتورة الورشة">
            <Input name="supplierInvoiceNo" dir="ltr" className="w-full" />
          </PanelField>
        </>
      ) : (
        <PanelField label="القطع تُشترى من" hint="يمكن تحديده لاحقاً عند الاعتماد">
          <Select name="cashAccountId" defaultValue="" className="w-full">
            <option value="">لاحقاً عند الاعتماد</option>
            {cashes.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nameAr}
              </option>
            ))}
          </Select>
        </PanelField>
      )}
    </>
  );
}
