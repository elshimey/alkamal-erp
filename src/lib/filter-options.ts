// البحث في قوائم الاختيار أثناء الكتابة.

/** تطبيع عربي للبحث: بلا تشكيل، والألف والتاء المربوطة والياء بصورة واحدة. */
export const norm = (t: string) =>
  t
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim();

/** ترتيب النتائج: ما يبدأ بالنص، ثم ما تبدأ به إحدى كلماته، ثم ما يحتويه. */
export function filterOptions<T extends { label: string }>(
  options: T[],
  query: string,
  limit = 60,
): T[] {
  const q = norm(query);
  if (!q) return options.slice(0, limit);
  const tiers: T[][] = [[], [], []];
  for (const o of options) {
    const l = norm(o.label);
    if (l.startsWith(q)) tiers[0].push(o);
    else if (l.split(/[\s/←–-]+/).some((w) => w.startsWith(q)))
      tiers[1].push(o);
    else if (l.includes(q)) tiers[2].push(o);
  }
  return tiers.flat().slice(0, limit);
}
