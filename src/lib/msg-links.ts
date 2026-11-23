import { EXTRA_PAGES, NAV } from "@/data/nav";

/**
 * روابط داخل رسائل الخطأ والتنبيه (طلب أحمد 2026-11-23): كل رسالة توجّه المستخدم لصفحة أخرى
 * تعطيه رابطاً يفتحها مباشرة بدل أن يبحث عنها. تُفهم الرسالة كما هي، دون تغيير نصها:
 * - اسم صفحة بين «» كما في القائمة الجانبية، مثل «سندات صرف تحت المراجعة».
 * - عبارات التوجيه المعروفة («شاشة المصروفات»، «صفحة الأقساط»، «شجرة الحسابات»...) في PAGE_PHRASES،
 *   والمتغيرة منها (الفترة المقفلة، سعر الصرف الناقص...) في PAGE_PATTERNS.
 * - رقم مستند (WB-2026-000012، INV-…) يفتح المستند نفسه عبر /go/<الرقم>.
 * - رابط صريح [النص](/المسار) لرسالة تحتاج صفحة مصفّاة على السجل نفسه.
 * أي رسالة جديدة توجّه لصفحة تكتب اسمها بين «» أو تضيف عبارتها هنا.
 */
export type MsgSegment = { text: string; href?: string };

/** عبارات توجيه تكتبها رسائل الخادم كما هي (الأطول أولاً عند التطابق). */
export const PAGE_PHRASES: Record<string, string> = {
  "سندات صرف تحت المراجعة": "/payments/review",
  "شاشة المصروفات": "/expenses",
  "شاشة السائقين": "/drivers",
  "شاشة الموردين": "/parties",
  "شاشة «الإسناد»": "/assignments",
  "صفحة الأقساط": "/payments/installments",
  "صفحة العقد": "/contracts",
  "صفحة الأصول الثابتة": "/fixed-assets",
  "صفحة المستخدمين": "/users",
  "ملف الموظف": "/employees",
  "شجرة الحسابات": "/accounts",
  "من المسارات": "/routes",
  "من سندات الصرف": "/payments",
  "الإعدادات ← الفوترة الإلكترونية": "/settings/zatca",
  "بيانات الشركة": "/settings/company",
  "أسعار الصرف": "/exchange-rates",
  "الفترات والإقفال": "/periods",
};

/** عبارات متغيرة (برقم أو اسم داخلها)، ومنها رسائل قاعدة البيانات نفسها */
export const PAGE_PATTERNS: [RegExp, string][] = [
  [/الفترة \d+ \/ \d+ مقفلة/, "/periods"],
  [/لا توجد فترة محاسبية لتاريخ [\d-]+/, "/periods"],
  [/أدخل سعر (?:ال)?صرف(?: [A-Z]{3})?/, "/exchange-rates"],
  [/لا يوجد سعر صرف مسجّل لـ [A-Z]{3}/, "/exchange-rates"],
  [/أضف المركبة/, "/vehicles"],
  [/لا يوجد حساب عهدة لهذا السائق/, "/drivers"],
  [/الحساب [^؛\n]{1,60} موقوف/, "/accounts"],
];

const LABELS: Record<string, string> = Object.fromEntries([
  ...NAV.flatMap((g) => g.items.map((i) => [i.label, i.href] as const)),
  ...EXTRA_PAGES.map((p) => [p.label, p.href] as const),
]);

/** رقم مستند بصيغة البرنامج: بادئة ثم السنة ثم التسلسل */
const DOC_NUMBER = /\b(?:WB|INV|DRF|RC|RF|JE|MO|PI|PO|QT|PR|PV|EX|VIO|ADV|CAR|FA|TR|BR|FC)-\d{4}-\d{3,}\b/;
const EXPLICIT = /\[([^\]\n]+)\]\((\/[^)\s]*)\)/;
const QUOTED = /«([^»\n]+)»/g;

const internal = (href: string) => href.startsWith("/") && !href.startsWith("//");

/** يقسم الرسالة إلى نص وروابط داخلية. نص بلا روابط يعود سطراً واحداً كما هو. */
export function msgSegments(text: string): MsgSegment[] {
  if (!text) return [];
  // 1) الرابط الصريح [النص](/المسار)
  const ex = EXPLICIT.exec(text);
  if (ex && internal(ex[2])) {
    return [...msgSegments(text.slice(0, ex.index)), { text: ex[1], href: ex[2] }, ...msgSegments(text.slice(ex.index + ex[0].length))];
  }
  // 2) أول ما يُطابق من: عبارة توجيه، اسم صفحة بين «»، رقم مستند
  let best: { at: number; len: number; seg: MsgSegment } | null = null;
  const consider = (at: number, len: number, seg: MsgSegment) => {
    if (at >= 0 && (!best || at < best.at || (at === best.at && len > best.len))) best = { at, len, seg };
  };
  for (const [phrase, href] of Object.entries(PAGE_PHRASES)) {
    const at = text.indexOf(phrase);
    // العبارة المكتوبة بين «» تُعرض بقوسيها
    consider(at, phrase.length, { text: phrase, href });
  }
  for (const [re, href] of PAGE_PATTERNS) {
    const m = re.exec(text);
    if (m) consider(m.index, m[0].length, { text: m[0], href });
  }
  for (const m of text.matchAll(QUOTED)) {
    const href = LABELS[m[1].trim()];
    if (href) consider(m.index!, m[0].length, { text: m[0], href });
  }
  const doc = DOC_NUMBER.exec(text);
  if (doc) consider(doc.index, doc[0].length, { text: doc[0], href: `/go/${doc[0]}` });
  if (!best) return [{ text }];
  const { at, len, seg } = best as { at: number; len: number; seg: MsgSegment };
  return [...(at > 0 ? [{ text: text.slice(0, at) }] : []), seg, ...msgSegments(text.slice(at + len))];
}

/** هل في الرسالة رابط؟ (تبقى رسالة الخطأ أطول على الشاشة لتُضغط) */
export const msgHasLink = (text: string) => msgSegments(text).some((s) => s.href);
