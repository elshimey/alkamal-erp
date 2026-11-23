import { and, desc, eq, gte, ne } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { driverOptions, payFromTree, toAccountOptions, vehicleOptions } from "@/lib/lookups";
import { payFromAccounts } from "@/lib/invoices";
import { expenseAccountOptions, supplierOptions } from "@/lib/purchases";
import { todayRiyadh } from "@/lib/dates";
import { AccountField } from "@/components/account-field";
import { DocumentFileInput } from "@/components/document-file-input";
import { FormCombo } from "@/components/form-combo";
import { PanelField, PanelSection } from "@/components/panel-ui";
import { RecordPanel } from "@/components/record-panel";
import { Input, Select } from "@/components/ui";
import { saveExpenseAction } from "./actions";

const radio = "flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50";

/**
 * نافذة مصروف واحد (المكتب): نوع المصروف والمبلغ، وعلى أي مركبة وسائق وشحنة أو مركز تكلفة،
 * ومن دفع: عهدة السائق، أو الشركة (صندوق / بنك / عهدة موظف)، أو «لم يُدفع بعد» على مستفيد.
 * تحفظ بنفس منطق الشيت (createExpense) فلا يختلف القيد بين الطريقتين.
 */
export async function ExpensePanel({ closeHref, canApprove }: { closeHref: string; canApprove: boolean }) {
  const today = todayRiyadh();
  const since = new Date(Date.parse(today) - 60 * 86_400_000).toISOString().slice(0, 10);
  const [accounts, drivers, vehicles, cashes, payees, waybills, centers] = await Promise.all([
    expenseAccountOptions(db),
    driverOptions(),
    vehicleOptions(),
    payFromAccounts(db),
    supplierOptions(db),
    db
      .select({ id: s.waybills.id, number: s.waybills.number, date: s.waybills.waybillDate })
      .from(s.waybills)
      .where(gte(s.waybills.waybillDate, since))
      .orderBy(desc(s.waybills.waybillDate)),
    db
      .select({ id: s.costCenters.id, code: s.costCenters.code, nameAr: s.costCenters.nameAr })
      .from(s.costCenters)
      .where(and(eq(s.costCenters.isActive, true), ne(s.costCenters.type, "vehicle")))
      .orderBy(s.costCenters.code),
  ]);
  const [cashOpts, tree] = await Promise.all([toAccountOptions(cashes), payFromTree()]);
  const firstCash = cashes.find((a) => a.code.startsWith("1101")) ?? cashes[0];
  return (
    <RecordPanel
      title="مصروف جديد"
      subtitle={canApprove ? "يُعتمد ويُقيد فور الحفظ" : "يبقى بانتظار الاعتماد حتى يعتمده المحاسب"}
      closeHref={closeHref}
      action={saveExpenseAction}
      creating
    >
      <PanelSection title="المصروف">
        <PanelField label="التاريخ" required>
          <Input type="date" name="date" defaultValue={today} required className="w-full" />
        </PanelField>
        <PanelField label="نوع المصروف" required hint="حساب المصروف من الشجرة (ديزل، صيانة، رسوم…)">
          <AccountField name="accountId" options={accounts} required />
        </PanelField>
        <PanelField label="البيان">
          <Input name="description" className="w-full" placeholder="فارغ = اسم نوع المصروف" />
        </PanelField>
        <PanelField label="المبلغ قبل الضريبة" required>
          <Input name="amount" type="number" min={0.01} step="0.01" required dir="ltr" className="w-full" />
        </PanelField>
        <PanelField label="الضريبة" hint="ضريبة المدخلات من الإيصال (حتى 15% من المبلغ)">
          <Input name="vat" type="number" min={0} step="0.01" dir="ltr" placeholder="0" className="w-full" />
        </PanelField>
      </PanelSection>

      <PanelSection title="على أي مركبة وسائق">
        <PanelField label="السائق" hint="اختياره يملأ مركبته في تاريخ المصروف">
          <FormCombo name="driverId" options={drivers} create="driver" placeholder="اكتب اسم السائق…" autoVehicle={{ name: "vehicleId", dateName: "date" }} />
        </PanelField>
        <PanelField label="المركبة" hint="حسابات التشغيل (5xxx) تشترط المركبة">
          <FormCombo name="vehicleId" options={vehicles} create="vehicle" placeholder="اكتب اللوحة…" />
        </PanelField>
        <PanelField label="الشحنة" hint="تربط المصروف بالرحلة وتملأ المركبة والسائق إن تُركا فارغين">
          <FormCombo name="waybillId" options={waybills.map((w) => ({ value: String(w.id), label: `${w.number} · ${w.date}` }))} placeholder="رقم الشحنة…" />
        </PanelField>
        <PanelField label="مركز التكلفة" hint="للمصروف غير المرتبط بمركبة (الإدارة، الورشة…). المركبة تحدد مركزها تلقائياً">
          <Select name="costCenterId" defaultValue="" className="w-full">
            <option value="">— من المركبة —</option>
            {centers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nameAr} ({c.code})
              </option>
            ))}
          </Select>
        </PanelField>
        <PanelField label="على العميل">
          <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
            <input type="checkbox" name="billToCustomer" value="1" className="mt-0.5 accent-brand-600" />
            <span>
              يُحمَّل على عميل الشحنة ويظهر سطراً في فاتورتها
              <span className="block text-xs text-gray-600">يُقيد على 1114 بدل مصروف المركبة ويحتاج الشحنة.</span>
            </span>
          </label>
        </PanelField>
      </PanelSection>

      <PanelSection title="من دفع">
        <div className="group/payer flex flex-col gap-3">
          <span className="flex flex-wrap gap-2">
            <label className={radio}>
              <input id="exp-cash" type="radio" name="payer" value="cash" defaultChecked required className="accent-brand-600" />
              الشركة
            </label>
            <label className={radio}>
              <input id="exp-custody" type="radio" name="payer" value="driver_custody" className="accent-brand-600" />
              عهدة السائق
            </label>
            <label className={radio}>
              <input id="exp-unpaid" type="radio" name="payer" value="unpaid" className="accent-brand-600" />
              لم يُدفع بعد
            </label>
          </span>
          <div className="group-has-[#exp-cash:checked]/payer:block hidden">
            <PanelField label="دُفع من" hint="صندوق أو بنك أو عهدة موظف المكتب">
              <AccountField name="cashAccountId" options={cashOpts} moreOptions={tree} defaultValue={firstCash?.id} scope="1101,1102,1105" />
            </PanelField>
          </div>
          <p className="group-has-[#exp-custody:checked]/payer:block hidden rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
            يُخصم من عهدة السائق المختار أعلاه (أو سائق الشحنة).
          </p>
          <div className="group-has-[#exp-unpaid:checked]/payer:block hidden">
            <PanelField label="المستفيد" hint="المورد أو الورشة إن عُرف، وإلا يُقيد على المصروفات المستحقة 2106">
              <FormCombo name="partyId" options={payees} create="supplier" placeholder="اختياري…" />
            </PanelField>
            <p className="mt-2 text-xs text-gray-600">يُقيد عند الاعتماد التزاماً على المستفيد، ويُسدد لاحقاً بسند صرف من «سندات صرف تحت المراجعة».</p>
          </div>
        </div>
      </PanelSection>

      <PanelSection title="الإيصال" optional open>
        <PanelField label="المحل">
          <Input name="vendor" className="w-full" />
        </PanelField>
        <PanelField label="رقم الإيصال">
          <Input name="reference" dir="ltr" className="w-full" />
        </PanelField>
        <PanelField label="صورة الإيصال" hint="صورة أو PDF">
          <DocumentFileInput />
        </PanelField>
      </PanelSection>
    </RecordPanel>
  );
}
