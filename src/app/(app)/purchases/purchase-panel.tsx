import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { productOptions } from "@/lib/inventory";
import { vehicleOptions } from "@/lib/lookups";
import { expenseAccountOptions, supplierOptions } from "@/lib/purchases";
import { taxCodeOptions } from "@/lib/tax-codes";
import { todayRiyadh } from "@/lib/dates";
import { DocumentFileInput } from "@/components/document-file-input";
import { FormCombo } from "@/components/form-combo";
import { PanelField, PanelSection } from "@/components/panel-ui";
import { RecordPanel } from "@/components/record-panel";
import { Input, Select } from "@/components/ui";
import { savePurchaseAction } from "./actions";
import { PurchaseDates, PurchaseLines } from "./purchase-lines";

/**
 * نافذة فاتورة مورد واحدة على نمط فاتورة المبيعات (قرار أحمد 2026-11-22): المورد ورقم فاتورته والتواريخ من التقويم،
 * والبنود بطاقات. تحفظ بنفس createPurchaseInvoice الذي يستخدمه الشيت، فلا يختلف القيد بين الطريقتين.
 */
export async function PurchasePanel({ closeHref, canPost }: { closeHref: string; canPost: boolean }) {
  const [suppliers, accounts, vehicles, products, warehouses, taxes] = await Promise.all([
    supplierOptions(db),
    expenseAccountOptions(db),
    vehicleOptions(),
    productOptions(db).then((r) => r.map((p) => ({ value: String(p.id), label: `${p.code} ${p.nameAr}` }))),
    db
      .select({ id: s.warehouses.id, nameAr: s.warehouses.nameAr })
      .from(s.warehouses)
      .where(eq(s.warehouses.isActive, true))
      .then((r) => r.map((w) => ({ value: String(w.id), label: w.nameAr }))),
    taxCodeOptions(db, "purchases"),
  ]);
  return (
    <RecordPanel
      title="فاتورة مورد جديدة"
      subtitle="تُحفظ مسودة، وتأخذ قيدها عند الترحيل"
      closeHref={closeHref}
      action={savePurchaseAction}
      creating
      altSubmit={canPost ? { label: "حفظ وترحيل", name: "postNow" } : undefined}
    >
      <PanelSection title="بيانات الفاتورة">
        <PanelField label="المورد" required>
          <FormCombo name="supplierId" options={suppliers} create="supplier" required placeholder="ابحث عن المورد…" keepOnReset />
        </PanelField>
        <PanelField label="رقم فاتورة المورد" required>
          <Input name="supplierInvoiceNo" required dir="ltr" className="w-full" />
        </PanelField>
        <PurchaseDates today={todayRiyadh()} />
        <PanelField label="العملة">
          <Select name="currency" defaultValue="SAR" className="w-full">
            <option value="SAR">ريال سعودي SAR</option>
            <option value="KWD">دينار كويتي KWD</option>
          </Select>
        </PanelField>
      </PanelSection>

      <PanelSection title="البنود" hint="كل بند على حسابه ومركبته، وضريبة المدخلات تُسترد تلقائياً">
        <PurchaseLines products={products} warehouses={warehouses} accounts={accounts} vehicles={vehicles} taxes={taxes} />
      </PanelSection>

      <PanelSection title="ملاحظات وصورة الفاتورة" optional>
        <PanelField label="ملاحظات">
          <Input name="notes" className="w-full" placeholder="ملاحظات داخلية" />
        </PanelField>
        <PanelField label="صورة فاتورة المورد">
          <DocumentFileInput label="إرفاق صورة فاتورة المورد" />
        </PanelField>
      </PanelSection>
    </RecordPanel>
  );
}
