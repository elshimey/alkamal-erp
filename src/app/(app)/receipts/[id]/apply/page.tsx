import { notFound } from "next/navigation";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { openInvoices, receiptDoc } from "@/lib/receipts";
import { todayRiyadh } from "@/lib/dates";
import { PageHeader } from "@/components/ui";
import { ApplyForm } from "./form";

export default async function ApplyAdvancePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("receipts", "create");
  const id = Number((await params).id);
  const doc = Number.isInteger(id) ? await receiptDoc(db, id) : null;
  if (!doc || doc.r.kind !== "advance") notFound();
  const applied = doc.allocations.reduce((t, a) => t + Number(a.amount), 0);
  const remaining = Math.round((Number(doc.r.amount) - applied) * 100) / 100;
  const invoices = await openInvoices(db, doc.r.customerId, doc.r.currencyCode);
  return (
    <>
      <PageHeader title={`تطبيق الدفعة المقدمة ${doc.r.number}`} description={`${doc.customer.nameAr} · المتبقي غير المطبق ${remaining.toFixed(2)} ${doc.r.currencyCode}`} />
      <ApplyForm receiptId={id} remaining={remaining} invoices={invoices} today={todayRiyadh()} minDate={doc.r.receiptDate} posted={doc.r.status === "posted"} />
    </>
  );
}
