"use client";

import { useRef, useState } from "react";
import { ComboBox, ComboField } from "@/components/combo-box";
import { DateInput } from "@/components/date-input";
import { PanelField, PanelSection } from "@/components/panel-ui";
import { RecordPanel, type PanelResult } from "@/components/record-panel";
import { WaybillDocument } from "@/components/waybill-document";
import { Icon } from "@/components/icons";
import { CustomerChargesEditor, PAYER_LABELS, type ChargeDraft, type TripExpense } from "@/components/customer-charges-editor";
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
  /** السعر الأساسي (من العقد أو يدوي) */
  amount: string;
  /** مكونات السعر فوقه: النوع «الأساسي~رقم» */
  components: PriceComponentDraft[];
  /** فارغ = تلقائي حسب المسار */
  taxCodeId: string;
  commission: string;
  // عهدة الرحلة تُصرف للسائق عند الإرسال؛ تُقفل بعد الإرسال
  tripCustody: string;
  sent?: boolean;
  weight: string;
  container: string;
  deliveryNote: string;
  customs: string;
  notes: string;
  priceNote?: string | null;
  transport: TransportDraft;
  /** مصاريف جديدة على العميل تُضاف مع الحفظ */
  charges: ChargeDraft[];
  /** مصاريف العميل المسجلة من قبل (للعرض) */
  savedCharges?: { label: string; amount: string; payer: keyof typeof PAYER_LABELS; invoiced: boolean }[];
  /** إيصالات الرحلة المسجلة التي لم تُحمَّل على العميل بعد، وما علّمه المستخدم منها */
  tripExpenses?: TripExpense[];
  billExpenses: number[];
}

export type RouteOption = QuickOption & { international: boolean };
export type PriceComponentDraft = { kind: string; label: string; quantity: string; unitPrice: string };
export type TaxOption = { value: string; label: string; rate: number; code: string };

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
  componentKinds,
  taxes,
  chargeTypes,
  brokers,
  cashAccounts,
  company,
  template,
  action,
  closeHref,
  savedHref,
  fromRequest,
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
  componentKinds: QuickOption[];
  taxes: TaxOption[];
  chargeTypes: QuickOption[];
  brokers: QuickOption[];
  cashAccounts: QuickOption[];
  company: CompanyProfile;
  template: InvoiceTemplate;
  action: (data: FormData) => Promise<PanelResult>;
  closeHref: string;
  savedHref: string;
  /** تحويل رحلة بدأها السائق: تنتقل مراحلها وصورها للشحنة عند الحفظ */
  fromRequest?: { id: number; driver: string; canFinish: boolean };
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
  // نوع الضريبة: المختار، أو التلقائي (الدولية «نسبة صفر»، والداخلية الأساسية)
  const autoTax = route ? taxes.find((x) => x.code === (route.international ? "ZERO" : "VAT15-OUT")) : undefined;
  const tax = taxes.find((x) => x.value === d.taxCodeId) ?? autoTax;
  const vatRate = route ? (tax?.rate ?? (route.international ? 0 : 15)) : null;
  const compAmount = (c: PriceComponentDraft) => {
    const v = Math.round((num(c.quantity || "1") * num(c.unitPrice)) * 100) / 100;
    return c.kind.split("~")[0] === "discount" ? -v : v;
  };
  const base = num(d.amount);
  const amount = Math.round((base + d.components.reduce((s, c) => s + compAmount(c), 0)) * 100) / 100;
  const setComp = (i: number, patch: Partial<PriceComponentDraft>) => set("components", d.components.map((c, k) => (k === i ? { ...c, ...patch } : c)));

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
      altSubmit={fromRequest?.canFinish ? { label: "حفظ واعتماد وإصدار فاتورة فوراً", name: "finishNow" } : undefined}
      toolbar={
        <button type="button" onClick={() => setPreview((p) => !p)} aria-label={preview ? "إخفاء المعاينة" : "إظهار المعاينة"} className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50">
          <Icon name="document" className="size-4" />
          <span className="hidden sm:inline">{preview ? "إخفاء المعاينة" : "إظهار المعاينة"}</span>
        </button>
      }
    >
      <div ref={box} className={`grid items-start gap-6 ${preview ? "xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]" : ""}`}>
        <div className="min-w-0">
          {fromRequest && (
            <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <input type="hidden" name="driverRequestId" value={fromRequest.id} />
              تحويل رحلة بدأها السائق <b>{fromRequest.driver}</b> من التطبيق: أكمل العميل والمسار والسعر. عند الحفظ تنتقل مراحل الرحلة وصورها إلى الشحنة.
            </p>
          )}
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
                  {route.international ? "شحن دولي" : "شحن داخلي"} · {tax ? tax.label : route.international ? "ضريبة صفرية" : "ضريبة 15%"}
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
                  <ComboField name="driverId" options={drivers} defaultValue={d.driverId} create="driver" placeholder="السائق المسند تلقائياً" onChange={(v) => set("driverId", v)} autoVehicle={{ name: "vehicleId", dateName: "date" }} />
                </PanelField>
                <PanelField label="عمولة السائق" hint="فارغ = من المسار">
                  <input name="commission" value={d.commission} onChange={onField} inputMode="decimal" className={`${field} ltr-nums`} placeholder="من المسار" />
                </PanelField>
                <PanelField label="عهدة الرحلة" hint={d.sent ? "أُرسلت للسائق؛ ألغِ الإرسال لتعديلها" : "تُصرف للسائق عند الإرسال"}>
                  <input name="tripCustody" value={d.tripCustody} onChange={onField} readOnly={d.sent} inputMode="decimal" className={`${field} ltr-nums ${d.sent ? "bg-gray-50 text-gray-500" : ""}`} placeholder="0" />
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
              <PanelField label="السعر الأساسي" hint="فارغ = من العقد الساري">
                <input name="amount" value={d.amount} onChange={onField} inputMode="decimal" className={`${field} ltr-nums`} placeholder="من العقد" />
                {d.priceNote && <span className="mt-1 block text-xs text-gray-500">{d.priceNote}</span>}
              </PanelField>
              <input type="hidden" name="components" value={JSON.stringify(d.components)} />
              <div className="space-y-2">
                <span className="block text-sm text-gray-700">مكونات إضافية على السعر</span>
                {d.components.map((c, i) => (
                  <div key={i} className="grid grid-cols-[minmax(0,1fr)_4.5rem_6rem_auto] items-center gap-2">
                    <ComboBox value={c.kind} options={componentKinds} create="price_component" allowEmpty={false} placeholder="وزن زائد، كم، انتظار…" onChange={(v, o) => setComp(i, { kind: v, label: o?.label ?? "" })} className={field} />
                    <input value={c.quantity} onChange={(e) => setComp(i, { quantity: e.target.value })} inputMode="decimal" placeholder="الكمية" aria-label="الكمية" className={`${field} ltr-nums`} />
                    <input value={c.unitPrice} onChange={(e) => setComp(i, { unitPrice: e.target.value })} inputMode="decimal" placeholder="سعر الوحدة" aria-label="سعر الوحدة" className={`${field} ltr-nums`} />
                    <button type="button" aria-label="حذف المكون" onClick={() => set("components", d.components.filter((_, k) => k !== i))} className="p-1 text-gray-400 hover:text-red-600">
                      <Icon name="close" className="size-4" />
                    </button>
                  </div>
                ))}
                <button type="button" onClick={() => set("components", [...d.components, { kind: "", label: "", quantity: "1", unitPrice: "" }])} className="text-xs text-brand-700 hover:underline">
                  + مكون (وزن زائد، كيلومترات، انتظار، خصم…)
                </button>
                {d.components.length > 0 && (
                  <span className="block text-xs text-gray-500">
                    سعر الشحنة = الأساسي {fmt(base)} + المكونات = <b className="ltr-nums">{fmt(amount)}</b>، ويظهر في الفاتورة سطراً واحداً وتحته التفاصيل.
                  </span>
                )}
              </div>
              <PanelField label="نوع الضريبة" hint="فارغ = حسب المسار">
                <select name="taxCodeId" value={d.taxCodeId} onChange={(e) => set("taxCodeId", e.target.value)} className={field}>
                  <option value="">تلقائي{autoTax ? ` (${autoTax.label})` : ""}</option>
                  {taxes.map((x) => (
                    <option key={x.value} value={x.value}>
                      {x.label}
                    </option>
                  ))}
                </select>
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

          {showPrices && (
            <PanelSection
              title={`مصاريف على العميل${(d.savedCharges?.length ?? 0) + d.charges.length ? ` (${(d.savedCharges?.length ?? 0) + d.charges.length})` : ""}`}
              hint="ما تدفعه عن العميل (جمارك، رسوم ميناء…) ويُفوتر عليه سطراً مستقلاً"
              optional
              open={d.charges.length > 0 || !!d.savedCharges?.length || !!d.tripExpenses?.length}
            >
              <input type="hidden" name="charges" value={JSON.stringify(d.charges)} />
              <input type="hidden" name="billExpenses" value={JSON.stringify(d.billExpenses)} />
              {!!d.savedCharges?.length && (
                <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 text-sm">
                  {d.savedCharges.map((c, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 px-3 py-2">
                      <span>
                        {c.label}
                        <span className="block text-[11px] text-gray-500">
                          دفعه: {PAYER_LABELS[c.payer]}
                          {c.invoiced ? " · في الفاتورة" : ""}
                        </span>
                      </span>
                      <span className="ltr-nums font-medium">{fmt(c.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <CustomerChargesEditor rows={d.charges} onChange={(rows) => set("charges", rows)} chargeTypes={chargeTypes} brokers={brokers} cashAccounts={cashAccounts} fleet={d.execution === "fleet"} tripExpenses={d.tripExpenses} picked={d.billExpenses} onPick={(ids) => set("billExpenses", ids)} />
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
          <aside className="min-w-0 xl:sticky xl:top-0" aria-label="معاينة البوليصة">
            <div className="mb-2 flex items-center gap-2 text-xs text-gray-500">
              <span className="size-2 animate-pulse rounded-full bg-green-500" />
              معاينة مباشرة كما ستُطبع البوليصة
            </div>
            <div className="rounded-2xl xl:max-h-[calc(100vh-9rem)] xl:overflow-y-auto bg-[repeating-linear-gradient(0deg,transparent,transparent_23px,rgba(0,0,0,0.03)_24px),repeating-linear-gradient(90deg,transparent,transparent_23px,rgba(0,0,0,0.03)_24px)] p-3">
              <WaybillDocument company={company} doc={doc} template={template} compact />
            </div>
          </aside>
        )}
      </div>
    </RecordPanel>
  );
}
