/** مبلغ بخانتين عشريتين وفواصل الآلاف (1,234.50). */
export const fmt = (v: string | number) => Number(v).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
