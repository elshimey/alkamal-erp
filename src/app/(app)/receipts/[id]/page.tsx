import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { receiptDoc } from "@/lib/receipts";
import { getCompany, getInvoiceTemplate } from "@/lib/company";
import { AutoPrint, PrintButton } from "@/components/print-button";
import { ReceiptVoucher } from "@/components/receipt-voucher";

export default async function ReceiptPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ print?: string }> }) {
  await requirePermission("receipts", "view");
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const print = (await searchParams).print === "1";
  const [doc, company, template] = await Promise.all([receiptDoc(db, id), getCompany(db), getInvoiceTemplate(db)]);
  if (!doc) notFound();
  return (
    <div className="mx-auto max-w-3xl">
      {print && <AutoPrint />}
      <div className="mb-4 flex items-center gap-2 print:hidden">
        <Link href={`/receipts?open=${id}`} className="text-sm text-brand-700 hover:underline">
          ← سندات العملاء
        </Link>
        <span className="ms-auto">
          <PrintButton />
        </span>
      </div>
      <ReceiptVoucher company={company} doc={doc} template={template} />
    </div>
  );
}
