"use client";

import { useState, type ReactNode } from "react";
import { SheetPanel } from "./mobile-sheet";
import { Badge } from "./ui";

type Tone = "gray" | "blue" | "amber" | "green" | "red";

// الخط الملون على حافة البطاقة بلون الحالة (نفس DocCard)
export const STRIPE: Record<Tone, string> = {
  gray: "before:bg-st-neutral-dot",
  blue: "before:bg-st-info-dot",
  amber: "before:bg-st-warn-dot",
  green: "before:bg-st-ok-dot",
  red: "before:bg-st-bad-dot",
};

export const cardShell =
  "relative block w-full overflow-hidden rounded-[18px] bg-white px-3.5 pt-3.5 pb-3 text-start shadow-[0_1px_2px_rgba(27,33,38,0.06),0_4px_14px_-6px_rgba(27,33,38,0.14)] transition before:absolute before:inset-y-3.5 before:right-0 before:w-[3px] before:rounded-e-[3px]";

/**
 * بطاقة سجل على الجوال (قرار أحمد 2026-11-22، خطة الشكل الخطوة 3 الجزء الثاني):
 * السائق والمركبة والجهة والمسار والموظف: الاسم كبيراً مع رمز صغير، وأهم المعلومات في عمودين.
 */
export function RecordCardFace({
  avatar,
  name,
  sub,
  status,
  facts,
}: {
  avatar: ReactNode;
  name: ReactNode;
  sub?: ReactNode;
  status?: { label: string; tone: Tone } | null;
  facts?: [string, ReactNode][];
}) {
  return (
    <>
      <div className="flex items-center gap-2.5">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 font-display text-[15px] font-semibold text-brand-700">{avatar}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold text-gray-900">{name}</div>
          {sub && <div className="truncate text-[12.5px] text-gray-500">{sub}</div>}
        </div>
        {status && <Badge tone={status.tone}>{status.label}</Badge>}
      </div>
      {facts && facts.length > 0 && <Facts items={facts} />}
    </>
  );
}

/** معلومات البطاقة والمعاينة في عمودين: العنوان صغيراً والقيمة تحته. */
export function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2 text-[13px]">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-[11px] text-gray-500">{k}</dt>
          <dd className="truncate text-gray-900">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * بطاقة تُلمس فتفتح معاينتها من الأسفل (SheetPanel) دون تغيير الرابط: العنوان والتفاصيل وأزرار العمليات.
 * تُغلق بـ× وEsc والنقر خارجها وسحبها لأسفل.
 */
export function TapCard({
  tone,
  label,
  face,
  header,
  details,
  footer,
}: {
  tone: Tone;
  label: string;
  face: ReactNode;
  header: ReactNode;
  details?: ReactNode;
  footer?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div
        role="button"
        tabIndex={0}
        aria-label={label}
        data-tap-card
        onClick={(e) => {
          // خانة تحديد أو رابط داخل البطاقة يعمل وحده دون فتح المعاينة
          if ((e.target as HTMLElement).closest("input,label,a,button,select,textarea")) return;
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={`${cardShell} cursor-pointer active:scale-[0.985] ${STRIPE[tone]}`}
      >
        {face}
      </div>
      {open && (
        <SheetPanel label={label} header={header} footer={footer} onClose={() => setOpen(false)}>
          {details}
        </SheetPanel>
      )}
    </>
  );
}

/**
 * وجه بطاقة المستند داخل TapCard (سندات الصرف، المصروفات، المخالفات، العهد، السلف، المسيرات، العقود):
 * الرقم والحالة والتاريخ، ثم الجهة، ثم سطر صغير، والمبلغ واضحاً مع الخطوة التالية.
 */
export function DocCardFace({
  number,
  status,
  date,
  party,
  meta,
  amount,
  currency,
  next,
}: {
  number: ReactNode;
  status: { label: string; tone: Tone };
  date?: ReactNode;
  party: ReactNode;
  meta?: ReactNode;
  amount?: string | null;
  currency?: string;
  next?: string | null;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="ltr-nums font-display text-sm font-semibold whitespace-nowrap text-brand-900">{number}</span>
        <Badge tone={status.tone}>{status.label}</Badge>
        {date && <span className="ltr-nums ms-auto shrink-0 text-[11.5px] text-gray-500">{date}</span>}
      </div>
      <div className="mt-2.5 truncate text-[15px] font-semibold text-gray-900">{party}</div>
      {meta && <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-gray-500">{meta}</div>}
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
}

/** أزرار العمليات في أسفل المعاينة: كل ما في خانة العمليات بالجدول، بعرض المعاينة. */
export function SheetActions({ children }: { children: ReactNode }) {
  return <div className="col-span-2 flex flex-wrap items-center gap-2 [&_a]:min-h-10 [&_button]:min-h-10 [&>*]:grow">{children}</div>;
}
