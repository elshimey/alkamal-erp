// المركبة المسندة للسائق في تاريخ المستند: اختيار السائق في أي نموذج أو شيت يملأ مركبته،
// ويبقى للمستخدم تغييرها. الفترات تأتي مع خيار السائق من driverOptions().

export interface VehiclePeriod {
  /** رقم المركبة */
  v: string;
  from: string;
  /** فارغ = الإسناد ما زال مفتوحاً */
  to: string | null;
}

const toIso = (text?: string | null) => {
  const t = (text ?? "").trim().replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t.length === 8 && /^\d+$/.test(t) ? `${t.slice(0, 2)}/${t.slice(2, 4)}/${t.slice(4)}` : t);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
};

/**
 * المركبة التي كانت مع السائق في التاريخ المعطى (يوم/شهر/سنة أو 2026-10-25).
 * دون تاريخ صالح: إسناده المفتوح الآن. وإن لم يكن له إسناد يومها: فارغ.
 */
export function vehicleOnDate(periods: VehiclePeriod[] | undefined, date?: string | null): string {
  if (!periods?.length) return "";
  const iso = toIso(date);
  if (iso) {
    const hit = periods.filter((p) => p.from <= iso && (!p.to || p.to >= iso)).sort((a, b) => (a.from < b.from ? 1 : -1))[0];
    return hit?.v ?? "";
  }
  return periods.find((p) => !p.to)?.v ?? "";
}
