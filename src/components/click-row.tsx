"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

/** صف جدول يفتح المعاينة عند النقر في أي مكان منه، ما عدا الروابط والأزرار ومربعات التحديد داخله. */
export function ClickRow({
  href,
  className = "",
  children,
  kidOf,
  hidden,
}: {
  href: string;
  className?: string;
  children: ReactNode;
  /** صف ابن داخل مجموعة مدمجة: يظهر ويختفي بسهم المجموعة (GroupToggle) */
  kidOf?: string;
  hidden?: boolean;
}) {
  const router = useRouter();
  return (
    <tr
      data-kid-of={kidOf}
      hidden={hidden}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a, button, input, label, select, textarea")) return;
        if (window.getSelection()?.toString()) return;
        router.push(href, { scroll: false });
      }}
      className={`cursor-pointer ${className}`}
    >
      {children}
    </tr>
  );
}
