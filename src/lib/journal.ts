import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db, Tx } from "@/db";
import * as s from "@/db/schema";
import { LedgerError, createJournalEntryTx, deleteEntryTx, validateLines, type LineInput } from "@/lib/ledger";
import type { DocFilter } from "@/lib/doc-filters";

// القيود اليومية اليدوية كما في وافق: مسودة تُعدَّل ثم تُرحّل، وتُرجع لمسودة للتصحيح.
// القيود الآلية (من الفواتير والسندات...) تُعرض هنا للاطلاع ولا تُعدَّل إلا من مستندها.

const num = (v: string | null | undefined) => (v == null ? 0 : Number(v));

export interface ManualLine {
  accountId: number;
  description?: string | null;
  debit?: number;
  credit?: number;
  costCenterId?: number | null;
  partyId?: number | null;
}

export interface ManualEntryInput {
  entryDate: string;
  description: string;
  reference?: string | null;
  lines: ManualLine[];
  post?: boolean;
  userId?: number;
}

async function checkLines(tx: Tx, lines: ManualLine[]): Promise<LineInput[]> {
  const clean = lines.filter((l) => (l.debit ?? 0) > 0 || (l.credit ?? 0) > 0);
  const ids = [...new Set(clean.map((l) => l.accountId))];
  const accounts = ids.length ? await tx.select().from(s.accounts).where(inArray(s.accounts.id, ids)) : [];
  const errors: string[] = [];
  clean.forEach((l, i) => {
    const a = accounts.find((x) => x.id === l.accountId);
    if (!a) errors.push(`السطر ${i + 1}: اختر الحساب`);
    else if (!a.isPostable || !a.isActive) errors.push(`السطر ${i + 1}: الحساب ${a.code} ${a.nameAr} تجميعي أو موقوف`);
    else if (a.requiresCostCenter && !l.costCenterId) errors.push(`السطر ${i + 1}: الحساب ${a.nameAr} يتطلب مركز تكلفة (مركبة)`);
  });
  const out: LineInput[] = clean.map((l) => ({
    accountId: l.accountId,
    debit: Math.round((l.debit ?? 0) * 100) / 100,
    credit: Math.round((l.credit ?? 0) * 100) / 100,
    description: l.description?.trim() || undefined,
    costCenterId: l.costCenterId ?? null,
    partyId: l.partyId ?? null,
  }));
  errors.push(...validateLines(out));
  if (errors.length) throw new LedgerError(errors);
  return out;
}

async function lockManual(tx: Tx, id: number) {
  const [e] = await tx.select().from(s.journalEntries).where(eq(s.journalEntries.id, id)).for("update");
  if (!e) throw new Error("القيد غير موجود");
  if (e.sourceType) throw new Error("هذا قيد آلي؛ يُعدَّل من مستنده");
  return e;
}

export async function createManualEntry(db: Db | Tx, input: ManualEntryInput) {
  return db.transaction(async (tx) => {
    if (!input.description.trim()) throw new Error("اكتب وصف القيد");
    const lines = await checkLines(tx, input.lines);
    const entry = await createJournalEntryTx(tx, { entryDate: input.entryDate, description: input.description.trim(), lines, userId: input.userId });
    if (input.reference?.trim()) await tx.update(s.journalEntries).set({ reference: input.reference.trim() }).where(eq(s.journalEntries.id, entry.id));
    if (input.post) await tx.update(s.journalEntries).set({ status: "posted", approvedBy: input.userId ?? null }).where(eq(s.journalEntries.id, entry.id));
    return entry;
  });
}

/** تعديل مسودة قيد يدوي: يُستبدل رأسه وسطوره. */
export async function updateManualEntry(db: Db, id: number, input: ManualEntryInput) {
  return db.transaction(async (tx) => {
    const e = await lockManual(tx, id);
    if (e.status === "posted") throw new Error("القيد مرحّل؛ أرجعه لمسودة أولاً");
    if (!input.description.trim()) throw new Error("اكتب وصف القيد");
    const lines = await checkLines(tx, input.lines);
    await tx.delete(s.journalLines).where(eq(s.journalLines.entryId, id));
    await tx.insert(s.journalLines).values(
      lines.map((l, i) => ({
        entryId: id,
        lineNo: i + 1,
        accountId: l.accountId,
        debit: String(l.debit ?? 0),
        credit: String(l.credit ?? 0),
        description: l.description,
        costCenterId: l.costCenterId ?? null,
        partyId: l.partyId ?? null,
      })),
    );
    await tx
      .update(s.journalEntries)
      .set({ entryDate: input.entryDate, description: input.description.trim(), reference: input.reference?.trim() || null, updatedAt: new Date() })
      .where(eq(s.journalEntries.id, id));
    if (input.post) await tx.update(s.journalEntries).set({ status: "posted", approvedBy: input.userId ?? null }).where(eq(s.journalEntries.id, id));
  });
}

export async function postManualEntry(db: Db, id: number, userId?: number) {
  return db.transaction(async (tx) => {
    const e = await lockManual(tx, id);
    if (e.status === "posted") throw new Error(`القيد ${e.number} مرحّل مسبقاً`);
    await tx.update(s.journalEntries).set({ status: "posted", approvedBy: userId ?? null }).where(eq(s.journalEntries.id, id));
    return e;
  });
}

export async function revertManualEntry(db: Db, id: number) {
  return db.transaction(async (tx) => {
    const e = await lockManual(tx, id);
    if (e.status !== "posted") throw new Error("القيد ليس مرحّلاً");
    const [used] = await tx.select({ id: s.assetDepreciation.id }).from(s.assetDepreciation).where(eq(s.assetDepreciation.entryId, id)).limit(1);
    if (used) throw new Error("قيد إهلاك؛ ألغه من صفحة الأصول الثابتة");
    await tx.update(s.journalEntries).set({ status: "draft" }).where(eq(s.journalEntries.id, id));
  });
}

export async function deleteManualEntry(db: Db, id: number, opts: { reason: string; userId?: number }) {
  if (!opts.reason.trim()) throw new Error("اكتب سبب الحذف");
  return db.transaction(async (tx) => {
    const e = await lockManual(tx, id);
    if (e.status === "posted") throw new Error("الحذف متاح للمسودة فقط");
    const lines = await tx.select().from(s.journalLines).where(eq(s.journalLines.entryId, id));
    await tx.insert(s.deletionLog).values({ entity: "journal_entry", entityId: String(id), snapshot: { entry: e, lines }, reason: opts.reason.trim(), userId: opts.userId });
    await deleteEntryTx(tx, id);
  });
}

// ───────────── القائمة والمستند ─────────────

export interface EntryFilter extends Pick<DocFilter, "q" | "from" | "to"> {
  kind?: "manual" | "auto" | "draft";
  sort?: "date_desc" | "date_asc" | "amount_desc" | "amount_asc";
}

export async function listEntries(db: Db | Tx, f: EntryFilter, limit = 500) {
  const total = sql<string>`(select coalesce(sum(l.debit_base), 0) from journal_lines l where l.entry_id = journal_entries.id)`;
  const where: (SQL | undefined)[] = [];
  if (f.q) {
    const q = `%${f.q.replace(/[%_\\]/g, "\\$&")}%`;
    where.push(
      or(
        ilike(s.journalEntries.number, q),
        ilike(s.journalEntries.description, q),
        ilike(s.journalEntries.reference, q),
        sql`exists (select 1 from journal_lines l join accounts a on a.id = l.account_id where l.entry_id = journal_entries.id and (a.code like ${q} or a.name_ar ilike ${q} or l.description ilike ${q}))`,
      ),
    );
  }
  if (f.kind === "manual") where.push(isNull(s.journalEntries.sourceType));
  if (f.kind === "auto") where.push(isNotNull(s.journalEntries.sourceType));
  if (f.kind === "draft") where.push(sql`${s.journalEntries.status} <> 'posted'`);
  if (f.from) where.push(gte(s.journalEntries.entryDate, f.from));
  if (f.to) where.push(lte(s.journalEntries.entryDate, f.to));
  const order =
    f.sort === "date_asc"
      ? [asc(s.journalEntries.entryDate), asc(s.journalEntries.id)]
      : f.sort === "amount_desc"
        ? [desc(total)]
        : f.sort === "amount_asc"
          ? [asc(total)]
          : [desc(s.journalEntries.entryDate), desc(s.journalEntries.id)];
  return db
    .select({ e: s.journalEntries, total, lines: sql<number>`(select count(*) from journal_lines l where l.entry_id = journal_entries.id)::int` })
    .from(s.journalEntries)
    .where(and(...where))
    .orderBy(...order)
    .limit(limit);
}

export async function entryDoc(db: Db | Tx, id: number) {
  const creator = alias(s.users, "creator");
  const [row] = await db
    .select({ e: s.journalEntries, createdBy: creator.name })
    .from(s.journalEntries)
    .leftJoin(creator, eq(creator.id, s.journalEntries.createdBy))
    .where(eq(s.journalEntries.id, id));
  if (!row) return null;
  const lines = await db
    .select({ l: s.journalLines, code: s.accounts.code, account: s.accounts.nameAr, costCenter: s.costCenters.nameAr, party: s.parties.nameAr })
    .from(s.journalLines)
    .innerJoin(s.accounts, eq(s.accounts.id, s.journalLines.accountId))
    .leftJoin(s.costCenters, eq(s.costCenters.id, s.journalLines.costCenterId))
    .leftJoin(s.parties, eq(s.parties.id, s.journalLines.partyId))
    .where(eq(s.journalLines.entryId, id))
    .orderBy(asc(s.journalLines.lineNo));
  return { ...row, lines, debit: lines.reduce((t, x) => t + num(x.l.debitBase), 0), credit: lines.reduce((t, x) => t + num(x.l.creditBase), 0) };
}

// ───────────── إعادة التصنيف الجماعي ─────────────

export interface ReclassFilter {
  accountId: number;
  from?: string;
  to?: string;
  costCenterId?: number | null;
  q?: string;
}

/** سطور الحساب المرحّلة المرشحة لإعادة التصنيف. */
export async function reclassCandidates(db: Db | Tx, f: ReclassFilter, limit = 1000) {
  const where: (SQL | undefined)[] = [eq(s.journalLines.accountId, f.accountId), eq(s.journalEntries.status, "posted")];
  if (f.from) where.push(gte(s.journalEntries.entryDate, f.from));
  if (f.to) where.push(lte(s.journalEntries.entryDate, f.to));
  if (f.costCenterId) where.push(eq(s.journalLines.costCenterId, f.costCenterId));
  if (f.q) {
    const q = `%${f.q.replace(/[%_\\]/g, "\\$&")}%`;
    where.push(or(ilike(s.journalLines.description, q), ilike(s.journalEntries.description, q), ilike(s.journalEntries.number, q)));
  }
  return db
    .select({
      id: s.journalLines.id,
      entryId: s.journalEntries.id,
      number: s.journalEntries.number,
      date: s.journalEntries.entryDate,
      description: sql<string>`coalesce(${s.journalLines.description}, ${s.journalEntries.description}, '')`,
      debit: s.journalLines.debitBase,
      credit: s.journalLines.creditBase,
      costCenter: s.costCenters.nameAr,
      costCenterId: s.journalLines.costCenterId,
      party: s.parties.nameAr,
    })
    .from(s.journalLines)
    .innerJoin(s.journalEntries, eq(s.journalEntries.id, s.journalLines.entryId))
    .leftJoin(s.costCenters, eq(s.costCenters.id, s.journalLines.costCenterId))
    .leftJoin(s.parties, eq(s.parties.id, s.journalLines.partyId))
    .where(and(...where))
    .orderBy(asc(s.journalEntries.entryDate), asc(s.journalLines.id))
    .limit(limit);
}

/**
 * ينقل سطوراً مرحّلة إلى حساب (ومركز تكلفة) آخر بقيد تصحيح واحد يعكس كل سطر على حسابه
 * ويثبته على الحساب الجديد، فيبقى الأثر والتاريخ واضحين في الدفاتر.
 */
export async function reclassify(db: Db, input: { lineIds: number[]; targetAccountId: number; targetCostCenterId?: number | null; date: string; description?: string; userId?: number }) {
  return db.transaction(async (tx) => {
    if (!input.lineIds.length) throw new Error("اختر السطور");
    const rows = await tx
      .select({ l: s.journalLines, status: s.journalEntries.status, number: s.journalEntries.number })
      .from(s.journalLines)
      .innerJoin(s.journalEntries, eq(s.journalEntries.id, s.journalLines.entryId))
      .where(inArray(s.journalLines.id, input.lineIds));
    if (rows.length !== new Set(input.lineIds).size) throw new Error("بعض السطور غير موجودة");
    if (rows.some((r) => r.status !== "posted")) throw new Error("إعادة التصنيف للسطور المرحّلة فقط");
    const [target] = await tx.select().from(s.accounts).where(eq(s.accounts.id, input.targetAccountId));
    if (!target || !target.isPostable || !target.isActive) throw new Error("اختر حساباً تفصيلياً");
    if (rows.every((r) => r.l.accountId === target.id && (input.targetCostCenterId == null || r.l.costCenterId === input.targetCostCenterId))) throw new Error("السطور على الحساب نفسه");
    const lines: LineInput[] = [];
    for (const { l, number } of rows) {
      const debit = num(l.debitBase);
      const credit = num(l.creditBase);
      const cc = input.targetCostCenterId ?? l.costCenterId;
      const desc = `إعادة تصنيف ${number}${l.description ? ` – ${l.description}` : ""}`;
      const common = { partyId: l.partyId, driverId: l.driverId, waybillId: l.waybillId, description: desc };
      lines.push({ accountId: l.accountId, debit: credit, credit: debit, costCenterId: l.costCenterId, ...common });
      lines.push({ accountId: target.id, debit, credit, costCenterId: cc, ...common });
    }
    if (target.requiresCostCenter && lines.some((x) => x.accountId === target.id && !x.costCenterId)) throw new Error(`الحساب ${target.nameAr} يتطلب مركز تكلفة`);
    return createJournalEntryTx(tx, {
      entryDate: input.date,
      description: input.description?.trim() || `إعادة تصنيف ${rows.length} سطر إلى ${target.code} ${target.nameAr}`,
      post: true,
      userId: input.userId,
      lines,
    });
  });
}
