"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icons";

/**
 * «مصدر الرقم» (طلب أحمد 2026-11-24): الرقم أو الاسم أو المربع يفتح ما حُسب منه.
 * - `Drill`: رابط مباشر (قيود الحساب أو المجموعة، المستندات، القائمة المصفّاة).
 * - `FormulaDrill`: الرقم المحسوب من أرقام (مجمل الربح، صافي الربح، ربح المركبة…) يفتح نافذة
 *   «من أين جاء هذا الرقم؟» بالمعادلة، وكل جزء منها رابط أو معادلة أخرى (قرار أحمد: المعادلة أولاً).
 * الروابط بلا جلب مسبق لأن التقرير قد يحوي مئات منها.
 */
export function Drill({ href, tip, children, className = "", card = false }: { href?: string | null; tip?: string; children: ReactNode; className?: string; card?: boolean }) {
  // بلا رابط (لا صلاحية للتقارير): نفس الشكل دون نقر
  if (!href) return className ? <span className={className}>{children}</span> : <>{children}</>;
  return (
    <Link href={href} prefetch={false} title={tip ?? "اعرض من أين جاء هذا الرقم"} className={`${card ? "drill-card" : "drill"} ${className}`}>
      {children}
    </Link>
  );
}

export interface FormulaRow {
  /** «+» أو «−» أو فارغ لأول سطر. */
  op?: string;
  label: string;
  note?: string;
  value: string;
  href?: string | null;
  formula?: Formula;
}
export interface Formula {
  title: string;
  value: string;
  period?: string;
  rows: FormulaRow[];
  /** كل القيود معاً. */
  allHref?: string | null;
  /** التقرير الكامل (مثل قائمة الدخل). */
  reportHref?: string | null;
  reportLabel?: string;
}

export function FormulaDrill({ formula, children, className = "", card = false }: { formula: Formula; children: ReactNode; className?: string; card?: boolean }) {
  const [stack, setStack] = useState<Formula[]>([]);
  const open = stack.length > 0;
  const cur = stack[stack.length - 1];
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      e.stopPropagation();
      // Esc يرجع خطوة إن كانت النافذة فتحت معادلة داخلها، وإلا يغلق
      setStack((s) => s.slice(0, -1));
    };
    window.addEventListener("keydown", onKey, true);
    closeRef.current?.focus({ preventScroll: true });
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setStack([formula])}
        title="رقم محسوب: اعرض كيف حُسب"
        className={`${card ? "drill-card w-full text-start" : "drill"} ${className}`}
      >
        {children}
      </button>
      {/* على جسم الصفحة لا داخل المربع: المربع المتحرك (transform) يحبس `fixed` داخله فتنقص النافذة أو تُغطّى */}
      {open &&
        cur &&
        createPortal(
        <div className="fixed inset-0 z-[60] print:hidden" data-formula-drill dir="rtl">
          <button type="button" aria-label="إغلاق" tabIndex={-1} onClick={() => setStack([])} className="animate-fade-in absolute inset-0 block w-full cursor-default bg-asphalt-900/30" />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="من أين جاء هذا الرقم؟"
            className="max-md:animate-sheet-up md:animate-drawer-left absolute flex flex-col bg-white text-gray-900 shadow-[20px_0_50px_-20px_rgba(0,0,0,0.4)] max-md:inset-x-0 max-md:bottom-0 max-md:max-h-[85dvh] max-md:rounded-t-2xl max-md:pb-[env(safe-area-inset-bottom)] md:inset-y-0 md:left-0 md:w-[min(28rem,94vw)]"
          >
            <div className="flex shrink-0 items-start gap-3 border-b border-gray-100 px-5 pt-4 pb-3">
              {stack.length > 1 && (
                <button type="button" onClick={() => setStack((s) => s.slice(0, -1))} className="grid size-9 shrink-0 place-items-center rounded-full bg-concrete text-gray-600 hover:bg-gray-200" aria-label="رجوع" title="رجوع">
                  →
                </button>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-xs text-gray-500">من أين جاء هذا الرقم؟</p>
                <h2 className="mt-0.5 text-lg font-semibold break-words">
                  {cur.title} = <span className="ltr-nums">{cur.value}</span>
                </h2>
                {cur.period && <p className="ltr-nums text-xs text-gray-500">{cur.period}</p>}
              </div>
              <button ref={closeRef} type="button" onClick={() => setStack([])} aria-label="إغلاق" title="إغلاق (Esc)" className="grid size-9 shrink-0 place-items-center rounded-full bg-concrete text-gray-600 hover:bg-gray-200">
                <Icon name="close" className="size-4.5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <div className="rounded-xl bg-[#f6f3ea] px-3">
                {cur.rows.map((r, i) => {
                  const body = (
                    <>
                      <span className="w-5 shrink-0 text-center font-display text-gray-400">{r.op ?? ""}</span>
                      <span className="min-w-0 flex-1">
                        {r.label}
                        {r.note && <span className="block text-xs text-gray-500">{r.note}</span>}
                      </span>
                      <span className="ltr-nums shrink-0 font-medium">{r.value}</span>
                      {(r.href || r.formula) && <span className="shrink-0 text-brand-700">←</span>}
                    </>
                  );
                  const cls = "flex w-full items-center gap-2 border-b border-dashed border-gray-300 py-2.5 text-start text-sm last:border-b-0";
                  if (r.formula) {
                    const f = r.formula;
                    return (
                      <button key={i} type="button" onClick={() => setStack((s) => [...s, f])} className={`${cls} hover:text-brand-700`}>
                        {body}
                      </button>
                    );
                  }
                  if (r.href)
                    return (
                      <Link key={i} href={r.href} prefetch={false} onClick={() => setStack([])} className={`${cls} hover:text-brand-700`}>
                        {body}
                      </Link>
                    );
                  return (
                    <div key={i} className={cls}>
                      {body}
                    </div>
                  );
                })}
                <div className="flex items-center gap-2 py-2.5 text-sm font-bold">
                  <span className="w-5 shrink-0 text-center font-display text-gray-400">=</span>
                  <span className="flex-1">{cur.title}</span>
                  <span className="ltr-nums">{cur.value}</span>
                </div>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-gray-500">انقر أي سطر لتفتح القيود التي حُسب منها. السطر المحسوب يفتح معادلته هو.</p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-gray-100 bg-[#faf9f5] px-5 py-3">
              {cur.allHref && (
                <Link href={cur.allHref} prefetch={false} onClick={() => setStack([])} className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-asphalt-900 hover:bg-brand-600">
                  كل القيود معاً
                </Link>
              )}
              {cur.reportHref && (
                <Link href={cur.reportHref} prefetch={false} onClick={() => setStack([])} className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-gray-200 hover:bg-gray-50">
                  {cur.reportLabel ?? "التقرير الكامل"}
                </Link>
              )}
              <button type="button" onClick={() => setStack([])} className="ms-auto rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100">
                إغلاق
              </button>
            </div>
          </aside>
        </div>,
          document.body,
        )}
    </>
  );
}

/** «رجوع» إلى المكان الذي نُقر منه الرقم (التقرير أو اللوحة بنفس فلاترها). */
export function DrillBack({ fallback = "/reports" }: { fallback?: string }) {
  return (
    <button
      type="button"
      onClick={() => (window.history.length > 1 ? window.history.back() : window.location.assign(fallback))}
      className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-gray-200 hover:bg-brand-50"
    >
      → رجوع
    </button>
  );
}
