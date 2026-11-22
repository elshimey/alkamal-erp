import Link from "next/link";
import type { ReactNode } from "react";
import { fmtDate } from "@/lib/format";
import { Badge } from "./ui";

type Tone = "gray" | "blue" | "amber" | "green" | "red";

// الخط الملون على حافة البطاقة بلون الحالة نفسه (ألوان st-* في globals.css)
const STRIPE: Record<Tone, string> = {
  gray: "before:bg-st-neutral-dot",
  blue: "before:bg-st-info-dot",
  amber: "before:bg-st-warn-dot",
  green: "before:bg-st-ok-dot",
  red: "before:bg-st-bad-dot",
};

/** شاحنة صغيرة على خط المسار (نفس شاحنة الهوية) */
export function TruckGlyph({ className = "w-6", muted = false }: { className?: string; muted?: boolean }) {
  return (
    <svg viewBox="0 0 72 30" className={className} aria-hidden="true">
      <rect x="22" y="3" width="48" height="18" rx="1.5" fill={muted ? "#c9c4b8" : "#e9a100"} />
      <path d="M3 21v-7.5L8.5 6H20v15Z" fill="#303a42" />
      <path d="M6 13 10 8h6.5v5Z" fill="#9fd3e6" />
      <circle cx="11" cy="25" r="4.2" fill="#1b2126" />
      <circle cx="48" cy="25" r="4.2" fill="#1b2126" />
      <circle cx="61" cy="25" r="4.2" fill="#1b2126" />
    </svg>
  );
}

/** اللوحة في إطار صغير يشبه لوحة المركبة */
export function Plate({ children }: { children: ReactNode }) {
  return <span className="inline-flex h-[22px] shrink-0 items-center rounded-[5px] border-[1.5px] border-asphalt-600 bg-white px-1.5 text-[11px] font-semibold whitespace-nowrap text-asphalt-900">{children}</span>;
}

/** قائمة بطاقات المستندات على الجوال فقط؛ الكمبيوتر يبقى جدولاً. */
export function DocCards({ children, empty }: { children: ReactNode; empty?: ReactNode }) {
  const has = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <div data-doc-cards className="flex flex-col gap-2.5 md:hidden">
      {has ? children : <p className="rounded-2xl bg-white px-4 py-10 text-center text-sm text-gray-500 shadow-sm">{empty}</p>}
    </div>
  );
}

/**
 * بطاقة مستند على الجوال (قرار أحمد 2026-11-22): الرقم والحالة والتاريخ أعلاها، ثم الجهة،
 * ثم المسار (للشحنات)، ثم سطر صغير بالتفاصيل (اللوحة والسائق)، والمبلغ واضحاً مع الخطوة التالية.
 * لمسها يفتح المعاينة التي تصعد من الأسفل (رابط ?open=).
 * دون href تصبح بطاقة ثابتة وأزرارها (actions) تحتها مباشرة، مثل طلبات الشراء (اعتماد، رفض، إصدار أمر شراء).
 */
export function DocCard({
  href,
  number,
  status,
  extraBadge,
  date,
  party,
  route,
  meta,
  amount,
  currency,
  next,
  active,
  actions,
}: {
  href?: string;
  number: string;
  status: { label: string; tone: Tone };
  extraBadge?: { label: string; tone: Tone } | null;
  date: string;
  party: ReactNode;
  route?: { from: string; to: string; international?: boolean } | null;
  meta?: ReactNode;
  amount?: string | null;
  currency?: string;
  next?: string | null;
  active?: boolean;
  /** أزرار البطاقة (للبطاقة دون href فقط، لأن النموذج لا يوضع داخل رابط) */
  actions?: ReactNode;
}) {
  const cls = `relative block overflow-hidden rounded-[18px] bg-white px-3.5 pt-3.5 pb-3 shadow-[0_1px_2px_rgba(27,33,38,0.06),0_4px_14px_-6px_rgba(27,33,38,0.14)] transition before:absolute before:inset-y-3.5 before:right-0 before:w-[3px] before:rounded-e-[3px] ${STRIPE[status.tone]}`;
  const body = (
    <>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="ltr-nums font-display text-sm font-semibold whitespace-nowrap text-brand-900">{number}</span>
        <Badge tone={status.tone}>{status.label}</Badge>
        {extraBadge && <Badge tone={extraBadge.tone}>{extraBadge.label}</Badge>}
        <span className="ltr-nums ms-auto shrink-0 text-[11.5px] text-gray-500">{fmtDate(date)}</span>
      </div>
      <div className="mt-2.5 truncate text-[15px] font-semibold text-gray-900">{party}</div>
      {route && (
        <div className="mt-2 flex items-center gap-2 text-[13px] text-gray-700">
          <span className="truncate">{route.from}</span>
          <span className="relative h-0.5 min-w-6 flex-1 bg-[linear-gradient(to_left,var(--color-brand-600)_55%,transparent_0)] bg-[length:10px_2px]">
            <TruckGlyph className="absolute -top-2 left-1/2 w-6 -translate-x-1/2" />
          </span>
          <span className="truncate">{route.to}</span>
          {route.international && <span className="shrink-0 rounded-md bg-st-info-bg px-1.5 text-[10.5px] font-semibold text-st-info-fg">دولي</span>}
        </div>
      )}
      {meta && <div className="mt-2 flex min-w-0 items-center gap-2.5 text-xs text-gray-500">{meta}</div>}
      {(amount != null || next) && (
        <div className="mt-3 flex items-center gap-2 border-t border-dashed border-gray-200 pt-2.5">
          {amount != null && (
            <span className="ltr-nums font-display text-[19px] font-semibold text-brand-900">
              {amount}
              {currency && <small className="ms-1 font-sans text-[11px] font-medium text-gray-500">{currency}</small>}
            </span>
          )}
          {next && <span className="ms-auto rounded-lg bg-brand-50 px-2 py-1 text-[11.5px] font-semibold text-brand-700">{next}</span>}
        </div>
      )}
    </>
  );
  if (!href)
    return (
      <div data-doc-card className={cls}>
        {body}
        {actions && <div className="mt-3 flex flex-wrap items-start gap-2 [&>*]:min-w-[8rem] [&>*]:flex-1">{actions}</div>}
      </div>
    );
  return (
    <Link href={href} scroll={false} aria-current={active ? "true" : undefined} className={`${cls} active:scale-[0.985] ${active ? "ring-2 ring-brand-500" : ""}`}>
      {body}
    </Link>
  );
}

/** بطاقة «من ← إلى» بمراحل المستند وشاحنة تتقدم عليها. */
export function SheetTrack({ from, to, steps, at, muted }: { from?: string; to?: string; steps: string[]; at: number; muted?: boolean }) {
  const pct = steps.length > 1 ? Math.max(0, Math.min(100, (at / (steps.length - 1)) * 100)) : 0;
  return (
    <div className="rounded-2xl bg-concrete p-3.5">
      {(from || to) && (
        <div className="flex justify-between gap-3 text-xs text-gray-600">
          <span className="min-w-0">
            من<b className="block truncate text-sm font-semibold text-gray-900">{from}</b>
          </span>
          <span className="min-w-0 text-left">
            إلى<b className="block truncate text-sm font-semibold text-gray-900">{to}</b>
          </span>
        </div>
      )}
      <div className="relative mx-1 mt-2.5 mb-1 h-6">
        <div className="absolute inset-x-0 top-3 h-[3px] bg-[linear-gradient(to_left,#c9c4b8_55%,transparent_0)] bg-[length:10px_3px]" />
        <div className="absolute top-3 right-0 h-[3px] rounded-full bg-brand-600" style={{ width: `${pct}%` }} />
        <svg viewBox="0 0 72 30" className="absolute top-0 w-[26px]" style={{ right: `calc(${pct}% - ${(pct * 26) / 100}px)` }} aria-hidden="true">
          <rect x="22" y="3" width="48" height="18" rx="1.5" fill={muted ? "#c9c4b8" : "#e9a100"} />
          <path d="M3 21v-7.5L8.5 6H20v15Z" fill="#303a42" />
          <path d="M6 13 10 8h6.5v5Z" fill="#9fd3e6" />
          <circle cx="11" cy="25" r="4.2" fill="#1b2126" />
          <circle cx="48" cy="25" r="4.2" fill="#1b2126" />
          <circle cx="61" cy="25" r="4.2" fill="#1b2126" />
        </svg>
      </div>
      <ol className="grid text-center text-[10.5px] text-gray-500" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((s, i) => (
          <li key={s} className={i <= at ? "font-semibold text-gray-900" : ""}>
            {s}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** شبكة «العنوان: القيمة» بخانتين في المعاينة. */
export function SheetFacts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="mt-3.5 grid grid-cols-2 gap-px overflow-hidden rounded-[14px] border border-gray-200 bg-gray-200">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0 bg-white px-3 py-2.5">
          <dt className="text-[11px] text-gray-500">{k}</dt>
          <dd className="mt-0.5 truncate text-[13.5px] font-semibold text-gray-900">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** المبالغ: أسطر ثم سطر الإجمالي الداكن. */
export function SheetMoney({ lines, total }: { lines: [string, string][]; total: [string, string] }) {
  return (
    <div className="mt-3.5 overflow-hidden rounded-[14px] border border-gray-200 text-[13px]">
      {lines.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3 border-b border-gray-200 px-3 py-2">
          <span>{k}</span>
          <span className="ltr-nums">{v}</span>
        </div>
      ))}
      <div className="flex justify-between gap-3 bg-asphalt-900 px-3 py-2.5 font-semibold text-white">
        <span>{total[0]}</span>
        <span className="ltr-nums font-display text-base text-brand-500">{total[1]}</span>
      </div>
    </div>
  );
}

/** أزرار أسفل المعاينة: الرئيسي بعرض كامل والباقي نصفان. */
export const sheetBtn = "inline-flex h-12 items-center justify-center gap-1.5 rounded-[14px] border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-800 disabled:opacity-60";
export const sheetPrimary = "col-span-2 inline-flex h-12 items-center justify-center gap-1.5 rounded-[14px] bg-brand-600 px-3 text-sm font-semibold text-brand-900 shadow-sm disabled:opacity-60";
