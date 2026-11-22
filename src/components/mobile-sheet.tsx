"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNarrow } from "@/lib/use-narrow";
import { Icon } from "./icons";

/**
 * معاينة المستند على الجوال: تصعد من أسفل الشاشة فوق القائمة (قرار أحمد 2026-11-22).
 * تُغلق بـ× وEsc والنقر خارجها وسحب المقبض لأسفل، وكلها تعود لرابط القائمة نفسه.
 * Esc الذي يغلق نافذة تأكيد أو قائمة عمليات فوقها لا يغلقها. على الكمبيوتر لا تظهر (المعاينة الجانبية تكفي).
 */
export function MobileSheet({ closeHref, label, header, children, footer }: { closeHref: string; label: string; header: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const narrow = useNarrow();
  const router = useRouter();
  if (!narrow) return null;
  return (
    <SheetPanel label={label} header={header} footer={footer} closeHref={closeHref} onClose={() => router.push(closeHref, { scroll: false })}>
      {children}
    </SheetPanel>
  );
}

/**
 * لوحة المعاينة نفسها (تصعد من الأسفل)، مشتركة بين معاينة المستند بالرابط (MobileSheet)
 * وبطاقة القائمة التي تفتح معاينتها دون تغيير الرابط (TapCard في list-card.tsx).
 */
export function SheetPanel({
  label,
  header,
  children,
  footer,
  onClose,
  closeHref,
}: {
  label: string;
  header: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  /** إن وُجد يكون الإغلاق رابطاً (يعمل قبل تحميل الصفحة كاملة) */
  closeHref?: string;
}) {
  const panel = useRef<HTMLElement>(null);
  const closeBtn = useRef<HTMLElement>(null);
  const drag = useRef<{ y: number; dy: number } | null>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // نافذة تأكيد أو قائمة أو تقويم مفتوح فوق المعاينة: Esc له وحده
      if (document.querySelector('dialog[open], [role="menu"], [role="listbox"]')) return;
      e.preventDefault();
      closeRef.current();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    closeBtn.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("a,button")) return;
    drag.current = { y: e.clientY, dy: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (panel.current) panel.current.style.transition = "none";
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current || !panel.current) return;
    drag.current.dy = Math.max(0, e.clientY - drag.current.y);
    panel.current.style.transform = `translateY(${drag.current.dy}px)`;
  };
  const onUp = () => {
    if (!drag.current || !panel.current) return;
    const { dy } = drag.current;
    drag.current = null;
    panel.current.style.transition = "";
    if (dy > 90) closeRef.current();
    else panel.current.style.transform = "";
  };
  const closeCls = "grid size-9 shrink-0 place-items-center rounded-full bg-concrete text-gray-600";

  return createPortal(
    <div className="fixed inset-0 z-[70] md:hidden" dir="rtl">
      {closeHref ? (
        <Link href={closeHref} scroll={false} replace aria-label="إغلاق المعاينة" tabIndex={-1} className="absolute inset-0 block bg-asphalt-900/45" />
      ) : (
        <button type="button" aria-label="إغلاق المعاينة" tabIndex={-1} onClick={onClose} className="absolute inset-0 block w-full bg-asphalt-900/45" />
      )}
      <section
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="animate-sheet-up absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col overflow-hidden rounded-t-[26px] bg-white pb-[env(safe-area-inset-bottom,0px)] shadow-[0_-16px_40px_-12px_rgba(27,33,38,0.3)] transition-transform"
      >
        <div onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} className="shrink-0 touch-none">
          <div className="grid cursor-grab place-items-center pt-2.5 pb-1" aria-hidden>
            <span className="h-[5px] w-[42px] rounded-full bg-[#d7d3c9]" />
          </div>
          <div className="flex items-start gap-2.5 border-b border-gray-100 px-4 pt-1 pb-3">
            <div className="min-w-0 flex-1">{header}</div>
            {closeHref ? (
              <Link ref={closeBtn as React.Ref<HTMLAnchorElement>} href={closeHref} scroll={false} replace aria-label="إغلاق المعاينة" className={closeCls}>
                <Icon name="close" className="size-4.5" />
              </Link>
            ) : (
              <button ref={closeBtn as React.Ref<HTMLButtonElement>} type="button" onClick={onClose} aria-label="إغلاق المعاينة" className={closeCls}>
                <Icon name="close" className="size-4.5" />
              </button>
            )}
          </div>
        </div>
        {children && <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3.5 pb-2">{children}</div>}
        {footer && <div className="grid shrink-0 grid-cols-2 gap-2 border-t border-gray-100 bg-white px-4 pt-3 pb-4">{footer}</div>}
      </section>
    </div>,
    document.body,
  );
}
