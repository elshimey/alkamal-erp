import { and, asc, eq, inArray, or } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import * as s from "@/db/schema";
import { isTaxBehavior, normalizeTaxName, TAX_BEHAVIORS, type TaxSide } from "@/data/tax-codes";

// أنواع الضريبة: القائمة في الشاشات، والتحقق في الخادم، والإضافة «يتصرف مثل».

export type TaxCodeRow = typeof s.taxCodes.$inferSelect;

const sides = (side: Exclude<TaxSide, "both">) => or(eq(s.taxCodes.side, side), eq(s.taxCodes.side, "both"));

/** أنواع الضريبة النشطة لجهة (مبيعات أو مشتريات) بترتيب وافق. */
export async function taxCodesFor(db: Db | Tx, side: Exclude<TaxSide, "both">) {
  return db
    .select()
    .from(s.taxCodes)
    .where(and(eq(s.taxCodes.isActive, true), sides(side)))
    .orderBy(asc(s.taxCodes.sort), asc(s.taxCodes.id));
}

/** خيارات القائمة المنسدلة: القيمة رقم النوع، والاسم كما في وافق مع نسبته. */
export async function taxCodeOptions(db: Db | Tx, side: Exclude<TaxSide, "both">) {
  return (await taxCodesFor(db, side)).map((t) => ({ value: String(t.id), label: `${t.nameAr} (${Number(t.rate)}%)`, rate: Number(t.rate), code: t.code, reverse: t.behavior === "reverse" }));
}

export async function taxCodeByCode(db: Db | Tx, code: string) {
  const [row] = await db.select().from(s.taxCodes).where(eq(s.taxCodes.code, code));
  return row ?? null;
}

/** النوع المختار بعد التحقق أنه نشط ولجهة المستند. */
export async function requireTaxCode(db: Db | Tx, id: number, side: Exclude<TaxSide, "both">) {
  const [row] = await db.select().from(s.taxCodes).where(eq(s.taxCodes.id, id));
  if (!row || !row.isActive) throw new Error("نوع الضريبة غير موجود");
  if (row.side !== side && row.side !== "both") throw new Error(`«${row.nameAr}» ليس من ضرائب ${side === "sales" ? "المبيعات" : "المشتريات"}`);
  return row;
}

/** خريطة الأنواع بالأرقام (لعرض الأسماء في المستندات). */
export async function taxCodeMap(db: Db | Tx, ids: (number | null | undefined)[]) {
  const list = [...new Set(ids.filter((x): x is number => x != null))];
  if (!list.length) return new Map<number, TaxCodeRow>();
  const rows = await db.select().from(s.taxCodes).where(inArray(s.taxCodes.id, list));
  return new Map(rows.map((r) => [r.id, r]));
}

/** يطابق نص خلية Excel باسم النوع (كما في وافق، مع «(15.00%)» أو دونها) أو برمزه. */
export function matchTaxCode(rows: TaxCodeRow[], raw: string) {
  const key = normalizeTaxName(raw);
  if (!key) return null;
  return rows.find((t) => normalizeTaxName(t.nameAr) === key || t.code.toLowerCase() === key) ?? null;
}

/** يضيف نوع ضريبة باسم جديد «يتصرف مثل» سلوك أساسي. */
export async function addTaxCode(db: Db | Tx, input: { name: string; behavior: string }) {
  const name = input.name.trim();
  if (!name) throw new Error("اكتب اسم الضريبة");
  if (!isTaxBehavior(input.behavior)) throw new Error("اختر «يتصرف مثل»");
  const b = TAX_BEHAVIORS[input.behavior];
  const all = await db.select().from(s.taxCodes);
  if (all.some((t) => normalizeTaxName(t.nameAr) === normalizeTaxName(name))) throw new Error(`«${name}» موجود مسبقاً`);
  const [acc] = b.account ? await db.select({ id: s.accounts.id }).from(s.accounts).where(eq(s.accounts.code, b.account)) : [];
  const code = `T${Date.now().toString(36).toUpperCase()}`.slice(0, 20);
  const [row] = await db
    .insert(s.taxCodes)
    .values({
      code,
      nameAr: name,
      kind: b.kind,
      rate: String(b.rate),
      accountId: acc?.id ?? null,
      behavior: input.behavior,
      side: b.side,
      category: b.category,
      exemptionCode: b.exemptionCode,
      exemptionReason: b.exemptionReason,
      sort: 100 + all.length,
    })
    .returning();
  return row;
}

/** تفعيل أو إيقاف نوع أضافه المستخدم (الأساسية لا تُوقف). */
export async function setTaxCodeActive(db: Db | Tx, id: number, active: boolean) {
  const [row] = await db.select().from(s.taxCodes).where(eq(s.taxCodes.id, id));
  if (!row) throw new Error("نوع الضريبة غير موجود");
  if (!active && !row.code.startsWith("T")) throw new Error("الأنواع الأساسية لا تُوقف");
  await db.update(s.taxCodes).set({ isActive: active }).where(eq(s.taxCodes.id, id));
}
