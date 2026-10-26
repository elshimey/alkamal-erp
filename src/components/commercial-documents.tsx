import type { CompanyProfile } from "@/lib/company";
import type { orderDoc } from "@/lib/purchasing";
import { SHIPPING_TYPES, type ShippingType } from "@/lib/quotations-data";
import { DEFAULT_TEMPLATE, type InvoiceTemplate } from "@/lib/invoice-template";
import { Facts, Frame } from "@/components/maintenance-document";
import { fmt } from "@/lib/format";

type Order = NonNullable<Awaited<ReturnType<typeof orderDoc>>>;
/** يكفي من العرض ما يُطبع، فتُبنى المعاينة المباشرة في نافذة التعديل من الحقول نفسها. */
export interface QuoteView {
  q: { number: string; quoteDate: string; validUntil: string; currencyCode: string; shippingType: ShippingType; reference: string | null; notes: string | null; terms: string | null; subtotal: string; vatTotal: string; total: string };
  customer: { nameAr: string; vatNumber: string | null };
  lines: { description: string; quantity: string; unitPrice: string; vatRate: string }[];
}

function Lines({ rows, currency, totals }: { rows: { description: string; quantity: string; unitPrice: string; vatRate: string }[]; currency: string; totals: { subtotal: number; vat: number; total: number } }) {
  return (
    <>
      <table className="mt-6 w-full text-sm">
        <thead className="border-b-2 border-[var(--inv-accent)] text-xs text-gray-500">
          <tr>
            <th className="w-8 py-2 text-start font-medium">#</th>
            <th className="py-2 text-start font-medium">البيان</th>
            <th className="py-2 text-end font-medium">الكمية</th>
            <th className="py-2 text-end font-medium">السعر</th>
            <th className="py-2 text-end font-medium">الضريبة</th>
            <th className="py-2 text-end font-medium">الإجمالي</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((l, i) => (
            <tr key={i}>
              <td className="ltr-nums w-8 py-2 pe-3 text-gray-400">{i + 1}</td>
              <td className="py-2">{l.description}</td>
              <td className="py-2 text-end"><bdi className="ltr-nums">{Number(l.quantity).toLocaleString("en")}</bdi></td>
              <td className="py-2 text-end"><bdi className="ltr-nums">{fmt(l.unitPrice)}</bdi></td>
              <td className="py-2 text-end"><bdi className="ltr-nums">{Number(l.vatRate)}%</bdi></td>
              <td className="py-2 text-end font-medium"><bdi className="ltr-nums">{fmt(Number(l.quantity) * Number(l.unitPrice))}</bdi></td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="ltr-nums ms-auto mt-4 grid w-64 grid-cols-2 gap-y-1 text-sm">
        <dt className="text-gray-500">قبل الضريبة</dt>
        <dd className="text-end">{fmt(totals.subtotal)}</dd>
        <dt className="text-gray-500">ضريبة القيمة المضافة</dt>
        <dd className="text-end">{fmt(totals.vat)}</dd>
        <dt className="border-t border-gray-200 pt-1 font-semibold text-[var(--inv-dark)]">الإجمالي</dt>
        <dd className="border-t border-gray-200 pt-1 text-end font-semibold text-[var(--inv-dark)]">
          {fmt(totals.total)} {currency}
        </dd>
      </dl>
    </>
  );
}

/** أمر شراء للمورد: الأصناف والكميات والأسعار المتفق عليها. */
export function PurchaseOrderDocument({ company, doc, template = DEFAULT_TEMPLATE, compact = false }: { company: CompanyProfile; doc: Order; template?: InvoiceTemplate; compact?: boolean }) {
  const { o } = doc;
  return (
    <Frame
      company={company}
      template={template}
      compact={compact}
      title="أمر شراء"
      en="Purchase Order"
      meta={[
        ["الرقم", o.number],
        ["التاريخ", o.orderDate],
        ...(o.expectedDate ? ([["التوريد قبل", o.expectedDate]] as [string, string][]) : []),
      ]}
      signatures={["أعدّه", "اعتمده", "توقيع المورد وختمه"]}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Facts
          rows={[
            ["المورد", doc.supplier.nameAr],
            ["الرقم الضريبي", doc.supplier.vatNumber],
            ["الجوال", doc.supplier.mobile],
          ]}
        />
        <Facts
          rows={[
            ["طلب الشراء", doc.request],
            ["المركبة", doc.plate],
            ["ملاحظات", o.notes],
          ]}
        />
      </div>
      <Lines rows={doc.lines} currency={o.currencyCode} totals={doc.totals} />
    </Frame>
  );
}

/** عرض سعر للعميل بصلاحية محددة. */
export function QuotationDocument({ company, doc, template = DEFAULT_TEMPLATE, compact = false }: { company: CompanyProfile; doc: QuoteView; template?: InvoiceTemplate; compact?: boolean }) {
  const { q } = doc;
  return (
    <Frame
      company={company}
      template={template}
      compact={compact}
      title="عرض سعر"
      en="Quotation"
      meta={[
        ["الرقم", q.number],
        ["التاريخ", q.quoteDate],
        ["صالح حتى", q.validUntil],
      ]}
      signatures={["المفوض بالتوقيع", "موافقة العميل"]}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Facts
          rows={[
            ["السادة", doc.customer.nameAr],
            ["الرقم الضريبي", doc.customer.vatNumber],
            ["المرجع", q.reference],
          ]}
        />
        <Facts
          rows={[
            ["نوع الشحن", `${SHIPPING_TYPES[q.shippingType].label} · ${SHIPPING_TYPES[q.shippingType].tax}`],
            ["ملاحظات", q.notes],
          ]}
        />
      </div>
      <Lines rows={doc.lines} currency={q.currencyCode} totals={{ subtotal: Number(q.subtotal), vat: Number(q.vatTotal), total: Number(q.total) }} />
      {(q.terms || template.terms) && (
        <div className="mt-6 rounded-lg bg-gray-50 px-4 py-3 text-xs whitespace-pre-line text-gray-600">
          <div className="mb-1 font-semibold text-gray-700">الشروط</div>
          {q.terms || template.terms}
        </div>
      )}
    </Frame>
  );
}
