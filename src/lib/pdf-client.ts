// تحويل مستند معروض في الصفحة إلى PDF بمقاس A4 (في المتصفح)، والمستند الطويل على أكثر من صفحة.
// يُرسم المستند بعرض ورقة A4 ثابت مهما كان عرض الشاشة (فلا يخرج من الجوال ضيقاً مكدّساً)،
// ويُقسَّم على الصفحات عند حدود السطور والأقسام فلا ينقطع سطر بين صفحتين.
import { loadLazyImages } from "@/lib/eager-images";
const A4_PX = 760; // عرض محتوى A4 بهوامش 8 مم تقريباً بوحدة CSS

/** أماكن القطع الآمنة: نهاية كل سطر جدول وكل قسم مباشر في المستند (بالبكسل من أعلاه). */
function safeCuts(node: HTMLElement): number[] {
  const top = node.getBoundingClientRect().top;
  const els = node.querySelectorAll<HTMLElement>("tr, section, header, footer, h1, h2, h3, p, li, dl > div, :scope > div, :scope > * > div");
  const cuts = new Set<number>();
  for (const el of Array.from(els)) {
    const r = el.getBoundingClientRect();
    if (r.height > 0) cuts.add(Math.round(r.bottom - top));
  }
  return [...cuts].sort((a, b) => a - b);
}

export async function nodeToPdf(node: HTMLElement): Promise<ArrayBuffer> {
  const [{ toCanvas }, { jsPDF }] = await Promise.all([import("html-to-image"), import("jspdf")]);
  const prev = { width: node.style.width, maxWidth: node.style.maxWidth };
  node.style.width = `${A4_PX}px`;
  node.style.maxWidth = "none";
  try {
    await loadLazyImages(node);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const cssH = node.scrollHeight;
    const cuts = safeCuts(node);
    const canvas = await toCanvas(node, { pixelRatio: 2, backgroundColor: "#ffffff", cacheBust: false, width: A4_PX, height: cssH });
    const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
    const pageW = 210;
    const pageH = 297;
    const margin = 8;
    const w = pageW - margin * 2;
    const mmPerPx = w / A4_PX;
    const pagePx = (pageH - margin * 2) / mmPerPx; // ارتفاع الصفحة بوحدة CSS
    const scale = canvas.width / A4_PX;
    for (let y = 0, page = 0; y < cssH - 1; page++) {
      // أبعد نقطة قطع آمنة داخل الصفحة، وإن لم توجد (عنصر أطول من نصف صفحة) يُقطع عند نهاية الصفحة
      let end = Math.min(cssH, y + pagePx);
      if (end < cssH) {
        const safe = cuts.filter((c) => c > y + pagePx * 0.5 && c <= end).pop();
        if (safe) end = safe;
      }
      const slice = document.createElement("canvas");
      slice.width = canvas.width;
      slice.height = Math.max(1, Math.round((end - y) * scale));
      const ctx = slice.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, slice.width, slice.height);
      ctx.drawImage(canvas, 0, Math.round(y * scale), canvas.width, slice.height, 0, 0, slice.width, slice.height);
      if (page) pdf.addPage();
      pdf.addImage(slice.toDataURL("image/jpeg", 0.92), "JPEG", margin, margin, w, (end - y) * mmPerPx);
      y = end;
    }
    return pdf.output("arraybuffer");
  } finally {
    node.style.width = prev.width;
    node.style.maxWidth = prev.maxWidth;
  }
}

export const safeFileName = (name: string) => name.replace(/[\\/:*?"<>|]/g, "-");

export function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
