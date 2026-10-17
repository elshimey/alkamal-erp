"use client";

import { useEffect, useRef } from "react";

/** رقم يعدّ صعوداً من الصفر عند فتح الصفحة. */
export function CountUp({ value, className = "" }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || value <= 0 || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const start = performance.now();
    const duration = 800;
    let frame = requestAnimationFrame(function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      el.textContent = Math.round(value * (1 - (1 - t) ** 3)).toLocaleString("en");
      if (t < 1) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return (
    <span ref={ref} className={`ltr-nums ${className}`}>
      {value.toLocaleString("en")}
    </span>
  );
}
