import { driverOptions, vehicleOptions } from "@/lib/lookups";
import { todayRiyadh } from "@/lib/dates";
import { BREAKDOWN_APPROVAL_LIMIT, PRIORITIES } from "@/data/maintenance";
import { FormCombo } from "@/components/form-combo";
import { PanelField, PanelSection } from "@/components/panel-ui";
import { RecordPanel } from "@/components/record-panel";
import { Input } from "@/components/ui";
import { saveRequestAction } from "./actions";

const radio = "flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50";

/** نافذة بلاغ عطل واحد؛ بعد الحفظ تُفتح معاينته للمراجعة. */
export async function RequestPanel({ closeHref, savedHref }: { closeHref: string; savedHref: string }) {
  const [vehicles, drivers] = await Promise.all([vehicleOptions(), driverOptions()]);
  return (
    <RecordPanel
      title="بلاغ عطل جديد"
      subtitle={`يراجعه المشرف، وما تجاوز ${BREAKDOWN_APPROVAL_LIMIT.toLocaleString("en")} ر.س يعتمده المدير`}
      closeHref={closeHref}
      savedHref={savedHref}
      action={saveRequestAction}
      creating
    >
      <PanelSection title="البلاغ">
        <PanelField label="تاريخ البلاغ" required>
          <Input type="date" name="date" defaultValue={todayRiyadh()} required className="w-full" />
        </PanelField>
        <PanelField label="المركبة" required>
          <FormCombo name="vehicleId" options={vehicles} create="vehicle" required placeholder="اكتب اللوحة…" />
        </PanelField>
        <PanelField label="وصف العطل" required>
          <textarea name="description" rows={3} required className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" />
        </PanelField>
        <PanelField label="الأولوية" required>
          <span className="flex flex-wrap gap-2">
            {Object.entries(PRIORITIES).map(([k, p]) => (
              <label key={k} className={radio}>
                <input type="radio" name="priority" value={k} defaultChecked={k === "normal"} className="accent-brand-600" />
                {p.label}
              </label>
            ))}
          </span>
        </PanelField>
      </PanelSection>
      <PanelSection title="تفاصيل أخرى" optional open>
        <PanelField label="السائق" hint="من أبلغ عن العطل">
          <FormCombo name="driverId" options={drivers} placeholder="اختياري…" />
        </PanelField>
        <PanelField label="التكلفة التقديرية" hint="تحدد من يعتمد البلاغ">
          <Input name="estimatedCost" type="number" min={0} step="0.01" dir="ltr" className="w-full" />
        </PanelField>
      </PanelSection>
    </RecordPanel>
  );
}
