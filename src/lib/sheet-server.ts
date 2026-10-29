import "server-only";
import { db } from "@/db";
import { errorMessage } from "@/lib/errors";
import { once } from "@/lib/once";
import type { SheetResult } from "@/lib/sheet";

export type SheetRow = Record<string, string>;

/**
 * يحفظ صفوف الشيت صفاً صفاً، ويجمع سبب رفض كل صف بدل إيقاف الحفظ كله.
 * كل صف يحمل _op من الشيت: إعادة حفظ الشيت نفسه بعد انقطاع الرد لا تسجّل الصف مرتين.
 */
export async function saveSheetRows(rows: SheetRow[], save: (row: SheetRow) => Promise<unknown>): Promise<SheetResult> {
  if (!Array.isArray(rows) || rows.length > 2000) return { saved: 0, error: "عدد الصفوف أكبر من المسموح (2000)" };
  let saved = 0;
  const rowErrors: Record<number, string> = {};
  for (let i = 0; i < rows.length; i++) {
    try {
      const { _op, ...row } = rows[i];
      await once(db, _op, async () => void (await save(row)));
      saved++;
    } catch (err) {
      rowErrors[i] = errorMessage(err);
    }
  }
  return { saved, rowErrors: Object.keys(rowErrors).length ? rowErrors : undefined };
}

// قراءة القيم من خلايا الشيت
export const cell = {
  text: (v: string | undefined) => (v ?? "").trim() || null,
  required: (v: string | undefined, label: string) => {
    const t = (v ?? "").trim();
    if (!t) throw new Error(`${label} إلزامي`);
    return t;
  },
  number: (v: string | undefined, label: string) => {
    const t = (v ?? "").trim();
    if (!t) return null;
    const n = Number(t);
    if (!Number.isFinite(n) || n < 0) throw new Error(`${label}: رقم غير صالح`);
    return n;
  },
  date: (v: string | undefined, label: string) => {
    const t = (v ?? "").trim();
    if (!t) return null;
    // يقبل 2026-10-17 أو 17/10/2026
    const dmy = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    const iso = dmy ? `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}` : t;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || Number.isNaN(Date.parse(iso))) throw new Error(`${label}: تاريخ غير صالح`);
    return iso;
  },
};
