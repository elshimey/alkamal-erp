// الموارد البشرية: حالات المستندات ومستويات التقييم ومعادلاته

export const CUSTODY_KIND = { cash: "نقدية", in_kind: "عينية" } as const;

export const CUSTODY_STATUS = {
  draft: { label: "مسودة", tone: "gray" },
  approved: { label: "معتمدة – بانتظار التسليم", tone: "amber" },
  delivered: { label: "مسلّمة – مفتوحة", tone: "blue" },
  settled: { label: "مُسوّاة", tone: "green" },
  returned: { label: "مُرجعة", tone: "green" },
  cancelled: { label: "ملغاة", tone: "red" },
} as const;

export const HR_ACTION_KIND = {
  warning: { label: "إنذار", tone: "amber" },
  penalty: { label: "جزاء", tone: "red" },
  incentive: { label: "حافز", tone: "green" },
} as const;

export const HR_ACTION_STATUS = {
  draft: { label: "مسودة", tone: "gray" },
  approved: { label: "معتمد", tone: "green" },
  cancelled: { label: "ملغى", tone: "red" },
} as const;

export const LEAVE_STATUS = {
  pending: { label: "بانتظار الاعتماد", tone: "amber" },
  approved: { label: "معتمدة", tone: "green" },
  rejected: { label: "مرفوضة", tone: "red" },
  cancelled: { label: "ملغاة", tone: "gray" },
} as const;

export const ATTENDANCE_STATUS = {
  present: { label: "حاضر", short: "ح", tone: "green" },
  late: { label: "متأخر", short: "ت", tone: "amber" },
  absent: { label: "غائب", short: "غ", tone: "red" },
  leave: { label: "إجازة", short: "إ", tone: "blue" },
} as const;

export const ADVANCE_REQUEST_STATUS = {
  pending: { label: "بانتظار الاعتماد", tone: "amber" },
  approved: { label: "معتمد – سلفة", tone: "green" },
  rejected: { label: "مرفوض", tone: "red" },
} as const;

export const EVALUATION_STATUS = {
  draft: { label: "مسودة", tone: "gray" },
  approved: { label: "معتمد", tone: "green" },
} as const;

export const SCORE_LEVELS = [
  { min: 90, label: "ممتاز", tone: "green" },
  { min: 80, label: "جيد جداً", tone: "blue" },
  { min: 70, label: "جيد", tone: "blue" },
  { min: 60, label: "مقبول", tone: "amber" },
  { min: 0, label: "ضعيف", tone: "red" },
] as const;

export const scoreLevel = (score: number) => SCORE_LEVELS.find((l) => score >= l.min) ?? SCORE_LEVELS[SCORE_LEVELS.length - 1];

const r2 = (v: number) => Math.round(v * 100) / 100 + 0;

/** الدرجة الموزونة من 100: مجموع (الدرجة × الوزن) ÷ مجموع (10 × الوزن)، ثم خصم نقاط الإنذارات. */
export function computeEvaluation(criteria: { id: number; weight: number }[], scores: Record<string, number>, warnings: number, warningPoints: number) {
  const totalWeight = criteria.reduce((t, c) => t + c.weight, 0);
  if (!totalWeight) throw new Error("أضف معايير التقييم من إعدادات الموارد البشرية");
  let sum = 0;
  for (const c of criteria) {
    const v = Number(scores[String(c.id)] ?? 0);
    if (!Number.isFinite(v) || v < 0 || v > 10) throw new Error("درجة كل معيار من 0 إلى 10");
    sum += v * c.weight;
  }
  const baseScore = r2((sum / (totalWeight * 10)) * 100);
  const deduction = r2(warnings * warningPoints);
  return { baseScore, deduction, finalScore: r2(Math.max(0, baseScore - deduction)) };
}

/** رصيد الإجازة السنوية حسب نظام العمل: 21 يوماً، و30 يوماً لمن أكمل خمس سنوات. */
export const annualEntitlement = (hireDate: string | null, asOf: string) =>
  hireDate && (Date.parse(asOf) - Date.parse(hireDate)) / (365.25 * 86_400_000) >= 5 ? 30 : 21;

/** عدد الأيام بين تاريخين شاملين. */
export const inclusiveDays = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
