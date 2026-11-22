import { productOptions, vehicleOptions } from "@/lib/lookups";
import { todayRiyadh } from "@/lib/dates";
import { FormCombo } from "@/components/form-combo";
import { LinesEditor } from "@/components/lines-editor";
import { PanelField, PanelSection } from "@/components/panel-ui";
import { RecordPanel } from "@/components/record-panel";
import { Input } from "@/components/ui";
import { saveRequestPanel } from "./actions";

/**
 * نافذة «+ طلب شراء» (قرار أحمد 2026-11-22): التاريخ و«مطلوب قبل» من التقويم، والأصناف بطاقات
 * يُكتب فيها بسهولة على الجوال بدل النموذج المضغوط الذي كانت خاناته تتداخل.
 */
export async function RequestPanel({ closeHref }: { closeHref: string }) {
  const [products, vehicles] = await Promise.all([productOptions(), vehicleOptions()]);
  return (
    <RecordPanel title="طلب شراء جديد" subtitle="يُحفظ ويعتمده المدير، ثم يصدر له أمر شراء" closeHref={closeHref} action={saveRequestPanel} creating>
      <PanelSection title="بيانات الطلب">
        <PanelField label="التاريخ" required>
          <Input name="date" type="date" required defaultValue={todayRiyadh()} />
        </PanelField>
        <PanelField label="مطلوب قبل" hint="اختياري">
          <Input name="neededBy" type="date" />
        </PanelField>
        <PanelField label="للمركبة" hint="اختياري؛ تُحمّل عليها التكلفة">
          <FormCombo name="vehicleId" options={vehicles} create="vehicle" placeholder="ابحث باللوحة…" />
        </PanelField>
        <PanelField label="ملاحظات">
          <Input name="notes" className="w-full" placeholder="مثلاً: عاجل للورشة" />
        </PanelField>
      </PanelSection>

      <PanelSection title="الأصناف المطلوبة" hint="صنف من المخزون أو اكتب الوصف">
        <LinesEditor
          layout="cards"
          minRows={1}
          addLabel="+ إضافة صنف"
          totals={{ qty: "quantity", price: "price" }}
          columns={[
            { key: "productId", label: "الصنف", type: "select", options: products, placeholder: "صنف من المخزون أو اكتب الوصف", create: "product", wide: true, defaultValue: "" },
            { key: "description", label: "الوصف", wide: true },
            { key: "quantity", label: "الكمية", type: "number", required: true },
            { key: "price", label: "السعر التقديري", type: "number" },
          ]}
        />
      </PanelSection>
    </RecordPanel>
  );
}
