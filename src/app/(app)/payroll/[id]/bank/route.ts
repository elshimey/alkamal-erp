import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { bankTransferRows } from "@/lib/payroll";

// ملف CSV للتحويل البنكي (يفتح في Excel بالعربية): الاسم، الهوية، البنك، الآيبان، الصافي
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission("payroll", "export");
  const id = Number((await params).id);
  const [run] = await db.select().from(s.payrollRuns).where(eq(s.payrollRuns.id, id));
  if (!run) return new Response("غير موجود", { status: 404 });
  const rows = await bankTransferRows(db, id);
  const q = (v: string | number | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [
    ["الاسم", "الهوية", "البنك", "الآيبان", "المبلغ"].map(q).join(","),
    ...rows.map((r) => [r.name, r.nationalId, r.bank, r.iban, r.net.toFixed(2)].map(q).join(",")),
  ].join("\r\n");
  return new Response(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="payroll-${run.month.slice(0, 7)}.csv"`,
    },
  });
}
