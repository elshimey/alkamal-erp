"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/** تنبيه الوثائق المنتهية والقريبة من الانتهاء أعلى الشاشة؛ يُخفى لبقية اليوم عند إغلاقه. */
export function ExpiryBanner({ expired, soon, today }: { expired: number; soon: number; today: string }) {
  const key = `expiry-banner-${today}-${expired}-${soon}`;
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(key) === "1";
    } catch {}
    // eslint-disable-next-line react-hooks/set-state-in-effect -- يُقرأ التخزين المحلي بعد التحميل فقط
    setHidden(dismissed);
  }, [key]);
  if (hidden || (!expired && !soon)) return null;
  return (
    <div className={`flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b px-4 py-2 text-center text-xs print:hidden ${expired ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
      <span>
        وثائق الأسطول:
        {expired > 0 && (
          <>
            {" "}
            <b className="ltr-nums">{expired}</b> منتهية
          </>
        )}
        {expired > 0 && soon > 0 && "، و"}
        {soon > 0 && (
          <>
            {" "}
            <b className="ltr-nums">{soon}</b> تنتهي خلال 30 يوماً
          </>
        )}
        {" "}(استمارات، رخص، إقامات، تأمين).
      </span>
      <Link href="/fleet-documents" className="font-semibold underline underline-offset-2">
        عرض وتجديد
      </Link>
      <button
        type="button"
        onClick={() => {
          try {
            localStorage.setItem(key, "1");
          } catch {}
          setHidden(true);
        }}
        className="opacity-60 hover:opacity-100"
        aria-label="إخفاء اليوم"
      >
        إخفاء اليوم ✕
      </button>
    </div>
  );
}
