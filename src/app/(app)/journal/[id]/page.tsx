import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { entryDoc } from "@/lib/journal";
import { getCompany, getInvoiceTemplate } from "@/lib/company";
import { AutoPrint, PrintButton } from "@/components/print-button";
import { JournalVoucher } from "@/components/journal-voucher";

export default async function EntryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ print?: string }> }) {
  await requirePermission("journal_entries", "view");
  const id = Number((await params).id);
  const [doc, company, template] = await Promise.all([Number.isInteger(id) ? entryDoc(db, id) : null, getCompany(db), getInvoiceTemplate(db)]);
  if (!doc) notFound();
  return (
    <div className="mx-auto max-w-4xl">
      {(await searchParams).print === "1" && <AutoPrint />}
      <div className="mb-4 flex items-center gap-2 print:hidden">
        <Link href={`/journal?open=${id}`} className="text-sm text-brand-700 hover:underline">
          ← القيود اليومية
        </Link>
        <span className="ms-auto">
          <PrintButton />
        </span>
      </div>
      <JournalVoucher company={company} doc={doc} template={template} />
    </div>
  );
}
