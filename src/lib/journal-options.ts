import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";

/** قوائم نموذج القيد: الحسابات التفصيلية ومراكز التكلفة والجهات. */
export async function journalOptions() {
  const [accounts, centers, parties] = await Promise.all([
    db.select({ id: s.accounts.id, code: s.accounts.code, nameAr: s.accounts.nameAr, cc: s.accounts.requiresCostCenter }).from(s.accounts).where(and(eq(s.accounts.isPostable, true), eq(s.accounts.isActive, true))).orderBy(asc(s.accounts.code)),
    db.select({ id: s.costCenters.id, nameAr: s.costCenters.nameAr, code: s.costCenters.code }).from(s.costCenters).where(eq(s.costCenters.isActive, true)).orderBy(asc(s.costCenters.code)),
    db.select({ id: s.parties.id, nameAr: s.parties.nameAr }).from(s.parties).orderBy(asc(s.parties.nameAr)),
  ]);
  return {
    accounts: accounts.map((a) => ({ value: String(a.id), label: `${a.code} ${a.nameAr}`, code: a.code, cc: a.cc })),
    centers: centers.map((c) => ({ value: String(c.id), label: c.nameAr, code: c.code })),
    parties: parties.map((p) => ({ value: String(p.id), label: p.nameAr })),
  };
}
