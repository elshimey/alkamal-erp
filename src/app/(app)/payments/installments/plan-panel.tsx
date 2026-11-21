import { asc } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { toAccountOptions, vehicleOptions } from "@/lib/lookups";
import { creditorAccounts } from "@/lib/installments";
import { todayRiyadh } from "@/lib/dates";
import { AccountField } from "@/components/account-field";
import { FormCombo } from "@/components/form-combo";
import { PanelField, PanelSection } from "@/components/panel-ui";
import { RecordPanel } from "@/components/record-panel";
import { Input } from "@/components/ui";
import { savePlanAction } from "./actions";
import { ScheduleEditor } from "./schedule-editor";

/**
 * نافذة «جدول أقساط جديد» (ملاحظة التشغيل 16): حساب الدائن من الشجرة (قرض بنكي 2114/2201، أقساط سيارات،
 * دائن شخصي، مورد) والجهة والمركبة إن وُجدت، ثم الأقساط مولّدة أو ملصوقة من جدول البنك.
 */
export async function PlanPanel({ closeHref, paste }: { closeHref: string; paste: boolean }) {
  const [accounts, parties, vehicles] = await Promise.all([
    creditorAccounts(db),
    db.select({ id: s.parties.id, nameAr: s.parties.nameAr }).from(s.parties).orderBy(asc(s.parties.nameAr)),
    vehicleOptions(),
  ]);
  return (
    <RecordPanel title="جدول أقساط جديد" subtitle="خطة سداد لدين مقيد في الشجرة؛ لا قيد عند الحفظ إلا تكلفة أقساط فات استحقاقها" closeHref={closeHref} action={savePlanAction} creating={false} savedHref="/payments/installments/{id}" wide>
      <PanelSection title="الدائن">
        <PanelField label="اسم الجدول" required hint="مثل: قرض البنك الأهلي، أقساط الشاحنة">
          <Input name="name" required className="w-full" />
        </PanelField>
        <PanelField label="حساب الدائن" required hint="الحساب الذي فيه الدين (2xxx)">
          <AccountField name="accountId" options={await toAccountOptions(accounts)} scope="2114,2201,2101" required />
        </PanelField>
        <PanelField label="الجهة الدائنة" hint="البنك أو الشخص أو المورد، إن وُجد">
          <FormCombo name="partyId" options={parties.map((p) => ({ value: String(p.id), label: p.nameAr }))} create="supplier" />
        </PanelField>
        <PanelField label="المركبة" hint="تكلفة التمويل على مركز تكلفتها (ربحية المركبات)">
          <FormCombo name="vehicleId" options={vehicles} create="vehicle" />
        </PanelField>
        <PanelField label="ملاحظات">
          <Input name="notes" className="w-full" />
        </PanelField>
      </PanelSection>
      <PanelSection title="الأقساط">
        <ScheduleEditor paste={paste} today={todayRiyadh()} />
      </PanelSection>
    </RecordPanel>
  );
}
