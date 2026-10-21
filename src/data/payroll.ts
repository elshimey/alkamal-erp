// الرواتب: حالات المستندات، نسب التأمينات الاجتماعية، ومعادلات سطر المسير

export const PAYROLL_STATUS = {
  draft: { label: "مسودة", tone: "gray" },
  approved: { label: "معتمد – بانتظار الصرف", tone: "amber" },
  paid: { label: "مصروف", tone: "green" },
} as const;

export const ADVANCE_STATUS = {
  pending: { label: "بانتظار الصرف", tone: "amber" },
  paid: { label: "مصروفة – تُستقطع", tone: "blue" },
  settled: { label: "مسددة", tone: "green" },
} as const;

export const PAYROLL_ACCOUNTS = {
  driverSalaries: "5103",
  staffSalaries: "6101",
  gosiExpense: "6102",
  eosbExpense: "6103",
  gosiPayable: "2115",
  eosbProvision: "2203",
  advances: "1107",
  penalties: "2116",
} as const;

// التأمينات الاجتماعية على (الأساسي + السكن) بسقف 45,000 ر.س شهرياً
export const GOSI = {
  cap: 45_000,
  saudiEmployee: 0.0975, // معاشات 9% + ساند 0.75%
  saudiEmployer: 0.1175, // معاشات 9% + أخطار مهنية 2% + ساند 0.75%
  nonSaudiEmployer: 0.02, // أخطار مهنية فقط
} as const;

const r2 = (v: number) => Math.round(v * 100) / 100 + 0;

export interface PayrollInputs {
  basic: number;
  housing: number;
  otherAllowances: number;
  absenceDays: number;
  additions: number;
  deductions: number;
  commissions: number;
  /** مخالفات على السائق قُيدت على حسابه عند تسجيلها */
  violations?: number;
  advanceDeduction: number;
  /** حوافز وجزاءات الموارد البشرية المعتمدة */
  incentives?: number;
  penalties?: number;
  isSaudi: boolean;
  gosiSubject: boolean;
  /** سنوات الخدمة في آخر الشهر (لمخصص نهاية الخدمة) */
  serviceYears: number | null;
}

/** يحسب سطر المسير: الخصم بالغياب على أساس 30 يوماً، والتأمينات، ومخصص نهاية الخدمة، والصافي. */
export function computePayrollLine(i: PayrollInputs) {
  const wage = i.basic + i.housing + i.otherAllowances;
  const absenceDeduction = r2((wage / 30) * Math.min(i.absenceDays, 30));
  const gosiBase = Math.min(i.basic + i.housing, GOSI.cap);
  const gosiEmployee = i.gosiSubject && i.isSaudi ? r2(gosiBase * GOSI.saudiEmployee) : 0;
  const gosiEmployer = i.gosiSubject ? r2(gosiBase * (i.isSaudi ? GOSI.saudiEmployer : GOSI.nonSaudiEmployer)) : 0;
  // نظام العمل: نصف شهر عن كل سنة من الخمس الأولى، وشهر كامل عما بعدها
  const eosbAccrual = i.serviceYears == null ? 0 : r2(i.serviceYears >= 5 ? wage / 12 : wage / 24);
  // الجزاء لا يُنقص مصروف الرواتب: يُحتجز في حسابه لصالح العمال، فيُخصم من الصافي فقط
  const earnings = r2(wage + i.additions + (i.incentives ?? 0) - absenceDeduction - i.deductions);
  const net = r2(earnings - (i.penalties ?? 0) - gosiEmployee - i.advanceDeduction + i.commissions - (i.violations ?? 0));
  return { absenceDeduction, gosiEmployee, gosiEmployer, eosbAccrual, earnings, net };
}

/** "2026-10" أو "2026-10-01" → أول وآخر يوم في الشهر. */
export function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) throw new Error("الشهر غير صالح");
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { start, end };
}

export const MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
export const monthLabel = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return `${MONTHS_AR[m - 1]} ${y}`;
};
