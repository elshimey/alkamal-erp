"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { useNarrow } from "@/lib/use-narrow";
import { Icon } from "./icons";

/**
 * معاينة المستند على الكمبيوتر (قرار أحمد 2026-11-23): لوحة جانبية فوق القائمة، والقائمة تبقى خلفها.
 * تُغلق بـ× وEsc والنقر خارجها، وكلها تعود لرابط القائمة نفسه. Esc الذي يغلق نافذة تأكيد
 * أو قائمة أو تقويماً فوقها لا يغلقها. على الجوال لا تظهر (المعاينة تصعد من الأسفل، MobileSheet).
 */
export function DeskDrawer({ closeHref, label, header, children, footer }: { closeHref: string; label: string; header: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const narrow = useNarrow();
  const router = useRouter();
  const closeBtn = useRef<HTMLAnchorElement>(null);
  const href = useRef(closeHref);
  useEffect(() => {
    href.current = closeHref;
  }, [closeHref]);

  useEffect(() => {
    if (narrow) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector('dialog[open], [role="menu"], [role="listbox"], details[data-dropdown][open]')) return;
      e.preventDefault();
      router.push(href.current, { scroll: false });
    };
    window.addEventListener("keydown", onKey);
    closeBtn.current?.focus({ preventScroll: true });
    return () => window.removeEventListener("keydown", onKey);
  }, [narrow, router]);

  return (
    <div className="fixed inset-0 z-[55] max-md:hidden print:hidden" data-desk-drawer>
      <Link href={closeHref} scroll={false} replace aria-label="إغلاق المعاينة" tabIndex={-1} className="animate-fade-in absolute inset-0 block bg-asphalt-900/25" />
      {/* لوحة جانبية لا «dialog»: نوافذ التأكيد فوقها هي النوافذ */}
      <aside
        aria-label={label}
        className="animate-drawer-left absolute inset-y-0 left-0 flex w-[min(44rem,94vw)] flex-col bg-white shadow-[20px_0_50px_-20px_rgba(0,0,0,0.4)]"
      >
        <div className="flex shrink-0 items-start gap-3 border-b border-gray-100 px-5 pt-4 pb-3">
          <div className="min-w-0 flex-1">{header}</div>
          <Link ref={closeBtn} href={closeHref} scroll={false} replace aria-label="إغلاق المعاينة" title="إغلاق (Esc)" className="grid size-9 shrink-0 place-items-center rounded-full bg-concrete text-gray-600 hover:bg-gray-200">
            <Icon name="close" className="size-4.5" />
          </Link>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-gray-100 bg-[#faf9f5] px-5 py-3">{footer}</div>}
      </aside>
    </div>
  );
}
