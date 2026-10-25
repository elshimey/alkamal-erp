"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { todayRiyadh } from "@/lib/dates";
import { cell, saveSheetRows, type SheetRow } from "@/lib/sheet-server";

export async function saveRates(rows: SheetRow[]) {
  await requirePermission("accounts", "update");
  const result = await saveSheetRows(rows, async (r) => {
    const currencyCode = cell.required(r.currency, "العملة").toUpperCase();
    if (currencyCode === "SAR") throw new Error("الريال عملة الأساس وسعره 1 دائماً");
    const [cur] = await db.select().from(s.currencies).where(eq(s.currencies.code, currencyCode));
    if (!cur) throw new Error(`العملة ${currencyCode} غير معرّفة`);
    const rateDate = cell.date(r.date, "التاريخ") ?? todayRiyadh();
    const rate = cell.number(r.rate, "السعر");
    if (!rate) throw new Error("السعر إلزامي");
    // إدخال نفس العملة والتاريخ مرة ثانية يصحّح السعر
    await db
      .insert(s.exchangeRates)
      .values({ currencyCode, rateDate, rate: String(rate) })
      .onConflictDoUpdate({ target: [s.exchangeRates.currencyCode, s.exchangeRates.rateDate], set: { rate: String(rate) } });
  });
  revalidatePath("/exchange-rates");
  revalidatePath("/");
  return result;
}
