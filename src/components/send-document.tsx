"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/icons";
import { shareDocument } from "@/app/(app)/share-actions";

/** رقم الجوال بالصيغة الدولية لواتساب (السعودية افتراضياً). */
export function waNumber(raw?: string | null) {
  let d = (raw ?? "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10 && d.startsWith("05")) d = `966${d.slice(1)}`;
  else if (d.length === 9 && d.startsWith("5")) d = `966${d}`;
  return d;
}

/**
 * إرسال المستند للعميل: رابط عام يفتح المستند ويحمّله PDF دون دخول،
 * عبر واتساب أو البريد أو قائمة المشاركة في الجوال.
 */
export function SendDocument({ kind, id, label, company, phone, email, to = "للعميل" }: { kind: string; id: number; label: string; company: string; phone?: string | null; email?: string | null; to?: string }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [busy, start] = useTransition();

  const withLink = (fn: (u: string) => void) =>
    start(async () => {
      const res = url ? { url } : await shareDocument(kind, id);
      if (!res.url) return setError(res.error ?? "تعذر إنشاء الرابط");
      setUrl(res.url);
      fn(res.url);
    });
  const text = (u: string) => `السلام عليكم،\nمرفق ${label} من ${company}.\nللاطلاع والتحميل PDF:\n${u}`;

  return (
    <div className="relative print:hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50"
      >
        <Icon name="chat" className="size-4" />
        إرسال {to}
      </button>
      {open && (
        <div className="absolute end-0 top-full z-30 mt-2 w-64 rounded-xl border border-black/5 bg-white p-2 text-sm shadow-xl">
          <button
            type="button"
            disabled={busy}
            onClick={() => withLink((u) => window.open(`https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text(u))}`, "_blank"))}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start hover:bg-green-50"
          >
            <span className="size-2 rounded-full bg-green-500" />
            واتساب {phone ? <span className="ltr-nums text-xs text-gray-400">{phone}</span> : <span className="text-xs text-gray-400">(اختر الرقم)</span>}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => withLink((u) => (window.location.href = `mailto:${email ?? ""}?subject=${encodeURIComponent(`${label} - ${company}`)}&body=${encodeURIComponent(text(u))}`))}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start hover:bg-gray-50"
          >
            <span className="size-2 rounded-full bg-sky-500" />
            بريد إلكتروني {email && <span className="truncate text-xs text-gray-400">{email}</span>}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              withLink(async (u) => {
                if (navigator.share) await navigator.share({ title: label, text: text(u) }).catch(() => {});
                else {
                  await navigator.clipboard.writeText(u);
                  setCopied(true);
                }
              })
            }
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start hover:bg-gray-50"
          >
            <span className="size-2 rounded-full bg-gray-400" />
            {copied ? "نُسخ الرابط ✓" : "مشاركة أو نسخ الرابط"}
          </button>
          {busy && <p className="px-3 py-1 text-xs text-gray-500">جارٍ تجهيز الرابط…</p>}
          {error && <p className="px-3 py-1 text-xs text-red-700">{error}</p>}
          <p className="border-t border-gray-100 px-3 pt-2 pb-1 text-[11px] text-gray-400">يفتح العميل المستند ويحمّله PDF دون حساب، والرابط صالح 90 يوماً.</p>
        </div>
      )}
    </div>
  );
}
