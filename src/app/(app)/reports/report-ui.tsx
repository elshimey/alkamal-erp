import Link from "next/link";
import type { ReactNode } from "react";
import { presetRanges } from "@/lib/reports";
import { getBrand } from "@/lib/brand";
import { ExportButton } from "@/components/export-button";
import { PrintButton } from "@/components/print-button";
import { DateInput } from "@/components/date-input";

// عناصر مشتركة لصفحات التقارير: الترويسة وأزرار التصدير والطباعة ومرشح الفترة والجدول

const ISO = /^\d{4}-\d{2}-\d{2}$/;
type Params = Record<string, string | string[] | undefined>;
export const param = (sp: Params, key: string) => {
  const v = sp[key];
  return typeof v === "string" ? v : undefined;
};

/** الفترة من الرابط، وافتراضياً من أول السنة حتى اليوم. */
export function periodFrom(sp: Params, today: string) {
  const from = param(sp, "from");
  const to = param(sp, "to");
  const valid = (v?: string) => (v && ISO.test(v) && !Number.isNaN(Date.parse(v)) ? v : undefined);
  const f = valid(from) ?? `${today.slice(0, 4)}-01-01`;
  const t = valid(to) ?? today;
  return f <= t ? { from: f, to: t } : { from: t, to: f };
}

/** المبلغ بالريال، والسالب بين قوسين كما في القوائم المالية. */
export const money = (v: number, dashZero = true) => {
  if (dashZero && Math.abs(v) < 0.005) return "—";
  const s = Math.abs(v).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `(${s})` : s;
};

/** مصدر القيد: اسم المستند ورابطه (كشف الحساب والأستاذ العام وكشف العميل والمورد). */
export const SOURCE: Record<string, { label: string; href?: (id: number) => string }> = {
  waybill: { label: "شحنة", href: (id) => `/waybills/${id}` },
  waybill_charge: { label: "مصروف على شحنة" },
  invoice_charge: { label: "مصروف على فاتورة", href: (id) => `/invoices/${id}` },
  sales_invoice: { label: "فاتورة", href: (id) => `/invoices/${id}` },
  adjustment_note: { label: "إشعار دائن/مدين" },
  receipt: { label: "سند قبض" },
  purchase_invoice: { label: "فاتورة مورد", href: (id) => `/purchases/${id}` },
  expense: { label: "مصروف" },
  payment: { label: "سند صرف" },
  maintenance_order: { label: "أمر صيانة", href: (id) => `/maintenance/${id}` },
  payroll_run: { label: "مسير", href: (id) => `/payroll/${id}` },
  payroll_payment: { label: "صرف رواتب", href: (id) => `/payroll/${id}` },
  employee_advance: { label: "سلفة" },
  fixed_asset: { label: "أصل ثابت", href: (id) => `/fixed-assets?open=${id}` },
  traffic_violation: { label: "مخالفة" },
  violation_payment: { label: "سداد مخالفة" },
  cash_transfer: { label: "تحويل بين الحسابات" },
  custody: { label: "عهدة" },
  custody_close: { label: "تسوية عهدة" },
  stock_doc: { label: "مستند مخزني" },
  ecl: { label: "مخصص ديون" },
  year_close: { label: "إقفال السنة" },
};

export function SourceLink({ type, id }: { type: string | null; id: number | null }) {
  const src = type ? SOURCE[type] : undefined;
  if (src?.href && id) {
    return (
      <a href={src.href(Number(id))} className="text-brand-700 hover:underline">
        {src.label}
      </a>
    );
  }
  return <>{src?.label ?? "قيد يدوي"}</>;
}

/**
 * ترويسة التقرير: على الشاشة العنوان وأزرار التصدير والطباعة والمرشحات، وفي الطباعة شعار الشركة واسمها والعنوان والفترة،
 * وأرقام الصفحات أسفل كل صفحة، وwide يطبع التقرير العريض بالعرض.
 */
export async function ReportHeader({ title, period, filename, children, wide = false, note = "بالريال السعودي، من القيود المرحّلة فقط" }: { title: string; period: string; filename: string; children?: ReactNode; wide?: boolean; note?: string }) {
  const brand = await getBrand();
  return (
    <div className="mb-6">
      <style>{`@media print { @page { size: A4 ${wide ? "landscape" : "portrait"}; margin: 12mm 10mm 14mm; @bottom-center { content: "صفحة " counter(page) " من " counter(pages); font-size: 9px; color: #555; } } }`}</style>
      <div className="mb-3 hidden items-center justify-between gap-4 border-b-2 border-gray-800 pb-2 print:flex">
        <div className="flex items-center gap-3">
          {brand.logo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brand.logo} alt="" className="h-12 max-w-32 object-contain" />
          )}
          <span className="text-base font-bold text-gray-900">{brand.name}</span>
        </div>
        <span className="text-xs text-gray-600">طُبع في {new Date().toLocaleDateString("en-GB", { timeZone: "Asia/Riyadh" })}</span>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/reports" className="text-xs text-brand-700 hover:underline print:hidden">
            ← التقارير
          </Link>
          <h1 className="mt-1 flex items-center gap-3 text-2xl font-semibold text-brand-900 print:mt-0 print:text-lg print:text-black">
            <span className="h-7 w-1.5 rounded-full bg-brand-600 print:hidden" />
            {title}
          </h1>
          <p className="mt-1 ps-4.5 text-sm text-gray-500 print:ps-0 print:text-gray-700">
            {period}
            {note && ` · ${note}`}
          </p>
        </div>
        <div className="flex gap-2 print:hidden">
          <ExportButton filename={filename} />
          <PrintButton />
        </div>
      </div>
      {children && <div className="mt-5 print:hidden">{children}</div>}
    </div>
  );
}

export function PeriodFilter({ from, to, today, asOf = false, children }: { from: string; to: string; today: string; asOf?: boolean; children?: ReactNode }) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-3 rounded-2xl border border-black/[0.06] bg-white p-4 shadow-sm">
      {!asOf && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-gray-700">من</span>
          <DateInput name="from" defaultValue={from} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </label>
      )}
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-gray-700">{asOf ? "في تاريخ" : "إلى"}</span>
        <DateInput name="to" defaultValue={to} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
      </label>
      {children}
      <button className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-brand-900 hover:bg-brand-500">عرض</button>
      {!asOf && (
        <div className="flex flex-wrap gap-1.5 ps-2">
          {presetRanges(today).map((p) => (
            <PresetLink key={p.key} from={p.from} to={p.to} active={p.from === from && p.to === to} label={p.label} />
          ))}
        </div>
      )}
    </form>
  );
}

function PresetLink({ from, to, label, active }: { from: string; to: string; label: string; active: boolean }) {
  return (
    <Link
      href={`?from=${from}&to=${to}`}
      className={`rounded-full px-3 py-1 text-xs transition ${active ? "bg-asphalt-900 font-semibold text-brand-500" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
    >
      {label}
    </Link>
  );
}

export function RTable({ name, head, children, className = "" }: { name: string; head: ReactNode[]; children: ReactNode; className?: string }) {
  return (
    <div className={`overflow-x-auto rounded-2xl border border-black/[0.06] bg-white shadow-[0_4px_16px_-8px_rgba(27,33,38,0.08)] print:overflow-visible print:rounded-none print:border-0 print:shadow-none ${className}`}>
      <table data-report={name} className="w-full text-sm print:border-collapse print:text-[10px]">
        <thead className="bg-asphalt-900 text-white/85 print:table-header-group print:bg-white print:text-black">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="px-4 py-3 text-start font-medium whitespace-nowrap print:border print:border-gray-500 print:bg-gray-100 print:px-2 print:py-1.5">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">{children}</tbody>
      </table>
    </div>
  );
}

export function C({ children, className = "", num = false, colSpan }: { children?: ReactNode; className?: string; num?: boolean; colSpan?: number }) {
  return <td colSpan={colSpan} className={`px-4 py-2.5 print:border print:border-gray-400 print:px-2 print:py-1 ${num ? "ltr-nums text-end whitespace-nowrap" : ""} ${className}`}>{children}</td>;
}

/** أزرار التبديل داخل التقرير (العملاء / الموردون، ملخص / تفاصيل). */
export function ReportTabs({ items }: { items: { href: string; label: string; active: boolean }[] }) {
  return (
    <div className="mb-4 flex flex-wrap gap-1.5 print:hidden">
      {items.map((t) => (
        <Link key={t.href} href={t.href} className={`rounded-full px-4 py-1.5 text-sm transition ${t.active ? "bg-asphalt-900 font-semibold text-brand-500" : "bg-white text-gray-600 shadow-sm hover:bg-gray-100"}`}>
          {t.label}
        </Link>
      ))}
    </div>
  );
}

/** رابط بنفس معاملات الصفحة مع تغيير بعضها. */
export function withParams(sp: Params, changes: Record<string, string | null>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v) q.set(k, v);
  for (const [k, v] of Object.entries(changes)) {
    if (v) q.set(k, v);
    else q.delete(k);
  }
  const s = q.toString();
  return s ? `?${s}` : "?";
}

export type ReportParams = Params;
