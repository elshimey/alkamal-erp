import { sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { driverOptions, vehicleOptions } from "@/lib/lookups";
import { todayRiyadh } from "@/lib/dates";
import { DocumentFileInput } from "@/components/document-file-input";
import { FormCombo } from "@/components/form-combo";
import { PanelField, PanelSection } from "@/components/panel-ui";
import { RecordPanel } from "@/components/record-panel";
import { Input } from "@/components/ui";
import { saveViolationAction } from "./actions";

/** نافذة تسجيل مخالفة واحدة: المركبة والتاريخ والمبلغ وعلى من، والسائق يُعرف من سجل الإسناد إن تُرك فارغاً. */
export async function ViolationPanel({ closeHref }: { closeHref: string }) {
  const [vehicles, drivers, types] = await Promise.all([
    vehicleOptions(),
    driverOptions(),
    db
      .select({ t: s.trafficViolations.violationType })
      .from(s.trafficViolations)
      .groupBy(s.trafficViolations.violationType)
      .orderBy(sql`count(*) desc`)
      .limit(30),
  ]);
  const radio = "flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50";
  return (
    <RecordPanel title="تسجيل مخالفة" subtitle="يُنشأ قيد المخالفة فور الحفظ" closeHref={closeHref} action={saveViolationAction} creating>
      <PanelSection title="المخالفة">
        <PanelField label="تاريخ المخالفة" required>
          <Input type="date" name="date" defaultValue={todayRiyadh()} required className="w-full" />
        </PanelField>
        <PanelField label="المركبة" required>
          <FormCombo name="vehicleId" options={vehicles} create="vehicle" required placeholder="اكتب اللوحة…" />
        </PanelField>
        <PanelField label="نوع المخالفة" required hint="سرعة، وقوف، حمولة…">
          <Input name="type" required list="violation-types" className="w-full" />
          <datalist id="violation-types">
            {types.map((r) => (
              <option key={r.t} value={r.t} />
            ))}
          </datalist>
        </PanelField>
        <PanelField label="المبلغ" required>
          <Input name="amount" type="number" min={0.01} step="0.01" required dir="ltr" className="w-full" />
        </PanelField>
        <PanelField label="على من" required>
          <span className="flex flex-wrap gap-2">
            <label className={radio}>
              <input type="radio" name="chargeTo" value="driver" defaultChecked required className="accent-brand-600" />
              السائق (تُخصم من راتبه)
            </label>
            <label className={radio}>
              <input type="radio" name="chargeTo" value="company" className="accent-brand-600" />
              الشركة (مصروف على المركبة)
            </label>
          </span>
        </PanelField>
        <PanelField label="السائق" hint="فارغ = من سجل الإسناد في تاريخ المخالفة">
          <FormCombo name="driverId" options={drivers} placeholder="تلقائي من الإسناد…" />
        </PanelField>
      </PanelSection>
      <PanelSection title="تفاصيل أخرى" optional open>
        <PanelField label="رقم المخالفة" hint="يمنع تسجيلها مرتين">
          <Input name="reference" dir="ltr" className="w-full" />
        </PanelField>
        <PanelField label="الموقع">
          <Input name="location" className="w-full" />
        </PanelField>
        <PanelField label="صورة المخالفة" hint="صورة أو PDF">
          <DocumentFileInput />
        </PanelField>
        <PanelField label="ملاحظات">
          <textarea name="notes" rows={2} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" />
        </PanelField>
      </PanelSection>
    </RecordPanel>
  );
}
