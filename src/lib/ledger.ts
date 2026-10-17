import { and, eq, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import * as s from "@/db/schema";

// خدمة القيود: كل وحدة (البوليصة، الفاتورة، السند...) تنشئ قيدها من هنا.
// قاعدة البيانات تتحقق من التوازن والترحيل مرة أخرى (drizzle/0001_ledger_integrity.sql).

export interface LineInput {
  accountId: number;
  debit?: number;
  credit?: number;
  currencyCode?: string;
  exchangeRate?: number;
  description?: string;
  costCenterId?: number | null;
  partyId?: number | null;
  taxCodeId?: number | null;
  driverId?: number | null;
  waybillId?: number | null;
}

export interface EntryInput {
  entryDate: string;
  description?: string;
  source?: { type: string; id: number };
  lines: LineInput[];
  post?: boolean;
  userId?: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** تحقق مبدئي برسائل واضحة قبل الوصول لقاعدة البيانات. */
export function validateLines(lines: LineInput[]): string[] {
  const errors: string[] = [];
  if (lines.length < 2) errors.push("القيد يحتاج سطرين على الأقل");
  let debit = 0;
  let credit = 0;
  lines.forEach((l, i) => {
    const d = l.debit ?? 0;
    const c = l.credit ?? 0;
    const rate = l.exchangeRate ?? 1;
    if (d < 0 || c < 0) errors.push(`السطر ${i + 1}: لا يُقبل مبلغ سالب`);
    if ((d === 0) === (c === 0)) errors.push(`السطر ${i + 1}: أدخل مديناً أو دائناً (واحداً فقط)`);
    if (rate <= 0) errors.push(`السطر ${i + 1}: سعر الصرف غير صالح`);
    if ((l.currencyCode ?? "SAR") === "SAR" && rate !== 1) errors.push(`السطر ${i + 1}: سعر صرف الريال يجب أن يكون 1`);
    debit += round2(d * rate);
    credit += round2(c * rate);
  });
  if (round2(debit) !== round2(credit)) {
    errors.push(`القيد غير متوازن: المدين ${round2(debit).toFixed(2)} والدائن ${round2(credit).toFixed(2)}`);
  }
  return errors;
}

/** الرقم التالي لنوع مستند في سنة، مثل JE-2026-000001. يقفل السطر حتى نهاية المعاملة. */
export async function nextDocumentNumber(tx: Tx | Db, docType: string, prefix: string, year: number) {
  const [row] = await tx
    .insert(s.numberSequences)
    .values({ docType, year, prefix, nextNumber: 2 })
    .onConflictDoUpdate({
      target: [s.numberSequences.docType, s.numberSequences.year],
      set: { nextNumber: sql`${s.numberSequences.nextNumber} + 1` },
    })
    .returning({ issued: sql<number>`${s.numberSequences.nextNumber} - 1`, prefix: s.numberSequences.prefix });
  return `${row.prefix}-${year}-${String(row.issued).padStart(6, "0")}`;
}

export async function createJournalEntry(db: Db, input: EntryInput) {
  return db.transaction((tx) => createJournalEntryTx(tx, input));
}

/** ينشئ القيد داخل معاملة قائمة، ليُحفظ مع المستند المصدر أو يُلغى معه. */
export async function createJournalEntryTx(tx: Tx, input: EntryInput) {
  const errors = validateLines(input.lines);
  if (errors.length) throw new LedgerError(errors);
  {
    const year = Number(input.entryDate.slice(0, 4));
    const number = await nextDocumentNumber(tx, "journal_entry", "JE", year);
    const [entry] = await tx
      .insert(s.journalEntries)
      .values({
        number,
        entryDate: input.entryDate,
        description: input.description,
        sourceType: input.source?.type,
        sourceId: input.source?.id,
        createdBy: input.userId,
      })
      .returning({ id: s.journalEntries.id, number: s.journalEntries.number });
    await tx.insert(s.journalLines).values(
      input.lines.map((l, i) => ({
        entryId: entry.id,
        lineNo: i + 1,
        accountId: l.accountId,
        debit: String(l.debit ?? 0),
        credit: String(l.credit ?? 0),
        currencyCode: l.currencyCode ?? "SAR",
        exchangeRate: String(l.exchangeRate ?? 1),
        description: l.description,
        costCenterId: l.costCenterId ?? null,
        partyId: l.partyId ?? null,
        taxCodeId: l.taxCodeId ?? null,
        driverId: l.driverId ?? null,
        waybillId: l.waybillId ?? null,
      })),
    );
    if (input.post) {
      await tx
        .update(s.journalEntries)
        .set({ status: "posted", approvedBy: input.userId })
        .where(eq(s.journalEntries.id, entry.id));
    }
    return entry;
  }
}

/** إلغاء قيد مستند (الإرجاع لمسودة): يُرجَع القيد لمسودة ثم يُحذف. الفترة المقفلة تمنع ذلك. */
export async function deleteEntryTx(tx: Tx, entryId: number) {
  await tx.update(s.journalEntries).set({ status: "draft" }).where(and(eq(s.journalEntries.id, entryId), eq(s.journalEntries.status, "posted")));
  await tx.delete(s.journalEntries).where(eq(s.journalEntries.id, entryId));
}

export class LedgerError extends Error {
  constructor(public readonly errors: string[]) {
    super(errors.join("\n"));
  }
}
