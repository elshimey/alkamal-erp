"use server";

// ختام الجولة: القيود التي تكوّنت فعلاً أثناءها (أنشأها المستخدم نفسه منذ بداية الجولة).
import { and, desc, eq, gte, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requireUser } from "@/lib/auth";

export interface TourEntry {
  id: number;
  number: string;
  memo: string;
  status: string;
  lines: { side: "dr" | "cr"; account: string }[];
}

export async function tourEntries(since: string): Promise<TourEntry[]> {
  const user = await requireUser();
  const from = new Date(since);
  if (Number.isNaN(from.getTime())) return [];
  const entries = await db
    .select({ id: s.journalEntries.id, number: s.journalEntries.number, memo: s.journalEntries.description, status: s.journalEntries.status })
    .from(s.journalEntries)
    .where(and(gte(s.journalEntries.createdAt, from), or(eq(s.journalEntries.createdBy, user.id), isNull(s.journalEntries.createdBy))))
    .orderBy(desc(s.journalEntries.id))
    .limit(8);
  if (!entries.length) return [];
  const lines = await db
    .select({ entryId: s.journalLines.entryId, debit: s.journalLines.debit, code: s.accounts.code, name: s.accounts.nameAr })
    .from(s.journalLines)
    .innerJoin(s.accounts, eq(s.accounts.id, s.journalLines.accountId))
    .where(
      inArray(
        s.journalLines.entryId,
        entries.map((e) => e.id),
      ),
    )
    .orderBy(s.journalLines.entryId, s.journalLines.lineNo);
  return entries.reverse().map((e) => ({
    id: e.id,
    number: e.number,
    memo: e.memo ?? "",
    status: e.status,
    lines: lines.filter((l) => l.entryId === e.id).map((l) => ({ side: Number(l.debit) > 0 ? "dr" : "cr", account: `${l.code} ${l.name}` })),
  }));
}
