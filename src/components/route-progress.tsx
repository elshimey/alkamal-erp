"use client";

// شريط الانتقال بين الأقسام: طريق في أعلى الشاشة تسير عليه شاحنة حتى تفتح الصفحة الجديدة.

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Truck } from "./icons";

export function RouteProgress() {
  // الصفحة ونافذتها المفتوحة (?new=1 مثلاً): فتح نموذج إضافة أو تعديل ينتظر الخادم أيضاً
  const path = `${usePathname()}?${useSearchParams()}`;
  const [progress, setProgress] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval>>(undefined);

  // يبدأ عند الضغط على رابط داخلي لصفحة أخرى
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || (url.pathname === location.pathname && url.search === location.search)) return;
      clearInterval(timer.current);
      setProgress(8);
      // يقترب من النهاية ببطء ولا يصلها إلا عند فتح الصفحة
      timer.current = setInterval(() => setProgress((p) => (p === null ? p : p + (90 - p) * 0.09)), 180);
    };
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      clearInterval(timer.current);
    };
  }, []);

  // وصلت الصفحة: تكمل الشاحنة الطريق ثم يختفي الشريط
  useEffect(() => {
    clearInterval(timer.current);
    const finish = setTimeout(() => setProgress((p) => (p === null ? p : 100)), 0);
    const hide = setTimeout(() => setProgress(null), 450);
    return () => {
      clearTimeout(finish);
      clearTimeout(hide);
    };
  }, [path]);

  if (progress === null) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 h-[18px]" role="progressbar" aria-label="جارٍ فتح الصفحة" aria-valuenow={Math.round(progress)}>
      {/* الطريق المقطوع حتى الآن، والشاحنة في مقدمته */}
      <div
        className="absolute inset-y-0 start-0 overflow-hidden rounded-e-full bg-asphalt-900 shadow-md transition-[width] duration-300 ease-out"
        style={{ width: `calc(${progress}% + 44px)` }}
      >
        <div className="road-line-h road-moving-h absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2" />
      </div>
      <div className="truck-bump absolute top-px transition-[inset-inline-start] duration-300 ease-out" style={{ insetInlineStart: `${progress}%` }}>
        <Truck className="w-10" spinning />
      </div>
    </div>
  );
}
