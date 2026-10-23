import type { CSSProperties } from "react";
import type { CompanyProfile } from "@/lib/company";
import type { violationDoc } from "@/lib/violations";
import { DEFAULT_TEMPLATE, TEMPLATE_ACCENTS, type InvoiceTemplate } from "@/lib/invoice-template";
import { amountInWords } from "@/lib/tafqit";
import { LogoMark } from "@/components/logo";
import { fmt } from "@/lib/format";

type Doc = NonNullable<Awaited<ReturnType<typeof violationDoc>>>;

/** إشعار المخالفة المرورية: المركبة والسائق ومن يتحملها، وحالة السداد والخصم من الراتب. */
export function ViolationDocument({ company, doc, template: t = DEFAULT_TEMPLATE, compact = false }: { company: CompanyProfile; doc: Doc; template?: InvoiceTemplate; compact?: boolean }) {
  const { v } = doc;
  const accent = TEMPLATE_ACCENTS[t.accent];
  const vars = { "--inv-accent": accent.main, "--inv-dark": accent.dark } as CSSProperties;
  const rows: [string, string | null | undefined][] = [
    ["المركبة", doc.plate],
    ["السائق", doc.driver ?? "—"],
    ["نوع المخالفة", v.violationType],
    ["الموقع", v.location],
    ["رقم المخالفة لدى المرور", v.reference],
    ["تتحملها", v.chargeTo === "driver" ? "السائق (تُخصم من راتبه)" : "الشركة (مصروف على المركبة)"],
    ["الخصم من الراتب", v.chargeTo === "company" ? null : doc.run ? `${doc.runStatus === "draft" ? "في مسودة" : "خُصمت في"} ${doc.run}` : "بانتظار المسير"],
    ["قيد التسجيل", doc.entry],
    ["السداد للمرور", v.status === "paid" ? `${v.paymentDate} من ${doc.cashAccount ?? ""} (${doc.paymentEntry ?? ""})` : "غير مسددة"],
    ["ملاحظات", v.notes],
  ];
  return (
    <article style={vars} className={`relative overflow-hidden rounded-2xl border border-black/[0.06] bg-white text-gray-800 shadow-[0_4px_16px_-8px_rgba(27,33,38,0.08)] print:rounded-none print:border-0 print:shadow-none ${compact ? "p-6" : "p-8 sm:p-10"}`}>
      <header className="flex items-start justify-between gap-4 border-b-2 border-[var(--inv-accent)] pb-4">
        <div className="font-display text-lg font-semibold text-[var(--inv-dark)]">{company.nameAr}</div>
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
          مخالفة مرورية <span className="font-sans text-sm font-medium text-gray-400">Traffic Violation</span>
        </h2>
        <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-xs">
          <dt className="text-gray-500">الرقم</dt>
          <dd className="ltr-nums font-semibold">{v.number}</dd>
          <dt className="text-gray-500">التاريخ</dt>
          <dd className="ltr-nums">{v.violationDate}</dd>
        </dl>
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <dl className="divide-y divide-gray-100 rounded-xl border border-gray-200 text-sm">
          {rows
            .filter((r) => r[1])
            .map(([k, val]) => (
              <div key={k} className="grid grid-cols-[10rem_1fr] gap-3 px-4 py-2">
                <dt className="text-gray-500">{k}</dt>
                <dd>
                  <bdi>{val}</bdi>
                </dd>
              </div>
            ))}
        </dl>
        <div className="flex min-w-40 flex-col items-center justify-center self-start rounded-xl bg-[var(--inv-dark)] px-5 py-4 text-white print:[print-color-adjust:exact]">
          <span className="text-[11px] text-white/70">المبلغ</span>
          <span className="ltr-nums font-display text-2xl font-semibold">{fmt(v.amount)}</span>
          <span className="text-xs text-[var(--inv-accent)]">SAR</span>
        </div>
      </div>
      <p className="mt-3 text-xs text-gray-600">{amountInWords(Number(v.amount), "SAR")}</p>
      <footer className="mt-10 grid grid-cols-3 gap-6 text-center text-xs text-gray-500">
        {[v.chargeTo === "driver" ? "توقيع السائق بالعلم" : "مسؤول الأسطول", "المحاسب", "المدير"].map((label) => (
          <div key={label}>
            <div className="mb-1 h-10 border-b border-dashed border-gray-300" />
            {label}
          </div>
        ))}
      </footer>
    </article>
  );
}
