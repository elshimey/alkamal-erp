"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * غلاف الجدول العريض: يُسحب يميناً ويساراً، والعمود الأول ثابت (sticky-first في globals.css)،
 * وظل خفيف على الحافة التي فيها أعمدة أخرى، وعلى الجوال تلميح «اسحب لرؤية بقية الأعمدة» حتى يسحب أول مرة.
 */
export function ScrollTable({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ more: false, moved: false, used: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      const x = Math.abs(el.scrollLeft);
      setEdge((e) => ({ more: max > 2 && x < max - 2, moved: x > 2, used: e.used || x > 2 }));
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);
  return (
    <div className={`relative ${className}`} data-more={edge.more || undefined} data-moved={edge.moved || undefined}>
      <div ref={ref} className="scroll-table overflow-x-auto overscroll-x-contain print:overflow-visible">
        {children}
      </div>
      {edge.more && !edge.used && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center md:hidden print:hidden">
          <span className="flex items-center gap-1.5 rounded-full bg-asphalt-900/90 px-3 py-1 text-xs text-white shadow-lg">
            <svg viewBox="0 0 24 24" className="size-4 text-brand-500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 7 4 11l4 4M16 7l4 4-4 4M4 11h16" />
            </svg>
            اسحب لرؤية بقية الأعمدة
          </span>
        </div>
      )}
    </div>
  );
}
