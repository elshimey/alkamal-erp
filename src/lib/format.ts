/** مبلغ بخانتين عشريتين وفواصل الآلاف (1,234.50). */
export const fmt = (v: string | number) => Number(v).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** التاريخ بصيغة يوم/شهر/سنة: 2026-10-30 → 30/10/2026 */
export const fmtDate = (iso: string | null | undefined) => {
  const m = String(iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
};
