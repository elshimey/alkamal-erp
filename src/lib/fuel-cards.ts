import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import type { Db } from "@/db";
import * as s from "@/db/schema";
import { createJournalEntryTx, deleteEntryTx, nextDocumentNumber } from "@/lib/ledger";

// مطابقة كشف بطاقات الوقود: سطور الكشف من المزود مقابل تعبئات «بطاقة وقود» المسجلة في الشحنات.
// ما في الكشف ولم يُسجل يُقيد مصروف ديزل على المركبة من رصيد البطاقات 1106.
const FUEL_CARDS = "1106";
const DIESEL = "5101";
const INPUT_VAT = "1108";
const VAT = 0.15;

const round2 = (n: number) => Math.round(n * 100) / 100;
export const normPlate = (p: string) => p.replace(/[\s\-_]/g, "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));

export interface StatementLineInput {
  date: string;
  plate?: string | null;
  station?: string | null;
  reference?: string | null;
  liters?: number | null;
  amount: number;
}

export async function createStatement(
  db: Db,
  input: { providerId?: number | null; periodFrom: string; periodTo: string; closingBalance?: number | null; notes?: string | null; lines: StatementLineInput[]; userId?: number },
) {
  return db.transaction(async (tx) => {
    if (input.periodTo < input.periodFrom) throw new Error("نهاية الفترة قبل بدايتها");
    if (!input.lines.length) throw new Error("الصق سطور الكشف أولاً");
    const vehicles = await tx.select({ id: s.vehicles.id, plate: s.vehicles.plate }).from(s.vehicles);
    const byPlate = new Map(vehicles.map((v) => [normPlate(v.plate), v.id]));
    const number = await nextDocumentNumber(tx, "fuel_statement", "FC", Number(input.periodTo.slice(0, 4)));
    const [st] = await tx
      .insert(s.fuelCardStatements)
      .values({ number, providerId: input.providerId ?? null, periodFrom: input.periodFrom, periodTo: input.periodTo, closingBalance: input.closingBalance == null ? null : String(input.closingBalance), notes: input.notes || null, createdBy: input.userId ?? null })
      .returning();
    await tx.insert(s.fuelCardLines).values(
      input.lines.map((l, i) => ({
        statementId: st.id,
        lineNo: i + 1,
        txnDate: l.date,
        plate: l.plate?.trim() || null,
        vehicleId: l.plate ? (byPlate.get(normPlate(l.plate)) ?? null) : null,
        station: l.station?.trim() || null,
        reference: l.reference?.trim() || null,
        liters: l.liters == null ? null : String(l.liters),
        amount: String(l.amount),
      })),
    );
    await autoMatchTx(tx as unknown as Db, st.id);
    return st;
  });
}

/** تعبئات البطاقة المسجلة في الفترة (الشامل = المبلغ + الضريبة بالريال). */
async function systemFuel(db: Db, from: string, to: string) {
  return db
    .select({
      id: s.waybillFuel.id,
      date: s.waybills.waybillDate,
      waybill: s.waybills.number,
      waybillId: s.waybills.id,
      vehicleId: s.waybills.vehicleId,
      plate: s.vehicles.plate,
      liters: s.waybillFuel.liters,
      total: sql<number>`((${s.waybillFuel.amount} + ${s.waybillFuel.vatAmount}) * ${s.waybillFuel.exchangeRate})::float8`,
      invoiceNumber: s.waybillFuel.invoiceNumber,
    })
    .from(s.waybillFuel)
    .innerJoin(s.waybills, eq(s.waybills.id, s.waybillFuel.waybillId))
    .leftJoin(s.vehicles, eq(s.vehicles.id, s.waybills.vehicleId))
    .where(and(eq(s.waybillFuel.source, "fuel_card"), gte(s.waybills.waybillDate, from), lte(s.waybills.waybillDate, to)))
    .orderBy(asc(s.waybills.waybillDate));
}

const dayDiff = (a: string, b: string) => Math.abs((Date.parse(a) - Date.parse(b)) / 86_400_000);

/** مطابقة تلقائية: نفس المركبة، والمبلغ بفارق ريال، والتاريخ بفارق 3 أيام. أو رقم الفاتورة نفسه. */
async function autoMatchTx(db: Db, statementId: number) {
  const [st] = await db.select().from(s.fuelCardStatements).where(eq(s.fuelCardStatements.id, statementId));
  const lines = await db.select().from(s.fuelCardLines).where(and(eq(s.fuelCardLines.statementId, statementId), isNull(s.fuelCardLines.fuelId), isNull(s.fuelCardLines.journalEntryId)));
  const used = new Set((await db.select({ id: s.fuelCardLines.fuelId }).from(s.fuelCardLines).where(sql`${s.fuelCardLines.fuelId} is not null`)).map((r) => r.id));
  const pool = (await systemFuel(db, addDays(st.periodFrom, -3), addDays(st.periodTo, 3))).filter((f) => !used.has(f.id));
  let matched = 0;
  for (const l of lines) {
    const amount = Number(l.amount);
    const hit =
      (l.reference && pool.find((f) => f.invoiceNumber && f.invoiceNumber === l.reference)) ||
      pool
        .filter((f) => (!l.vehicleId || f.vehicleId === l.vehicleId) && Math.abs(f.total - amount) <= 1 && dayDiff(f.date, l.txnDate) <= 3)
        .sort((a, b) => dayDiff(a.date, l.txnDate) - dayDiff(b.date, l.txnDate))[0];
    if (!hit) continue;
    await db.update(s.fuelCardLines).set({ fuelId: hit.id }).where(eq(s.fuelCardLines.id, l.id));
    pool.splice(pool.indexOf(hit), 1);
    matched++;
  }
  return matched;
}

export const autoMatch = (db: Db, statementId: number) => db.transaction((tx) => autoMatchTx(tx as unknown as Db, statementId));

function addDays(d: string, n: number) {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

async function assertOpen(db: Db, statementId: number) {
  const [st] = await db.select().from(s.fuelCardStatements).where(eq(s.fuelCardStatements.id, statementId));
  if (!st) throw new Error("الكشف غير موجود");
  if (st.status === "reconciled") throw new Error("الكشف مُطابق ومقفل؛ أعد فتحه أولاً");
  return st;
}

export async function matchLine(db: Db, lineId: number, fuelId: number | null) {
  const [l] = await db.select().from(s.fuelCardLines).where(eq(s.fuelCardLines.id, lineId));
  if (!l) throw new Error("السطر غير موجود");
  await assertOpen(db, l.statementId);
  if (l.journalEntryId) throw new Error("السطر قُيد مصروفاً؛ احذف قيده أولاً");
  if (fuelId) {
    const [other] = await db.select({ id: s.fuelCardLines.id }).from(s.fuelCardLines).where(eq(s.fuelCardLines.fuelId, fuelId));
    if (other && other.id !== lineId) throw new Error("هذه التعبئة مطابقة لسطر آخر");
  }
  await db.update(s.fuelCardLines).set({ fuelId }).where(eq(s.fuelCardLines.id, lineId));
}

/** يقيد سطر الكشف غير المسجل مصروف ديزل على المركبة (شامل ضريبة 15%). */
export async function postLineAsExpense(db: Db, lineId: number, userId?: number) {
  return db.transaction(async (tx) => {
    const [l] = await tx.select().from(s.fuelCardLines).where(eq(s.fuelCardLines.id, lineId)).for("update");
    if (!l) throw new Error("السطر غير موجود");
    const st = await assertOpen(tx as unknown as Db, l.statementId);
    if (l.fuelId || l.journalEntryId) throw new Error("السطر مطابق أو مقيد مسبقاً");
    if (!l.vehicleId) throw new Error(`اللوحة «${l.plate ?? ""}» غير معرّفة في المركبات؛ صحّحها أو أضف المركبة`);
    const [v] = await tx.select({ cc: s.vehicles.costCenterId, plate: s.vehicles.plate }).from(s.vehicles).where(eq(s.vehicles.id, l.vehicleId));
    const codes = await tx.select({ id: s.accounts.id, code: s.accounts.code }).from(s.accounts).where(inArray(s.accounts.code, [FUEL_CARDS, DIESEL, INPUT_VAT]));
    const acc = (c: string) => codes.find((x) => x.code === c)!.id;
    const [tax] = await tx.select({ id: s.taxCodes.id }).from(s.taxCodes).where(eq(s.taxCodes.code, "VAT15-IN"));
    const total = Number(l.amount);
    const net = round2(total / (1 + VAT));
    const vat = round2(total - net);
    const desc = `ديزل بطاقة ${v.plate} ${l.txnDate}${l.station ? ` – ${l.station}` : ""} (كشف ${st.number})`;
    const entry = await createJournalEntryTx(tx, {
      entryDate: l.txnDate,
      description: desc,
      post: true,
      userId,
      lines: [
        { accountId: acc(DIESEL), debit: net, costCenterId: v.cc, description: desc },
        ...(vat > 0 ? [{ accountId: acc(INPUT_VAT), debit: vat, taxCodeId: tax?.id ?? null, description: `ضريبة مدخلات – ${desc}` }] : []),
        { accountId: acc(FUEL_CARDS), credit: total, description: desc },
      ],
    });
    await tx.update(s.fuelCardLines).set({ journalEntryId: entry.id }).where(eq(s.fuelCardLines.id, l.id));
    return entry;
  });
}

export async function unpostLine(db: Db, lineId: number) {
  return db.transaction(async (tx) => {
    const [l] = await tx.select().from(s.fuelCardLines).where(eq(s.fuelCardLines.id, lineId)).for("update");
    if (!l?.journalEntryId) return;
    await assertOpen(tx as unknown as Db, l.statementId);
    const entryId = l.journalEntryId;
    await tx.update(s.fuelCardLines).set({ journalEntryId: null }).where(eq(s.fuelCardLines.id, l.id));
    await deleteEntryTx(tx, entryId);
  });
}

export async function setStatementStatus(db: Db, id: number, status: "open" | "reconciled") {
  if (status === "reconciled") {
    const d = await statementDetail(db, id);
    if (d.summary.unresolved) throw new Error(`بقي ${d.summary.unresolved} سطر غير مطابق ولا مقيد`);
  }
  await db.update(s.fuelCardStatements).set({ status }).where(eq(s.fuelCardStatements.id, id));
}

export async function deleteStatement(db: Db, id: number) {
  const [posted] = await db.select({ id: s.fuelCardLines.id }).from(s.fuelCardLines).where(and(eq(s.fuelCardLines.statementId, id), sql`${s.fuelCardLines.journalEntryId} is not null`));
  if (posted) throw new Error("في الكشف سطور مقيدة؛ احذف قيودها أولاً");
  await db.delete(s.fuelCardStatements).where(eq(s.fuelCardStatements.id, id));
}

export async function listStatements(db: Db) {
  return db
    .select({
      st: s.fuelCardStatements,
      provider: s.parties.nameAr,
      lines: sql<number>`(select count(*) from fuel_card_lines l where l.statement_id = ${s.fuelCardStatements.id})::int`,
      total: sql<number>`(select coalesce(sum(amount), 0) from fuel_card_lines l where l.statement_id = ${s.fuelCardStatements.id})::float8`,
      open: sql<number>`(select count(*) from fuel_card_lines l where l.statement_id = ${s.fuelCardStatements.id} and l.fuel_id is null and l.journal_entry_id is null)::int`,
    })
    .from(s.fuelCardStatements)
    .leftJoin(s.parties, eq(s.parties.id, s.fuelCardStatements.providerId))
    .orderBy(desc(s.fuelCardStatements.periodTo), desc(s.fuelCardStatements.id));
}

export async function statementDetail(db: Db, id: number) {
  const [row] = await db.select({ st: s.fuelCardStatements, provider: s.parties.nameAr }).from(s.fuelCardStatements).leftJoin(s.parties, eq(s.parties.id, s.fuelCardStatements.providerId)).where(eq(s.fuelCardStatements.id, id));
  if (!row) throw new Error("الكشف غير موجود");
  const lines = await db
    .select({ l: s.fuelCardLines, vehicle: s.vehicles.plate, entry: s.journalEntries.number })
    .from(s.fuelCardLines)
    .leftJoin(s.vehicles, eq(s.vehicles.id, s.fuelCardLines.vehicleId))
    .leftJoin(s.journalEntries, eq(s.journalEntries.id, s.fuelCardLines.journalEntryId))
    .where(eq(s.fuelCardLines.statementId, id))
    .orderBy(asc(s.fuelCardLines.lineNo));
  const used = new Set((await db.select({ id: s.fuelCardLines.fuelId }).from(s.fuelCardLines).where(sql`${s.fuelCardLines.fuelId} is not null`)).map((r) => r.id));
  const fuel = await systemFuel(db, addDays(row.st.periodFrom, -3), addDays(row.st.periodTo, 3));
  const fuelById = new Map(fuel.map((f) => [f.id, f]));
  // تعبئات الفترة غير الموجودة في أي كشف: سُجلت في الشحنة ولم يظهر خصمها في الكشف
  const unmatchedSystem = fuel.filter((f) => !used.has(f.id) && f.date >= row.st.periodFrom && f.date <= row.st.periodTo);
  const [card] = await db.select({ id: s.accounts.id }).from(s.accounts).where(eq(s.accounts.code, FUEL_CARDS));
  const [bal] = (await db.execute(sql`
    select coalesce(sum(l.debit_base - l.credit_base), 0)::float8 as v from journal_lines l join journal_entries e on e.id = l.entry_id
    where l.account_id = ${card.id} and e.status = 'posted' and e.entry_date <= ${row.st.periodTo}`)) as unknown as { v: number }[];
  const total = lines.reduce((t, x) => t + Number(x.l.amount), 0);
  const matched = lines.filter((x) => x.l.fuelId).reduce((t, x) => t + Number(x.l.amount), 0);
  const posted = lines.filter((x) => x.l.journalEntryId).reduce((t, x) => t + Number(x.l.amount), 0);
  const unresolved = lines.filter((x) => !x.l.fuelId && !x.l.journalEntryId).length;
  return {
    ...row,
    lines: lines.map((x) => ({ ...x, fuel: x.l.fuelId ? (fuelById.get(x.l.fuelId) ?? null) : null })),
    unmatchedSystem,
    candidates: fuel.filter((f) => !used.has(f.id)),
    summary: { total: round2(total), matched: round2(matched), posted: round2(posted), unresolved, systemUnmatched: round2(unmatchedSystem.reduce((t, f) => t + f.total, 0)), ledgerBalance: round2(Number(bal.v)) },
  };
}
