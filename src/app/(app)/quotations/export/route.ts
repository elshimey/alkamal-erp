import ExcelJS from "exceljs";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { todayRiyadh } from "@/lib/dates";
import { listQuotations, parseQuoteFilter, quotationLinesFor, QUOTE_STATUS, SHIPPING_TYPES } from "@/lib/quotations";

// تصدير عروض الأسعار الظاهرة حسب الفلتر: بند في كل صف (مثل الورقة) إلى Excel أو CSV أو نص للحافظة.
const HEAD = ["رقم العرض", "التاريخ", "صالح حتى", "العميل", "نوع الشحن", "المرجع", "العملة", "الحالة", "البند", "الكمية", "السعر", "الضريبة %", "قبل الضريبة", "الضريبة", "إجمالي البند", "إجمالي العرض", "الفاتورة", "ملاحظات"];

export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (!can(user.perms, "sales_invoices", "view")) return new Response("Forbidden", { status: 403 });
  const sp = Object.fromEntries(req.nextUrl.searchParams);
  const format = sp.format === "csv" || sp.format === "tsv" ? sp.format : "xlsx";
  const quotes = await listQuotations(db, parseQuoteFilter(sp, todayRiyadh()), 5000);
  const lines = await quotationLinesFor(db, quotes.map((x) => x.q.id));
  const byQuote = Map.groupBy(lines, (l) => l.quotationId);
  const rows: (string | number)[][] = [];
  for (const { q, customer, invoice } of quotes) {
    for (const l of byQuote.get(q.id) ?? []) {
      const amount = Number(l.amount);
      const vat = Number(l.vatAmount);
      rows.push([q.number, q.quoteDate, q.validUntil, customer, SHIPPING_TYPES[q.shippingType].short, q.reference ?? "", q.currencyCode, QUOTE_STATUS[q.status].label, l.description, Number(l.quantity), Number(l.unitPrice), Number(l.vatRate), amount, vat, amount + vat, Number(q.total), invoice ?? "", q.notes ?? ""]);
    }
  }
  const name = `عروض-الأسعار-${todayRiyadh()}`;
  const disposition = (ext: string) => `attachment; filename="quotations-${todayRiyadh()}.${ext}"; filename*=UTF-8''${encodeURIComponent(`${name}.${ext}`)}`;

  if (format !== "xlsx") {
    const sep = format === "csv" ? "," : "\t";
    const q = (v: string | number) => (format === "csv" ? `"${String(v).replace(/"/g, '""')}"` : String(v).replace(/[\t\n]/g, " "));
    const text = [HEAD, ...rows].map((r) => r.map(q).join(sep)).join("\r\n");
    if (format === "tsv") return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
    return new Response(`﻿${text}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": disposition("csv"), "Cache-Control": "no-store" } });
  }

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("عروض الأسعار", { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
  ws.addRow(HEAD);
  rows.forEach((r) => ws.addRow(r));
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1B2126" } };
  ws.columns.forEach((c, i) => {
    c.width = [14, 12, 12, 28, 9, 22, 8, 10, 34, 8, 12, 9, 13, 11, 13, 13, 14, 26][i] ?? 12;
    if (i >= 9 && i <= 15) c.numFmt = "#,##0.00";
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: HEAD.length } };
  const file = await wb.xlsx.writeBuffer();
  return new Response(new Uint8Array(file as ArrayBuffer), {
    headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": disposition("xlsx"), "Cache-Control": "no-store" },
  });
}
