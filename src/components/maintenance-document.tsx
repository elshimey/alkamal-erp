import type { CSSProperties, ReactNode } from "react";
import type { CompanyProfile } from "@/lib/company";
import type { orderDoc, requestDoc } from "@/lib/maintenance";
import { DEFAULT_TEMPLATE, TEMPLATE_ACCENTS, type InvoiceTemplate } from "@/lib/invoice-template";
import { BREAKDOWN_APPROVAL_LIMIT, BREAKDOWN_STATUS, LINE_KINDS, MAINTENANCE_PROVIDERS, MAINTENANCE_STATUS, MAINTENANCE_TYPES, PRIORITIES } from "@/data/maintenance";
import { amountInWords } from "@/lib/tafqit";
import { LogoMark } from "@/components/logo";

const fmt = (v: string | number) => Number(v).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
type Order = NonNullable<Awaited<ReturnType<typeof orderDoc>>>;
type Request = NonNullable<Awaited<ReturnType<typeof requestDoc>>>;

function Frame({ company, template: t, compact, title, en, meta, children, signatures }: { company: CompanyProfile; template: InvoiceTemplate; compact: boolean; title: string; en: string; meta: [string, string][]; children: ReactNode; signatures: string[] }) {
  const accent = TEMPLATE_ACCENTS[t.accent];
  const vars = { "--inv-accent": accent.main, "--inv-dark": accent.dark } as CSSProperties;
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
          {title} <span className="font-sans text-sm font-medium text-gray-400">{en}</span>
        </h2>
        <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-xs">
          {meta.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-gray-500">{k}</dt>
              <dd className="ltr-nums font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      {children}
      <footer className="mt-10 grid grid-cols-3 gap-6 text-center text-xs text-gray-500">
        {signatures.map((label) => (
          <div key={label}>
            <div className="mb-1 h-10 border-b border-dashed border-gray-300" />
            {label}
          </div>
        ))}
      </footer>
    </article>
  );
}

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="divide-y divide-gray-100 rounded-xl border border-gray-200 text-sm">
      {rows
        .filter((r) => r[1])
        .map(([k, val]) => (
          <div key={k} className="grid grid-cols-[9rem_1fr] gap-3 px-4 py-2">
            <dt className="text-gray-500">{k}</dt>
            <dd>
              <bdi>{val}</bdi>
            </dd>
          </div>
        ))}
    </dl>
  );
}

/** أمر الصيانة: المركبة والجهة وبنود القطع وشغل اليد، والإجمالي وحالة القيد. */
export function MaintenanceOrderDocument({ company, doc, template = DEFAULT_TEMPLATE, compact = false }: { company: CompanyProfile; doc: Order; template?: InvoiceTemplate; compact?: boolean }) {
  const { o } = doc;
  return (
    <Frame
      company={company}
      template={template}
      compact={compact}
      title="أمر صيانة"
      en="Maintenance Order"
      meta={[
        ["الرقم", o.number],
        ["التاريخ", o.orderDate],
        ["الحالة", MAINTENANCE_STATUS[o.status].label],
      ]}
      signatures={["الفني / الورشة", "مسؤول الأسطول", "المدير"]}
    >
      <Facts
        rows={[
          ["المركبة", doc.plate],
          ["نوع الصيانة", MAINTENANCE_TYPES[o.type]],
          ["الجهة", doc.supplier ?? MAINTENANCE_PROVIDERS.internal],
          ["فاتورة الورشة", o.supplierInvoiceNo],
          ["الدفع من", doc.cash],
          ["قراءة العداد", o.odometer != null ? `${o.odometer.toLocaleString("en")} كم` : null],
          ["المصدر", doc.request ? `طلب عطل ${doc.request.number}: ${doc.request.description}` : doc.plan ? `صيانة دورية: ${doc.plan}` : null],
          ["تاريخ الإكمال", o.completedDate],
          ["القيد", doc.entry],
          ["ملاحظات", o.notes],
        ]}
      />
      <table className="mt-5 w-full text-sm">
        <thead>
          <tr className="bg-[var(--inv-dark)] text-white print:[print-color-adjust:exact]">
            {["#", "البند", "النوع", "الكمية", "السعر", "المبلغ", "الضريبة", "الإجمالي"].map((h) => (
              <th key={h} className="px-2 py-2 text-start text-xs font-medium first:rounded-s-lg last:rounded-e-lg">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {doc.lines.length === 0 && (
            <tr>
              <td colSpan={8} className="px-2 py-4 text-center text-gray-400">
                لا توجد بنود بعد
              </td>
            </tr>
          )}
          {doc.lines.map(({ l, product, warehouse }) => (
            <tr key={l.id}>
              <td className="ltr-nums px-2 py-2 text-gray-400">{l.lineNo}</td>
              <td className="px-2 py-2">
                {l.description}
                {warehouse && (
                  <div className="text-xs text-gray-500">
                    من {warehouse}
                    {product && <span className="ltr-nums"> · {product}</span>}
                  </div>
                )}
              </td>
              <td className="px-2 py-2 text-xs">{LINE_KINDS[l.kind]}</td>
              <td className="ltr-nums px-2 py-2">{Number(l.quantity)}</td>
              <td className="ltr-nums px-2 py-2">{fmt(l.unitPrice)}</td>
              <td className="ltr-nums px-2 py-2">{fmt(l.amount)}</td>
              <td className="ltr-nums px-2 py-2 text-gray-500">{fmt(l.vatAmount)}</td>
              <td className="ltr-nums px-2 py-2 font-semibold">{fmt(Number(l.amount) + Number(l.vatAmount))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-4 flex justify-end">
        <dl className="w-64 text-sm">
          <div className="flex justify-between py-1">
            <dt className="text-gray-500">قبل الضريبة</dt>
            <dd className="ltr-nums">{fmt(o.subtotal)}</dd>
          </div>
          <div className="flex justify-between py-1">
            <dt className="text-gray-500">الضريبة</dt>
            <dd className="ltr-nums">{fmt(o.vatTotal)}</dd>
          </div>
          <div className="mt-1 flex justify-between rounded-lg bg-[var(--inv-dark)] px-3 py-2 font-semibold text-white print:[print-color-adjust:exact]">
            <dt>الإجمالي</dt>
            <dd className="ltr-nums">
              {fmt(o.total)} <span className="text-xs text-[var(--inv-accent)]">{o.currencyCode}</span>
            </dd>
          </div>
        </dl>
      </div>
      {Number(o.total) > 0 && <p className="mt-3 text-xs text-gray-600">{amountInWords(Number(o.total), o.currencyCode === "KWD" ? "KWD" : "SAR")}</p>}
    </Frame>
  );
}

/** بلاغ العطل: المركبة والسائق والوصف، ومسار المراجعة والاعتماد وأمر الصيانة الناتج. */
export function BreakdownRequestDocument({ company, doc, template = DEFAULT_TEMPLATE, compact = false }: { company: CompanyProfile; doc: Request; template?: InvoiceTemplate; compact?: boolean }) {
  const { r } = doc;
  const cost = r.estimatedCost != null ? Number(r.estimatedCost) : null;
  return (
    <Frame
      company={company}
      template={template}
      compact={compact}
      title="بلاغ عطل"
      en="Breakdown Report"
      meta={[
        ["الرقم", r.number],
        ["التاريخ", r.reportDate],
        ["الحالة", BREAKDOWN_STATUS[r.status].label],
      ]}
      signatures={["السائق", "المشرف", "المدير"]}
    >
      <Facts
        rows={[
          ["المركبة", doc.plate],
          ["السائق", doc.driver],
          ["الأولوية", PRIORITIES[r.priority].label],
          ["وصف العطل", r.description],
          ["التكلفة التقديرية", cost != null ? `${fmt(cost)} ر.س` : "لم تُحدد بعد"],
          ["مسار الاعتماد", cost == null ? null : cost > BREAKDOWN_APPROVAL_LIMIT ? `أكثر من ${BREAKDOWN_APPROVAL_LIMIT.toLocaleString("en")} ر.س: المشرف ثم المدير` : "ضمن صلاحية المشرف"],
          ["راجعه", doc.reviewer],
          ["اعتمده", doc.approver],
          ["سبب الرفض", r.rejectReason],
          ["أمر الصيانة", doc.order?.id ? `${doc.order.number} (${MAINTENANCE_STATUS[doc.order.status!].label}) بمبلغ ${fmt(doc.order.total ?? 0)}` : null],
        ]}
      />
    </Frame>
  );
}
