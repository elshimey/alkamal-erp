"use client";

import { useRef, useState } from "react";
import { ComboBox, ComboField } from "@/components/combo-box";
import { DateInput } from "@/components/date-input";
import { PanelField, PanelSection } from "@/components/panel-ui";
import { RecordPanel, type PanelResult } from "@/components/record-panel";
import { WaybillDocument } from "@/components/waybill-document";
import { Icon } from "@/components/icons";
import type { CompanyProfile } from "@/lib/company";
import type { InvoiceTemplate } from "@/lib/invoice-template";
import type { QuickOption } from "@/lib/quick-add-types";
import { fmt } from "@/lib/format";
import { fillContact, type ContactCard, type TransportDraft } from "@/lib/transport-draft";
import { TransportFields } from "./transport-fields";

export interface WaybillDraft {
  number?: string;
  date: string;
  customerId: string;
  routeId: string;
  execution: "fleet" | "carrier";
  vehicleId: string;
  trailerId: string;
  driverId: string;
  carrierId: string;
  carrierCost: string;
  carrierPlate: string;
  carrierDriverName: string;
  shipper: string;
  consignee: string;
  amount: string;
  commission: string;
  weight: string;
  container: string;
  deliveryNote: string;
  customs: string;
  notes: string;
  priceNote?: string | null;
  transport: TransportDraft;
}

export type RouteOption = QuickOption & { international: boolean };

const field = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20";
const num = (v: string) => Number(v.replace(/[,\s]/g, "")) || 0;

/**
 * نافذة إنشاء الشحنة وتعديلها على طريقة وافق: الحقول يميناً ومعاينة البوليصة يساراً تتحدث مع كل حرف.
 * المسار يحدد الضريبة (دولي صفر، داخلي 15%)، والسعر الفارغ يُحسب من العقد الساري عند الحفظ.
 */
export function WaybillEditor({
  title,
  initial,
  customers,
  routes,
  vehicles,
  trailers,
  drivers,
  carriers,
  shippers,
  contacts,
  cities,
  showPrices,
  company,
  template,
  action,
  closeHref,
  savedHref,
}: {
  title: string;
  initial: WaybillDraft;
  customers: QuickOption[];
  routes: RouteOption[];
  vehicles: QuickOption[];
  trailers: QuickOption[];
  drivers: QuickOption[];
  carriers: QuickOption[];
  shippers: string[];
  contacts: Record<string, ContactCard>;
  cities: string[];
  showPrices: boolean;
  company: CompanyProfile;
  template: InvoiceTemplate;
  action: (data: FormData) => Promise<PanelResult>;
  closeHref: string;
  savedHref: string;
}) {
  const [d, setD] = useState(initial);
  const [preview, setPreview] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  const touch = () => box.current?.dispatchEvent(new Event("input", { bubbles: true }));
  const set = <K extends keyof WaybillDraft>(k: K, v: WaybillDraft[K]) => {
    setD((x) => ({ ...x, [k]: v }));
    touch();
  };
  const onField = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(e.target.name as keyof WaybillDraft, e.target.value);
  const suggestions = shippers.map((x) => ({ value: x, label: x }));
  // اختيار مرسل أو مستلم محفوظ يملأ جواله ومدينته وعنوانه في وثيقة النقل
  const pickParty = (side: "shipper" | "consignee", v: string, picked: boolean) => {
    setD((x) => ({ ...x, [side]: v, transport: picked ? fillContact(x.transport, side, contacts[v]) : x.transport }));
    touch();
  };

  const route = routes.find((r) => r.value === d.routeId);
  const [from, to] = (route?.label ?? "— ← —").split(" ← ");
  const label = (list: QuickOption[], v: string) => list.find((o) => o.value === v)?.label ?? null;
  const fleet = d.execution === "fleet";
  const vatRate = route ? (route.international ? 0 : 15) : null;
  const amount = num(d.amount);

  const doc = {
    w: {
      number: d.number ?? "جديدة",
      waybillDate: d.date,
      shipper: d.shipper || "—",
      consignee: d.consignee || "—",
      deliveryAddress: d.transport.deliveryAddress || null,
      shipperPhone: d.transport.shipperPhone || null,
      shipperCity: d.transport.shipperCity || null,
      consigneePhone: d.transport.consigneePhone || null,
      consigneeCity: d.transport.consigneeCity || null,
      pickupDate: d.transport.pickupDate || null,
      expectedDeliveryDate: d.transport.expectedDeliveryDate || null,
      logistiNumber: d.transport.logistiNumber || null,
      isInternational: !!route?.international,
      execution: d.execution,
      carrierDriverName: d.carrierDriverName || null,
      carrierDriverMobile: null,
      carrierPlate: d.carrierPlate || null,
      containerNumber: d.container || null,
      weightTons: d.weight || null,
      customsDeclaration: d.customs || null,
      deliveryNoteNumber: d.deliveryNote || null,
      distanceKm: null,
      notes: d.notes || null,
    },
    customer: label(customers, d.customerId) ?? "—",
    from,
    to,
    plate: label(vehicles, d.vehicleId),
    driver: label(drivers, d.driverId) ?? (fleet && d.vehicleId ? "السائق المسند للمركبة" : null),
    driverMobile: null,
    carrier: label(carriers, d.carrierId),
    trailerPlate: label(trailers, d.trailerId),
    stages: [],
    goods: d.transport.goods.filter((g) => g.description.trim()).map((g) => ({ ...g, quantity: g.quantity || null, weight: g.weight || null })),
  } as unknown as Parameters<typeof WaybillDocument>[0]["doc"];

  return (
    <RecordPanel
      title={title}
      subtitle={d.number ? `رقم ${d.number}` : "تُرقّم تلقائياً عند الحفظ"}
      closeHref={closeHref}
      savedHref={savedHref}
      action={action}
      creating={false}
      wide
      toolbar={
        <button type="button" onClick={() => setPreview((p) => !p)} className="hidden items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50 lg:flex">
          <Icon name="document" className="size-4" />
          {preview ? "إخفاء المعاينة" : "إظهار المعاينة"}
        </button>
      }
    >
      <div ref={box} className={`grid items-start gap-6 ${preview ? "lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]" : ""}`}>
        <div className="min-w-0">
          <PanelSection title="بيانات الشحنة">
            <PanelField label="التاريخ" required>
              <DateInput name="date" required value={d.date} onChange={(e) => set("date", e.target.value)} className={field} />
            </PanelField>
            <PanelField label="العميل" required>
              <ComboField name="customerId" options={customers} defaultValue={d.customerId} create="customer" required placeholder="ابحث عن العميل…" onChange={(v) => set("customerId", v)} />
            </PanelField>
            <PanelField label="المسار" required hint="يحدد الضريبة والعمولة">
              <ComboField name="routeId" options={routes} defaultValue={d.routeId} create="route" required placeholder="من ← إلى" onChange={(v) => set("routeId", v)} />
              {route && (
                <span className={`mt-1.5 inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ${route.international ? "bg-sky-50 text-sky-800" : "bg-amber-50 text-amber-800"}`}>
                  {route.international ? "شحن دولي · ضريبة صفرية" : "شحن داخلي · ضريبة 15%"}
                </span>
              )}
            </PanelField>
            <PanelField label="المرسل" required>
              <input type="hidden" name="shipper" value={d.shipper} />
              <ComboBox value={d.shipper} options={suggestions} free placeholder="اسم الشاحن" onChange={(v, o) => pickParty("shipper", v, !!o)} className={field} />
            </PanelField>
            <PanelField label="المستلم" required>
              <input type="hidden" name="consignee" value={d.consignee} />
              <ComboBox value={d.consignee} options={suggestions} free placeholder="اسم المستلم" onChange={(v, o) => pickParty("consignee", v, !!o)} className={field} />
            </PanelField>
          </PanelSection>

          <PanelSection title="التنفيذ" hint="مركبة من الأسطول أو ناقل خارجي">
            <span className="flex flex-wrap gap-2">
              {(
                [
                  ["fleet", "أسطولنا (مركبة وسائق)"],
                  ["carrier", "ناقل خارجي"],
                ] as const
              ).map(([k, t]) => (
                <label key={k} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${d.execution === k ? "border-brand-500 bg-brand-50 font-semibold text-brand-900" : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"}`}>
                  <input type="radio" name="execution" value={k} checked={d.execution === k} onChange={() => set("execution", k)} className="accent-brand-600" />
                  {t}
                </label>
              ))}
            </span>
            {fleet ? (
              <>
                <PanelField label="المركبة" required>
                  <ComboField key="v" name="vehicleId" options={vehicles} defaultValue={d.vehicleId} create="vehicle" required placeholder="رقم اللوحة" onChange={(v) => set("vehicleId", v)} />
                </PanelField>
                {trailers.length > 0 && (
                  <PanelField label="المقطورة">
                    <ComboField name="trailerId" options={trailers} defaultValue={d.trailerId} placeholder="بلا مقطورة" onChange={(v) => set("trailerId", v)} />
                  </PanelField>
                )}
                <PanelField label="السائق" hint="فارغ = المسند للمركبة">
                  <ComboField name="driverId" options={drivers} defaultValue={d.driverId} create="driver" placeholder="السائق المسند تلقائياً" onChange={(v) => set("driverId", v)} />
                </PanelField>
                <PanelField label="عمولة السائق" hint="فارغ = من المسار">
                  <input name="commission" value={d.commission} onChange={onField} inputMode="decimal" className={`${field} ltr-nums`} placeholder="من المسار" />
                </PanelField>
              </>
            ) : (
              <>
                <PanelField label="الناقل" required>
                  <ComboField key="c" name="carrierId" options={carriers} defaultValue={d.carrierId} create="carrier" required placeholder="اسم الناقل" onChange={(v) => set("carrierId", v)} />
                </PanelField>
                <PanelField label="تكلفة الناقل" required>
                  <input name="carrierCost" value={d.carrierCost} onChange={onField} inputMode="decimal" required className={`${field} ltr-nums`} />
                </PanelField>
                <PanelField label="لوحة الناقل">
                  <input name="carrierPlate" value={d.carrierPlate} onChange={onField} className={`${field} ltr-nums`} />
                </PanelField>
                <PanelField label="سائق الناقل">
                  <input name="carrierDriverName" value={d.carrierDriverName} onChange={onField} className={field} />
                </PanelField>
              </>
            )}
          </PanelSection>

          {showPrices && (
            <PanelSection title="السعر">
              <PanelField label="مبلغ الشحنة" hint="فارغ = من العقد الساري">
                <input name="amount" value={d.amount} onChange={onField} inputMode="decimal" className={`${field} ltr-nums`} placeholder="من العقد" />
                {d.priceNote && <span className="mt-1 block text-xs text-gray-500">{d.priceNote}</span>}
              </PanelField>
              {vatRate != null && amount > 0 && (
                <div className="ltr-nums grid grid-cols-3 gap-2 rounded-xl bg-gray-50 px-4 py-3 text-center text-sm">
                  <span>
                    <span className="block text-xs text-gray-500">قبل الضريبة</span>
                    {fmt(amount)}
                  </span>
                  <span>
                    <span className="block text-xs text-gray-500">الضريبة {vatRate}%</span>
                    {fmt((amount * vatRate) / 100)}
                  </span>
                  <span className="font-semibold">
                    <span className="block text-xs font-normal text-gray-500">الإجمالي</span>
                    {fmt(amount * (1 + vatRate / 100))}
                  </span>
                </div>
              )}
            </PanelSection>
          )}

          <TransportFields value={d.transport} onChange={(t) => set("transport", t)} cities={cities} />

          <PanelSection title="الحمولة والمستندات" optional open={!!(d.weight || d.container || d.deliveryNote || d.customs || d.notes)}>
            <PanelField label="الوزن (طن)">
              <input name="weight" value={d.weight} onChange={onField} inputMode="decimal" className={`${field} ltr-nums`} />
            </PanelField>
            <PanelField label="رقم الحاوية">
              <input name="container" value={d.container} onChange={onField} className={`${field} ltr-nums`} />
            </PanelField>
            <PanelField label="رقم سند التسليم">
              <input name="deliveryNote" value={d.deliveryNote} onChange={onField} className={`${field} ltr-nums`} />
            </PanelField>
            <PanelField label="البيان الجمركي">
              <input name="customs" value={d.customs} onChange={onField} className={`${field} ltr-nums`} />
            </PanelField>
            <PanelField label="ملاحظات">
              <textarea name="notes" value={d.notes} onChange={onField} rows={2} className={field} />
            </PanelField>
          </PanelSection>
        </div>

        {preview && (
          <aside className="sticky top-0 hidden min-w-0 lg:block" aria-label="معاينة البوليصة">
            <div className="mb-2 flex items-center gap-2 text-xs text-gray-500">
              <span className="size-2 animate-pulse rounded-full bg-green-500" />
              معاينة مباشرة كما ستُطبع البوليصة
            </div>
            <div className="max-h-[calc(100vh-9rem)] overflow-y-auto rounded-2xl bg-[repeating-linear-gradient(0deg,transparent,transparent_23px,rgba(0,0,0,0.03)_24px),repeating-linear-gradient(90deg,transparent,transparent_23px,rgba(0,0,0,0.03)_24px)] p-3">
              <WaybillDocument company={company} doc={doc} template={template} compact />
            </div>
          </aside>
        )}
      </div>
    </RecordPanel>
  );
}
