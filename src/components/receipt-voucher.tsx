import Link from "next/link";
import type { CSSProperties } from "react";
import type { CompanyProfile } from "@/lib/company";
import type { receiptDoc } from "@/lib/receipts";
import { DEFAULT_TEMPLATE, TEMPLATE_ACCENTS, type InvoiceTemplate } from "@/lib/invoice-template";
import { amountInWords } from "@/lib/tafqit";
import { PAYMENT_METHODS, RECEIPT_KINDS } from "@/data/sales";
import { LogoMark } from "@/components/logo";
import { companyAddress } from "@/components/tax-invoice";

const fmt = (v: string | number) => Number(v).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Doc = NonNullable<Awaited<ReturnType<typeof receiptDoc>>>;

const TITLES = {
  invoice_payment: { ar: "سند قبض", en: "Receipt Voucher" },
  advance: { ar: "سند قبض – دفعة مقدمة", en: "Advance Payment Receipt" },
  refund: { ar: "سند استرداد", en: "Refund Voucher" },
} as const;

/** سند القبض كما يُطبع: بيانات المنشأة ولون القالب، المبلغ بالأرقام والحروف، والفواتير المسددة به. */
export function ReceiptVoucher({ company, doc, template: t = DEFAULT_TEMPLATE, compact = false }: { company: CompanyProfile; doc: Doc; template?: InvoiceTemplate; compact?: boolean }) {
  const { r, customer } = doc;
  const accent = TEMPLATE_ACCENTS[t.accent];
  const vars = { "--inv-accent": accent.main, "--inv-dark": accent.dark } as CSSProperties;
  const title = TITLES[r.kind];
  const allocated = doc.allocations.reduce((a, x) => a + Number(x.amount), 0);
  const adjusted = doc.adjustments.reduce((a, x) => a + Number(x.amount), 0);
  const unallocated = r.status === "posted" && r.kind !== "refund" ? Number(r.amount) + adjusted - allocated : 0;
  const refund = r.kind === "refund";

  return (
    <article style={vars} className={`relative overflow-hidden rounded-2xl border border-black/[0.06] bg-white text-gray-800 shadow-[0_4px_16px_-8px_rgba(27,33,38,0.08)] print:rounded-none print:border-0 print:shadow-none ${compact ? "p-6" : "p-8 sm:p-10"}`}>
      {r.status === "draft" && (
        <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="-rotate-[24deg] font-display text-[7rem] font-bold text-gray-900/[0.04] select-none">مسودة</span>
        </div>
      )}
      <header className="flex items-start justify-between gap-4 border-b-2 border-[var(--inv-accent)] pb-4 text-xs leading-relaxed">
        <div>
          <div className="font-display text-lg font-semibold text-[var(--inv-dark)]">{company.nameAr}</div>
          <div className="text-gray-500">{companyAddress(company)}</div>
          {company.phone && <div className="ltr-nums text-gray-500">{company.phone}</div>}
          {company.vatNumber && (
            <div>
              الرقم الضريبي <span className="ltr-nums font-medium">{company.vatNumber}</span>
            </div>
          )}
        </div>
        {t.showLogo &&
          (company.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={company.logo} alt="" className="h-14 w-24 object-contain" />
          ) : (
            <LogoMark size={46} />
          ))}
      </header>

      <div className="my-5 flex flex-wrap items-end justify-between gap-3">
        <h2 className="font-display text-2xl font-semibold text-[var(--inv-dark)]">
          {title.ar} <span className="font-sans text-sm font-medium text-gray-400">{title.en}</span>
        </h2>
        <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-xs">
          <dt className="text-gray-500">الرقم</dt>
          <dd className="ltr-nums font-semibold">{r.number}</dd>
          <dt className="text-gray-500">التاريخ</dt>
          <dd className="ltr-nums">{r.receiptDate}</dd>
          {doc.entry && (
            <>
              <dt className="text-gray-500">القيد</dt>
              <dd className="ltr-nums">{doc.entry}</dd>
            </>
          )}
        </dl>
      </div>

      <section className="grid gap-4 rounded-xl border border-gray-200 p-4 text-sm sm:grid-cols-[1fr_auto]">
        <div className="space-y-2.5">
          <div>
            <span className="text-gray-500">{refund ? "صُرف إلى السادة:" : "استلمنا من السادة:"} </span>
            <span className="font-semibold">{customer.nameAr}</span>
            {customer.vatNumber && <span className="ltr-nums ms-2 text-xs text-gray-500">({customer.vatNumber})</span>}
          </div>
          <div>
            <span className="text-gray-500">مبلغ وقدره: </span>
            <span className="font-medium">{amountInWords(Number(r.amount), r.currencyCode)}</span>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-600">
            <span>
              طريقة الدفع: <b className="font-medium text-gray-800">{PAYMENT_METHODS[r.method]}</b>
            </span>
            <span>
              {refund ? "من" : "إلى"}: <b className="font-medium text-gray-800">{doc.cashAccount}</b>
            </span>
            {r.reference && (
              <span>
                المرجع: <b className="ltr-nums font-medium text-gray-800">{r.reference}</b>
              </span>
            )}
            {r.collector && (
              <span>
                المحصّل: <b className="font-medium text-gray-800">{r.collector}</b>
              </span>
            )}
          </div>
          {r.notes && <div className="text-xs text-gray-600">البيان: {r.notes}</div>}
        </div>
        <div className="flex min-w-40 flex-col items-center justify-center rounded-xl bg-[var(--inv-dark)] px-5 py-3 text-white print:[print-color-adjust:exact]">
          <span className="text-[11px] text-white/70">المبلغ</span>
          <span className="ltr-nums font-display text-2xl font-semibold">{fmt(r.amount)}</span>
          <span className="text-xs text-[var(--inv-accent)]">{r.currencyCode}</span>
        </div>
      </section>

      {doc.allocations.length > 0 && (
        <section className="mt-5">
          <h3 className="mb-2 text-sm font-semibold text-[var(--inv-dark)]">{r.kind === "advance" ? "طُبقت على الفواتير" : "سداد الفواتير"}</h3>
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="px-3 py-2 text-start font-medium">الفاتورة</th>
                <th className="px-3 py-2 text-start font-medium">التاريخ</th>
                <th className="px-3 py-2 text-end font-medium">قيمة الفاتورة</th>
                <th className="px-3 py-2 text-end font-medium">المسدد بهذا السند</th>
                <th className="px-3 py-2 text-end font-medium print:hidden">المتبقي على الفاتورة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {doc.allocations.map((a) => (
                <tr key={a.invoiceId}>
                  <td className="ltr-nums px-3 py-2">
                    <Link href={`/invoices?open=${a.invoiceId}`} className="text-brand-700 hover:underline print:text-gray-800 print:no-underline">
                      {a.number}
                    </Link>
                  </td>
                  <td className="ltr-nums px-3 py-2">{a.invoiceDate}</td>
                  <td className="ltr-nums px-3 py-2 text-end">{fmt(a.total)}</td>
                  <td className="ltr-nums px-3 py-2 text-end font-semibold">{fmt(a.amount)}</td>
                  <td className="ltr-nums px-3 py-2 text-end text-gray-500 print:hidden">{fmt(Number(a.total) - Number(a.paid))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {(doc.adjustments.length > 0 || unallocated > 0.005) && (
        <dl className="mt-4 ms-auto max-w-sm space-y-1 text-xs">
          {doc.adjustments.map((a, i) => (
            <div key={i} className="flex justify-between border-b border-gray-100 py-1">
              <dt className="text-gray-500">
                {a.description} <span className="ltr-nums text-gray-400">({a.code})</span>
              </dt>
              <dd className="ltr-nums">{fmt(a.amount)}</dd>
            </div>
          ))}
          {unallocated > 0.005 && (
            <div className="flex justify-between rounded-lg bg-amber-50 px-2 py-1.5 text-amber-800">
              <dt>{r.kind === "advance" ? "رصيد الدفعة غير المطبق" : "رصيد دائن للعميل (دفع زائد)"}</dt>
              <dd className="ltr-nums font-semibold">{fmt(unallocated)}</dd>
            </div>
          )}
        </dl>
      )}

      <footer className="mt-10 grid grid-cols-3 gap-6 text-center text-xs text-gray-500">
        {[refund ? "المستلم" : "المسلِّم", "المحاسب", "المدير المالي"].map((label) => (
          <div key={label}>
            <div className="mb-1 h-10 border-b border-dashed border-gray-300" />
            {label}
          </div>
        ))}
      </footer>
      <div className="mt-6 text-center text-[11px] text-gray-400">
        {RECEIPT_KINDS[r.kind].label} · {company.nameAr}
      </div>
    </article>
  );
}
