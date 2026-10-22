"use client";

import { useState } from "react";
import { Icon } from "@/components/icons";
import { downloadBlob, nodeToPdf, safeFileName } from "@/lib/pdf-client";

export function SharedDocTools({ name, company }: { name: string; company: string }) {
  const [busy, setBusy] = useState(false);
  const download = async () => {
    const node = document.querySelector<HTMLElement>("[data-doc]");
    if (!node) return;
    setBusy(true);
    try {
      await document.fonts.ready;
      const pdf = await nodeToPdf(node);
      downloadBlob(new Blob([pdf], { type: "application/pdf" }), `${safeFileName(name)}.pdf`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-black/[0.06] bg-white px-5 py-3 shadow-sm print:hidden">
      <div>
        <div className="font-semibold text-brand-900">{company}</div>
        <div className="ltr-nums text-xs text-gray-500">{name}</div>
      </div>
      <div className="ms-auto flex gap-2">
        <button type="button" onClick={() => window.print()} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50">
          طباعة
        </button>
        <button type="button" disabled={busy} onClick={download} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-brand-900 shadow-sm hover:bg-brand-500 disabled:opacity-50">
          <Icon name="download" className="size-4" />
          {busy ? "جارٍ التجهيز…" : "تحميل PDF"}
        </button>
      </div>
    </div>
  );
}
