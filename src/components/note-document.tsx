import Link from "next/link";
import type { CSSProperties } from "react";
import type { CompanyProfile } from "@/lib/company";
import type { noteDoc } from "@/lib/notes";
import { DEFAULT_TEMPLATE, TEMPLATE_ACCENTS, type InvoiceTemplate } from "@/lib/invoice-template";
import { amountInWords } from "@/lib/tafqit";
import { NOTE_KINDS, NOTE_SIDES } from "@/data/sales";
import { LogoMark } from "@/components/logo";
import { companyAddress } from "@/components/tax-invoice";

const fmt = (v: string | number) => Number(v).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
type Doc = NonNullable<Awaited<ReturnType<typeof noteDoc>>>;

/** الإشعار الدائن/المدين كما يُطبع: مرجع الفاتورة الأصلية والسبب والسطور والضريبة. */
export function NoteDocument({ company, doc, template: t = DEFAULT_TEMPLATE, compact = false }: { company: CompanyProfile; doc: Doc; template?: InvoiceTemplate; compact?: boolean }) {
  const { n, party } = doc;
  const k = NOTE_KINDS[n.kind];
  const side = NOTE_SIDES[k.side];
  const accent = TEMPLATE_ACCENTS[t.accent];
  const vars = { "--inv-accent": accent.main, "--inv-dark": accent.dark } as CSSProperties;
  const invoiceId = n.salesInvoiceId ?? n.purchaseInvoiceId;
  return (
    <article style={vars} className={`relative overflow-hidden rounded-2xl border border-black/[0.06] bg-white text-gray-800 shadow-[0_4px_16px_-8px_rgba(27,33,38,0.08)] print:rounded-none print:border-0 print:shadow-none ${compact ? "p-6" : "p-8 sm:p-10"}`}>
      {n.status === "draft" && (
        <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="-rotate-[24deg] font-display text-[7rem] font-bold text-gray-900/[0.04] select-none">مسودة</span>
        </div>
      )}
      <header className="flex items-start justify-between gap-4 border-b-2 border-[var(--inv-accent)] pb-4 text-xs leading-relaxed">
        <div>
          <div className="font-display text-lg font-semibold text-[var(--inv-dark)]">{company.nameAr}</div>
          <div className="text-gray-500">{companyAddress(company)}</div>
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
          {k.side === "sales" ? `${k.label} ضريبي` : k.label} <span className="font-sans text-sm font-medium text-gray-400">{k.en}</span>
        </h2>
        <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-xs">
          <dt className="text-gray-500">الرقم</dt>
          <dd className="ltr-nums font-semibold">{n.number}</dd>
          <dt className="text-gray-500">التاريخ</dt>
          <dd className="ltr-nums">{n.noteDate}</dd>
          {doc.invoice && (
            <>
              <dt className="text-gray-500">الفاتورة الأصلية</dt>
              <dd className="ltr-nums">
                {invoiceId ? (
                  <Link href={`${side.invoices}?open=${invoiceId}`} className="text-brand-700 hover:underline print:text-gray-800 print:no-underline">
                    {doc.invoice}
                  </Link>
                ) : (
                  doc.invoice
                )}
                {doc.supplierInvoiceNo && <span className="text-gray-400"> ({doc.supplierInvoiceNo})</span>}
                {doc.invoiceDate && <span className="text-gray-400"> · {doc.invoiceDate}</span>}
              </dd>
            </>
          )}
          {doc.entry && (
            <>
              <dt className="text-gray-500">القيد</dt>
              <dd className="ltr-nums">{doc.entry}</dd>
            </>
          )}
        </dl>
      </div>

      <section className="rounded-xl border border-gray-200 p-4 text-sm">
        <div>
          <span className="text-gray-500">{side.party}: </span>
          <span className="font-semibold">{party.nameAr}</span>
          {party.vatNumber && <span className="ltr-nums ms-2 text-xs text-gray-500">الرقم الضريبي {party.vatNumber}</span>}
        </div>
        <div className="mt-1.5">
          <span className="text-gray-500">سبب الإشعار: </span>
          {n.reason}
        </div>
      </section>

      <table className="mt-5 w-full text-xs">
        <thead className="bg-[var(--inv-dark)] text-white print:[print-color-adjust:exact]">
          <tr>
            <th className="px-3 py-2 text-start font-medium">#</th>
            <th className="px-3 py-2 text-start font-medium">البيان</th>
            <th className="px-3 py-2 text-end font-medium">المبلغ</th>
            <th className="px-3 py-2 text-end font-medium">الضريبة</th>
            <th className="px-3 py-2 text-end font-medium">الإجمالي</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {doc.lines.map(({ l, code, account }) => (
            <tr key={l.id}>
              <td className="ltr-nums px-3 py-2 text-gray-400">{l.lineNo}</td>
              <td className="px-3 py-2">
                {l.description}
                <div className="text-[10px] text-gray-400 print:hidden">
                  <span className="ltr-nums">{code}</span> {account}
                </div>
              </td>
              <td className="ltr-nums px-3 py-2 text-end">{fmt(l.amount)}</td>
              <td className="ltr-nums px-3 py-2 text-end">
                {fmt(l.vatAmount)} <span className="text-gray-400">({Number(l.vatRate)}%)</span>
              </td>
              <td className="ltr-nums px-3 py-2 text-end font-medium">{fmt(Number(l.amount) + Number(l.vatAmount))}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <p className="max-w-sm text-xs text-gray-600">{amountInWords(Number(n.total), n.currencyCode)}</p>
        <dl className="w-64 space-y-1 text-xs">
          <div className="flex justify-between">
            <dt className="text-gray-500">الإجمالي قبل الضريبة</dt>
            <dd className="ltr-nums">{fmt(n.subtotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">ضريبة القيمة المضافة</dt>
            <dd className="ltr-nums">{fmt(n.vatTotal)}</dd>
          </div>
          <div className="flex justify-between rounded-lg bg-[var(--inv-dark)] px-3 py-2 text-sm font-semibold text-white print:[print-color-adjust:exact]">
            <dt>الإجمالي</dt>
            <dd className="ltr-nums">
              {fmt(n.total)} <span className="text-[10px] text-[var(--inv-accent)]">{n.currencyCode}</span>
            </dd>
          </div>
          {n.status === "posted" && Number(n.appliedAmount) > 0 && (
            <div className="flex justify-between pt-1 text-emerald-700">
              <dt>خُصم من رصيد الفاتورة</dt>
              <dd className="ltr-nums">{fmt(n.appliedAmount)}</dd>
            </div>
          )}
          {n.status === "posted" && k.reduces && Number(n.total) - Number(n.appliedAmount) > 0.005 && (
            <div className="flex justify-between rounded bg-amber-50 px-2 py-1 text-amber-800">
              <dt>رصيد دائن لل{side.party}</dt>
              <dd className="ltr-nums">{fmt(Number(n.total) - Number(n.appliedAmount))}</dd>
            </div>
          )}
        </dl>
      </div>
      <footer className="mt-10 grid grid-cols-2 gap-6 text-center text-xs text-gray-500">
        {["المحاسب", "المدير المالي"].map((label) => (
          <div key={label}>
            <div className="mb-1 h-10 border-b border-dashed border-gray-300" />
            {label}
          </div>
        ))}
      </footer>
    </article>
  );
}
