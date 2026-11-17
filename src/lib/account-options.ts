import { sql } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import * as s from "@/db/schema";

export type PickRow = { id: number; code: string; nameAr: string; currencyCode?: string | null };

/**
 * يحوّل صفوف حسابات إلى خيارات منتقي الحسابات الموحد: الاسم، ورقمه بجانبه، ومجمّعة تحت حسابها الأب
 * (عنوان المجموعة اسم الأب ورقمه). يُستخدم في كل خانة حساب في البرنامج.
 */
export async function accountPickOptions(db: Db | Tx, rows: PickRow[]) {
  const heads = await db.select({ code: s.accounts.code, nameAr: s.accounts.nameAr }).from(s.accounts).where(sql`${s.accounts.level} < 4`);
  const names = new Map(heads.map((h) => [h.code, h.nameAr]));
  return [...rows]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((r) => {
      const parent = parentCode(r.code);
      return {
        value: String(r.id),
        label: r.currencyCode && r.currencyCode !== "SAR" ? `${r.nameAr} (${r.currencyCode})` : r.nameAr,
        code: r.code,
        group: parent ? (names.get(parent) ?? parent) : undefined,
        groupCode: parent || undefined,
      };
    });
}

/** رقم الحساب الأب من رقم الحساب (1 ← 11 ← 1101 ← 110101). */
export const parentCode = (code: string) => (code.length > 4 ? code.slice(0, 4) : code.length > 2 ? code.slice(0, 2) : code.length > 1 ? code.slice(0, 1) : "");

