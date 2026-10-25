// نص الشروط في الفاتورة يتبع مدة السداد الفعلية (من تاريخ الإصدار حتى الاستحقاق)، لا الرقم الثابت في القالب.
const DAYS = /(\d+|[٠-٩]+)(\s*)(يوماً|يوما|يوم|أيام)/;

export function invoiceTerms(terms: string, invoiceDate: string, dueDate: string) {
  if (!terms) return terms;
  const days = Math.round((Date.parse(dueDate) - Date.parse(invoiceDate)) / 86_400_000);
  if (!Number.isFinite(days) || days < 0) return terms;
  if (terms.includes("{مدة_السداد}")) return terms.replaceAll("{مدة_السداد}", String(days));
  return terms.replace(DAYS, (_, __, sp: string, unit: string) => `${days}${sp}${days >= 3 && days <= 10 ? "أيام" : unit === "أيام" ? "يوماً" : unit}`);
}
