"use client";

import { useRef, useState } from "react";
import type * as s from "@/db/schema";
import { ComboField } from "@/components/combo-box";
import { DateInput } from "@/components/date-input";
import { LinesEditor, type LineOption } from "@/components/lines-editor";
import { PanelField, PanelSection } from "@/components/panel-ui";
import { RecordPanel, type PanelResult } from "@/components/record-panel";
import { TaxInvoiceDocument } from "@/components/tax-invoice";
import { Icon } from "@/components/icons";
import { fmt } from "@/lib/format";
import type { CompanyProfile } from "@/lib/company";
import type { InvoiceTemplate } from "@/lib/invoice-template";
import type { QuickOption } from "@/lib/quick-add-types";

export type TaxOption = LineOption & { rate: number };
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
  fixedLines: { id: number; kind: "waybill" | "expense"; description: string; amount: string; vatAmount: string; vatRate: string; details?: string | null; cost?: string | null; taxName?: string | null }[];
  /** رحلة السائق للفاتورة المباشرة: تظهر في تطبيقه عند الإرسال ومعها عهدتها */
  trip: { on: boolean; routeId: string; vehicleId: string; driverId: string; shipper: string; consignee: string; custody: string; number?: string; sent?: boolean };
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
  currencies,
  routes,
  vehicles,
  drivers,
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
  currencies: string[];
  routes: QuickOption[];
  vehicles: QuickOption[];
  drivers: QuickOption[];
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
  const locked = initial.fixedLines.length > 0;
  // سعر سطور الشحنات ومصاريفها ووصفها قابلان للتعديل في المسودة
  const [fixed, setFixed] = useState(initial.fixedLines);
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

  const used = lines.filter((l) => (l.description ?? "").trim() || num(l.price));
  const viewLines: (Line & { taxName?: string | null })[] = [
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
      toolbar={
        <button type="button" onClick={() => setPreview((p) => !p)} className="hidden items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50 lg:flex">
          <Icon name="document" className="size-4" />
          {preview ? "إخفاء المعاينة" : "إظهار المعاينة"}
        </button>
      }
    >
      <div ref={box} className={`grid items-start gap-6 ${preview ? "lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]" : ""}`}>
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

          <input type="hidden" name="fixedLines" value={JSON.stringify(fixed.map((f) => ({ id: f.id, amount: f.amount, description: f.description })))} />
          {fixed.some((l) => l.kind === "waybill") && (
            <PanelSection title={`الشحنات في الفاتورة (${fixed.filter((l) => l.kind === "waybill").length})`} hint="السعر هنا يُحدّث سعر الشحنة نفسها، والضريبة والحساب والمركبة من الشحنة">
              <FixedRows rows={fixed.filter((l) => l.kind === "waybill")} onEdit={editFixed} />
            </PanelSection>
          )}
          {fixed.some((l) => l.kind === "expense") && (
            <PanelSection title={`مصاريف على العميل (${fixed.filter((l) => l.kind === "expense").length})`} hint="من مصاريف الشحنة؛ تُقفل حساب المستردة 1114، وما يزيد على المدفوع إيراد">
              <FixedRows rows={fixed.filter((l) => l.kind === "expense")} onEdit={editFixed} />
            </PanelSection>
          )}

          <PanelSection
            title={locked ? "بنود أخرى على الفاتورة" : "البنود"}
            optional={locked}
            open
            hint={locked ? "لإضافة شيء غير الشحنات (رسوم أو خدمة). يبدأ بضريبة الشحنة وحسابها ومركبتها" : "الصق من Excel مباشرة"}
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

          {!locked && (
            <PanelSection title="رحلة السائق" optional open={trip.on} hint={trip.sent ? `أُرسلت للسائق (${trip.number})` : "لتظهر الفاتورة رحلةً في تطبيق السائق مع عهدتها"}>
              <input type="hidden" name="tripOn" value={trip.on ? "1" : "0"} />
              <label className="mb-3 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={trip.on} disabled={trip.sent} onChange={(e) => setTrip({ on: e.target.checked })} className="accent-brand-600" />
                ينفذها سائق من الأسطول
              </label>
              {trip.on && (
                <>
                  {trip.sent && <p className="mb-3 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800">الرحلة مرسلة للسائق؛ لتغيير السائق أو المركبة أو العهدة ألغِ الإرسال من «العمليات» أولاً.</p>}
                  <PanelField label="المسار" required>
                    <ComboField name="tripRouteId" options={routes} defaultValue={trip.routeId} create="route" required placeholder="من ← إلى" onChange={(v) => setTrip({ routeId: v })} />
                  </PanelField>
                  <PanelField label="المركبة" required>
                    <ComboField name="tripVehicleId" options={vehicles} defaultValue={trip.vehicleId} create="vehicle" required placeholder="رقم اللوحة" onChange={(v) => setTrip({ vehicleId: v })} />
                  </PanelField>
                  <PanelField label="السائق" hint="فارغ = المسند للمركبة">
                    <ComboField name="tripDriverId" options={drivers} defaultValue={trip.driverId} create="driver" placeholder="السائق المسند تلقائياً" onChange={(v) => setTrip({ driverId: v })} />
                  </PanelField>
                  <PanelField label="المرسل" required>
                    <input name="tripShipper" value={trip.shipper} onChange={(e) => setTrip({ shipper: e.target.value })} required className={field} placeholder={customer?.label ?? ""} />
                  </PanelField>
                  <PanelField label="المستلم" required>
                    <input name="tripConsignee" value={trip.consignee} onChange={(e) => setTrip({ consignee: e.target.value })} required className={field} />
                  </PanelField>
                  <PanelField label="عهدة الرحلة" hint={trip.sent ? "مقيدة على السائق" : "تُصرف للسائق عند الإرسال"}>
                    <input name="tripCustody" value={trip.custody} readOnly={trip.sent} onChange={(e) => setTrip({ custody: e.target.value })} inputMode="decimal" className={`${field} ltr-nums ${trip.sent ? "bg-gray-50 text-gray-500" : ""}`} placeholder="0" />
                  </PanelField>
                </>
              )}
            </PanelSection>
          )}

          <PanelSection title="ملاحظات" optional open={!!d.notes}>
            <PanelField label="ملاحظات" hint="تظهر في الفاتورة المطبوعة">
              <textarea name="notes" rows={2} value={d.notes} onChange={(e) => set("notes", e.target.value)} className={field} />
            </PanelField>
          </PanelSection>
        </div>

        {preview && (
          <aside className="sticky top-0 hidden min-w-0 lg:block" aria-label="معاينة الفاتورة">
            <div className="mb-2 flex items-center gap-2 text-xs text-gray-500">
              <span className="size-2 animate-pulse rounded-full bg-green-500" />
              معاينة مباشرة كما ستُطبع الفاتورة
            </div>
            <div className="max-h-[calc(100vh-9rem)] overflow-y-auto rounded-2xl bg-[repeating-linear-gradient(0deg,transparent,transparent_23px,rgba(0,0,0,0.03)_24px),repeating-linear-gradient(90deg,transparent,transparent_23px,rgba(0,0,0,0.03)_24px)] p-3">
              <TaxInvoiceDocument company={company} invoice={invoice} customer={party} lines={viewLines} qrSvg={null} template={template} compact />
            </div>
          </aside>
        )}
      </div>
    </RecordPanel>
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
  };
}
