// الصور تُحمَّل عند ظهورها (loading="lazy") لتخفيف الصفحة، لكن الورق وملف PDF يحتاجانها كلها:
// قبل الطباعة التلقائية أو التحويل إلى PDF تُحمَّل كل صورة مؤجلة ويُنتظر وصولها (بحد أقصى حتى لا تتعلق الطباعة).
export async function loadLazyImages(root: ParentNode = document, timeoutMs = 4000): Promise<void> {
  const imgs = Array.from(root.querySelectorAll<HTMLImageElement>('img[loading="lazy"]'));
  for (const img of imgs) img.loading = "eager";
  const pending = imgs.filter((img) => !img.complete).map((img) => new Promise<void>((r) => {
    img.addEventListener("load", () => r(), { once: true });
    img.addEventListener("error", () => r(), { once: true });
  }));
  if (pending.length) await Promise.race([Promise.all(pending), new Promise((r) => setTimeout(r, timeoutMs))]);
}
