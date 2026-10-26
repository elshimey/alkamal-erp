import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";

// صفحة العرض الواحد صارت معاينة بجانب القائمة؛ الروابط القديمة تُحوَّل إليها.
export default async function QuotationPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("sales_invoices", "view");
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  redirect(`/quotations?open=${id}`);
}
