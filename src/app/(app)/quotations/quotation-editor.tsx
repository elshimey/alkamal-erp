"use client";

import { useRef, useState } from "react";
import { ComboField } from "@/components/combo-box";
import { DateInput } from "@/components/date-input";
import { LinesEditor, type LineOption } from "@/components/lines-editor";
import { PanelField, PanelSection } from "@/components/panel-ui";
import { RecordPanel, type PanelResult } from "@/components/record-panel";
import { QuotationDocument, type QuoteView } from "@/components/commercial-documents";
import { Icon } from "@/components/icons";
import { SHIPPING_TYPES, type ShippingType } from "@/lib/quotations-data";
import type { CompanyProfile } from "@/lib/company";
import type { InvoiceTemplate } from "@/lib/invoice-template";
import type { QuickOption } from "@/lib/quick-add-types";

export interface QuoteDraft {
  number?: string;
  customerId: string;
  date: string;
  validUntil: string;
  currencyCode: string;
  shippingType: ShippingType;
  reference: string;
  notes: string;
  terms: string;
  lines: Record<string, string>[];
}

type Row = Record<string, string>;

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
 * نافذة إنشاء عرض السعر وتعديله على طريقة وافق: الحقول يميناً ومعاينة العرض كما سيُطبع يساراً،
 * تتحدث مع كل حرف. نوع الشحن يحدد ضريبة البنود (دولي صفر، داخلي 15%) ما لم يُغيَّر بند بعينه.
 */
export function QuotationEditor({
  title,
  initial,
  customers,
  routes,
  currencies,
  company,
  template,
  action,
  closeHref,
  savedHref,
}: {
  title: string;
  initial: QuoteDraft;
  customers: (QuickOption & { vatNumber: string | null })[];
  routes: LineOption[];
  currencies: string[];
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

  // تغييرات القوائم والسطور لا تطلق حدث إدخال؛ نبلغ النافذة بها لتسأل قبل الإغلاق
  const touch = () => box.current?.dispatchEvent(new Event("input", { bubbles: true }));
  const set = <K extends keyof QuoteDraft>(k: K, v: QuoteDraft[K]) => {
    setD((x) => ({ ...x, [k]: v }));
    touch();
  };

  const vatDefault = SHIPPING_TYPES[d.shippingType].vat;
  const customer = customers.find((c) => c.value === d.customerId);
  const viewLines = lines
    .filter((l) => (l.description ?? "").trim() || l.routeId)
    .map((l) => ({
      description: (l.description ?? "").trim() || `نقل ${routes.find((r) => r.value === l.routeId)?.label ?? ""}`,
      quantity: String(num(l.quantity)),
      unitPrice: String(num(l.price)),
      vatRate: String(l.vatRate === "" || l.vatRate == null ? vatDefault : num(l.vatRate)),
    }));
  const subtotal = round2(viewLines.reduce((t, l) => t + Number(l.quantity) * Number(l.unitPrice), 0));
  const vat = round2(viewLines.reduce((t, l) => t + (Number(l.quantity) * Number(l.unitPrice) * Number(l.vatRate)) / 100, 0));
  const view: QuoteView = {
    q: {
      number: d.number ?? "جديد",
      quoteDate: d.date,
      validUntil: d.validUntil,
      currencyCode: d.currencyCode,
      shippingType: d.shippingType,
      reference: d.reference || null,
      notes: d.notes || null,
      terms: d.terms || null,
      subtotal: String(subtotal),
      vatTotal: String(vat),
      total: String(round2(subtotal + vat)),
    },
    customer: { nameAr: customer?.label ?? "—", vatNumber: customer?.vatNumber ?? null },
    lines: viewLines,
  };

  return (
    <RecordPanel
      title={title}
      subtitle={d.number ? `رقم ${d.number}` : "يُرقّم تلقائياً عند الحفظ"}
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
          <PanelSection title="بيانات العرض">
            <PanelField label="العميل" required>
              <ComboField name="customerId" options={customers} defaultValue={d.customerId} create="customer" required placeholder="ابحث عن العميل…" onChange={(v) => set("customerId", v)} />
            </PanelField>
            <PanelField label="نوع الشحن" required hint="يحدد ضريبة البنود">
              <span className="flex flex-wrap gap-2">
                {(Object.entries(SHIPPING_TYPES) as [ShippingType, (typeof SHIPPING_TYPES)[ShippingType]][]).map(([k, t]) => (
                  <label key={k} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${d.shippingType === k ? "border-brand-500 bg-brand-50 font-semibold text-brand-900" : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"}`}>
                    <input type="radio" name="shippingType" value={k} checked={d.shippingType === k} onChange={() => set("shippingType", k)} className="accent-brand-600" />
                    {t.label}
                    <span className="text-xs font-normal text-gray-500">({t.tax})</span>
                  </label>
                ))}
              </span>
            </PanelField>
            <PanelField label="التاريخ" required>
              <DateInput name="date" required value={d.date} onChange={(e) => set("date", e.target.value)} className={field} />
            </PanelField>
            <PanelField label="صالح حتى" required>
              <span className="flex flex-wrap items-center gap-2">
                <span className="min-w-44 flex-1">
                  <DateInput name="validUntil" required value={d.validUntil} onChange={(e) => set("validUntil", e.target.value)} className={field} />
                </span>
                {[7, 15, 30].map((n) => (
                  <button key={n} type="button" onClick={() => set("validUntil", plusDays(d.date, n))} className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">
                    {n} يوم
                  </button>
                ))}
              </span>
            </PanelField>
            <PanelField label="المرجع" hint="رقم طلب العميل أو وصف مختصر">
              <input name="reference" value={d.reference} onChange={(e) => set("reference", e.target.value)} className={field} />
            </PanelField>
            <PanelField label="العملة">
              <select name="currencyCode" value={d.currencyCode} onChange={(e) => set("currencyCode", e.target.value)} className={field}>
                {currencies.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </PanelField>
          </PanelSection>

          <PanelSection title="البنود" hint="الصق من Excel مباشرة">
            <LinesEditor
              initial={initial.lines}
              totals={{ qty: "quantity", price: "price", vat: "vatRate" }}
              totalsVat={vatDefault}
              onChange={(rows) => {
                setLines(rows);
                if (JSON.stringify(rows) !== first.current) touch();
              }}
              columns={[
                { key: "description", label: "الوصف", placeholder: "نقل حاوية 40 قدم…" },
                { key: "routeId", label: "المسار", type: "select", width: "9.5rem", create: "route", options: routes },
                { key: "quantity", label: "الكمية", type: "number", width: "4.5rem", defaultValue: "1" },
                { key: "price", label: "السعر", type: "number", width: "6.5rem" },
                {
                  key: "vatRate",
                  label: "الضريبة",
                  type: "select",
                  width: "8rem",
                  defaultValue: "",
                  options: [
                    { value: "", label: `حسب النوع (${vatDefault}%)` },
                    { value: "15", label: "15%" },
                    { value: "0", label: "صفر" },
                  ],
                },
              ]}
            />
          </PanelSection>

          <PanelSection title="الشروط والملاحظات" optional open={!!(d.notes || d.terms)}>
            <PanelField label="الشروط">
              <textarea name="terms" rows={3} value={d.terms} onChange={(e) => set("terms", e.target.value)} className={field} />
            </PanelField>
            <PanelField label="ملاحظات" hint="تظهر في العرض المطبوع">
              <textarea name="notes" rows={2} value={d.notes} onChange={(e) => set("notes", e.target.value)} className={field} />
            </PanelField>
          </PanelSection>
        </div>

        {preview && (
          <aside className="sticky top-0 hidden min-w-0 lg:block" aria-label="معاينة العرض">
            <div className="mb-2 flex items-center gap-2 text-xs text-gray-500">
              <span className="size-2 animate-pulse rounded-full bg-green-500" />
              معاينة مباشرة كما سيُطبع العرض
            </div>
            <div className="max-h-[calc(100vh-9rem)] overflow-y-auto rounded-2xl bg-[repeating-linear-gradient(0deg,transparent,transparent_23px,rgba(0,0,0,0.03)_24px),repeating-linear-gradient(90deg,transparent,transparent_23px,rgba(0,0,0,0.03)_24px)] p-3">
              <QuotationDocument company={company} doc={view} template={template} compact />
            </div>
          </aside>
        )}
      </div>
    </RecordPanel>
  );
}
