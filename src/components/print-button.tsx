"use client";

import { useEffect } from "react";
import { loadLazyImages } from "@/lib/eager-images";

export function PrintButton({ label = "طباعة" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50">
      {label}
    </button>
  );
}

/** يفتح نافذة الطباعة بمجرد تحميل الصفحة (روابط «طباعة» من المعاينة الجانبية). */
export function AutoPrint() {
  useEffect(() => {
    const t = setTimeout(() => void loadLazyImages().then(() => window.print()), 300);
    return () => clearTimeout(t);
  }, []);
  return null;
}
