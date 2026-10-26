import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { vehicleOptions } from "@/lib/lookups";
import { cashAccounts } from "@/lib/invoices";
import { productOptions } from "@/lib/inventory";
import { supplierOptions } from "@/lib/purchases";
import { todayRiyadh } from "@/lib/dates";
import { LINE_KINDS, MAINTENANCE_TYPES } from "@/data/maintenance";
import { FormCombo } from "@/components/form-combo";
import { LinesEditor } from "@/components/lines-editor";
import { PanelField, PanelSection } from "@/components/panel-ui";
import { RecordPanel } from "@/components/record-panel";
import { Input, Select } from "@/components/ui";
import { OrderProviderFields } from "./order-provider-fields";
import { saveOrderPanelAction } from "./actions";

/** نافذة أمر صيانة جديد: الرأس والبنود معاً، وبعد الحفظ تُفتح معاينته للاعتماد. يُربط بطلب عطل أو خطة دورية إن جاء منهما. */
export async function OrderPanel({ closeHref, savedHref, vehicle, request, plan, type }: { closeHref: string; savedHref: string; vehicle?: string; request?: string; plan?: string; type?: string }) {
  const [vehicles, suppliers, cashes, products, warehouses, source] = await Promise.all([
    vehicleOptions(),
    supplierOptions(db),
    cashAccounts(db),
    productOptions(db),
    db.select({ id: s.warehouses.id, nameAr: s.warehouses.nameAr }).from(s.warehouses).where(eq(s.warehouses.isActive, true)).orderBy(asc(s.warehouses.code)),
    request
      ? db.select({ text: s.breakdownRequests.number, more: s.breakdownRequests.description }).from(s.breakdownRequests).where(eq(s.breakdownRequests.id, Number(request)))
      : plan
        ? db.select({ text: s.maintenancePlans.title, more: s.maintenancePlans.title }).from(s.maintenancePlans).where(eq(s.maintenancePlans.id, Number(plan)))
        : Promise.resolve([]),
  ]);
  const from = source[0];
  const firstWarehouse = warehouses[0] ? String(warehouses[0].id) : "";
  return (
    <RecordPanel
      title="أمر صيانة جديد"
      subtitle={from ? (request ? `من بلاغ العطل ${from.text}: ${from.more}` : `من الصيانة الدورية: ${from.text}`) : "يُحفظ مسودة، ويُقيد على مركز تكلفة المركبة عند الاعتماد"}
      closeHref={closeHref}
      savedHref={savedHref}
      action={saveOrderPanelAction}
      creating
    >
      <input type="hidden" name="breakdownRequestId" value={request ?? ""} />
      <input type="hidden" name="planId" value={plan ?? ""} />
      <PanelSection title="الأمر">
        <PanelField label="المركبة" required>
          <FormCombo name="vehicleId" options={vehicles} create="vehicle" defaultValue={vehicle ?? ""} required placeholder="اكتب اللوحة…" />
        </PanelField>
        <PanelField label="التاريخ" required>
          <Input type="date" name="orderDate" defaultValue={todayRiyadh()} required className="w-full" />
        </PanelField>
        <PanelField label="نوع الصيانة" required>
          <Select name="type" defaultValue={type && type in MAINTENANCE_TYPES ? type : "mechanical"} className="w-full">
            {Object.entries(MAINTENANCE_TYPES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </PanelField>
        <OrderProviderFields suppliers={suppliers} cashes={cashes} />
      </PanelSection>
      <PanelSection title="البنود" optional open hint="قطع الغيار وشغل اليد، ويمكن إضافتها لاحقاً قبل الاعتماد">
        <LinesEditor
          minRows={3}
          totals={{ qty: "quantity", price: "unitPrice", vat: "vat" }}
          columns={[
            { key: "kind", label: "النوع", type: "select", options: Object.entries(LINE_KINDS).map(([value, label]) => ({ value, label })), defaultValue: "part", width: "7.5rem" },
            {
              key: "productId",
              label: "الصنف",
              type: "select",
              create: "product",
              width: "11rem",
              options: products.map((p) => ({
                value: String(p.id),
                label: `${p.code} ${p.nameAr}`,
                // صنف المخزون يُصرف بمتوسط تكلفته فلا سعر له؛ الخدمة تأخذ سعرها
                fill: (p.kind === "stock" ? { description: p.nameAr, warehouseId: firstWarehouse } : { description: p.nameAr, unitPrice: p.price ? String(Number(p.price)) : "" }) as Record<string, string>,
              })),
            },
            { key: "warehouseId", label: "يُصرف من", type: "select", options: warehouses.map((w) => ({ value: String(w.id), label: w.nameAr })), width: "8rem", placeholder: "—", defaultValue: "" },
            { key: "description", label: "الوصف", width: "12rem" },
            { key: "quantity", label: "الكمية", type: "number", defaultValue: "1", width: "4.5rem" },
            { key: "unitPrice", label: "سعر الوحدة", type: "number", width: "7.5rem", placeholder: "متوسط التكلفة" },
            { key: "vat", label: "الضريبة", type: "select", options: [{ value: "15", label: "15%" }, { value: "0", label: "بدون" }], defaultValue: "15", width: "5.5rem" },
          ]}
        />
        <p className="text-xs text-gray-500">لصرف قطعة من المخزون اختر الصنف والمستودع واترك السعر؛ تُحمّل بمتوسط تكلفتها ولا تدخل في ذمة الورشة.</p>
      </PanelSection>
      <PanelSection title="تفاصيل أخرى" optional>
        <PanelField label="قراءة العداد">
          <Input name="odometer" type="number" min={0} dir="ltr" className="w-full" />
        </PanelField>
        <PanelField label="ملاحظات">
          <textarea name="notes" rows={2} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" />
        </PanelField>
      </PanelSection>
    </RecordPanel>
  );
}
