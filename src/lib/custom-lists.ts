import { and, asc, eq } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import * as s from "@/db/schema";
import { CUSTOM_LISTS, type CustomList } from "@/data/custom-lists";

// العناصر التي يضيفها المستخدم للقوائم الثابتة (انظر src/data/custom-lists.ts).

/** خيارات القائمة: العناصر الأساسية ثم المضافة، والمضافة بقيمة «الأساسية~رقم». */
export async function customListOptions(db: Db | Tx, list: CustomList) {
  const def = CUSTOM_LISTS[list];
  const rows = await db
    .select()
    .from(s.lookupValues)
    .where(and(eq(s.lookupValues.list, list), eq(s.lookupValues.isActive, true)))
    .orderBy(asc(s.lookupValues.label));
  if (!def.base) return rows.map((r) => ({ value: r.label, label: r.label }));
  const base = Object.entries(def.base).map(([value, label]) => ({ value, label }));
  return [...base, ...rows.filter((r) => r.base && r.base in def.base!).map((r) => ({ value: `${r.base}~${r.id}`, label: r.label, hint: `مثل «${def.base![r.base!]}»` }))];
}

/** أسماء العناصر المضافة بأرقامها، لعرضها بدل القيمة الأساسية في الجداول. */
export async function customLabels(db: Db | Tx) {
  const rows = await db.select({ id: s.lookupValues.id, label: s.lookupValues.label }).from(s.lookupValues);
  return new Map(rows.map((r) => [r.id, r.label]));
}

/** يضيف عنصراً للقائمة (أو يعيد الموجود بالاسم نفسه)؛ base إلزامية للقوائم ذات القيم الأساسية. */
export async function addCustomValue(db: Db | Tx, list: CustomList, label: string, base?: string | null) {
  const def = CUSTOM_LISTS[list];
  const name = label.trim();
  if (!name) throw new Error("اكتب الاسم");
  if (def.base) {
    if (!base || !(base in def.base)) throw new Error("اختر «يتصرف مثل»");
    const same = Object.entries(def.base).find(([, l]) => l === name);
    if (same) return { value: same[0], label: name };
  }
  const [existing] = await db
    .select()
    .from(s.lookupValues)
    .where(and(eq(s.lookupValues.list, list), eq(s.lookupValues.label, name)));
  const row =
    existing ??
    (
      await db
        .insert(s.lookupValues)
        .values({ list, label: name, base: def.base ? base! : null })
        .returning()
    )[0];
  if (!row.isActive) await db.update(s.lookupValues).set({ isActive: true }).where(eq(s.lookupValues.id, row.id));
  return def.base ? { value: `${row.base}~${row.id}`, label: row.label } : { value: row.label, label: row.label };
}

/** يتحقق أن العنصر المضاف من القائمة الصحيحة وأساسه يطابق القيمة المحفوظة. */
export async function checkCustomValue(db: Db | Tx, list: CustomList, base: string | null, classId: number | null) {
  if (!classId) return null;
  const [row] = await db.select().from(s.lookupValues).where(eq(s.lookupValues.id, classId));
  if (!row || row.list !== list || row.base !== base) throw new Error(`${CUSTOM_LISTS[list].label}: العنصر المختار غير موجود`);
  return classId;
}
