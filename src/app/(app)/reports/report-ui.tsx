import Link from "next/link";
import type { ReactNode } from "react";
import { presetRanges } from "@/lib/reports";
import { getBrand } from "@/lib/brand";
import { ExportButton } from "@/components/export-button";
import { PrintButton } from "@/components/print-button";

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

export async function ReportHeader({ title, period, filename, children }: { title: string; period: string; filename: string; children?: ReactNode }) {
  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/reports" className="text-xs text-brand-700 hover:underline print:hidden">
            ← التقارير
          </Link>
          <h1 className="mt-1 flex items-center gap-3 text-2xl font-semibold text-brand-900">
            <span className="h-7 w-1.5 rounded-full bg-brand-600 print:hidden" />
            {title}
          </h1>
          <p className="mt-1 ps-4.5 text-sm text-gray-500">
            <span className="hidden font-semibold text-gray-800 print:inline">{(await getBrand()).name} · </span>
            {period} · بالريال السعودي، من القيود المرحّلة فقط
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
          <input type="date" name="from" defaultValue={from} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </label>
      )}
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-gray-700">{asOf ? "في تاريخ" : "إلى"}</span>
        <input type="date" name="to" defaultValue={to} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
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
      <table data-report={name} className="w-full text-sm">
        <thead className="bg-asphalt-900 text-white/85 print:bg-white print:text-black">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="border-black/20 px-4 py-3 text-start font-medium whitespace-nowrap print:border-b print:px-2 print:py-1.5">
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
  return <td colSpan={colSpan} className={`px-4 py-2.5 print:px-2 print:py-1 ${num ? "ltr-nums text-end whitespace-nowrap" : ""} ${className}`}>{children}</td>;
}
