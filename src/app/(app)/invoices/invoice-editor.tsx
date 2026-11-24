"use client";

import { useRef, useState } from "react";
import type * as s from "@/db/schema";
import { ComboBox, ComboField } from "@/components/combo-box";
import { DateInput } from "@/components/date-input";
import { LinesEditor, type LineOption } from "@/components/lines-editor";
import { PanelField, PanelSection } from "@/components/panel-ui";
import { RecordPanel, type PanelResult } from "@/components/record-panel";
import { TaxInvoiceDocument } from "@/components/tax-invoice";
import { Icon } from "@/components/icons";
import { CustomerChargesEditor, type ChargeDraft, type TripExpense } from "@/components/customer-charges-editor";
import { fmt } from "@/lib/format";
import type { CompanyProfile } from "@/lib/company";
import type { InvoiceTemplate } from "@/lib/invoice-template";
import type { QuickOption } from "@/lib/quick-add-types";
import type { PriceComponentDraft, RouteOption } from "../waybills/waybill-editor";
import type { TripDraft } from "./trip-draft";

export type TaxOption = LineOption & { rate: number; code?: string };
/** قيم البند الجديد: ضريبة أول شحنة في الفاتورة وحسابها ومركبتها */
export interface LineDefaults {
  taxCodeId: string;
  accountId: string;
  costCenterId: string;
}

export interface InvoiceDraft {
  id?: number;
  number?: string;
  customerId: string;
  invoiceDate: string;
  dueDate: string;
  currencyCode: string;
  reference: string;
  notes: string;
  lines: Record<string, string>[];
  /** سطور الشحنات ومصاريفها في المسودة: يُعدَّل سعرها ووصفها هنا، وضريبتها وحسابها من الشحنة */
  fixedLines: { id: number; kind: "waybill" | "expense"; own?: boolean; description: string; amount: string; vatAmount: string; vatRate: string; details?: string | null; cost?: string | null; taxName?: string | null }[];
  /** النقل في الفاتورة المباشرة بنفس حقول الشحنة: المسار والتنفيذ والسعر ومكوناته، ورحلته تظهر للسائق عند الإرسال */
  trip: TripDraft;
}


type Row = Record<string, string>;
type Party = typeof s.parties.$inferSelect;
type Invoice = typeof s.salesInvoices.$inferSelect;
type Line = typeof s.salesInvoiceLines.$inferSelect;

const plusDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  if (isNaN(x.getTime())) return d;
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const num = (v: string | undefined) => Number((v ?? "").replace(/[,\s]/g, "")) || 0;
const round2 = (n: number) => Math.round(n * 100) / 100;
const field = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20";

/**
 * نافذة الفاتورة المباشرة (دون شحنة) وتعديل المسودة: الحقول يميناً ومعاينة الفاتورة الضريبية يساراً
 * تتحدث مع كل حرف. تُحفظ مسودة برقم مسودة، وتأخذ رقمها الرسمي عند الاعتماد.
 */
export function InvoiceEditor({
  title,
  initial,
  customers,
  accounts,
  costCenters,
  taxes,
  lineDefaults,
  chargeOptions,
  currencies,
  routes,
  vehicles,
  trailers,
  drivers,
  carriers,
  shippers,
  componentKinds,
  custodyAccounts,
  canSend,
  canIssue,
  company,
  template,
  action,
  closeHref,
  savedHref,
}: {
  title: string;
  initial: InvoiceDraft;
  customers: (QuickOption & { vatNumber: string | null; days: number | null })[];
  accounts: LineOption[];
  costCenters: LineOption[];
  taxes: TaxOption[];
  lineDefaults: LineDefaults;
  /** مصاريف على العميل تُضاف من المسودة لأي شحنة فيها */
  chargeOptions?: { chargeTypes: QuickOption[]; brokers: QuickOption[]; payees: QuickOption[]; cashAccounts: QuickOption[]; waybills: (QuickOption & { fleet: boolean })[]; tripExpenses: TripExpense[] };
  currencies: string[];
  routes: RouteOption[];
  vehicles: QuickOption[];
  trailers: QuickOption[];
  drivers: QuickOption[];
  carriers: QuickOption[];
  shippers: string[];
  componentKinds: QuickOption[];
  /** الصناديق والبنوك والعهد التي تُصرف منها عهدة الرحلة عند الإرسال للسائق */
  custodyAccounts: QuickOption[];
  canSend: boolean;
  canIssue: boolean;
  company: CompanyProfile;
  template: InvoiceTemplate;
  action: (data: FormData) => Promise<PanelResult>;
  closeHref: string;
  savedHref: string;
}) {
  const [d, setD] = useState(initial);
  const [lines, setLines] = useState<Row[]>(initial.lines);
  const [preview, setPreview] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  const first = useRef(JSON.stringify(initial.lines));
  // الشحنات تثبّت العميل والعملة؛ مصاريف الفاتورة المباشرة نفسها لا
  const locked = initial.fixedLines.some((l) => l.kind === "waybill" || !l.own);
  // سعر سطور الشحنات ومصاريفها ووصفها قابلان للتعديل في المسودة
  const [fixed, setFixed] = useState(initial.fixedLines);
  const [charges, setCharges] = useState<ChargeDraft[]>([]);
  const [billExpenses, setBillExpenses] = useState<number[]>([]);
  const canCharge = !!chargeOptions;
  const editFixed = (id: number, patch: { amount?: string; description?: string }) => {
    setFixed((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    touch();
  };
  const rateOf = (r: Row) => taxes.find((t) => t.value === r.taxCodeId)?.rate ?? 0;

  const touch = () => box.current?.dispatchEvent(new Event("input", { bubbles: true }));
  const set = <K extends keyof InvoiceDraft>(k: K, v: InvoiceDraft[K]) => {
    setD((x) => ({ ...x, [k]: v }));
    touch();
  };
  const customer = customers.find((c) => c.value === d.customerId);
  const trip = d.trip;
  const setTrip = (patch: Partial<InvoiceDraft["trip"]>) => {
    setD((x) => ({ ...x, trip: { ...x.trip, ...patch } }));
    touch();
  };

  // النقل في الفاتورة المباشرة: المسار يحدد الضريبة (الدولية «نسبة صفر» والداخلية الأساسية) كما في الشحنة
  const route = routes.find((r) => r.value === trip.routeId);
  const direct = !locked;
  const transport = direct && !!route;
  const fleet = trip.execution === "fleet";
  const autoTax = route ? taxes.find((x) => x.code === (route.international ? "ZERO" : "VAT15-OUT")) : undefined;
  const tripTax = taxes.find((x) => x.value === trip.taxCodeId) ?? autoTax;
  const compAmount = (c: PriceComponentDraft) => {
    const v = round2(num(c.quantity || "1") * num(c.unitPrice));
    return c.kind.split("~")[0] === "discount" ? -v : v;
  };
  const tripBase = num(trip.amount);
  const tripAmount = round2(tripBase + trip.components.reduce((s, c) => s + compAmount(c), 0));
  const setComp = (i: number, patch: Partial<PriceComponentDraft>) => setTrip({ components: trip.components.map((c, k) => (k === i ? { ...c, ...patch } : c)) });
  const label = (list: QuickOption[], v: string) => list.find((o) => o.value === v)?.label ?? "";
  const suggestions = shippers.map((x) => ({ value: x, label: x }));
  const sent = !!trip.sent;
  const canSendNow = transport && fleet && canSend && !sent;

  const used = lines.filter((l) => (l.description ?? "").trim() || num(l.price));
  const tripView = transport && trip.priced && tripAmount > 0;
  const tripRate = tripTax?.rate ?? 0;
  const viewLines: (Line & { taxName?: string | null })[] = [
    ...(tripView
      ? [
          {
            ...blankLine(-1),
            description: `خدمة نقل · ${route.label}`,
            details: trip.components.length ? [`أساسي ${fmt(tripBase)}`, ...trip.components.map((c) => `${c.label || "مكون"} ${fmt(compAmount(c))}`)].join(" + ") : null,
            quantity: "1",
            unitPrice: String(tripAmount),
            amount: String(tripAmount),
            taxName: tripTax?.label.replace(/\s*\([\d.]+%\)$/, "") ?? null,
            vatRate: String(tripRate),
            vatAmount: String(round2((tripAmount * tripRate) / 100)),
          },
        ]
      : []),
    ...fixed.map((l, i) => {
      const amount = round2(num(l.amount));
      return {
        ...blankLine(i),
        kind: l.kind === "waybill" ? ("manual" as const) : ("expense" as const),
        description: l.kind === "waybill" ? `خدمة نقل · ${l.description}` : l.description,
        details: l.details ?? null,
        taxName: l.taxName ?? null,
        amount: String(amount),
        vatAmount: String(round2((amount * Number(l.vatRate)) / 100)),
        vatRate: l.vatRate,
      };
    }),
    ...used.map((l, i) => {
      const qty = l.quantity === "" || l.quantity == null ? 1 : num(l.quantity);
      const price = num(l.price);
      const disc = Math.min(100, Math.max(0, num(l.discount)));
      const amount = round2(qty * price * (1 - disc / 100));
      const rate = rateOf(l);
      return {
        ...blankLine(fixed.length + i),
        kind: "manual" as const,
        description: (l.description ?? "").trim() || "—",
        quantity: String(qty),
        unitPrice: String(price),
        discountPercent: disc ? String(disc) : null,
        amount: String(amount),
        taxCodeId: Number(l.taxCodeId) || null,
        taxName: taxes.find((x) => x.value === l.taxCodeId)?.label.replace(/\s*\([\d.]+%\)$/, "") ?? null,
        vatRate: String(rate),
        vatAmount: String(round2((amount * rate) / 100)),
      };
    }),
  ];
  const subtotal = round2(viewLines.reduce((t, l) => t + Number(l.amount), 0));
  const vat = round2(viewLines.reduce((t, l) => t + Number(l.vatAmount), 0));
  const invoice = {
    id: initial.id ?? 0,
    number: d.number ?? "مسودة جديدة",
    draftNumber: d.number ?? null,
    invoiceDate: d.invoiceDate,
    dueDate: d.dueDate,
    customerId: Number(d.customerId) || 0,
    contractId: null,
    currencyCode: d.currencyCode,
    exchangeRate: "1",
    subtotal: String(subtotal),
    vatTotal: String(vat),
    total: String(round2(subtotal + vat)),
    paidAmount: "0",
    status: "draft",
    zatcaStatus: "not_sent",
    zatcaResponse: null,
    notes: d.notes || null,
    reference: d.reference || null,
    journalEntryId: null,
    issuedBy: null,
    issuedAt: null,
    createdBy: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  } satisfies Invoice;
  const party = { nameAr: customer?.label ?? "—", vatNumber: customer?.vatNumber ?? null } as Party;

  return (
    <RecordPanel
      title={title}
      subtitle={d.number ? `رقم المسودة ${d.number}` : "تُحفظ مسودة، وتأخذ رقمها الرسمي عند الاعتماد"}
      closeHref={closeHref}
      savedHref={savedHref}
      action={action}
      creating={false}
      wide
      altSubmit={canIssue ? { label: canSendNow && trip.send ? "حفظ وإصدار وإرسال للسائق" : "حفظ وإصدار", name: "issueNow" } : undefined}
      toolbar={
        <button type="button" onClick={() => setPreview((p) => !p)} aria-label={preview ? "إخفاء المعاينة" : "إظهار المعاينة"} className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50">
          <Icon name="document" className="size-4" />
          <span className="hidden sm:inline">{preview ? "إخفاء المعاينة" : "إظهار المعاينة"}</span>
        </button>
      }
    >
      <div ref={box} className={`grid items-start gap-6 ${preview ? "2xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]" : ""}`}>
        <div className="min-w-0">
          <PanelSection title="بيانات الفاتورة">
            <PanelField label="العميل" required hint={locked ? "ثابت لأن في الفاتورة شحنات" : undefined}>
              {locked ? (
                <>
                  <input type="hidden" name="customerId" value={d.customerId} />
                  <span className={`${field} block bg-gray-50 text-gray-600`}>{customer?.label}</span>
                </>
              ) : (
                <ComboField
                  name="customerId"
                  options={customers}
                  defaultValue={d.customerId}
                  create="customer"
                  required
                  placeholder="ابحث عن العميل…"
                  onChange={(v) => {
                    const days = customers.find((c) => c.value === v)?.days;
                    setD((x) => ({ ...x, customerId: v, dueDate: days != null && !initial.id ? plusDays(x.invoiceDate, days) : x.dueDate }));
                    touch();
                  }}
                />
              )}
            </PanelField>
            {direct && (
              <>
                <PanelField label="المسار" hint={trip.priced ? "لفاتورة نقل: يحدد الضريبة وسعر العقد" : undefined}>
                  <ComboField
                    name="tripRouteId"
                    options={routes}
                    defaultValue={trip.routeId}
                    create="route"
                    placeholder="من ← إلى (اتركه فارغاً لفاتورة بلا نقل)"
                    onChange={(v) => setTrip({ routeId: v, on: !!v })}
                  />
                  {route && (
                    <span className={`mt-1.5 inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ${route.international ? "bg-sky-50 text-sky-800" : "bg-amber-50 text-amber-800"}`}>
                      {route.international ? "شحن دولي" : "شحن داخلي"}
                      {tripTax ? ` · ${tripTax.label}` : ""}
                    </span>
                  )}
                </PanelField>
                {transport && (
                  <>
                    <PanelField label="المرسل" required>
                      <input type="hidden" name="tripShipper" value={trip.shipper} />
                      <ComboBox value={trip.shipper} options={suggestions} free placeholder={customer?.label ?? "اسم الشاحن"} onChange={(v) => setTrip({ shipper: v })} className={field} />
                    </PanelField>
                    <PanelField label="المستلم" required>
                      <input type="hidden" name="tripConsignee" value={trip.consignee} />
                      <ComboBox value={trip.consignee} options={suggestions} free placeholder="اسم المستلم" onChange={(v) => setTrip({ consignee: v })} className={field} />
                    </PanelField>
                  </>
                )}
              </>
            )}
            <PanelField label="تاريخ الفاتورة" required>
              <DateInput name="invoiceDate" required value={d.invoiceDate} onChange={(e) => set("invoiceDate", e.target.value)} className={field} />
            </PanelField>
            <PanelField label="تاريخ الاستحقاق" required>
              <span className="flex flex-wrap items-center gap-2">
                <span className="min-w-44 flex-1">
                  <DateInput name="dueDate" required value={d.dueDate} onChange={(e) => set("dueDate", e.target.value)} className={field} />
                </span>
                {[0, 15, 30, 60].map((n) => (
                  <button key={n} type="button" onClick={() => set("dueDate", plusDays(d.invoiceDate, n))} className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">
                    {n ? `${n} يوم` : "فوري"}
                  </button>
                ))}
              </span>
            </PanelField>
            <PanelField label="العملة">
              {locked ? (
                <>
                  <input type="hidden" name="currencyCode" value={d.currencyCode} />
                  <span className={`${field} block bg-gray-50 text-gray-600`}>{d.currencyCode}</span>
                </>
              ) : (
                <select name="currencyCode" value={d.currencyCode} onChange={(e) => set("currencyCode", e.target.value)} className={field}>
                  {currencies.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              )}
            </PanelField>
            <PanelField label="المرجع" hint="رقم أمر الشراء أو العقد لدى العميل">
              <input name="reference" value={d.reference} onChange={(e) => set("reference", e.target.value)} className={field} />
            </PanelField>
          </PanelSection>

          {direct && <input type="hidden" name="tripOn" value={transport ? "1" : "0"} />}
          {transport && (
            <TripSections
              trip={trip}
              setTrip={setTrip}
              sent={sent}
              fleet={fleet}
              vehicles={vehicles}
              trailers={trailers}
              drivers={drivers}
              carriers={carriers}
              componentKinds={componentKinds}
              taxes={taxes}
              autoTax={autoTax}
              tripTax={tripTax}
              tripBase={tripBase}
              tripAmount={tripAmount}
              setComp={setComp}
              label={label}
            />
          )}

          <input type="hidden" name="fixedLines" value={JSON.stringify(fixed.map((f) => ({ id: f.id, amount: f.amount, description: f.description })))} />
          {fixed.some((l) => l.kind === "waybill") && (
            <PanelSection title={`الشحنات في الفاتورة (${fixed.filter((l) => l.kind === "waybill").length})`} hint="السعر هنا يُحدّث سعر الشحنة نفسها، والضريبة والحساب والمركبة من الشحنة">
              <FixedRows rows={fixed.filter((l) => l.kind === "waybill")} onEdit={editFixed} />
            </PanelSection>
          )}
          {(fixed.some((l) => l.kind === "expense") || canCharge) && (
            <PanelSection
              title={`المصاريف${fixed.filter((l) => l.kind === "expense").length + charges.length ? ` (${fixed.filter((l) => l.kind === "expense").length + charges.length})` : ""}`}
              hint="على العميل: سطر مستقل يُقفل 1114. على الشركة: تكلفة الرحلة ولا تدخل الفاتورة. دُفعت أو لم تُدفع بعد"
              optional
              open
            >
              {fixed.some((l) => l.kind === "expense") && <FixedRows rows={fixed.filter((l) => l.kind === "expense")} onEdit={editFixed} />}
              {canCharge && chargeOptions && (
                <>
                  <input type="hidden" name="newCharges" value={JSON.stringify(charges)} />
                  <input type="hidden" name="billExpenses" value={JSON.stringify(billExpenses)} />
                  <CustomerChargesEditor
                    rows={charges}
                    onChange={(rows) => {
                      setCharges(rows);
                      touch();
                    }}
                    chargeTypes={chargeOptions.chargeTypes}
                    brokers={chargeOptions.brokers}
                    payees={chargeOptions.payees}
                    cashAccounts={chargeOptions.cashAccounts}
                    waybills={chargeOptions.waybills.length ? chargeOptions.waybills : undefined}
                    fleet={false}
                    companyHint={chargeOptions.waybills.length ? undefined : "تُحمَّل على رحلة هذه الفاتورة (اختر المسار)."}
                    tripExpenses={chargeOptions.tripExpenses}
                    picked={billExpenses}
                    onPick={(ids) => {
                      setBillExpenses(ids);
                      touch();
                    }}
                  />
                  {charges.length + billExpenses.length > 0 && <span className="block text-xs text-amber-700">تظهر المصاريف الجديدة في الفاتورة ومعاينتها بعد «حفظ».</span>}
                </>
              )}
            </PanelSection>
          )}

          <PanelSection
            title={locked || (transport && trip.priced) ? "بنود أخرى على الفاتورة" : "البنود"}
            optional={locked || (transport && trip.priced)}
            open={!(transport && trip.priced) || initial.lines.length > 0}
            hint={locked ? "لإضافة شيء غير الشحنات (رسوم أو خدمة). يبدأ بضريبة الشحنة وحسابها ومركبتها" : transport && trip.priced ? "لبند غير النقل (تخزين، تأجير…)" : "الصق من Excel مباشرة"}
          >
            <LinesEditor
              initial={initial.lines}
              minRows={locked ? 1 : 3}
              totals={{ qty: "quantity", price: "price", vat: "taxCodeId" }}
              vatRateOf={rateOf}
              onChange={(rows) => {
                setLines(rows);
                if (JSON.stringify(rows) !== first.current) touch();
              }}
              columns={[
                { key: "description", label: "الوصف", placeholder: "نقل حاوية 40 قدم من جدة إلى الرياض…" },
                { key: "quantity", label: "الكمية", type: "number", width: "4.5rem", defaultValue: "1" },
                { key: "price", label: "السعر", type: "number", width: "6.5rem" },
                { key: "discount", label: "خصم %", type: "number", width: "4.5rem" },
                { key: "taxCodeId", label: "الضريبة", type: "select", width: "12rem", defaultValue: lineDefaults.taxCodeId, options: taxes },
                { key: "accountId", label: "نوع الإيراد", type: "select", width: "12rem", defaultValue: lineDefaults.accountId || (accounts[0]?.value ?? ""), options: accounts, create: "account" },
                { key: "costCenterId", label: "المركبة", type: "select", width: "8rem", defaultValue: lineDefaults.costCenterId, options: costCenters },
              ]}
            />
          </PanelSection>

          {transport && fleet && (canSend || sent) && (
            <PanelSection title="إرسال للسائق" optional open={trip.send || sent} hint="تصله الرحلة «في الطريق» ويضغط «تم التسليم» فقط">
              {sent ? (
                <p className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800">
                  أُرسلت للسائق ({trip.number}). لتغيير السائق أو المركبة أو العهدة ألغِ الإرسال من «العمليات» أولاً.
                </p>
              ) : (
                <>
                  <input type="hidden" name="sendDriver" value={trip.send ? "1" : "0"} />
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input type="checkbox" checked={trip.send} onChange={(e) => setTrip({ send: e.target.checked })} className="size-4 accent-brand-600" />
                    أرسلها للسائق على مرحلة التسليم
                  </label>
                  {trip.send && (
                    <>
                      <ol className="grid grid-cols-4 gap-1 text-center text-[11px]" aria-label="مراحل الرحلة عند السائق">
                        {["استلم الرحلة", "تم التحميل", "في الطريق", "تم التسليم"].map((s, i) => (
                          <li key={s}>
                            <span className={`block h-1.5 rounded-full ${i < 3 ? "bg-brand-600" : "bg-gray-200"}`} />
                            <span className={`mt-1 block ${i < 3 ? "text-asphalt-900" : "font-semibold text-amber-700"}`}>{s}</span>
                          </li>
                        ))}
                      </ol>
                      <p className="text-xs text-gray-500">يصل للسائق إشعار، ويجد الرحلة «في الطريق» بزر واحد «تم التسليم» وصورة اختيارية.</p>
                      {num(trip.custody) > 0 && (
                        <PanelField label="تُصرف عهدة الرحلة من" required>
                          <select name="cashAccountId" value={trip.custodyFrom} onChange={(e) => setTrip({ custodyFrom: e.target.value })} required className={field}>
                            <option value="">اختر الصندوق أو البنك</option>
                            {custodyAccounts.map((a) => (
                              <option key={a.value} value={a.value}>
                                {a.label}
                              </option>
                            ))}
                            <option value="defer">لم تُصرف بعد (تُصرف من «سندات صرف تحت المراجعة»)</option>
                          </select>
                        </PanelField>
                      )}
                    </>
                  )}
                </>
              )}
            </PanelSection>
          )}

          {transport && (
            <PanelSection title="الحمولة والمستندات" optional open={!!(trip.weight || trip.container || trip.deliveryNote || trip.customs)}>
              <PanelField label="الوزن (طن)">
                <input name="tripWeight" value={trip.weight} onChange={(e) => setTrip({ weight: e.target.value })} inputMode="decimal" className={`${field} ltr-nums`} />
              </PanelField>
              <PanelField label="رقم الحاوية">
                <input name="tripContainer" value={trip.container} onChange={(e) => setTrip({ container: e.target.value })} className={`${field} ltr-nums`} />
              </PanelField>
              <PanelField label="رقم سند التسليم">
                <input name="tripDeliveryNote" value={trip.deliveryNote} onChange={(e) => setTrip({ deliveryNote: e.target.value })} className={`${field} ltr-nums`} />
              </PanelField>
              <PanelField label="البيان الجمركي">
                <input name="tripCustoms" value={trip.customs} onChange={(e) => setTrip({ customs: e.target.value })} className={`${field} ltr-nums`} />
              </PanelField>
            </PanelSection>
          )}

          <PanelSection title="ملاحظات" optional open={!!d.notes}>
            <PanelField label="ملاحظات" hint="تظهر في الفاتورة المطبوعة">
              <textarea name="notes" rows={2} value={d.notes} onChange={(e) => set("notes", e.target.value)} className={field} />
            </PanelField>
          </PanelSection>
        </div>

        {preview && (
          <aside className="min-w-0 2xl:sticky 2xl:top-0" aria-label="معاينة الفاتورة">
            <div className="mb-2 flex items-center gap-2 text-xs text-gray-500">
              <span className="size-2 animate-pulse rounded-full bg-green-500" />
              معاينة مباشرة كما ستُطبع الفاتورة
            </div>
            <div className="rounded-2xl 2xl:max-h-[calc(100vh-9rem)] 2xl:overflow-y-auto bg-[repeating-linear-gradient(0deg,transparent,transparent_23px,rgba(0,0,0,0.03)_24px),repeating-linear-gradient(90deg,transparent,transparent_23px,rgba(0,0,0,0.03)_24px)] p-3">
              <TaxInvoiceDocument company={company} invoice={invoice} customer={party} lines={viewLines} qrSvg={null} template={template} compact />
            </div>
          </aside>
        )}
      </div>
    </RecordPanel>
  );
}

/** التنفيذ والسعر في الفاتورة المباشرة: نفس قسمي نافذة الشحنة. */
function TripSections({
  trip,
  setTrip,
  sent,
  fleet,
  vehicles,
  trailers,
  drivers,
  carriers,
  componentKinds,
  taxes,
  autoTax,
  tripTax,
  tripBase,
  tripAmount,
  setComp,
}: {
  trip: TripDraft;
  setTrip: (patch: Partial<TripDraft>) => void;
  sent: boolean;
  fleet: boolean;
  vehicles: QuickOption[];
  trailers: QuickOption[];
  drivers: QuickOption[];
  carriers: QuickOption[];
  componentKinds: QuickOption[];
  taxes: TaxOption[];
  autoTax?: TaxOption;
  tripTax?: TaxOption;
  tripBase: number;
  tripAmount: number;
  setComp: (i: number, patch: Partial<PriceComponentDraft>) => void;
  label: (list: QuickOption[], v: string) => string;
}) {
  const locked = sent ? "bg-gray-50 text-gray-500" : "";
  return (
    <>
      <input type="hidden" name="tripPriced" value={trip.priced ? "1" : "0"} />
      <input type="hidden" name="tripExecution" value={trip.execution} />
      <PanelSection title="التنفيذ" hint="مركبة من الأسطول أو ناقل خارجي">
        {trip.priced && !sent && (
          <span className="flex flex-wrap gap-2">
            {(
              [
                ["fleet", "أسطولنا (مركبة وسائق)"],
                ["carrier", "ناقل خارجي"],
              ] as const
            ).map(([k, t]) => (
              <label key={k} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${trip.execution === k ? "border-brand-500 bg-brand-50 font-semibold text-brand-900" : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"}`}>
                <input type="radio" checked={trip.execution === k} onChange={() => setTrip({ execution: k, send: k === "fleet" ? trip.send : false })} className="accent-brand-600" />
                {t}
              </label>
            ))}
          </span>
        )}
        {fleet ? (
          <>
            {sent && (
              <>
                <input type="hidden" name="tripVehicleId" value={trip.vehicleId} />
                <input type="hidden" name="tripDriverId" value={trip.driverId} />
              </>
            )}
            <PanelField label="المركبة" required>
              {sent ? (
                <span className={`${field} block ${locked}`}>{vehicles.find((v) => v.value === trip.vehicleId)?.label}</span>
              ) : (
                <ComboField key="v" name="tripVehicleId" options={vehicles} defaultValue={trip.vehicleId} create="vehicle" required placeholder="رقم اللوحة" onChange={(v) => setTrip({ vehicleId: v })} />
              )}
            </PanelField>
            {trip.priced && trailers.length > 0 && (
              <PanelField label="المقطورة">
                <ComboField name="tripTrailerId" options={trailers} defaultValue={trip.trailerId} placeholder="بلا مقطورة" onChange={(v) => setTrip({ trailerId: v })} />
              </PanelField>
            )}
            <PanelField label="السائق" hint="فارغ = المسند للمركبة">
              {sent ? (
                <span className={`${field} block ${locked}`}>{drivers.find((v) => v.value === trip.driverId)?.label ?? "المسند للمركبة"}</span>
              ) : (
                <ComboField name="tripDriverId" options={drivers} defaultValue={trip.driverId} create="driver" placeholder="السائق المسند تلقائياً" onChange={(v) => setTrip({ driverId: v })} autoVehicle={{ name: "tripVehicleId", dateName: "invoiceDate" }} />
              )}
            </PanelField>
            {trip.priced && (
              <PanelField label="عمولة السائق" hint="فارغ = من المسار">
                <input name="tripCommission" value={trip.commission} onChange={(e) => setTrip({ commission: e.target.value })} inputMode="decimal" className={`${field} ltr-nums`} placeholder="من المسار" />
              </PanelField>
            )}
            <PanelField label="عهدة الرحلة" hint={sent ? "أُرسلت للسائق؛ ألغِ الإرسال لتعديلها" : "تُصرف للسائق عند الإرسال"}>
              <input name="tripCustody" value={trip.custody} readOnly={sent} onChange={(e) => setTrip({ custody: e.target.value })} inputMode="decimal" className={`${field} ltr-nums ${locked}`} placeholder="0" />
            </PanelField>
          </>
        ) : (
          <>
            <PanelField label="الناقل" required>
              <ComboField key="c" name="tripCarrierId" options={carriers} defaultValue={trip.carrierId} create="carrier" required placeholder="اسم الناقل" onChange={(v) => setTrip({ carrierId: v })} />
            </PanelField>
            <PanelField label="تكلفة الناقل" required hint="تُقيد ديناً للناقل عند إصدار الفاتورة">
              <input name="tripCarrierCost" value={trip.carrierCost} onChange={(e) => setTrip({ carrierCost: e.target.value })} inputMode="decimal" required className={`${field} ltr-nums`} />
            </PanelField>
            <PanelField label="لوحة الناقل">
              <input name="tripCarrierPlate" value={trip.carrierPlate} onChange={(e) => setTrip({ carrierPlate: e.target.value })} className={`${field} ltr-nums`} />
            </PanelField>
            <PanelField label="سائق الناقل">
              <input name="tripCarrierDriver" value={trip.carrierDriverName} onChange={(e) => setTrip({ carrierDriverName: e.target.value })} className={field} />
            </PanelField>
          </>
        )}
      </PanelSection>

      {trip.priced ? (
        <PanelSection title="السعر">
          <PanelField label="السعر الأساسي" hint="فارغ = من العقد الساري">
            <input name="tripAmount" value={trip.amount} onChange={(e) => setTrip({ amount: e.target.value })} inputMode="decimal" className={`${field} ltr-nums`} placeholder="من العقد" />
            {trip.priceNote && <span className="mt-1 block text-xs text-gray-500">{trip.priceNote}</span>}
          </PanelField>
          <input type="hidden" name="tripComponents" value={JSON.stringify(trip.components)} />
          <div className="space-y-2">
            <span className="block text-sm text-gray-700">مكونات إضافية على السعر</span>
            {trip.components.map((c, i) => (
              <div key={i} className="line-in grid grid-cols-[minmax(0,1fr)_4.5rem_6rem_auto] items-center gap-2">
                <ComboBox value={c.kind} options={componentKinds} create="price_component" allowEmpty={false} placeholder="وزن زائد، كم، انتظار…" onChange={(v, o) => setComp(i, { kind: v, label: o?.label ?? "" })} className={field} />
                <input value={c.quantity} onChange={(e) => setComp(i, { quantity: e.target.value })} inputMode="decimal" placeholder="الكمية" aria-label="الكمية" className={`${field} ltr-nums`} />
                <input value={c.unitPrice} onChange={(e) => setComp(i, { unitPrice: e.target.value })} inputMode="decimal" placeholder="سعر الوحدة" aria-label="سعر الوحدة" className={`${field} ltr-nums`} />
                <button type="button" aria-label="حذف المكون" onClick={() => setTrip({ components: trip.components.filter((_, k) => k !== i) })} className="p-1 text-gray-400 hover:text-red-600">
                  <Icon name="close" className="size-4" />
                </button>
              </div>
            ))}
            <button type="button" onClick={() => setTrip({ components: [...trip.components, { kind: "", label: "", quantity: "1", unitPrice: "" }] })} className="text-xs text-brand-700 hover:underline">
              + مكون (وزن زائد، كيلومترات، انتظار، خصم…)
            </button>
            {trip.components.length > 0 && (
              <span className="block text-xs text-gray-500">
                سعر النقل = الأساسي {fmt(tripBase)} + المكونات = <b className="ltr-nums">{fmt(tripAmount)}</b>، ويظهر في الفاتورة سطراً واحداً وتحته التفاصيل.
              </span>
            )}
          </div>
          <PanelField label="نوع الضريبة" hint="فارغ = حسب المسار">
            <select name="tripTaxCodeId" value={trip.taxCodeId} onChange={(e) => setTrip({ taxCodeId: e.target.value })} className={field}>
              <option value="">تلقائي{autoTax ? ` (${autoTax.label})` : ""}</option>
              {taxes.map((x) => (
                <option key={x.value} value={x.value}>
                  {x.label}
                </option>
              ))}
            </select>
          </PanelField>
          {tripAmount > 0 && (
            <div className="ltr-nums grid grid-cols-3 gap-2 rounded-xl bg-gray-50 px-4 py-3 text-center text-sm">
              <span>
                <span className="block text-xs text-gray-500">قبل الضريبة</span>
                {fmt(tripAmount)}
              </span>
              <span>
                <span className="block text-xs text-gray-500">الضريبة {tripTax?.rate ?? 0}%</span>
                {fmt((tripAmount * (tripTax?.rate ?? 0)) / 100)}
              </span>
              <span className="font-semibold">
                <span className="block text-xs font-normal text-gray-500">الإجمالي</span>
                {fmt(tripAmount * (1 + (tripTax?.rate ?? 0) / 100))}
              </span>
            </div>
          )}
        </PanelSection>
      ) : (
        <p className="mb-4 rounded-xl bg-gray-50 px-4 py-3 text-xs text-gray-600">سعر هذه الفاتورة في «البنود» لأنها حُفظت قبل توحيدها مع الشحنة.</p>
      )}
    </>
  );
}

/** سطور الشحنات أو مصاريفها: الوصف والسعر يُعدَّلان، والضريبة تظهر باسمها. */
function FixedRows({ rows, onEdit }: { rows: InvoiceDraft["fixedLines"]; onEdit: (id: number, patch: { amount?: string; description?: string }) => void }) {
  return (
    <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100 text-sm">
      {rows.map((l) => (
        <li key={l.id} className="grid gap-2 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_8rem]">
          <span className="min-w-0">
            <input value={l.description} onChange={(e) => onEdit(l.id, { description: e.target.value })} aria-label="الوصف" className={`${field} !py-1.5`} />
            {l.details && <span className="mt-1 block text-xs text-gray-500">{l.details}</span>}
            <span className="mt-1 block text-xs text-gray-500">
              {l.taxName ?? `ضريبة ${Number(l.vatRate)}%`}
              {l.cost != null && ` · المدفوع ${fmt(l.cost)}`}
            </span>
          </span>
          <input
            value={l.amount}
            onChange={(e) => onEdit(l.id, { amount: e.target.value })}
            inputMode="decimal"
            aria-label="السعر قبل الضريبة"
            className={`${field} ltr-nums !py-1.5 text-end font-medium`}
          />
        </li>
      ))}
    </ul>
  );
}

function blankLine(i: number): Line {
  return {
    id: -1 - i,
    invoiceId: 0,
    lineNo: i + 1,
    kind: "manual",
    waybillId: null,
    waybillExpenseId: null,
    description: "",
    quantity: null,
    unitPrice: null,
    discountPercent: null,
    amount: "0",
    taxCodeId: null,
    vatRate: "0",
    vatAmount: "0",
    accountId: 0,
    costCenterId: null,
    details: null,
    costAmount: null,
    groupKey: null,
    trip: false,
  };
}
