import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requireUser } from "@/lib/auth";

/**
 * مستند القيد من نوعه ورقمه الداخلي (مصدر الرقم والكشوف): يفتح صفحة المستند، أو قائمته مفتوحاً فيها،
 * وما ليس له صفحة (سند الصرف، المصروف، التحويل…) يفتح القيد نفسه (`je`). صلاحية العرض تفحصها الصفحة المفتوحة.
 */
export default async function GoToSource({ params, searchParams }: { params: Promise<{ type: string; id: string }>; searchParams: Promise<{ je?: string }> }) {
  await requireUser();
  const { type, id: raw } = await params;
  const id = Number(raw);
  const je = Number((await searchParams).je) || null;
  if (!Number.isInteger(id) || id <= 0) notFound();
  const direct: Record<string, string> = {
    waybill: `/waybills/${id}`,
    sales_invoice: `/invoices/${id}`,
    invoice_charge: `/invoices/${id}`,
    receipt: `/receipts/${id}`,
    purchase_invoice: `/purchases/${id}`,
    maintenance_order: `/maintenance/${id}`,
    payroll_run: `/payroll/${id}`,
    payroll_payment: `/payroll/${id}`,
    fixed_asset: `/fixed-assets?open=${id}`,
    traffic_violation: `/violations?open=${id}`,
    violation_payment: `/violations?open=${id}`,
    custody: `/hr/custody?open=${id}`,
    custody_close: `/hr/custody?open=${id}`,
    stock_doc: `/inventory/docs?open=${id}`,
  };
  if (direct[type]) redirect(direct[type]);
  if (type === "adjustment_note") {
    const [n] = await db.select({ kind: s.adjustmentNotes.kind }).from(s.adjustmentNotes).where(eq(s.adjustmentNotes.id, id));
    if (n) redirect(`/notes/${n.kind.startsWith("sales") ? "sales" : "purchase"}?open=${id}`);
  }
  if (type === "waybill_charge") {
    const [x] = await db.select({ waybillId: s.waybillExpenses.waybillId, invoiceId: s.waybillExpenses.invoiceId }).from(s.waybillExpenses).where(eq(s.waybillExpenses.id, id));
    if (x?.waybillId) redirect(`/waybills/${x.waybillId}`);
    if (x?.invoiceId) redirect(`/invoices/${x.invoiceId}`);
  }
  if (je) redirect(`/journal/${je}`);
  notFound();
}
