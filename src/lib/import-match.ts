// مطابقة أعمدة ملف Excel مع حقول النظام، وأدوات النصوص المشتركة بين المتصفح والخادم.

import type { ImportField } from "@/data/import-specs";

/** توحيد النص للمقارنة: حروف صغيرة، بلا تشكيل ولا رموز، والهمزات والتاء المربوطة موحدة. */
export function normText(v: string) {
  return v
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function names(f: ImportField) {
  return [f.label, f.en, `${f.en} ${f.label}`, `${f.label} ${f.en}`, ...(f.aliases ?? [])].map(normText).filter(Boolean);
}

/** درجة تطابق رأس عمود مع حقل: 3 تطابق تام، 2 الرأس يحوي الاسم كاملاً (مثل رأس وافق الثنائي اللغة)، 0 لا تطابق. */
function score(header: string, f: ImportField) {
  const h = normText(header);
  if (!h) return 0;
  const ns = names(f);
  if (ns.includes(h)) return 3;
  // الأطول أولاً حتى لا يغلب «السعر» على «سعر المنتج»
  const hit = ns.filter((n) => n.length >= 3 && ` ${h} `.includes(` ${n} `)).sort((a, b) => b.length - a.length)[0];
  return hit ? 2 + hit.length / 1000 : 0;
}

/** لكل عمود في الملف الحقل المقابل أو null. الحقل الواحد لا يُربط بعمودين؛ يفوز الأقوى تطابقاً. */
export function matchColumns(headers: string[], fields: ImportField[]): (string | null)[] {
  const candidates: { col: number; key: string; score: number }[] = [];
  headers.forEach((h, col) => fields.forEach((f) => {
    const sc = score(h, f);
    if (sc > 0) candidates.push({ col, key: f.key, score: sc });
  }));
  candidates.sort((a, b) => b.score - a.score);
  const out: (string | null)[] = headers.map(() => null);
  const used = new Set<string>();
  for (const c of candidates) {
    if (out[c.col] || used.has(c.key)) continue;
    out[c.col] = c.key;
    used.add(c.key);
  }
  return out;
}

/** عدد الحقول المطابقة في صف؛ يُستخدم لاكتشاف صف العناوين في الملف. */
export const headerScore = (cells: string[], fields: ImportField[]) => matchColumns(cells, fields).filter(Boolean).length;

export interface ImportIssue {
  // أرقام الصفوف في ملف Excel
  rows: number[];
  message: string;
  // بيانات غير موجودة في النظام تحتاج إنشاءها أولاً
  missing?: { kind: "customer" | "account" | "vehicleType" | "costCenter" | "currency" | "taxCode"; value: string };
}

export interface ImportReport {
  dryRun: boolean;
  // عدد السجلات (فاتورة بعدة بنود = سجل واحد)
  total: number;
  ok: number;
  issues: ImportIssue[];
  created?: string[];
  error?: string;
}

export const MISSING_LABELS: Record<NonNullable<ImportIssue["missing"]>["kind"], { label: string; href: string; action: string }> = {
  customer: { label: "عملاء غير موجودين", href: "/import/customers", action: "استورد العملاء أو أضفهم من جهات الاتصال" },
  account: { label: "حسابات غير موجودة", href: "/accounts", action: "أضفها في شجرة الحسابات" },
  vehicleType: { label: "أنواع مركبات غير موجودة", href: "/vehicles", action: "أضف النوع أو اترك العمود فارغاً" },
  costCenter: { label: "مراكز تكلفة أو مركبات غير موجودة", href: "/cost-centers", action: "أضف المركبة أو مركز التكلفة" },
  currency: { label: "عملات غير معرفة", href: "/exchange-rates", action: "استخدم رمز عملة معرف" },
  taxCode: { label: "معدلات ضريبة غير معروفة", href: "/settings", action: "استخدم 15% أو صفر أو معفى" },
};
