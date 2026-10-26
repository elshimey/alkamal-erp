"use client";

import { DateInput } from "@/components/date-input";
import { PanelField, PanelSection } from "@/components/panel-ui";
import { EMPTY_GOODS, type GoodsDraft, type TransportDraft } from "@/lib/transport-draft";
import { FREIGHT_PAYERS, GOODS_CONDITIONS, LOGISTI_STATUSES, PACKAGE_UNITS, PAYMENT_METHODS, WEIGHT_UNITS } from "@/data/waybills";

const field = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20";
const cell = "w-full min-w-0 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20";

/**
 * أقسام وثيقة النقل (لوجستي) في نافذة الشحنة: تفاصيل المرسل والمستلم، والتواريخ، والبضاعة سطراً سطراً،
 * وأجور النقل، ورقم وثيقة لوجستي. القيم كلها تُرسل في حقل مخفي واحد (transport).
 */
export function TransportFields({ value: t, onChange, cities, open = false }: { value: TransportDraft; onChange: (t: TransportDraft) => void; cities: string[]; open?: boolean }) {
  const set = <K extends keyof TransportDraft>(k: K, v: TransportDraft[K]) => onChange({ ...t, [k]: v });
  const text = (k: keyof TransportDraft, extra?: { ltr?: boolean; placeholder?: string; list?: string }) => (
    <input value={t[k] as string} onChange={(e) => set(k, e.target.value as never)} className={`${field} ${extra?.ltr ? "ltr-nums" : ""}`} dir={extra?.ltr ? "ltr" : undefined} placeholder={extra?.placeholder} list={extra?.list} />
  );
  const setLine = (i: number, patch: Partial<GoodsDraft>) => set("goods", t.goods.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  const hasParty = !!(t.shipperPhone || t.shipperCity || t.shipperAddress || t.consigneePhone || t.consigneeCity || t.deliveryAddress);
  const totalKg = t.goods.reduce((s, g) => s + (Number(g.weight) || 0) * (g.weightUnit === "ton" ? 1000 : 1), 0);

  return (
    <>
      <input type="hidden" name="transport" value={JSON.stringify(t)} />
      <datalist id="transport-cities">
        {cities.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      <PanelSection title="المرسل والمرسل إليه" optional open={open || hasParty} hint="جوال ومدينة وعنوان كل طرف">
        <div className="grid gap-x-6 gap-y-3 lg:grid-cols-2">
          <div className="flex flex-col gap-3">
            <div className="text-xs font-semibold text-gray-500">المرسل</div>
            <PanelField label="الجوال">{text("shipperPhone", { ltr: true, placeholder: "05XXXXXXXX" })}</PanelField>
            <PanelField label="المدينة">{text("shipperCity", { list: "transport-cities" })}</PanelField>
            <PanelField label="العنوان">{text("shipperAddress")}</PanelField>
            <PanelField label="ملاحظات">{text("shipperNotes")}</PanelField>
          </div>
          <div className="flex flex-col gap-3">
            <div className="text-xs font-semibold text-gray-500">المرسل إليه</div>
            <PanelField label="الجوال">{text("consigneePhone", { ltr: true, placeholder: "05XXXXXXXX" })}</PanelField>
            <PanelField label="المدينة">{text("consigneeCity", { list: "transport-cities" })}</PanelField>
            <PanelField label="عنوان التسليم">{text("deliveryAddress")}</PanelField>
            <PanelField label="ملاحظات">{text("consigneeNotes")}</PanelField>
          </div>
        </div>
      </PanelSection>

      <PanelSection title="البضاعة والتواريخ" optional open={open || t.goods.length > 0 || !!t.pickupDate} hint="سطر لكل صنف كما في وثيقة لوجستي">
        <div className="grid gap-3 sm:grid-cols-2">
          <PanelField label="تاريخ الاستلام">
            <DateInput value={t.pickupDate} onChange={(e) => set("pickupDate", e.target.value)} className={field} />
          </PanelField>
          <PanelField label="التسليم المتوقع">
            <DateInput value={t.expectedDeliveryDate} onChange={(e) => set("expectedDeliveryDate", e.target.value)} className={field} />
          </PanelField>
        </div>
        <div className="overflow-x-auto">
          {t.goods.length > 0 && (
            <table className="w-full min-w-[44rem] text-sm">
              <thead className="text-xs text-gray-500">
                <tr>
                  <th className="pb-1 text-start font-medium">الوصف</th>
                  <th className="w-20 pb-1 text-start font-medium">العدد</th>
                  <th className="w-24 pb-1 text-start font-medium">الوحدة</th>
                  <th className="w-20 pb-1 text-start font-medium">الوزن</th>
                  <th className="w-20 pb-1 text-start font-medium" />
                  <th className="w-28 pb-1 text-start font-medium">الأبعاد</th>
                  <th className="w-24 pb-1 text-start font-medium">الحالة</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {t.goods.map((g, i) => (
                  <tr key={i}>
                    <td className="py-1 pe-1">
                      <input aria-label={`وصف الصنف ${i + 1}`} value={g.description} onChange={(e) => setLine(i, { description: e.target.value })} className={cell} placeholder="مثال: مواد بناء" />
                    </td>
                    <td className="py-1 pe-1">
                      <input aria-label="العدد" value={g.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} inputMode="decimal" className={`${cell} ltr-nums`} />
                    </td>
                    <td className="py-1 pe-1">
                      <select aria-label="الوحدة" value={g.packageUnit} onChange={(e) => setLine(i, { packageUnit: e.target.value })} className={cell}>
                        <option value="">—</option>
                        {Object.entries(PACKAGE_UNITS).map(([k, l]) => (
                          <option key={k} value={k}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1 pe-1">
                      <input aria-label="الوزن" value={g.weight} onChange={(e) => setLine(i, { weight: e.target.value })} inputMode="decimal" className={`${cell} ltr-nums`} />
                    </td>
                    <td className="py-1 pe-1">
                      <select aria-label="وحدة الوزن" value={g.weightUnit} onChange={(e) => setLine(i, { weightUnit: e.target.value })} className={cell}>
                        {Object.entries(WEIGHT_UNITS).map(([k, l]) => (
                          <option key={k} value={k}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1 pe-1">
                      <input aria-label="الأبعاد" value={g.dimensions} onChange={(e) => setLine(i, { dimensions: e.target.value })} className={`${cell} ltr-nums`} placeholder="2×1×1 م" />
                    </td>
                    <td className="py-1 pe-1">
                      <select aria-label="الحالة" value={g.condition} onChange={(e) => setLine(i, { condition: e.target.value })} className={cell}>
                        {Object.entries(GOODS_CONDITIONS).map(([k, l]) => (
                          <option key={k} value={k}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1 text-center">
                      <button type="button" aria-label={`حذف السطر ${i + 1}`} onClick={() => set("goods", t.goods.filter((_, j) => j !== i))} className="rounded-md px-2 py-1 text-gray-400 hover:bg-red-50 hover:text-red-600">
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => set("goods", [...t.goods, { ...EMPTY_GOODS }])} className="rounded-lg border border-dashed border-gray-300 px-3 py-1.5 text-sm font-medium text-brand-800 hover:bg-brand-50">
            + إضافة صنف
          </button>
          {totalKg > 0 && <span className="ltr-nums text-xs text-gray-500">إجمالي الوزن {(totalKg / 1000).toLocaleString("en", { maximumFractionDigits: 3 })} طن، ويصبح وزن الشحنة</span>}
        </div>
      </PanelSection>

      <PanelSection title="أجور النقل ووثيقة لوجستي" optional open={open || !!t.logistiNumber} hint="من يدفع، وطريقة الدفع، ورقم الوثيقة">
        <PanelField label="تُدفع من قِبل">
          <select value={t.freightPayer} onChange={(e) => set("freightPayer", e.target.value)} className={field}>
            {Object.entries(FREIGHT_PAYERS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </PanelField>
        <PanelField label="طريقة الدفع">
          <select value={t.paymentMethod} onChange={(e) => set("paymentMethod", e.target.value)} className={field}>
            {Object.entries(PAYMENT_METHODS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </PanelField>
        <PanelField label="تعليمات">{text("freightInstructions")}</PanelField>
        <PanelField label="قابلة للتداول">
          <span className="flex items-center gap-2">
            <input type="checkbox" checked={t.negotiable} onChange={(e) => set("negotiable", e.target.checked)} className="size-4 accent-brand-600" />
            <span className="text-gray-600">{t.negotiable ? "نعم" : "لا"}</span>
          </span>
        </PanelField>
        <PanelField label="رقم وثيقة لوجستي" hint="يُدخل يدوياً حتى يتوفر الربط">
          {text("logistiNumber", { ltr: true })}
        </PanelField>
        <PanelField label="حالة الوثيقة">
          <select value={t.logistiStatus} onChange={(e) => set("logistiStatus", e.target.value)} className={field}>
            {Object.entries(LOGISTI_STATUSES).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </PanelField>
      </PanelSection>
    </>
  );
}
