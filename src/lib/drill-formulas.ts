import type { Formula } from "@/components/drill";
import { sourceHref, type SourceFilter } from "@/lib/source-lines";

/**
 * معادلات الأرقام المحسوبة (قرار أحمد 2026-11-24: الرقم المحسوب يفتح معادلته أولاً).
 * كل جزء يفتح قيوده بنفس شروط التقرير، والمجموع «كل القيود معاً» بطبيعة الرقم.
 */

type Base = { from: string; to: string; period: string; fmt: (v: number) => string; reportHref?: string | null };
export type Src = (f: Partial<SourceFilter> & { title: string }) => string;

/** رابط «مصدر الرقم» لحركة الفترة (قائمة الدخل وما يشبهها: دون قيد إقفال السنة). */
export const periodSource = (from: string, to: string): Src => (f) => sourceHref({ from, to, noClose: true, mode: "net", sign: 1, ...f });

interface IncomeTotals {
  revenue: number;
  cost: number;
  admin: number;
  finance?: number;
  zakat?: number;
}

/** معادلات قائمة الدخل: مجمل الربح، الربح التشغيلي، قبل الزكاة، الصافي. */
export function incomeFormulas(t: IncomeTotals, b: Base) {
  const src = periodSource(b.from, b.to);
  const gross = t.revenue - t.cost;
  const operating = gross - t.admin;
  const beforeZakat = operating - (t.finance ?? 0);
  const net = beforeZakat - (t.zakat ?? 0);
  const common = { period: b.period, reportHref: b.reportHref, reportLabel: "قائمة الدخل كاملة" };
  const row = (op: string, label: string, note: string, codes: string[], value: number, sign: 1 | -1) => ({
    op,
    label,
    note,
    value: b.fmt(value),
    href: src({ title: label, codes, sign, expected: value }),
  });
  const grossF: Formula = {
    title: "مجمل الربح",
    value: b.fmt(gross),
    rows: [row("", "الإيرادات", "حسابات 4", ["4"], t.revenue, -1), row("−", "تكاليف التشغيل", "حسابات 5", ["5"], t.cost, 1)],
    allHref: src({ title: "مجمل الربح", codes: ["4", "5"], sign: -1, expected: gross }),
    ...common,
  };
  const operatingF: Formula = {
    title: "الربح التشغيلي",
    value: b.fmt(operating),
    rows: [{ op: "", label: "مجمل الربح", note: "الإيرادات − تكاليف التشغيل", value: b.fmt(gross), formula: grossF }, row("−", "المصروفات الإدارية والعمومية", "حسابات 6", ["6"], t.admin, 1)],
    allHref: src({ title: "الربح التشغيلي", codes: ["4", "5", "6"], sign: -1, expected: operating }),
    ...common,
  };
  const beforeZakatF: Formula = {
    title: "الربح قبل الزكاة",
    value: b.fmt(beforeZakat),
    rows: [{ op: "", label: "الربح التشغيلي", note: "مجمل الربح − المصروفات الإدارية", value: b.fmt(operating), formula: operatingF }, row("−", "تكاليف التمويل والبنود الأخرى", "حسابات 71", ["71"], t.finance ?? 0, 1)],
    allHref: src({ title: "الربح قبل الزكاة", codes: ["4", "5", "6", "71"], sign: -1, expected: beforeZakat }),
    ...common,
  };
  const netF: Formula = {
    title: "صافي الربح",
    value: b.fmt(net),
    rows: [{ op: "", label: "الربح قبل الزكاة", note: "الربح التشغيلي − تكاليف التمويل", value: b.fmt(beforeZakat), formula: beforeZakatF }, row("−", "الزكاة", "حسابات 72", ["72"], t.zakat ?? 0, 1)],
    allHref: src({ title: "صافي الربح", codes: ["4", "5", "6", "71", "72"], sign: -1, expected: net }),
    ...common,
  };
  /** لوحة القيادة: الصافي بعد المصروفات الإدارية فقط (كما تحسبه `summarize`). */
  const dashNetF: Formula = {
    title: "صافي الربح",
    value: b.fmt(operating),
    rows: operatingF.rows,
    allHref: operatingF.allHref,
    ...common,
  };
  return { gross: grossF, operating: operatingF, beforeZakat: beforeZakatF, net: netF, dashNet: dashNetF };
}

/** هامش = الرقم ÷ الإيراد: المعادلة بالرقم والإيراد. */
export function marginFormula(title: string, part: Formula, revenue: number, revenueHref: string, pct: string, b: Pick<Base, "fmt" | "period">): Formula {
  return {
    title,
    value: pct,
    period: b.period,
    rows: [
      { op: "", label: part.title, value: part.value, formula: part },
      { op: "÷", label: "الإيرادات", note: "حسابات 4", value: b.fmt(revenue), href: revenueHref },
    ],
  };
}

interface IncomeSection {
  key: string;
  label: string;
  prefix: string;
  sign: number;
  current: number;
  lines: { code: string; name: string; current: number }[];
}

/** روابط قائمة الدخل (لوحة القيادة والتقرير): كل حساب ومجموع قسم يفتح قيوده، وكل ربح يفتح معادلته. */
export function incomeStatementDrills(sections: readonly IncomeSection[], b: Base) {
  const tot = (k: string) => sections.find((s) => s.key === k)?.current ?? 0;
  const f = incomeFormulas({ revenue: tot("revenue"), cost: tot("cost"), admin: tot("admin"), finance: tot("finance"), zakat: tot("zakat") }, b);
  const src = periodSource(b.from, b.to);
  const sign = (sec: IncomeSection) => (sec.sign < 0 ? -1 : 1) as 1 | -1;
  return {
    line: (sec: IncomeSection, l: { code: string; name: string; current: number }) => src({ title: `${l.code} ${l.name}`, codes: [l.code], sign: sign(sec), expected: l.current }),
    section: (sec: IncomeSection) => src({ title: sec.label, codes: [sec.prefix], sign: sign(sec), expected: sec.current }),
    /** المجموع الذي يلي القسم: مجمل الربح بعد التكلفة، التشغيلي بعد الإدارية… */
    subtotal: { cost: f.gross, admin: f.operating, finance: f.beforeZakat, zakat: f.net } as Record<string, Formula>,
    revenueHref: src({ title: "الإيرادات", codes: ["4"], sign: -1, expected: tot("revenue") }),
    formulas: f,
  };
}

interface CashFlowLike {
  opening: number;
  inflow: number;
  outflow: number;
  closing: number;
  sections: { label: string; net: number; items: { label: string; codes: string[]; in: number; out: number; net: number }[] }[];
  accounts: { code: string; name: string; opening: number; in: number; out: number; closing: number }[];
}

/** «مصدر الرقم» في التدفق النقدي (لوحة القيادة والتقرير): الطرف المقابل للصناديق والبنوك في القيود التي تمسها. */
export function cashDrills(r: CashFlowLike, from: string, to: string, fmt: (v: number) => string) {
  const CASH = ["1101", "1102"];
  const per = `من ${from} إلى ${to}`;
  const dayBefore = new Date(Date.parse(from) - 86400000).toISOString().slice(0, 10);
  const flow = (title: string, codes: string[], side: "in" | "out" | "net", expected: number) =>
    sourceHref({ title, from, to, codes: codes.length ? codes : ["0"], touch: CASH, noClose: true, mode: "net", side: side === "in" ? "c" : side === "out" ? "d" : undefined, sign: side === "out" ? 1 : -1, expected });
  const all = r.sections.flatMap((s) => s.items.flatMap((l) => l.codes));
  const opening = sourceHref({ title: "رصيد النقدية أول الفترة", to: dayBefore, codes: CASH, mode: "bal", sign: 1, expected: r.opening });
  const inflow = flow("المقبوضات", all, "in", r.inflow);
  const outflow = flow("المدفوعات", all, "out", r.outflow);
  const closing: Formula = {
    title: "رصيد النقدية آخر الفترة",
    value: fmt(r.closing),
    period: per,
    rows: [
      { label: "رصيد أول الفترة", value: fmt(r.opening), href: opening },
      { op: "+", label: "المقبوضات", value: fmt(r.inflow), href: inflow },
      { op: "−", label: "المدفوعات", value: fmt(r.outflow), href: outflow },
    ],
    allHref: sourceHref({ title: "رصيد النقدية آخر الفترة", to, codes: CASH, mode: "bal", sign: 1, expected: r.closing }),
    reportHref: `/reports/cash-flow?from=${from}&to=${to}`,
    reportLabel: "قائمة التدفق النقدي",
  };
  const net: Formula = {
    title: "صافي التغير في النقد",
    value: fmt(r.inflow - r.outflow),
    period: per,
    rows: closing.rows.slice(1),
  };
  /** حساب صندوق أو بنك واحد: رصيده أول الفترة وآخرها، وكل ما دخله أو خرج منه (ومنه التحويل بين الصناديق). */
  const account = (a: CashFlowLike["accounts"][number], col: "opening" | "in" | "out" | "closing") =>
    col === "in" || col === "out"
      ? sourceHref({ title: `${a.code} ${a.name}: ${col === "in" ? "داخل" : "خارج"}`, from, to, codes: [`=${a.code}`], noClose: true, side: col === "in" ? "d" : "c", mode: "net", sign: col === "in" ? 1 : -1, expected: a[col] })
      : sourceHref({ title: `${a.code} ${a.name}: ${col === "opening" ? "أول الفترة" : "آخر الفترة"}`, to: col === "opening" ? dayBefore : to, codes: [`=${a.code}`], mode: "bal", sign: 1, expected: a[col] });
  return {
    opening,
    inflow,
    outflow,
    closing,
    net,
    account,
    item: (l: { label: string; codes: string[]; in: number; out: number; net: number }, side: "in" | "out" | "net") => flow(l.label, l.codes, side, side === "in" ? l.in : side === "out" ? l.out : l.net),
    section: (s: { label: string; net: number; items: { codes: string[] }[] }) => flow(`صافي النقد من ${s.label}`, s.items.flatMap((l) => l.codes), "net", s.net),
  };
}
