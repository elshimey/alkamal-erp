import { like } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import * as s from "@/db/schema";

export const COST_CENTER_TYPES = { admin: "إداري", workshop: "ورشة", other: "أخرى" } as const;
export type ManualCostCenterType = keyof typeof COST_CENTER_TYPES;

/**
 * مركز تكلفة يدوي (المقطورات، الإدارة، فرع…) لما ليس مركبة (ملاحظات التشغيل 10 و11 و17).
 * مركز المركبة لا يُنشأ هنا: يُنشأ مع المركبة نفسها (createVehicle). الرمز فارغ = CC-1، CC-2…
 */
export async function createCostCenter(db: Db | Tx, input: { nameAr: string; code?: string | null; type?: string | null }) {
  const nameAr = input.nameAr.trim();
  if (!nameAr) throw new Error("اكتب اسم مركز التكلفة");
  const type = (input.type || "other") as ManualCostCenterType;
  if (!(type in COST_CENTER_TYPES)) throw new Error("نوع المركز: إداري أو ورشة أو أخرى (مركز المركبة يُنشأ مع المركبة)");
  return db.transaction(async (tx) => {
    const all = await tx.select({ code: s.costCenters.code, nameAr: s.costCenters.nameAr }).from(s.costCenters);
    const norm = (x: string) => x.replace(/\s+/g, " ").trim();
    if (all.some((c) => norm(c.nameAr) === norm(nameAr))) throw new Error(`مركز التكلفة «${nameAr}» موجود`);
    let code = input.code?.trim().toUpperCase() || "";
    if (code) {
      if (code.startsWith("V-")) throw new Error("الرمز V- محجوز لمراكز المركبات");
      if (all.some((c) => c.code.toUpperCase() === code)) throw new Error(`الرمز ${code} مستخدم لمركز آخر`);
    } else {
      const used = new Set((await tx.select({ code: s.costCenters.code }).from(s.costCenters).where(like(s.costCenters.code, "CC-%"))).map((c) => c.code));
      let n = 1;
      while (used.has(`CC-${n}`)) n++;
      code = `CC-${n}`;
    }
    const [row] = await tx.insert(s.costCenters).values({ code, nameAr, type }).returning();
    return row;
  });
}

