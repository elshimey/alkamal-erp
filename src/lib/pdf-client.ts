// تحويل مستند معروض في الصفحة إلى PDF بمقاس A4 (في المتصفح)، والمستند الطويل على أكثر من صفحة
export async function nodeToPdf(node: HTMLElement): Promise<ArrayBuffer> {
  const [{ toCanvas }, { jsPDF }] = await Promise.all([import("html-to-image"), import("jspdf")]);
  const canvas = await toCanvas(node, { pixelRatio: 2, backgroundColor: "#ffffff", cacheBust: false });
  const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const pageW = 210;
  const pageH = 297;
  const margin = 8;
  const w = pageW - margin * 2;
  const h = (canvas.height * w) / canvas.width;
  const img = canvas.toDataURL("image/jpeg", 0.92);
  for (let y = 0, page = 0; y < h; y += pageH - margin * 2, page++) {
    if (page) pdf.addPage();
    pdf.addImage(img, "JPEG", margin, margin - y, w, h);
  }
  return pdf.output("arraybuffer");
}

export const safeFileName = (name: string) => name.replace(/[\\/:*?"<>|]/g, "-");

export function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
