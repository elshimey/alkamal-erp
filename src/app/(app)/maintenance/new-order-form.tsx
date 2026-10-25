import { db } from "@/db";
import { ComboField } from "@/components/combo-box";
import { vehicleOptions } from "@/lib/lookups";
import { cashAccounts } from "@/lib/invoices";
import { supplierOptions } from "@/lib/purchases";
import { todayRiyadh } from "@/lib/dates";
import { MAINTENANCE_PROVIDERS, MAINTENANCE_TYPES } from "@/data/maintenance";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Field, Input, Select } from "@/components/ui";
import { Icon } from "@/components/icons";
import { createOrder } from "./actions";

/** نموذج أمر الصيانة الجديد، يُفتح من زر «أمر صيانة جديد» أو تلقائياً عند القدوم من طلب عطل أو خطة دورية. */
export async function NewOrderForm({ sp }: { sp: { vehicle?: string; request?: string; plan?: string; type?: string } }) {
  const [vehicles, suppliers, cashes] = await Promise.all([vehicleOptions(), supplierOptions(db), cashAccounts(db)]);
  return (
    <details open={!!(sp.request || sp.plan || sp.vehicle)} className="group mb-5 rounded-2xl border border-black/[0.06] bg-white shadow-sm print:hidden">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-3.5">
        <span className="flex size-8 items-center justify-center rounded-lg bg-brand-500 text-brand-900">
          <Icon name="wrench" className="size-4" />
        </span>
        <span className="font-semibold text-brand-900">أمر صيانة جديد</span>
        <span className="ms-auto text-xs text-gray-500 group-open:hidden">فتح النموذج</span>
      </summary>
      <div className="border-t border-gray-100 px-5 py-4">
            <ActionForm action={createOrder} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <input type="hidden" name="breakdownRequestId" value={sp.request ?? ""} />
              <input type="hidden" name="planId" value={sp.plan ?? ""} />
              <Field label="المركبة">
                <ComboField name="vehicleId" options={vehicles} create="vehicle" defaultValue={sp.vehicle ?? ""} required />
              </Field>
              <Field label="التاريخ">
                <Input name="orderDate" type="date" defaultValue={todayRiyadh()} />
              </Field>
              <Field label="النوع">
                <Select name="type" defaultValue={sp.type ?? "mechanical"}>
                  {Object.entries(MAINTENANCE_TYPES).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="الجهة">
                <Select name="provider" defaultValue="external">
                  {Object.entries(MAINTENANCE_PROVIDERS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="الورشة / المورد" hint="للجهة الخارجية: تصبح دائنة بقيمة الأمر">
                <ComboField name="supplierId" options={suppliers} create="workshop" placeholder="ابحث عن الورشة أو المورد…" />
              </Field>
              <Field label="رقم فاتورة الورشة">
                <Input name="supplierInvoiceNo" className="ltr-nums" />
              </Field>
              <Field label="أو الصندوق" hint="للورشة الداخلية: القطع تُشترى منه">
                <Select name="cashAccountId" defaultValue="">
                  <option value="">—</option>
                  {cashes.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nameAr}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="قراءة العداد">
                <Input name="odometer" type="number" min={0} />
              </Field>
              <Field label="ملاحظات">
                <Input name="notes" />
              </Field>
              <div className="flex items-end">
                <SubmitButton>إنشاء الأمر وإضافة البنود</SubmitButton>
              </div>
            </ActionForm>
            {(sp.request || sp.plan) && <p className="mt-3 text-xs text-brand-700">الأمر مرتبط {sp.request ? "بطلب العطل المختار" : "بالخطة الدورية المختارة"}.</p>}
      </div>
    </details>
  );
}
