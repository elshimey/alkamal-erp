// مسار الصفحة أعلى كل شاشة (القسم › القائمة › المستند)، يُبنى من شاشات القائمة الجانبية والبحث الشامل
export type CrumbPage = { href: string; label: string; group: string };
export type Crumb = { label: string; href?: string };

// أسماء أقصر في المسار من أسمائها في البحث
const SHORT: Record<string, string> = { "/reports": "التقارير", "/settings": "الإعدادات" };

const within = (path: string, href: string) => href !== "/" && (path === href || path.startsWith(`${href}/`));

/** شاشات المسار: شاشات القائمة أولاً، ثم صفحات البحث الإضافية (عدا «إنشاء» لأنها روابط لنفس القوائم). */
export function crumbPages(nav: { title: string; items: { href: string; label: string }[] }[], extra: { href: string; label: string; group: string }[]): CrumbPage[] {
  const out = new Map<string, CrumbPage>();
  for (const g of nav) for (const i of g.items) if (!out.has(i.href)) out.set(i.href, { href: i.href, label: i.label, group: g.title });
  for (const p of extra) if (p.group !== "إنشاء" && !out.has(p.href)) out.set(p.href, { href: p.href, label: p.label, group: p.group.split(" · ")[0] });
  return [...out.values()];
}

/**
 * المسار من القسم إلى الصفحة الحالية. القسم نص (ليس صفحة)، وكل قائمة أب رابط، والأخير هو الصفحة الحالية بلا رابط.
 * title: عنوان الصفحة الحالية من رأسها، للصفحات الأعمق من القائمة (مثل رقم الشحنة).
 */
export function crumbTrail(path: string, pages: CrumbPage[], title?: string | null): Crumb[] {
  const clean = path.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  if (clean === "/") return [{ label: "لوحة القيادة" }];
  const chain = pages.filter((p) => within(clean, p.href)).sort((a, b) => a.href.length - b.href.length);
  const trail: Crumb[] = [];
  const first = chain[0];
  const label = (p: CrumbPage) => SHORT[p.href] ?? p.label;
  if (first && first.group !== "عام" && label(first) !== first.group) trail.push({ label: first.group });
  for (const p of chain) trail.push({ label: label(p), href: p.href });
  const last = chain.at(-1);
  if (last?.href === clean) delete trail[trail.length - 1].href;
  else if (title?.trim()) trail.push({ label: title.trim() });
  return trail;
}
