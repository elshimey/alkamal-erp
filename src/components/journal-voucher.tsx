import Link from "next/link";
import type { CSSProperties } from "react";
import type { CompanyProfile } from "@/lib/company";
import type { entryDoc } from "@/lib/journal";
import { DEFAULT_TEMPLATE, TEMPLATE_ACCENTS, type InvoiceTemplate } from "@/lib/invoice-template";
import { amountInWords } from "@/lib/tafqit";
import { ENTRY_SOURCES } from "@/data/journal";
import { LogoMark } from "@/components/logo";
import { fmt } from "@/lib/format";

type Doc = NonNullable<Awaited<ReturnType<typeof entryDoc>>>;

/** قيد اليومية كما يُطبع: السطور بالحساب ومركز التكلفة والجهة، والمجموع بالحروف. */
export function JournalVoucher({ company, doc, template: t = DEFAULT_TEMPLATE, compact = false }: { company: CompanyProfile; doc: Doc; template?: InvoiceTemplate; compact?: boolean }) {
  const { e } = doc;
  const accent = TEMPLATE_ACCENTS[t.accent];
  const vars = { "--inv-accent": accent.main, "--inv-dark": accent.dark } as CSSProperties;
  const source = e.sourceType ? ENTRY_SOURCES[e.sourceType] : null;
  return (
    <article style={vars} className={`relative overflow-hidden rounded-2xl border border-black/[0.06] bg-white text-gray-800 shadow-[0_4px_16px_-8px_rgba(27,33,38,0.08)] print:rounded-none print:border-0 print:shadow-none ${compact ? "p-6" : "p-8 sm:p-10"}`}>
      {e.status !== "posted" && (
        <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="-rotate-[24deg] font-display text-[7rem] font-bold text-gray-900/[0.04] select-none">مسودة</span>
        </div>
      )}
      <header className="flex items-start justify-between gap-4 border-b-2 border-[var(--inv-accent)] pb-4">
        <div className="text-xs">
          <div className="font-display text-lg font-semibold text-[var(--inv-dark)]">{company.nameAr}</div>
          {company.vatNumber && (
            <div>
              الرقم الضريبي <span className="ltr-nums">{company.vatNumber}</span>
            </div>
          )}
        </div>
        {t.showLogo &&
          (company.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={company.logo} alt="" className="h-12 w-20 object-contain" />
          ) : (
            <LogoMark size={40} />
          ))}
      </header>
      <div className="my-5 flex flex-wrap items-end justify-between gap-3">
        <h2 className="font-display text-2xl font-semibold text-[var(--inv-dark)]">
          قيد يومية <span className="font-sans text-sm font-medium text-gray-400">Journal Voucher</span>
        </h2>
        <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-xs">
          <dt className="text-gray-500">الرقم</dt>
          <dd className="ltr-nums font-semibold">{e.number}</dd>
          <dt className="text-gray-500">التاريخ</dt>
          <dd className="ltr-nums">{e.entryDate}</dd>
          {e.reference && (
            <>
              <dt className="text-gray-500">المرجع</dt>
              <dd className="ltr-nums">{e.reference}</dd>
            </>
          )}
          <dt className="text-gray-500">المصدر</dt>
          <dd>
            {source ? (
              source.href && e.sourceId ? (
                <Link href={source.href(e.sourceId)} className="text-brand-700 hover:underline print:text-gray-800">
                  {source.label}
                </Link>
              ) : (
                source.label
              )
            ) : e.sourceType ? (
              e.sourceType
            ) : (
              "قيد يدوي"
            )}
          </dd>
        </dl>
      </div>
      {e.description && (
        <p className="rounded-xl border border-gray-200 px-4 py-3 text-sm">
          <span className="text-gray-500">البيان: </span>
          {e.description}
        </p>
      )}
      <table className="mt-5 w-full text-xs">
        <thead className="bg-[var(--inv-dark)] text-white print:[print-color-adjust:exact]">
          <tr>
            <th className="px-2 py-2 text-start font-medium">الحساب</th>
            <th className="px-2 py-2 text-start font-medium">الوصف</th>
            <th className="px-2 py-2 text-start font-medium">مركز التكلفة / الجهة</th>
            <th className="px-2 py-2 text-end font-medium">مدين</th>
            <th className="px-2 py-2 text-end font-medium">دائن</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {doc.lines.map(({ l, code, account, costCenter, party }) => (
            <tr key={l.id}>
              <td className="px-2 py-2">
                <span className="ltr-nums text-gray-400">{code}</span> {account}
              </td>
              <td className="px-2 py-2 text-gray-600">{l.description}</td>
              <td className="px-2 py-2 text-gray-600">{[costCenter, party].filter(Boolean).join(" · ")}</td>
              <td className="ltr-nums px-2 py-2 text-end">{Number(l.debitBase) ? fmt(l.debitBase) : ""}</td>
              <td className="ltr-nums px-2 py-2 text-end">{Number(l.creditBase) ? fmt(l.creditBase) : ""}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-[var(--inv-dark)] font-semibold">
            <td colSpan={3} className="px-2 py-2">
              الإجمالي <span className="font-normal text-gray-500">({amountInWords(doc.debit, "SAR")})</span>
            </td>
            <td className="ltr-nums px-2 py-2 text-end">{fmt(doc.debit)}</td>
            <td className="ltr-nums px-2 py-2 text-end">{fmt(doc.credit)}</td>
          </tr>
        </tfoot>
      </table>
      <footer className="mt-10 grid grid-cols-3 gap-6 text-center text-xs text-gray-500">
        {[`أعدّه${doc.createdBy ? `: ${doc.createdBy}` : ""}`, "راجعه", "اعتمده"].map((label) => (
          <div key={label}>
            <div className="mb-1 h-10 border-b border-dashed border-gray-300" />
            {label}
          </div>
        ))}
      </footer>
    </article>
  );
}
