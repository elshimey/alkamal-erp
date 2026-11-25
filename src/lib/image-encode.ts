// ضغط صور الرفع في المتصفح: WebP أصغر بنحو 30% من JPEG بالجودة نفسها.
// المتصفح الذي لا يكتب WebP (سفاري قديم) يعيد PNG كبيراً بدلها، فيُرجع إلى JPEG.
export function canvasToCompressed(canvas: HTMLCanvasElement, quality: number): string {
  const webp = canvas.toDataURL("image/webp", quality);
  return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", quality);
}
