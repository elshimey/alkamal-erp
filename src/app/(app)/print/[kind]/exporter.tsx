"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";

/** يحوّل كل مستند في الصفحة إلى PDF مستقل ويجمعها في ملف مضغوط واحد للتنزيل. */
export function BatchExporter({ title, auto }: { title: string; auto: boolean }) {
  const [state, setState] = useState<{ done: number; total: number; busy: boolean; error?: string }>({ done: 0, total: 0, busy: false });
  const started = useRef(false);

  const run = async () => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-doc]"));
    if (!nodes.length) return;
    setState({ done: 0, total: nodes.length, busy: true });
    try {
      const [{ toCanvas }, { jsPDF }, { default: JSZip }] = await Promise.all([import("html-to-image"), import("jspdf"), import("jszip")]);
      const zip = new JSZip();
      const used = new Map<string, number>();
      for (const [i, node] of nodes.entries()) {
        const canvas = await toCanvas(node, { pixelRatio: 2, backgroundColor: "#ffffff", cacheBust: false });
        const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
        const pageW = 210;
        const pageH = 297;
        const margin = 8;
        const w = pageW - margin * 2;
        const h = (canvas.height * w) / canvas.width;
        const img = canvas.toDataURL("image/jpeg", 0.92);
        // المستند الطويل يُقسم على أكثر من صفحة
        for (let y = 0, page = 0; y < h; y += pageH - margin * 2, page++) {
          if (page) pdf.addPage();
          pdf.addImage(img, "JPEG", margin, margin - y, w, h);
        }
        const base = (node.dataset.doc || `doc-${i + 1}`).replace(/[\\/:*?"<>|]/g, "-");
        const n = (used.get(base) ?? 0) + 1;
        used.set(base, n);
        zip.file(`${n > 1 ? `${base}-${n}` : base}.pdf`, pdf.output("arraybuffer"));
        setState((s) => ({ ...s, done: i + 1 }));
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${title}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      setState((s) => ({ ...s, busy: false }));
    } catch (err) {
      setState((s) => ({ ...s, busy: false, error: err instanceof Error ? err.message : "تعذر إنشاء الملفات" }));
    }
  };

  useEffect(() => {
    if (!auto || started.current) return;
    started.current = true;
    // ننتظر تحميل الخطوط والصور قبل التحويل
    const t = setTimeout(() => void document.fonts.ready.then(run), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto]);

  return (
    <div className="sticky top-0 z-20 mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-black/[0.06] bg-white px-5 py-3 shadow-sm print:hidden">
      <div>
        <div className="font-semibold text-brand-900">{title}</div>
        <div className="text-xs text-gray-500">
          {state.busy ? (
            <>
              جارٍ تجهيز الملفات <span className="ltr-nums">{state.done}</span> من <span className="ltr-nums">{state.total}</span>…
            </>
          ) : state.error ? (
            <span className="text-red-700">{state.error}</span>
          ) : state.total && state.done === state.total ? (
            "اكتمل التنزيل"
          ) : (
            "كل مستند في ملف PDF مستقل داخل ملف مضغوط، أو اطبعها كلها مرة واحدة"
          )}
        </div>
        {state.busy && (
          <div className="mt-1.5 h-1.5 w-56 overflow-hidden rounded-full bg-gray-100">
            <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${(state.done / Math.max(1, state.total)) * 100}%` }} />
          </div>
        )}
      </div>
      <div className="ms-auto flex gap-2">
        <button type="button" onClick={() => window.print()} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50">
          طباعة الكل
        </button>
        <button type="button" disabled={state.busy} onClick={run} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-brand-900 shadow-sm hover:bg-brand-500 disabled:opacity-50">
          <Icon name="download" className="size-4" />
          تنزيل ملف مضغوط
        </button>
      </div>
    </div>
  );
}
