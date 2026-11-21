// حسابات جدول الأقساط التي لا تحتاج قاعدة البيانات: توليد السطور، ولصق جدول البنك من Excel، ومراحل التنبيه.
// تُستخدم في النافذة (المتصفح) وفي الخادم بنفس النتيجة.

import { daysBetween } from "@/lib/dates";

export interface ScheduleRow {
  dueDate: string;
  principal: number;
  cost: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** نفس اليوم من الشهر بعد n شهراً؛ يوم 31 في شهر أقصر يصبح آخر يوم فيه. */
export function addMonths(iso: string, n: number, day = Number(iso.slice(8, 10))) {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7)) - 1 + n;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, last))).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * السطور من القسط الشهري: «مبلغ القسط» يشمل تكلفة التمويل، فالأصل = القسط − التكلفة.
 * يوم الاستحقاق ثابت كل شهر (يوم أول قسط أو اليوم المكتوب).
 */
export function generateSchedule(input: { firstDate: string; count: number; amount: number; cost?: number; day?: number }): ScheduleRow[] {
  const count = Math.floor(input.count);
  if (!input.firstDate) throw new Error("اكتب تاريخ أول قسط");
  if (!(count >= 1 && count <= 360)) throw new Error("عدد الأقساط من 1 إلى 360");
  if (!(input.amount > 0)) throw new Error("اكتب مبلغ القسط");
  const cost = r2(input.cost ?? 0);
  if (cost < 0 || cost >= input.amount) throw new Error("تكلفة التمويل في القسط يجب أن تكون أقل من مبلغ القسط");
  const day = input.day && input.day >= 1 && input.day <= 31 ? input.day : Number(input.firstDate.slice(8, 10));
  const first = addMonths(input.firstDate, 0, day) < input.firstDate ? addMonths(input.firstDate, 1, day) : addMonths(input.firstDate, 0, day);
  return Array.from({ length: count }, (_, i) => ({ dueDate: addMonths(first, i, day), principal: r2(input.amount - cost), cost }));
}

const digits = (t: string) => t.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));

/** يقبل 2026-10-05 أو 05/10/2026 أو رقم التاريخ في Excel. */
export function parseDate(raw: string): string | null {
  const t = digits(raw.trim());
  if (/^\d{5}$/.test(t) && Number(t) > 20000 && Number(t) < 80000) return new Date(Date.UTC(1899, 11, 30) + Number(t) * 86400000).toISOString().slice(0, 10);
  const dmy = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  const ymd = t.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/);
  const iso = dmy ? `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}` : ymd ? `${ymd[1]}-${ymd[2].padStart(2, "0")}-${ymd[3].padStart(2, "0")}` : "";
  const d = new Date(`${iso}T00:00:00Z`);
  return iso && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

export function parseAmount(raw: string): number | null {
  const t = digits(raw).replace(/[,\s٬]/g, "").replace("٫", ".");
  if (!t) return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * جدول البنك الملصوق من Excel: كل صف «التاريخ، الأصل، تكلفة التمويل» (التكلفة اختيارية).
 * صف العناوين يُتجاهل، وكل خطأ يظهر برقم صفه.
 */
export function parsePastedSchedule(text: string): { rows: ScheduleRow[]; errors: string[] } {
  const rows: ScheduleRow[] = [];
  const errors: string[] = [];
  text
    .split(/\r?\n/)
    .map((l) => l.split("\t").map((c) => c.trim()))
    .forEach((cells, i) => {
      if (!cells.some(Boolean)) return;
      const [d, p, c = ""] = cells;
      const dueDate = parseDate(d ?? "");
      if (!dueDate) {
        // أول صف نصي = عناوين الأعمدة
        if (i === 0 && !/\d/.test(d ?? "")) return;
        errors.push(`الصف ${i + 1}: «${d}» ليس تاريخاً`);
        return;
      }
      const principal = parseAmount(p ?? "");
      const cost = parseAmount(c);
      if (principal == null || principal < 0) return void errors.push(`الصف ${i + 1}: الأصل «${p}» ليس رقماً`);
      if (cost == null || cost < 0) return void errors.push(`الصف ${i + 1}: التكلفة «${c}» ليست رقماً`);
      if (principal + cost <= 0) return void errors.push(`الصف ${i + 1}: القسط صفر`);
      rows.push({ dueDate, principal: r2(principal), cost: r2(cost) });
    });
  return { rows, errors };
}

/** يتحقق من السطور قبل الحفظ ويرتبها بالتاريخ. */
export function validateSchedule(rows: ScheduleRow[]): ScheduleRow[] {
  if (!rows.length) throw new Error("أضف قسطاً واحداً على الأقل");
  if (rows.length > 360) throw new Error("الجدول أكثر من 360 قسطاً");
  rows.forEach((r, i) => {
    if (!parseDate(r.dueDate ?? "")) throw new Error(`القسط ${i + 1}: التاريخ غير صحيح`);
    if (!(r.principal >= 0) || !(r.cost >= 0)) throw new Error(`القسط ${i + 1}: المبلغ لا يكون سالباً`);
    if (!(r.principal + r.cost > 0)) throw new Error(`القسط ${i + 1}: القسط صفر`);
  });
  return [...rows].map((r) => ({ dueDate: r.dueDate, principal: r2(r.principal), cost: r2(r.cost) })).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

export const ALERT_DAYS_BEFORE = 3;

/**
 * مرحلة إشعار القسط (قرار أحمد): «b3» قبل الاستحقاق بثلاثة أيام، و«x0» يوم الاستحقاق (وأسبوعه)،
 * ثم «x1» بعد أسبوع، وهكذا كل أسبوع حتى السداد.
 */
export function installmentStage(dueDate: string, today: string): string | null {
  const left = daysBetween(today, dueDate);
  if (left > ALERT_DAYS_BEFORE) return null;
  if (left > 0) return `b${ALERT_DAYS_BEFORE}`;
  return `x${Math.floor(-left / 7)}`;
}
