import { and, eq, like, sql } from "drizzle-orm";
import type { Db } from "@/db";
import * as s from "@/db/schema";

/**
 * يضيف حساباً فرعياً برمز تلقائي (رمز الأب + رقمان). الأب يصبح تجميعياً،
 * ولذلك يُرفض إن كانت عليه سطور قيود.
 */
export async function addSubAccount(db: Db, parentId: number, nameAr: string, currencyCode?: string | null) {
  return db.transaction(async (tx) => {
    const [parent] = await tx.select().from(s.accounts).where(eq(s.accounts.id, parentId)).for("update");
    if (!parent) throw new Error("الحساب الأب غير موجود");
    if (parent.level >= 4) throw new Error("لا يمكن إضافة حساب تحت المستوى الرابع");
    if (parent.isPostable) {
      const [{ n }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(s.journalLines)
        .where(eq(s.journalLines.accountId, parent.id));
      if (n > 0) throw new Error(`الحساب ${parent.code} عليه قيود، فلا يمكن جعله تجميعياً`);
    }

    const width = parent.level === 1 ? 1 : 2;
    const siblings = await tx
      .select({ code: s.accounts.code })
      .from(s.accounts)
      .where(and(eq(s.accounts.parentId, parent.id), like(s.accounts.code, `${parent.code}%`)));
    const max = siblings.reduce((m, r) => Math.max(m, Number(r.code.slice(parent.code.length)) || 0), 0);
    const next = max + 1;
    if (String(next).length > width) throw new Error("امتلأت أرقام المستوى تحت هذا الحساب");
    const code = parent.code + String(next).padStart(width, "0");

    const [account] = await tx
      .insert(s.accounts)
      .values({
        code,
        nameAr: nameAr.trim(),
        parentId: parent.id,
        level: parent.level + 1,
        type: parent.type,
        normalBalance: parent.normalBalance,
        isPostable: true,
        requiresCostCenter: parent.requiresCostCenter || parent.type === "cost_of_revenue",
        currencyCode: currencyCode || parent.currencyCode,
      })
      .returning();
    if (parent.isPostable) {
      await tx.update(s.accounts).set({ isPostable: false }).where(eq(s.accounts.id, parent.id));
    }
    return account;
  });
}
