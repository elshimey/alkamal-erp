import ExcelJS from "exceljs";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { requireUser } from "@/lib/auth";
import { can, hasSpecial, scopeFor } from "@/lib/permissions";
import { todayRiyadh } from "@/lib/dates";
import { listWaybills, parseWaybillFilter } from "@/lib/waybills";
import { WAYBILL_STATUS } from "@/data/waybills";

// تصدير الشحنات الظاهرة حسب الفلتر إلى Excel أو CSV أو نص للحافظة. الأسعار لمن يملك صلاحية رؤيتها فقط.
export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (!can(user.perms, "waybills", "view")) return new Response("Forbidden", { status: 403 });
  const prices = hasSpecial(user.perms, "view_prices");
  const sp = Object.fromEntries(req.nextUrl.searchParams);
  const format = sp.format === "csv" || sp.format === "tsv" ? sp.format : "xlsx";
  const filter = { ...parseWaybillFilter(sp, todayRiyadh()), driverUserId: scopeFor(user.perms, "waybills", "view") === "own" ? user.id : undefined };
  const { rows: list } = await listWaybills(db, filter, 5000);
  const head = ["رقم الشحنة", "التاريخ", "العميل", "المسار", "نوع الشحن", "الضريبة %", "المركبة / الناقل", "السائق", "المرسل", "المستلم", ...(prices ? ["المبلغ", "الضريبة", "الإجمالي", "العملة"] : []), "الوزن (طن)", "رقم الحاوية", "سند التسليم", "الحالة", "الفاتورة", "ملاحظات"];
  const rows = list.map((r) => {
    const { w } = r;
    const vat = w.isInternational ? 0 : 15;
    const amount = Number(w.amount);
    const state = w.status !== "approved" ? WAYBILL_STATUS[w.status].label : !r.invoiceId ? "معتمدة · بانتظار الفوترة" : r.invoiceWaybills > 1 ? "مدمجة" : "في مسودة فاتورة";
    return [
      w.number,
      w.waybillDate,
      r.customer,
      r.route,
      w.isInternational ? "دولي" : "داخلي",
      vat,
      r.plate ?? r.carrier ?? "",
      r.driver ?? w.carrierDriverName ?? "",
      w.shipper,
      w.consignee,
      ...(prices ? [amount, Math.round(amount * vat) / 100, Math.round(amount * (100 + vat)) / 100, w.currencyCode] : []),
      w.weightTons != null ? Number(w.weightTons) : "",
      w.containerNumber ?? "",
      w.deliveryNoteNumber ?? "",
      state,
      r.invoice ?? "",
      w.notes ?? "",
    ];
  });
  const name = `الشحنات-${todayRiyadh()}`;
  const disposition = (ext: string) => `attachment; filename="waybills-${todayRiyadh()}.${ext}"; filename*=UTF-8''${encodeURIComponent(`${name}.${ext}`)}`;

  if (format !== "xlsx") {
    const sep = format === "csv" ? "," : "\t";
    const q = (v: string | number) => (format === "csv" ? `"${String(v).replace(/"/g, '""')}"` : String(v).replace(/[\t\n]/g, " "));
    const text = [head, ...rows].map((r) => r.map(q).join(sep)).join("\r\n");
    if (format === "tsv") return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
    return new Response(`﻿${text}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": disposition("csv"), "Cache-Control": "no-store" } });
  }

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("الشحنات", { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
  ws.addRow(head);
  rows.forEach((r) => ws.addRow(r));
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1B2126" } };
  ws.columns.forEach((c, i) => {
    c.width = [14, 12, 26, 24, 9, 9, 16, 18, 20, 20][i] ?? 13;
    if (prices && i >= 10 && i <= 12) c.numFmt = "#,##0.00";
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: head.length } };
  const file = await wb.xlsx.writeBuffer();
  return new Response(new Uint8Array(file as ArrayBuffer), {
    headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": disposition("xlsx"), "Cache-Control": "no-store" },
  });
}
