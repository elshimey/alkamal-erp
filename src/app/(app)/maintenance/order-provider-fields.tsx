"use client";

import { useState } from "react";
import type { QuickOption } from "@/lib/quick-add-types";
import { FormCombo } from "@/components/form-combo";
import { PanelField } from "@/components/panel-ui";
import { Input } from "@/components/ui";
import { AccountField } from "@/components/account-field";

const radio = "flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50";

/**
 * الجهة: ورشة خارجية (تصبح دائنة بقيمة الأمر) أو ورشة داخلية (الميكانيكي موظف).
 * القطع المشتراة للورشة الداخلية من الصندوق أو ديناً على مورد آجل؛ وقطع المستودع تُصرف في البنود.
 */
export function OrderProviderFields({ suppliers, cashes, moreCashes }: { suppliers: QuickOption[]; cashes: QuickOption[]; moreCashes?: QuickOption[] }) {
  const [provider, setProvider] = useState<"external" | "internal">("external");
  const [partsFrom, setPartsFrom] = useState<"cash" | "supplier">("cash");
  const pick = (set: (v: string) => void) => (e: React.FormEvent<HTMLSpanElement>) => set((e.target as HTMLInputElement).value);
  const supplierFields = (label: string, hint: string) => (
    <>
      <PanelField label={label} required hint={hint}>
        <FormCombo name="supplierId" options={suppliers} create="workshop" required placeholder="ابحث عن الورشة أو المورد…" />
      </PanelField>
      <PanelField label="رقم فاتورة المورد">
        <Input name="supplierInvoiceNo" dir="ltr" className="w-full" />
      </PanelField>
    </>
  );
  return (
    <>
      <PanelField label="الجهة" required>
        <span className="flex flex-wrap gap-2" onChange={pick((v) => (v === "external" || v === "internal") && setProvider(v))}>
          <label className={radio}>
            <input type="radio" name="provider" value="external" defaultChecked className="accent-brand-600" />
            ورشة خارجية / على الطريق
          </label>
          <label className={radio}>
            <input type="radio" name="provider" value="internal" className="accent-brand-600" />
            ورشة داخلية
          </label>
        </span>
      </PanelField>
      {provider === "external" ? (
        supplierFields("الورشة / المورد", "تصبح دائنة بقيمة الأمر عند الاعتماد")
      ) : (
        <>
          <PanelField label="القطع المشتراة" hint="قطع المستودع تُصرف في البنود بمتوسط تكلفتها">
            <span className="flex flex-wrap gap-2" onChange={pick((v) => (v === "cash" || v === "supplier") && setPartsFrom(v))}>
              <label className={radio}>
                <input type="radio" name="partsFrom" value="cash" defaultChecked className="accent-brand-600" />
                نقداً من صندوق
              </label>
              <label className={radio}>
                <input type="radio" name="partsFrom" value="supplier" className="accent-brand-600" />
                آجل من مورد
              </label>
            </span>
          </PanelField>
          {partsFrom === "supplier" ? (
            supplierFields("مورد القطع", "يصبح دائناً بقيمة القطع المشتراة عند الاعتماد")
          ) : (
            <PanelField label="الصندوق" hint="يمكن تحديده لاحقاً عند الاعتماد">
              <AccountField name="cashAccountId" options={cashes} moreOptions={moreCashes} scope="1101,1102" placeholder="لاحقاً عند الاعتماد" />
            </PanelField>
          )}
        </>
      )}
    </>
  );
}
