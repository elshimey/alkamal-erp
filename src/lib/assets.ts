import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import * as s from "@/db/schema";
import { createJournalEntryTx, deleteEntryTx, nextDocumentNumber, type LineInput } from "@/lib/ledger";
import { round2 } from "@/lib/invoice-posting";

// الأصول الثابتة (IAS 16) بالقسط الثابت شهرياً: (التكلفة − الخردة) ÷ العمر بالأشهر.
// قيد الإهلاك قيد واحد لكل شهر: مدين مصروف الإهلاك (على مركز تكلفة الأصل) / دائن مجمع الإهلاك.
// إعادة تشغيل شهر تحذف قيده وتعيد بناءه، فيدخل فيه أي أصل أُضيف لاحقاً بتاريخ سابق.

const num = (v: string | null | undefined) => (v == null ? 0 : Number(v));
export const ASSET_ACCOUNTS = { vehicleExpense: "5110", adminExpense: "6110", gain: "4202", loss: "7104" } as const;

async function accountByCode(db: Db | Tx, code: string) {
  const [a] = await db.select().from(s.accounts).where(eq(s.accounts.code, code));
  if (!a) throw new Error(`الحساب ${code} غير موجود في الشجرة`);
  return a;
}

const monthEnd = (iso: string) => {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;
const nextMonthEnd = (end: string) => {
  const [y, m] = end.split("-").map(Number);
  return new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
};

/** الحسابات المقترحة لفئة الأصل: مجمع الإهلاك المقابل (1201xx ← 1202xx) والمصروف. */
export async function suggestAccounts(db: Db | Tx, assetAccountId: number) {
  const [a] = await db.select().from(s.accounts).where(eq(s.accounts.id, assetAccountId));
  if (!a) return null;
  const accCode = a.code.startsWith("1201") ? `1202${a.code.slice(4)}` : null;
  const [acc] = accCode ? await db.select().from(s.accounts).where(eq(s.accounts.code, accCode)) : [];
  const vehicle = ["120101", "120102"].includes(a.code);
  const exp = await accountByCode(db, vehicle ? ASSET_ACCOUNTS.vehicleExpense : ASSET_ACCOUNTS.adminExpense);
  return { accumulatedAccountId: acc?.id ?? null, expenseAccountId: exp.id };
}

export interface AssetInput {
  nameAr: string;
  assetAccountId: number;
  accumulatedAccountId?: number | null;
  expenseAccountId?: number | null;
  costCenterId?: number | null;
  vehicleId?: number | null;
  acquisitionDate: string;
  depreciationStart?: string | null;
  cost: number;
  salvageValue?: number;
  usefulLifeMonths: number;
  openingDepreciation?: number;
  /** إن حُدد يُقيد الاقتناء: مدين الأصل / دائن هذا الحساب (بنك، مورد، جاري الشريك...) */
  offsetAccountId?: number | null;
  notes?: string | null;
  userId?: number;
}

export async function createAsset(db: Db | Tx, input: AssetInput) {
  return db.transaction(async (tx) => {
    if (!input.nameAr.trim()) throw new Error("اكتب اسم الأصل");
    if (!(input.cost > 0)) throw new Error("التكلفة أكبر من صفر");
    const salvage = input.salvageValue ?? 0;
    const opening = input.openingDepreciation ?? 0;
    if (salvage < 0 || salvage >= input.cost) throw new Error("قيمة الخردة أقل من التكلفة");
    if (opening < 0 || opening > input.cost - salvage) throw new Error("الإهلاك السابق أكبر من القيمة القابلة للإهلاك");
    if (!Number.isInteger(input.usefulLifeMonths) || input.usefulLifeMonths < 1 || input.usefulLifeMonths > 600) throw new Error("العمر الإنتاجي بالأشهر من 1 إلى 600");
    const [asset] = await tx.select().from(s.accounts).where(eq(s.accounts.id, input.assetAccountId));
    if (!asset || !asset.isPostable || !asset.code.startsWith("12") || asset.code.startsWith("1202")) throw new Error("اختر حساب أصل تفصيلياً من الأصول غير المتداولة");
    const suggested = await suggestAccounts(tx, asset.id);
    const accumulatedAccountId = input.accumulatedAccountId ?? suggested?.accumulatedAccountId;
    const expenseAccountId = input.expenseAccountId ?? suggested?.expenseAccountId;
    if (!accumulatedAccountId) throw new Error("اختر حساب مجمع الإهلاك");
    if (!expenseAccountId) throw new Error("اختر حساب مصروف الإهلاك");
    const [accumulated] = await tx.select().from(s.accounts).where(eq(s.accounts.id, accumulatedAccountId));
    const [expense] = await tx.select().from(s.accounts).where(eq(s.accounts.id, expenseAccountId));
    if (!accumulated?.isPostable || !accumulated.code.startsWith("12")) throw new Error("حساب مجمع الإهلاك غير صحيح");
    if (!expense?.isPostable || !/^[56]/.test(expense.code)) throw new Error("حساب مصروف الإهلاك يجب أن يكون من التكاليف أو المصروفات");
    let costCenterId = input.costCenterId ?? null;
    if (input.vehicleId) {
      const [v] = await tx.select().from(s.vehicles).where(eq(s.vehicles.id, input.vehicleId));
      if (!v) throw new Error("المركبة غير موجودة");
      costCenterId = v.costCenterId;
    }
    if (expense.requiresCostCenter && !costCenterId) throw new Error(`مصروف ${expense.nameAr} يتطلب مركبة أو مركز تكلفة`);
    const number = await nextDocumentNumber(tx, "fixed_asset", "FA", Number(input.acquisitionDate.slice(0, 4)));
    const [row] = await tx
      .insert(s.fixedAssets)
      .values({
        number,
        nameAr: input.nameAr.trim(),
        assetAccountId: asset.id,
        accumulatedAccountId,
        expenseAccountId,
        costCenterId,
        vehicleId: input.vehicleId ?? null,
        acquisitionDate: input.acquisitionDate,
        depreciationStart: monthStart(input.depreciationStart || input.acquisitionDate),
        cost: String(round2(input.cost)),
        salvageValue: String(round2(salvage)),
        usefulLifeMonths: input.usefulLifeMonths,
        openingDepreciation: String(round2(opening)),
        notes: input.notes?.trim() || null,
        createdBy: input.userId,
      })
      .returning();
    if (input.offsetAccountId) {
      const entry = await createJournalEntryTx(tx, {
        entryDate: input.acquisitionDate,
        description: `اقتناء أصل ${number} – ${row.nameAr}`,
        source: { type: "fixed_asset", id: row.id },
        post: true,
        userId: input.userId,
        lines: [
          { accountId: asset.id, debit: round2(input.cost), costCenterId, description: row.nameAr },
          { accountId: input.offsetAccountId, credit: round2(input.cost), description: `اقتناء ${row.nameAr}` },
        ],
      });
      await tx.update(s.fixedAssets).set({ acquisitionEntryId: entry.id }).where(eq(s.fixedAssets.id, row.id));
    }
    return row;
  });
}

const monthly = (a: typeof s.fixedAssets.$inferSelect) => round2((num(a.cost) - num(a.salvageValue)) / a.usefulLifeMonths);

/** يُهلك كل الأشهر المستحقة حتى نهاية الشهر المحدد. يعيد قيود الأشهر التي أُنشئت. */
export async function runDepreciation(db: Db, upTo: string, userId?: number) {
  const target = monthEnd(upTo);
  return db.transaction(async (tx) => {
    const assets = await tx.select().from(s.fixedAssets).where(and(lte(s.fixedAssets.depreciationStart, target))).orderBy(asc(s.fixedAssets.id));
    if (!assets.length) return [];
    const done = await tx.select().from(s.assetDepreciation).where(inArray(s.assetDepreciation.assetId, assets.map((a) => a.id)));
    const posted = new Map<number, number>();
    for (const d of done) posted.set(d.assetId, round2((posted.get(d.assetId) ?? 0) + num(d.amount)));
    const has = new Set(done.map((d) => `${d.assetId}|${d.periodEnd}`));
    const start = assets.reduce((m, a) => (monthEnd(a.depreciationStart) < m ? monthEnd(a.depreciationStart) : m), target);
    const created: { periodEnd: string; number: string; amount: number }[] = [];
    for (let end = start; end <= target; end = nextMonthEnd(end)) {
      const due = assets
        .filter((a) => monthEnd(a.depreciationStart) <= end && !has.has(`${a.id}|${end}`))
        .filter((a) => !(a.status === "disposed" && a.disposalDate && a.disposalDate < monthStart(end)))
        .map((a) => {
          const left = round2(num(a.cost) - num(a.salvageValue) - num(a.openingDepreciation) - (posted.get(a.id) ?? 0));
          return { a, amount: round2(Math.min(monthly(a), left)) };
        })
        .filter((x) => x.amount > 0);
      if (!due.length) continue;
      // إن وُجد قيد لهذا الشهر (لأصول أخرى) يُلغى ويُعاد بناؤه شاملاً الجميع
      const existing = done.filter((d) => d.periodEnd === end);
      const all = [...existing.map((d) => ({ a: assets.find((x) => x.id === d.assetId)!, amount: num(d.amount) })), ...due];
      for (const id of new Set(existing.map((d) => d.entryId))) {
        await tx.delete(s.assetDepreciation).where(eq(s.assetDepreciation.entryId, id));
        await deleteEntryTx(tx, id);
      }
      const lines: LineInput[] = all.flatMap(({ a, amount }) => [
        { accountId: a.expenseAccountId, debit: amount, costCenterId: a.costCenterId, description: `إهلاك ${a.number} ${a.nameAr}` },
        { accountId: a.accumulatedAccountId, credit: amount, costCenterId: a.costCenterId, description: `إهلاك ${a.number} ${a.nameAr}` },
      ]);
      const entry = await createJournalEntryTx(tx, { entryDate: end, description: `إهلاك الأصول الثابتة لشهر ${end.slice(0, 7)}`, post: true, userId, lines });
      await tx.insert(s.assetDepreciation).values(all.map(({ a, amount }) => ({ assetId: a.id, periodEnd: end, amount: String(amount), entryId: entry.id })));
      for (const { a, amount } of due) {
        posted.set(a.id, round2((posted.get(a.id) ?? 0) + amount));
        has.add(`${a.id}|${end}`);
      }
      created.push({ periodEnd: end, number: entry.number, amount: round2(all.reduce((t, x) => t + x.amount, 0)) });
    }
    return created;
  });
}

/** يلغي إهلاك آخر شهر مُهلك (لتصحيحه ثم إعادة التشغيل). */
export async function undoLastDepreciation(db: Db) {
  return db.transaction(async (tx) => {
    const [last] = await tx.select().from(s.assetDepreciation).orderBy(desc(s.assetDepreciation.periodEnd)).limit(1);
    if (!last) throw new Error("لا يوجد إهلاك مرحّل");
    const rows = await tx.select().from(s.assetDepreciation).where(eq(s.assetDepreciation.periodEnd, last.periodEnd));
    for (const id of new Set(rows.map((r) => r.entryId))) {
      await tx.delete(s.assetDepreciation).where(eq(s.assetDepreciation.entryId, id));
      await deleteEntryTx(tx, id);
    }
    return last.periodEnd;
  });
}

/** استبعاد الأصل (بيع أو تخريد): يُقفل الأصل ومجمعه، والفرق ربح 4202 أو خسارة 7104. */
export async function disposeAsset(db: Db, id: number, input: { date: string; proceeds: number; proceedsAccountId?: number | null; userId?: number }) {
  return db.transaction(async (tx) => {
    const [a] = await tx.select().from(s.fixedAssets).where(eq(s.fixedAssets.id, id)).for("update");
    if (!a) throw new Error("الأصل غير موجود");
    if (a.status === "disposed") throw new Error("الأصل مستبعد مسبقاً");
    if (input.proceeds > 0 && !input.proceedsAccountId) throw new Error("اختر حساب المتحصلات");
    const [last] = await tx.select({ end: sql<string | null>`max(${s.assetDepreciation.periodEnd})` }).from(s.assetDepreciation).where(eq(s.assetDepreciation.assetId, id));
    if (last.end && last.end > monthEnd(input.date)) throw new Error("يوجد إهلاك بعد تاريخ الاستبعاد؛ ألغه أولاً");
    const [{ dep }] = await tx.select({ dep: sql<string>`coalesce(sum(${s.assetDepreciation.amount}), 0)` }).from(s.assetDepreciation).where(eq(s.assetDepreciation.assetId, id));
    const accumulated = round2(num(a.openingDepreciation) + num(dep));
    const book = round2(num(a.cost) - accumulated);
    const result = round2(input.proceeds - book);
    const lines: LineInput[] = [{ accountId: a.assetAccountId, credit: num(a.cost), costCenterId: a.costCenterId, description: `استبعاد ${a.nameAr}` }];
    if (accumulated > 0) lines.push({ accountId: a.accumulatedAccountId, debit: accumulated, costCenterId: a.costCenterId, description: `مجمع إهلاك ${a.nameAr}` });
    if (input.proceeds > 0) lines.push({ accountId: input.proceedsAccountId!, debit: round2(input.proceeds), description: `متحصلات ${a.nameAr}` });
    if (result > 0) lines.push({ accountId: (await accountByCode(tx, ASSET_ACCOUNTS.gain)).id, credit: result, description: `ربح استبعاد ${a.nameAr}` });
    if (result < 0) lines.push({ accountId: (await accountByCode(tx, ASSET_ACCOUNTS.loss)).id, debit: -result, description: `خسارة استبعاد ${a.nameAr}` });
    const entry = await createJournalEntryTx(tx, { entryDate: input.date, description: `استبعاد الأصل ${a.number} – ${a.nameAr}`, post: true, userId: input.userId, lines });
    await tx.update(s.fixedAssets).set({ status: "disposed", disposalDate: input.date, notes: sql`concat_ws(' · ', ${s.fixedAssets.notes}, ${`قيد الاستبعاد ${entry.number}`}::text)` }).where(eq(s.fixedAssets.id, id));
    return { entry, book, result };
  });
}

export async function deleteAsset(db: Db, id: number, opts: { reason: string; userId?: number }) {
  if (!opts.reason.trim()) throw new Error("اكتب سبب الحذف");
  return db.transaction(async (tx) => {
    const [a] = await tx.select().from(s.fixedAssets).where(eq(s.fixedAssets.id, id)).for("update");
    if (!a) throw new Error("الأصل غير موجود");
    const [dep] = await tx.select({ id: s.assetDepreciation.id }).from(s.assetDepreciation).where(eq(s.assetDepreciation.assetId, id)).limit(1);
    if (dep) throw new Error("على الأصل إهلاك مرحّل؛ ألغِ الإهلاك أولاً أو استبعد الأصل");
    if (a.status === "disposed") throw new Error("الأصل مستبعد؛ لا يُحذف");
    await tx.insert(s.deletionLog).values({ entity: "fixed_asset", entityId: String(id), snapshot: a, reason: opts.reason.trim(), userId: opts.userId });
    await tx.delete(s.fixedAssets).where(eq(s.fixedAssets.id, id));
    if (a.acquisitionEntryId) await deleteEntryTx(tx, a.acquisitionEntryId);
  });
}

/** سجل الأصول بقيمها الدفترية. */
export async function listAssets(db: Db | Tx) {
  const rows = await db
    .select({
      a: s.fixedAssets,
      account: s.accounts.nameAr,
      code: s.accounts.code,
      costCenter: s.costCenters.nameAr,
      plate: s.vehicles.plate,
      depreciated: sql<string>`coalesce((select sum(d.amount) from asset_depreciation d where d.asset_id = fixed_assets.id), 0)`,
      lastPeriod: sql<string | null>`(select max(d.period_end) from asset_depreciation d where d.asset_id = fixed_assets.id)`,
    })
    .from(s.fixedAssets)
    .innerJoin(s.accounts, eq(s.accounts.id, s.fixedAssets.assetAccountId))
    .leftJoin(s.costCenters, eq(s.costCenters.id, s.fixedAssets.costCenterId))
    .leftJoin(s.vehicles, eq(s.vehicles.id, s.fixedAssets.vehicleId))
    .orderBy(asc(s.accounts.code), asc(s.fixedAssets.number));
  return rows.map((r) => {
    const accumulated = round2(num(r.a.openingDepreciation) + num(r.depreciated));
    return { ...r, accumulated, book: round2(num(r.a.cost) - accumulated), monthly: monthly(r.a) };
  });
}

export async function assetSchedule(db: Db | Tx, id: number) {
  return db
    .select({ periodEnd: s.assetDepreciation.periodEnd, amount: s.assetDepreciation.amount, entry: s.journalEntries.number, entryId: s.journalEntries.id })
    .from(s.assetDepreciation)
    .innerJoin(s.journalEntries, eq(s.journalEntries.id, s.assetDepreciation.entryId))
    .where(eq(s.assetDepreciation.assetId, id))
    .orderBy(asc(s.assetDepreciation.periodEnd));
}
