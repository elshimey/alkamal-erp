"use client";

import { useState } from "react";

export function CopyLink({ url, whatsapp }: { url: string; whatsapp: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <div dir="ltr" className="rounded-xl bg-gray-50 px-4 py-3 font-mono text-sm break-all text-gray-800 select-all">
        {url}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(url).catch(() => {});
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-brand-900 shadow-sm hover:bg-brand-500"
        >
          {copied ? "نُسخ الرابط ✓" : "نسخ الرابط"}
        </button>
        <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50">
          إرسال عبر واتساب
        </a>
        <a href={url} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50">
          فتح التطبيق
        </a>
      </div>
    </div>
  );
}
