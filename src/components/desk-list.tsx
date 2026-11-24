import Link from "next/link";
import type { ReactNode } from "react";
import { fmtDate } from "@/lib/format";
import { ActionButton, type MenuItem } from "./actions-menu";
import { TruckGlyph } from "./doc-card";
import { Badge } from "./ui";

/**
 * شكل قوائم المستندات على الكمبيوتر (الخطوة 3 من خطة «توحيد الفاتورة مع الشحنة»، اعتمدها أحمد 2026-11-23):
 * كل صف يُقرأ مثل بطاقة الجوال: الرقم وتحته التاريخ، والجهة وتحتها المسار، والمبلغ، والحالة بسطرها،
 * وزر «الخطوة التالية» (أصفر لما ينتظر إجراءً)، وخط بلون الحالة على حافة الصف.
 * أي قائمة مستندات جديدة على الكمبيوتر تُبنى بهذه المكونات.
 */

export type Tone = "gray" | "blue" | "amber" | "green" | "red";

const EDGE: Record<Tone, string> = {
  gray: "bg-st-neutral-dot",
  blue: "bg-st-info-dot",
  amber: "bg-st-warn-dot",
  green: "bg-st-ok-dot",
  red: "bg-st-bad-dot",
};

/** آخر خلية في الصف: خط بلون الحالة على حافته */
export function EdgeCell({ tone }: { tone: Tone }) {
  return (
    <td aria-hidden className="w-1 !p-0 print:hidden">
      <i className={`block h-11 w-1 rounded-s-[4px] ${EDGE[tone]}`} />
    </td>
  );
}

/** عنوان خلية الحافة في رأس الجدول (فارغ) */
export const EDGE_HEAD = "";

/** خانة صغيرة تحت النص الرئيسي في الخلية */
export function Sub({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`mt-0.5 block text-xs font-normal text-gray-500 ${className}`}>{children}</span>;
}

/** الرقم (رابط المعاينة) وتحته التاريخ يوم/شهر/سنة */
export function NumDateCell({ number, date, href, extra, kid }: { number: string; date: string | null; href?: string; extra?: ReactNode; kid?: "mid" | "last" }) {
  // kid: شحنة داخل صف مدمج، مزاحة بخط متقطع يربطها بصف الفاتورة
  const tree = kid
    ? `relative !ps-12 before:absolute before:top-0 before:start-7 before:border-s-2 before:border-dashed before:border-[#d7cba8] ${kid === "last" ? "before:h-1/2" : "before:bottom-0"} after:absolute after:top-1/2 after:start-7 after:w-3.5 after:border-t-2 after:border-dashed after:border-[#d7cba8]`
    : "";
  return (
    <td className={`px-4 py-2.5 whitespace-nowrap ${tree}`}>
      {href ? (
        <Link href={href} scroll={false} className="ltr-nums font-semibold text-asphalt-900 hover:text-brand-700 hover:underline">
          {number}
        </Link>
      ) : (
        <span className="ltr-nums font-semibold text-asphalt-900">{number}</span>
      )}
      <Sub>
        <span className="ltr-nums">{date ? fmtDate(date) : "—"}</span>
        {extra}
      </Sub>
    </td>
  );
}

/** المسار بشاحنة صغيرة ووسم الضريبة (دولي صفري أو داخلي 15%) */
export function RouteLine({ from, to, international }: { from?: string | null; to?: string | null; international?: boolean }) {
  if (!from && !to) return null;
  return (
    <span className="mt-0.5 flex items-center gap-1.5 text-xs whitespace-nowrap text-gray-500">
      <span className="max-w-32 truncate">{from}</span>
      <span className="relative inline-flex w-12 shrink-0 items-center" aria-hidden>
        <span className="h-px w-full border-t border-dashed border-gray-300" />
        <TruckGlyph className="absolute left-1/2 w-5 -translate-x-1/2" />
      </span>
      <span className="max-w-32 truncate">{to}</span>
      {international !== undefined && (
        <span className={`rounded px-1 text-[10.5px] ${international ? "bg-sky-50 text-sky-800" : "bg-amber-50 text-amber-800"}`}>{international ? "دولي · صفر" : "داخلي · 15%"}</span>
      )}
    </span>
  );
}

/** الحالة بشارتها وسطر صغير تحتها */
export function StatusCell({ status, sub, children }: { status: { label: string; tone: Tone }; sub?: ReactNode; children?: ReactNode }) {
  return (
    <td className="px-4 py-2.5">
      <Badge tone={status.tone}>{status.label}</Badge>
      {sub && <Sub className={status.tone === "red" ? "max-w-48 truncate text-red-600" : "whitespace-nowrap"}>{sub}</Sub>}
      {children}
    </td>
  );
}

const nextBase = "inline-flex h-8 items-center gap-1.5 rounded-[9px] px-3 text-[12.5px] font-semibold whitespace-nowrap transition disabled:opacity-60";
const nextGo = `${nextBase} bg-brand-600 text-asphalt-900 hover:bg-brand-500`;
const nextPlain = `${nextBase} border border-gray-200 bg-white text-gray-700 hover:bg-gray-50`;

/**
 * زر «الخطوة التالية» في الصف: نفس بند قائمة العمليات (نفس التأكيد والرسالة) باسم قصير.
 * go = ينتظر إجراءً منا (أصفر). دون بند يظهر نص هادئ (اكتملت، عند السائق…).
 */
export function NextStepCell({ item, label, go, note, href }: { item?: MenuItem | null; label?: string; go?: boolean; note?: string | null; href?: string }) {
  return (
    <td className="px-4 py-2.5 print:hidden">
      {href && label ? (
        <Link href={href} className={go ? nextGo : nextPlain}>
          {label}
        </Link>
      ) : item ? (
        <ActionButton item={{ ...item, label: label ?? item.label, icon: undefined }} className={go ? nextGo : nextPlain} />
      ) : note ? (
        <span className="text-xs whitespace-nowrap text-gray-400">{note}</span>
      ) : null}
    </td>
  );
}

/**
 * أزرار الحالات تحت العنوان: على الكمبيوتر تبويبات بخط سفلي وعددها (الأصفر = ينتظر إجراءً) والإجمالي في آخرها،
 * وعلى الجوال أزرار تُسحب جانبياً كما هي.
 */
export function StatusTabs({
  label,
  tabs,
  summary,
}: {
  label: string;
  tabs: { key: string; label: string; href: string; count?: number; attn?: boolean; active: boolean }[];
  summary?: ReactNode;
}) {
  return (
    <nav
      aria-label={label}
      className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1 text-sm [scrollbar-width:none] md:mx-0 md:items-end md:gap-1 md:overflow-visible md:border-b md:border-gray-200 md:px-0 md:pb-0 [&::-webkit-scrollbar]:hidden print:mx-0 print:flex-wrap print:overflow-visible print:px-0"
    >
      {tabs.map((t) => {
        const attn = !!t.attn && (t.count ?? 0) > 0;
        return (
          <Link
            key={t.key || "all"}
            href={t.href}
            scroll={false}
            aria-current={t.active ? "page" : undefined}
            className={`relative flex shrink-0 items-center gap-2 rounded-full px-3.5 py-1.5 whitespace-nowrap transition max-md:h-9 md:rounded-none md:bg-transparent md:px-3 md:pt-2.5 md:pb-3 md:shadow-none md:ring-0 ${
              t.active
                ? "bg-asphalt-900 font-semibold text-brand-500 md:text-asphalt-900 md:after:absolute md:after:inset-x-2 md:after:-bottom-px md:after:h-[3px] md:after:rounded-t-[3px] md:after:bg-brand-600"
                : `bg-white text-gray-600 shadow-sm hover:bg-brand-50 md:hover:bg-transparent md:hover:text-asphalt-900 ${attn ? "ring-1 ring-brand-500" : ""}`
            }`}
          >
            {t.label}
            {t.count !== undefined && (
              <span
                className={`ltr-nums grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-xs font-semibold ${
                  attn ? "bg-brand-500 text-brand-900" : t.active ? "bg-white/10 md:bg-[#e7e3d9] md:text-gray-700" : "bg-gray-100 md:bg-[#e7e3d9] md:text-gray-700"
                }`}
              >
                {t.count}
              </span>
            )}
          </Link>
        );
      })}
      {summary && <span className="ms-auto hidden shrink-0 pb-2 text-[12.5px] text-gray-500 md:block">{summary}</span>}
    </nav>
  );
}

/** المحصّل من المبلغ: شريط صغير والباقي تحته */
export function PaidBar({ total, paid }: { total: number; paid: number }) {
  const pct = total > 0 ? Math.max(0, Math.min(100, (paid / total) * 100)) : 0;
  return (
    <span className="mt-1.5 block h-[5px] w-28 overflow-hidden rounded bg-[#ebe7de]" aria-hidden>
      <i className="block h-full bg-st-ok-dot" style={{ width: `${pct}%` }} />
    </span>
  );
}

/**
 * شريط العمليات العائم أسفل الشاشة يظهر عند تحديد صف أو أكثر (بدل مربع التلميح الثابت).
 * القوائم المنسدلة داخله تُفتح لأعلى.
 */
export function BulkBar({ children }: { children: ReactNode }) {
  return (
    <div
      role="toolbar"
      aria-label="عمليات المحدد"
      className="animate-rise fixed inset-x-0 bottom-14 z-[60] print:hidden mx-auto flex w-fit max-w-[calc(100vw-2rem)] flex-wrap items-center gap-2 rounded-2xl bg-asphalt-900 px-3.5 py-2 text-white shadow-[0_18px_40px_-12px_rgba(0,0,0,0.5)] print:hidden [&>div>.text-brand-900]:text-brand-500 [&>div>.text-gray-500]:text-white/60"
    >
      {children}
    </div>
  );
}
