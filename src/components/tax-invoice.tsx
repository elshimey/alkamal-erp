import Link from "next/link";
import type { ReactNode } from "react";
import type * as s from "@/db/schema";
import type { CompanyProfile } from "@/lib/company";
import { zatcaQrSvg } from "@/lib/zatca-qr";
import { LogoMark } from "@/components/logo";

const fmt = (v: string | number) => Number(v).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Invoice = typeof s.salesInvoices.$inferSelect;
type Party = typeof s.parties.$inferSelect;
type Line = typeof s.salesInvoiceLines.$inferSelect;

export function companyAddress(c: CompanyProfile) {
  return [[c.buildingNo, c.street].filter(Boolean).join(" "), c.district, [c.city, c.postalCode].filter(Boolean).join(" "), c.additionalNo && `الرقم الإضافي ${c.additionalNo}`]
    .filter(Boolean)
    .join("، ");
}

function Bi({ ar, en }: { ar: string; en: string }) {
  return (
    <>
      <span className="block">{ar}</span>
      <span className="block text-[10px] font-normal tracking-wide opacity-70" dir="ltr">
        {en}
      </span>
    </>
  );
}

/**
 * الفاتورة الضريبية كما تُطبع وتُرسل للعميل: بيانات المنشأة من الإعدادات، ثنائية اللغة،
 * ورمز QR بمتطلبات هيئة الزكاة. تُستخدم في المعاينة الجانبية وصفحة الفاتورة والطباعة.
 */
export async function TaxInvoiceDocument({
  company,
  invoice: i,
  customer,
  lines,
  lineAction,
  compact = false,
}: {
  company: CompanyProfile;
  invoice: Invoice;
  customer: Party;
  lines: Line[];
  lineAction?: (line: Line) => ReactNode;
  compact?: boolean;
}) {
  const draft = i.status === "draft";
  const total = Number(i.total);
  const vat = Number(i.vatTotal);
  const foreign = i.currencyCode !== "SAR";
  const rate = Number(i.exchangeRate);
  const qr = company.vatNumber
    ? await zatcaQrSvg({
        sellerName: company.nameAr,
        vatNumber: company.vatNumber,
        timestamp: (i.issuedAt ?? new Date(`${i.invoiceDate}T00:00:00+03:00`)).toISOString(),
        // الرمز بالريال دائماً
        total: Math.round(total * rate * 100) / 100,
        vatTotal: Math.round(vat * rate * 100) / 100,
      })
    : null;
  const address = companyAddress(company);
  const pad = compact ? "p-6" : "p-8 sm:p-10";

  return (
    <article className={`relative overflow-hidden rounded-2xl border border-black/[0.06] bg-white text-gray-800 shadow-[0_4px_16px_-8px_rgba(27,33,38,0.08)] print:rounded-none print:border-0 print:shadow-none ${pad}`}>
      {draft && (
        <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="-rotate-[24deg] font-display text-[7rem] font-bold text-gray-900/[0.04] select-none">مسودة</span>
        </div>
      )}

      {/* رأس الفاتورة: المنشأة بالعربي يميناً، الشعار وسطاً، بالإنجليزي يساراً */}
      <header className="grid grid-cols-[1fr_auto_1fr] items-start gap-4 text-xs leading-relaxed">
        <div>
          <div className="font-display text-lg font-semibold text-brand-900">{company.nameAr}</div>
          {address && <div className="text-gray-500">{address}</div>}
          {company.phone && <div className="ltr-nums text-gray-500">{company.phone}</div>}
          {company.email && <div className="text-gray-500">{company.email}</div>}
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
        <div className="flex justify-center">
          {company.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={company.logo} alt="" className="max-h-16 max-w-28 object-contain" />
          ) : (
            <LogoMark size={52} />
          )}
        </div>
        <div dir="ltr" className="text-left">
          <div className="font-display text-lg font-semibold text-brand-900">{company.nameEn || company.nameAr}</div>
          {[company.city, company.country === "SA" ? "Kingdom of Saudi Arabia" : company.country].filter(Boolean).join(", ")}
          {company.vatNumber && <div className="text-gray-600">VAT No. {company.vatNumber}</div>}
          {company.crNumber && <div className="text-gray-600">CR No. {company.crNumber}</div>}
        </div>
      </header>

      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-gray-200" />
        <h2 className="font-display text-xl font-semibold text-brand-900">
          فاتورة ضريبية <span className="font-sans text-base font-medium text-gray-500">Tax Invoice</span>
        </h2>
        <span className="h-px flex-1 bg-gray-200" />
      </div>

      {/* العميل وبيانات الفاتورة */}
      <section className="grid gap-x-6 rounded-xl border border-gray-200 text-xs sm:grid-cols-2">
        <dl className="divide-y divide-gray-100 border-gray-200 sm:border-e">
          {[
            ["العميل", "Customer", customer.nameAr],
            ["العنوان", "Address", customer.nationalAddress],
            ["الرقم الضريبي", "VAT No.", customer.vatNumber],
            ["السجل التجاري", "CR No.", customer.crNumber],
          ]
            .filter(([, , v]) => v)
            .map(([ar, en, v]) => (
              <div key={en} className="grid grid-cols-[6.5rem_1fr] gap-2 px-3 py-1.5">
                <dt className="text-gray-500">
                  {ar} <span className="text-[10px] opacity-70">{en}</span>
                </dt>
                <dd className={`font-medium ${en?.includes("No.") ? "ltr-nums" : ""}`}>{v}</dd>
              </div>
            ))}
        </dl>
        <dl className="divide-y divide-gray-100">
          {[
            ["رقم الفاتورة", "Invoice No.", i.number],
            ["تاريخ الإصدار", "Issue date", i.invoiceDate],
            ["تاريخ الاستحقاق", "Due date", i.dueDate],
            ["العملة", "Currency", foreign ? `${i.currencyCode} · سعر الصرف ${rate}` : i.currencyCode],
          ].map(([ar, en, v]) => (
            <div key={en} className="grid grid-cols-[6.5rem_1fr] gap-2 px-3 py-1.5">
              <dt className="text-gray-500">
                {ar} <span className="text-[10px] opacity-70">{en}</span>
              </dt>
              <dd className="ltr-nums font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* السطور */}
      <table className="mt-5 w-full text-xs">
        <thead className="bg-asphalt-900 text-white/90 print:bg-gray-100 print:text-gray-800">
          <tr>
            {[
              ["#", "No."],
              ["الوصف", "Description"],
              ["المبلغ الخاضع", "Taxable"],
              ["الضريبة %", "VAT %"],
              ["مبلغ الضريبة", "VAT"],
              ["الإجمالي", "Total"],
            ].map(([ar, en], k) => (
              <th key={en} className={`px-2.5 py-2 font-medium ${k > 1 ? "text-end" : "text-start"}`}>
                <Bi ar={ar} en={en} />
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
          ].map(([ar, en, v]) => (
            <div key={en} className="flex justify-between border-b border-gray-100 py-1.5">
              <dt className="text-gray-500">
                {ar} <span className="text-[10px] opacity-70">{en}</span>
              </dt>
              <dd className="ltr-nums">{fmt(v)}</dd>
            </div>
          ))}
          <div className="flex justify-between py-2 text-sm font-semibold text-brand-900">
            <dt>
              الإجمالي شامل الضريبة <span className="text-[10px] font-normal opacity-70">Total incl. VAT</span>
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
        <div className="flex flex-col items-center gap-1.5">
          {qr ? (
            <div className="size-28" dangerouslySetInnerHTML={{ __html: qr }} />
          ) : (
            <Link href="/settings/company" className="flex size-28 items-center justify-center rounded-lg border border-dashed border-gray-300 p-2 text-center text-[10px] text-gray-400 hover:border-brand-500 hover:text-brand-700 print:hidden">
              أدخل الرقم الضريبي للمنشأة ليظهر رمز الفاتورة
            </Link>
          )}
          {qr && <div className="max-w-40 text-center text-[9px] leading-tight text-gray-400">رمز وفق متطلبات هيئة الزكاة والضريبة والجمارك</div>}
        </div>
      </section>

      {i.notes && <p className="mt-4 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">{i.notes}</p>}
      <div aria-hidden className="mt-6 h-1.5 rounded-full bg-[repeating-linear-gradient(90deg,var(--color-brand-600)_0_18px,transparent_18px_30px)] opacity-70" />
    </article>
  );
}
