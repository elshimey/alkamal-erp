// بحث وفلترة وترتيب قوائم الفواتير (المبيعات والمشتريات) من رابط الصفحة، فتبقى قابلة للمشاركة والرجوع.

export const PERIODS = {
  all: "كل الوقت",
  month: "هذا الشهر",
  last_month: "الشهر الماضي",
  quarter: "هذا الربع",
  year: "هذه السنة",
} as const;

export const PAY_FILTERS = {
  unpaid: "غير مسددة",
  partial: "مسددة جزئياً",
  paid: "مسددة",
  overdue: "متأخرة",
} as const;

export const SORTS = {
  date_desc: "الأحدث أولاً",
  date_asc: "الأقدم أولاً",
  amount_desc: "الأعلى مبلغاً",
  amount_asc: "الأقل مبلغاً",
  due_asc: "الأقرب استحقاقاً",
  party_asc: "حسب الاسم",
} as const;

export type Period = keyof typeof PERIODS;
export type PayFilter = keyof typeof PAY_FILTERS;
export type DocSort = keyof typeof SORTS;

export interface DocFilter {
  q?: string;
  status?: string;
  pay?: PayFilter;
  period: Period;
  from?: string;
  to?: string;
  sort: DocSort;
  today: string;
}

export interface DocListParams {
  q?: string;
  status?: string;
  pay?: string;
  period?: string;
  sort?: string;
  view?: string;
  open?: string;
}

const pick = <T extends string>(v: string | undefined, keys: Record<T, unknown>, fallback: T) => (v && v in keys ? (v as T) : fallback);
const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);

/** مدى التواريخ لفترة نسبية إلى اليوم. */
export function periodRange(period: Period, today: string): { from?: string; to?: string } {
  const [y, m] = today.split("-").map(Number);
  switch (period) {
    case "month":
      return { from: iso(y, m - 1, 1), to: iso(y, m, 0) };
    case "last_month":
      return { from: iso(y, m - 2, 1), to: iso(y, m - 1, 0) };
    case "quarter": {
      const q = Math.floor((m - 1) / 3) * 3;
      return { from: iso(y, q, 1), to: iso(y, q + 3, 0) };
    }
    case "year":
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    default:
      return {};
  }
}

export function parseDocFilter(sp: DocListParams, statuses: readonly string[], today: string): DocFilter {
  const period = pick(sp.period, PERIODS, "all");
  return {
    q: sp.q?.trim() || undefined,
    status: sp.status && statuses.includes(sp.status) ? sp.status : undefined,
    pay: sp.pay && sp.pay in PAY_FILTERS ? (sp.pay as PayFilter) : undefined,
    period,
    ...periodRange(period, today),
    sort: pick(sp.sort, SORTS, "date_desc"),
    today,
  };
}

/** رابط القائمة بعد تعديل بعض المعاملات؛ القيم الفارغة تُحذف. */
export function listHref(base: string, sp: DocListParams, patch: Partial<Record<keyof DocListParams, string | undefined>>) {
  const p = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter((e): e is [string, string] => !!e[1]));
  const q = p.toString();
  return q ? `${base}?${q}` : base;
}
