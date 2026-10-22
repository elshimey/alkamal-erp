import { and, desc, eq, inArray, like, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@/db";
import * as s from "@/db/schema";
import { createJournalEntryTx, deleteEntryTx, nextDocumentNumber, type LineInput } from "@/lib/ledger";
import { rateOn } from "@/lib/waybills";

// التحويل بين البنوك والصناديق وبطاقات الوقود (شحن رصيد البطاقة من البنك مثلاً).
// القيد: مدين المحوَّل إليه، دائن المحوَّل منه، والرسوم على 6108، وأي فرق عملة على 7103.
const TRANSFER_PARENTS = ["1101", "1102", "1106"];
const FEES = "6108";
const FX_DIFF = "7103";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** الحسابات التي يجوز التحويل منها وإليها. */
export async function transferAccounts(db: Db) {
  return db
    .select({ id: s.accounts.id, code: s.accounts.code, nameAr: s.accounts.nameAr, currencyCode: s.accounts.currencyCode })
    .from(s.accounts)
    .where(and(eq(s.accounts.isPostable, true), eq(s.accounts.isActive, true), or(...TRANSFER_PARENTS.map((p) => like(s.accounts.code, `${p}%`)))))
    .orderBy(s.accounts.code);
}

export interface TransferInput {
  date: string;
  fromAccountId: number;
  toAccountId: number;
  amount: number;
  // يُطلب فقط إذا اختلفت عملتا الحسابين
  receivedAmount?: number | null;
  fee?: number;
  reference?: string | null;
  notes?: string | null;
  userId?: number;
}

export async function createTransfer(db: Db, input: TransferInput) {
  return db.transaction(async (tx) => {
    if (input.fromAccountId === input.toAccountId) throw new Error("اختر حسابين مختلفين");
    if (!(input.amount > 0)) throw new Error("المبلغ إلزامي");
    const fee = input.fee ?? 0;
    if (fee < 0) throw new Error("الرسوم لا تكون سالبة");
    const allowed = await transferAccounts(db);
    const from = allowed.find((a) => a.id === input.fromAccountId);
    const to = allowed.find((a) => a.id === input.toAccountId);
    if (!from || !to) throw new Error("اختر بنكاً أو صندوقاً أو بطاقة وقود");
    const cf = from.currencyCode ?? "SAR";
    const ct = to.currencyCode ?? "SAR";
    const received = cf === ct ? input.amount : input.receivedAmount;
    if (!received || !(received > 0)) throw new Error(`اكتب المبلغ المستلم بـ ${ct} (العملتان مختلفتان)`);

    // قيمة الطرفين بالريال: الطرف بالريال بقيمته، والأجنبي بالسعر الضمني من الطرف الآخر أو بسعر اليوم
    let rateFrom = 1;
    let rateTo = 1;
    if (cf === ct) {
      rateFrom = rateTo = await rateOn(tx, cf, input.date);
    } else if (cf === "SAR") {
      rateTo = Number((input.amount / received).toFixed(6));
    } else if (ct === "SAR") {
      rateFrom = Number((received / input.amount).toFixed(6));
    } else {
      rateFrom = await rateOn(tx, cf, input.date);
      rateTo = await rateOn(tx, ct, input.date);
    }
    const baseFrom = round2(input.amount * rateFrom);
    const baseTo = round2(received * rateTo);
    const diff = round2(baseFrom - baseTo);

    const [fees] = await tx.select({ id: s.accounts.id }).from(s.accounts).where(eq(s.accounts.code, FEES));
    const [fx] = await tx.select({ id: s.accounts.id }).from(s.accounts).where(eq(s.accounts.code, FX_DIFF));
    const number = await nextDocumentNumber(tx, "cash_transfer", "TR", Number(input.date.slice(0, 4)));
    const desc = `تحويل ${number}: ${from.nameAr} ← ${to.nameAr}`;
    const lines: LineInput[] = [
      { accountId: to.id, debit: received, currencyCode: ct, exchangeRate: rateTo, description: desc },
      { accountId: from.id, credit: input.amount, currencyCode: cf, exchangeRate: rateFrom, description: desc },
    ];
    if (fee > 0) {
      lines.push({ accountId: fees.id, debit: round2(fee * rateFrom), description: `رسوم ${desc}` });
      lines.push({ accountId: from.id, credit: fee, currencyCode: cf, exchangeRate: rateFrom, description: `رسوم ${desc}` });
    }
    if (diff !== 0) lines.push({ accountId: fx.id, [diff > 0 ? "debit" : "credit"]: Math.abs(diff), description: `فرق عملة ${desc}` });

    const [row] = await tx
      .insert(s.cashTransfers)
      .values({
        number,
        transferDate: input.date,
        fromAccountId: from.id,
        toAccountId: to.id,
        amount: String(input.amount),
        receivedAmount: String(received),
        fee: String(fee),
        reference: input.reference?.trim() || null,
        notes: input.notes?.trim() || null,
        createdBy: input.userId ?? null,
      })
      .returning();
    const entry = await createJournalEntryTx(tx, { entryDate: input.date, description: desc, source: { type: "cash_transfer", id: row.id }, lines, post: true, userId: input.userId });
    await tx.update(s.cashTransfers).set({ journalEntryId: entry.id }).where(eq(s.cashTransfers.id, row.id));
    return { ...row, journalEntryId: entry.id, entryNumber: entry.number };
  });
}

/** حذف تحويل مع قيده (الفترة المقفلة تمنع ذلك). */
export async function deleteTransfer(db: Db, id: number) {
  return db.transaction(async (tx) => {
    const [t] = await tx.select().from(s.cashTransfers).where(eq(s.cashTransfers.id, id)).for("update");
    if (!t) throw new Error("التحويل غير موجود");
    await tx.update(s.cashTransfers).set({ journalEntryId: null }).where(eq(s.cashTransfers.id, id));
    if (t.journalEntryId) await deleteEntryTx(tx, t.journalEntryId);
    await tx.delete(s.cashTransfers).where(eq(s.cashTransfers.id, id));
  });
}

export async function listTransfers(db: Db, ids?: number[]) {
  const from = alias(s.accounts, "from_acc");
  const to = alias(s.accounts, "to_acc");
  return db
    .select({ t: s.cashTransfers, from: from.nameAr, fromCode: from.code, fromCur: from.currencyCode, to: to.nameAr, toCode: to.code, toCur: to.currencyCode, entry: s.journalEntries.number, by: s.users.name })
    .from(s.cashTransfers)
    .innerJoin(from, eq(from.id, s.cashTransfers.fromAccountId))
    .innerJoin(to, eq(to.id, s.cashTransfers.toAccountId))
    .leftJoin(s.journalEntries, eq(s.journalEntries.id, s.cashTransfers.journalEntryId))
    .leftJoin(s.users, eq(s.users.id, s.cashTransfers.createdBy))
    .where(ids ? inArray(s.cashTransfers.id, ids) : undefined)
    .orderBy(desc(s.cashTransfers.transferDate), desc(s.cashTransfers.id))
    .limit(500);
}
