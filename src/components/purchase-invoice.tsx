import type { purchaseInvoiceDoc } from "@/lib/purchases";
import { PURCHASE_STATUS } from "@/data/purchases";
import { paymentState } from "@/data/sales";
import { Badge } from "@/components/ui";

const fmt = (v: string | number) => Number(v).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Doc = NonNullable<Awaited<ReturnType<typeof purchaseInvoiceDoc>>>;

/** فاتورة المورد كما استُلمت: المورد وفاتورته، وسطورها على حساباتها ومراكز تكلفتها، والقيد. */
export function PurchaseInvoiceDocument({ doc }: { doc: Doc }) {
  const { i, supplier, lines } = doc;
  const total = Number(i.total);
  const paid = Number(i.paidAmount);
  const pay = paymentState(total, paid);
  return (
    <article className="rounded-2xl border border-black/[0.06] bg-white p-6 text-gray-800 shadow-[0_4px_16px_-8px_rgba(27,33,38,0.08)] sm:p-8 print:border-0 print:shadow-none">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-200 pb-4">
        <div>
          <div className="text-xs text-gray-500">المورد</div>
          <div className="font-display text-lg font-semibold text-brand-900">{supplier.nameAr}</div>
          {supplier.vatNumber && <div className="ltr-nums text-xs text-gray-500">الرقم الضريبي {supplier.vatNumber}</div>}
          {supplier.nationalAddress && <div className="text-xs text-gray-500">{supplier.nationalAddress}</div>}
        </div>
        <div className="text-end">
          <div className="font-display text-lg font-semibold text-brand-900">فاتورة مورد</div>
          <div className="ltr-nums text-sm text-gray-600">{i.number}</div>
          <div className="mt-1 flex justify-end gap-1.5">
            <Badge tone={PURCHASE_STATUS[i.status].tone}>{PURCHASE_STATUS[i.status].label}</Badge>
            {i.status === "posted" && <Badge tone={pay.tone}>{pay.label}</Badge>}
          </div>
        </div>
      </header>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 py-4 text-xs sm:grid-cols-4">
        {[
          ["رقم فاتورة المورد", i.supplierInvoiceNo],
          ["التاريخ", i.invoiceDate],
          ["الاستحقاق", i.dueDate],
          ["العملة", i.currencyCode === "SAR" ? "SAR" : `${i.currencyCode} · ${Number(i.exchangeRate)}`],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="text-gray-500">{k}</dt>
            <dd className="ltr-nums font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      <table className="w-full text-xs">
        <thead className="bg-asphalt-900 text-white/90 print:bg-gray-100 print:text-gray-800">
          <tr>
            {["#", "الحساب", "المركبة / المركز", "البيان", "المبلغ", "الضريبة", "الإجمالي"].map((h, k) => (
              <th key={h} className={`px-2.5 py-2 font-medium ${k > 3 ? "text-end" : "text-start"}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {lines.map(({ l, code, account, cc }) => (
            <tr key={l.id}>
              <td className="ltr-nums px-2.5 py-2">{l.lineNo}</td>
              <td className="px-2.5 py-2">
                <span className="ltr-nums text-gray-400">{code}</span> {account}
              </td>
              <td className="px-2.5 py-2">{cc ?? "—"}</td>
              <td className="px-2.5 py-2">{l.description}</td>
              <td className="ltr-nums px-2.5 py-2 text-end">{fmt(l.amount)}</td>
              <td className="ltr-nums px-2.5 py-2 text-end">{fmt(l.vatAmount)}</td>
              <td className="ltr-nums px-2.5 py-2 text-end font-medium">{fmt(Number(l.amount) + Number(l.vatAmount))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4 border-t border-gray-200 pt-3">
        <div className="text-xs text-gray-500">
          دائنة لحساب <span className="ltr-nums">{doc.payableCode}</span> {doc.payable}
          {doc.entry && (
            <>
              {" "}
              · القيد <span className="ltr-nums">{doc.entry}</span>
            </>
          )}
        </div>
        <dl className="w-full max-w-xs text-xs">
          <div className="flex justify-between py-1">
            <dt className="text-gray-500">قبل الضريبة</dt>
            <dd className="ltr-nums">{fmt(i.subtotal)}</dd>
          </div>
          <div className="flex justify-between py-1">
            <dt className="text-gray-500">ضريبة المدخلات</dt>
            <dd className="ltr-nums">{fmt(i.vatTotal)}</dd>
          </div>
          <div className="flex justify-between border-t border-gray-100 pt-2 text-sm font-semibold text-brand-900">
            <dt>الإجمالي</dt>
            <dd className="ltr-nums">
              {fmt(total)} {i.currencyCode}
            </dd>
          </div>
          {i.status === "posted" && paid > 0 && (
            <div className="flex justify-between py-1 text-gray-600">
              <dt>المسدد / المتبقي</dt>
              <dd className="ltr-nums">
                {fmt(paid)} / {fmt(total - paid)}
              </dd>
            </div>
          )}
        </dl>
      </div>
      {i.notes && <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">{i.notes}</p>}
    </article>
  );
}
