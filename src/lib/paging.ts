// تقسيم القوائم الطويلة إلى صفحات من رابط الصفحة (?page=)، فتخفّ الصفحة ويبقى الرابط قابلاً للمشاركة.

export const PAGE_SIZE = 100;

/** رقم الصفحة من الرابط (يبدأ من 1) وإزاحتها في الاستعلام. */
export function pageOf(v: string | undefined) {
  const n = Math.floor(Number(v));
  const page = Number.isFinite(n) && n >= 1 && n <= 100000 ? n : 1;
  return { page, offset: (page - 1) * PAGE_SIZE };
}
