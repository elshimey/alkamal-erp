import { eq } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import * as s from "@/db/schema";
import { createWaybillTx, type ExpenseInput, type WaybillInput } from "@/lib/waybills";
import { addWaybillChargeTx } from "@/lib/customer-charges";

// إدخال الشحنات جماعياً (ملف Excel وشيت الإضافة الجماعية): الشحنة كاملة بحقولها الاختيارية
// ومصاريفها على العميل في عملية واحدة، فإما تُحفظ كلها أو لا شيء.

/** مصروف على العميل من صف واحد: دفعته الشركة من حساب، أو المخلص. ما دفعه السائق يأتي من إيصاله فقط. */
export type BulkCharge = Pick<ExpenseInput, "chargeTypeId" | "amount" | "payer" | "cashAccountId" | "partyId" | "note">;

export interface BulkWaybillInput extends WaybillInput {
  deliveryNoteNumber?: string | null;
  customsDeclaration?: string | null;
  charges?: BulkCharge[];
}

export async function createBulkWaybillTx(tx: Tx, input: BulkWaybillInput) {
  const { deliveryNoteNumber, customsDeclaration, charges = [], ...waybill } = input;
  for (const c of charges) {
    if (c.payer !== "cash" && c.payer !== "customs_broker") throw new Error("ما دفعه السائق من عهدته يُحمَّل من إيصاله في التطبيق، لا يُكتب في الملف");
  }
  const w = await createWaybillTx(tx, waybill);
  if (deliveryNoteNumber || customsDeclaration) {
    await tx
      .update(s.waybills)
      .set({ deliveryNoteNumber: deliveryNoteNumber || null, customsDeclaration: customsDeclaration || null })
      .where(eq(s.waybills.id, w.id));
  }
  // بعملة الشحنة، على العميل دائماً (ذمة مستردة 1114)
  for (const c of charges) await addWaybillChargeTx(tx, w.id, { ...c, billTo: "customer", currencyCode: w.currencyCode }, input.userId);
  return w;
}

export async function createBulkWaybill(db: Db, input: BulkWaybillInput) {
  return db.transaction((tx) => createBulkWaybillTx(tx, input));
}
