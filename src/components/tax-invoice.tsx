import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import type * as s from "@/db/schema";
import type { CompanyProfile } from "@/lib/company";
import { DEFAULT_TEMPLATE, TEMPLATE_ACCENTS, formatIban, type InvoiceTemplate } from "@/lib/invoice-template";
import { LogoMark } from "@/components/logo";
import { fmt } from "@/lib/format";
import { invoiceTerms } from "@/lib/invoice-terms";

type Invoice = typeof s.salesInvoices.$inferSelect;
type Party = typeof s.parties.$inferSelect;
type Line = typeof s.salesInvoiceLines.$inferSelect;

export function companyAddress(c: CompanyProfile) {
  return [[c.buildingNo, c.street].filter(Boolean).join(" "), c.district, [c.city, c.postalCode].filter(Boolean).join(" "), c.additionalNo && `الرقم الإضافي ${c.additionalNo}`]
    .filter(Boolean)
    .join("، ");
}

/**
 * الفاتورة الضريبية كما تُطبع وتُرسل للعميل: بيانات المنشأة من الإعدادات، وشكلها من قالب الفاتورة،
 * ورمز QR بمتطلبات هيئة الزكاة (يُولَّد في الخادم ويُمرَّر جاهزاً). تعمل في الخادم وفي المعاينة المباشرة للقالب.
 */
export function TaxInvoiceDocument({
  company,
  invoice: i,
  customer,
  lines,
  qrSvg,
  template: t = DEFAULT_TEMPLATE,
  lineAction,
  compact = false,
}: {
  company: CompanyProfile;
  invoice: Invoice;
  customer: Party;
  lines: Line[];
  qrSvg: string | null;
  template?: InvoiceTemplate;
  lineAction?: (line: Line) => ReactNode;
  compact?: boolean;
}) {
  const draft = i.status === "draft";
  const total = Number(i.total);
  const vat = Number(i.vatTotal);
  const foreign = i.currencyCode !== "SAR";
  const rate = Number(i.exchangeRate);
  const address = companyAddress(company);
  const bi = t.language === "bilingual";
  const band = t.layout === "band";
  const minimal = t.layout === "minimal";
  const accent = TEMPLATE_ACCENTS[t.accent];
  const vars = { "--inv-accent": accent.main, "--inv-dark": accent.dark } as CSSProperties;
  const en = (text: string, cls = "text-[10px] opacity-70") => (bi ? <span className={cls}> {text}</span> : null);
  const pad = compact ? "p-6" : "p-8 sm:p-10";

  return (
    <article style={vars} className={`relative overflow-hidden rounded-2xl border border-black/[0.06] bg-white text-gray-800 shadow-[0_4px_16px_-8px_rgba(27,33,38,0.08)] print:rounded-none print:border-0 print:shadow-none ${pad}`}>
      {draft && (
        <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="-rotate-[24deg] font-display text-[7rem] font-bold text-gray-900/[0.04] select-none">مسودة</span>
        </div>
      )}

      {/* رأس الفاتورة: المنشأة بالعربي يميناً، الشعار وسطاً، بالإنجليزي يساراً */}
      <header
        className={`grid items-start gap-4 text-xs leading-relaxed ${bi ? "grid-cols-[1fr_auto_1fr]" : "grid-cols-[1fr_auto]"} ${
          band ? `-mx-6 -mt-6 mb-2 bg-[var(--inv-dark)] px-6 py-5 text-white/80 print:[print-color-adjust:exact] ${compact ? "" : "sm:-mx-10 sm:-mt-10 sm:px-10"}` : ""
        }`}
      >
        <div>
          <div className={`font-display text-lg font-semibold ${band ? "text-white" : "text-[var(--inv-dark)]"}`}>{company.nameAr}</div>
          {address && <div className={band ? "" : "text-gray-500"}>{address}</div>}
          {company.phone && (
            <div className={band ? "" : "text-gray-500"}>
              <span className="ltr-nums">{company.phone}</span>
            </div>
          )}
          {company.email && <div className={band ? "" : "text-gray-500"}>{company.email}</div>}
          {company.vatNumber && (
            <div>
              الرقم الضريبي <span className="ltr-nums font-medium">{company.vatNumber}</span>
            </div>
          )}
          {company.crNumber && (
            <div>
              السجل التجاري <span className="ltr-nums font-medium">{company.crNumber}</span>
            </div>
          )}
        </div>
        <div className={`flex ${bi ? "justify-center" : "justify-end"}`}>
          {t.showLogo &&
            (company.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={company.logo} alt="" className={`h-16 w-28 object-contain ${band ? "rounded-lg bg-white p-1.5" : ""}`} />
            ) : (
              <LogoMark size={52} />
            ))}
        </div>
        {bi && (
          <div dir="ltr" className="text-left">
            <div className={`font-display text-lg font-semibold ${band ? "text-white" : "text-[var(--inv-dark)]"}`}>{company.nameEn || company.nameAr}</div>
            {[company.city, company.country === "SA" ? "Kingdom of Saudi Arabia" : company.country].filter(Boolean).join(", ")}
            {company.vatNumber && <div>VAT No. {company.vatNumber}</div>}
            {company.crNumber && <div>CR No. {company.crNumber}</div>}
          </div>
        )}
      </header>

      <div className="my-5 flex items-center gap-3">
        <span className={`h-px flex-1 ${minimal ? "bg-gray-200" : "bg-[var(--inv-accent)]/40"}`} />
        <h2 className={`font-display text-xl font-semibold ${band ? "rounded-full bg-[var(--inv-accent)] px-4 py-1 text-white print:[print-color-adjust:exact]" : "text-[var(--inv-dark)]"}`}>
          فاتورة ضريبية {bi && <span className={`font-sans text-base font-medium ${band ? "text-white/80" : "text-gray-500"}`}>Tax Invoice</span>}
        </h2>
        <span className={`h-px flex-1 ${minimal ? "bg-gray-200" : "bg-[var(--inv-accent)]/40"}`} />
      </div>

      {/* العميل وبيانات الفاتورة */}
      <section className="grid gap-x-6 rounded-xl border border-gray-200 text-xs sm:grid-cols-2">
        <dl className="divide-y divide-gray-100 border-gray-200 sm:border-e">
          {(
            [
              ["العميل", "Customer", customer.nameAr, false],
              ["العنوان", "Address", [customer.buildingNo, customer.street, customer.district, customer.city, customer.postalCode].filter(Boolean).join("، ") || customer.nationalAddress, false],
              ["الرقم الضريبي", "VAT No.", t.showCustomerIds ? customer.vatNumber : null, true],
              ["السجل التجاري", "CR No.", t.showCustomerIds ? customer.crNumber : null, true],
            ] as const
          )
            .filter(([, , v]) => v)
            .map(([ar, label, v, ltr]) => (
              <div key={label} className="grid grid-cols-[6.5rem_1fr] gap-2 px-3 py-1.5">
                <dt className="text-gray-500">
                  {ar}
                  {en(label)}
                </dt>
                <dd className={`font-medium ${ltr ? "ltr-nums" : ""}`}>{v}</dd>
              </div>
            ))}
        </dl>
        <dl className="divide-y divide-gray-100">
          {[
            ["رقم الفاتورة", "Invoice No.", i.number],
            ["تاريخ الإصدار", "Issue date", i.invoiceDate],
            ["تاريخ الاستحقاق", "Due date", i.dueDate],
            ["العملة", "Currency", foreign ? `${i.currencyCode} · سعر الصرف ${rate}` : i.currencyCode],
          ].map(([ar, label, v]) => (
            <div key={label} className="grid grid-cols-[6.5rem_1fr] gap-2 px-3 py-1.5">
              <dt className="text-gray-500">
                {ar}
                {en(label)}
              </dt>
              <dd className="ltr-nums font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* السطور */}
      <table className="mt-5 w-full text-xs">
        <thead className={minimal ? "border-b-2 border-[var(--inv-dark)] text-[var(--inv-dark)]" : "bg-[var(--inv-dark)] text-white/90 print:[print-color-adjust:exact]"}>
          <tr>
            {[
              ["#", "No."],
              ["الوصف", "Description"],
              ["المبلغ الخاضع", "Taxable"],
              ["الضريبة %", "VAT %"],
              ["مبلغ الضريبة", "VAT"],
              ["الإجمالي", "Total"],
            ].map(([ar, label], k) => (
              <th key={label} className={`px-2.5 py-2 font-medium ${k > 1 ? "text-end" : "text-start"}`}>
                <span className="block">{ar}</span>
                {bi && (
                  <span className="block text-[10px] font-normal tracking-wide opacity-70" dir="ltr">
                    {label}
                  </span>
                )}
              </th>
            ))}
            {lineAction && <th className="print:hidden" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {lines.length === 0 && (
            <tr>
              <td colSpan={7} className="px-3 py-6 text-center text-gray-400">
                لا توجد سطور
              </td>
            </tr>
          )}
          {lines.map((l) => (
            <tr key={l.id} className={l.kind === "expense" ? "text-gray-600" : ""}>
              <td className="ltr-nums px-2.5 py-2 align-top">{l.lineNo}</td>
              <td className="px-2.5 py-2">
                {l.kind === "waybill" && l.waybillId ? (
                  <Link href={`/waybills/${l.waybillId}`} className="hover:text-brand-700 print:no-underline">
                    خدمة نقل · {l.description}
                  </Link>
                ) : l.kind === "manual" ? (
                  <span>
                    {l.description}
                    {l.quantity != null && Number(l.quantity) !== 1 && (
                      <span className="ltr-nums ms-1.5 text-xs text-gray-500">
                        ({Number(l.quantity)} × {fmt(l.unitPrice ?? "0")}
                        {Number(l.discountPercent ?? 0) > 0 && ` − ${Number(l.discountPercent)}%`})
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="ps-3">↳ {l.description}</span>
                )}
              </td>
              <td className="ltr-nums px-2.5 py-2 text-end">{fmt(l.amount)}</td>
              <td className="ltr-nums px-2.5 py-2 text-end">{Number(l.vatRate)}%</td>
              <td className="ltr-nums px-2.5 py-2 text-end">{fmt(l.vatAmount)}</td>
              <td className="ltr-nums px-2.5 py-2 text-end font-medium">{fmt(Number(l.amount) + Number(l.vatAmount))}</td>
              {lineAction && <td className="px-2 py-2 print:hidden">{lineAction(l)}</td>}
            </tr>
          ))}
        </tbody>
      </table>

      {/* الإجماليات والرمز */}
      <section className="mt-5 flex flex-wrap items-end justify-between gap-6 border-t border-gray-200 pt-4">
        <dl className="w-full max-w-xs text-xs">
          {[
            ["الإجمالي قبل الضريبة", "Subtotal", i.subtotal],
            ["ضريبة القيمة المضافة", "Total VAT", i.vatTotal],
          ].map(([ar, label, v]) => (
            <div key={label} className="flex justify-between border-b border-gray-100 py-1.5">
              <dt className="text-gray-500">
                {ar}
                {en(label)}
              </dt>
              <dd className="ltr-nums">{fmt(v)}</dd>
            </div>
          ))}
          <div className={`flex justify-between py-2 text-sm font-semibold text-[var(--inv-dark)] ${minimal ? "" : "mt-1 rounded-lg bg-[var(--inv-accent)]/10 px-2 print:[print-color-adjust:exact]"}`}>
            <dt>
              الإجمالي شامل الضريبة
              {en("Total incl. VAT", "text-[10px] font-normal opacity-70")}
            </dt>
            <dd className="ltr-nums">
              {fmt(total)} {i.currencyCode}
            </dd>
          </div>
          {foreign && (
            <div className="flex justify-between text-gray-500">
              <dt>الضريبة بالريال</dt>
              <dd className="ltr-nums">{fmt(vat * rate)} SAR</dd>
            </div>
          )}
        </dl>
        {t.showQr && (
          <div className="flex flex-col items-center gap-1.5">
            {qrSvg ? (
              <div className="size-28" dangerouslySetInnerHTML={{ __html: qrSvg }} />
            ) : (
              <Link href="/settings/company" className="flex size-28 items-center justify-center rounded-lg border border-dashed border-gray-300 p-2 text-center text-[10px] text-gray-400 hover:border-brand-500 hover:text-brand-700 print:hidden">
                أدخل الرقم الضريبي للمنشأة ليظهر رمز الفاتورة
              </Link>
            )}
            {qrSvg && <div className="max-w-40 text-center text-[9px] leading-tight text-gray-400">رمز وفق متطلبات هيئة الزكاة والضريبة والجمارك</div>}
          </div>
        )}
      </section>

      {i.notes && <p className="mt-4 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">{i.notes}</p>}

      {(t.showBank || t.terms) && (
        <section className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
          {t.showBank && t.iban && (
            <div className="rounded-lg border border-gray-200 px-3 py-2">
              <div className="mb-1 font-semibold text-[var(--inv-dark)]">
                بيانات التحويل البنكي
                {en("Bank details")}
              </div>
              <div>{t.bankName}</div>
              {t.accountName && <div className="text-gray-500">{t.accountName}</div>}
              <div className="ltr-nums mt-0.5 font-medium tracking-wide">{formatIban(t.iban)}</div>
            </div>
          )}
          {t.terms && (
            <div className={`rounded-lg border border-gray-200 px-3 py-2 ${t.showBank && t.iban ? "" : "sm:col-span-2"}`}>
              <div className="mb-1 font-semibold text-[var(--inv-dark)]">
                الشروط والأحكام
                {en("Terms")}
              </div>
              <p className="whitespace-pre-line text-gray-600">{invoiceTerms(t.terms, i.invoiceDate, i.dueDate)}</p>
            </div>
          )}
        </section>
      )}

      {t.footer && <p className="mt-5 text-center text-xs font-medium text-[var(--inv-dark)]">{t.footer}</p>}
      {t.showRoadLine && (
        <div
          aria-hidden
          className="mt-4 h-1.5 rounded-full bg-[repeating-linear-gradient(90deg,var(--inv-accent)_0_18px,transparent_18px_30px)] opacity-70 print:[print-color-adjust:exact]"
        />
      )}
    </article>
  );
}
