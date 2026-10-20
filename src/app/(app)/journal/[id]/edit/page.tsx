import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { entryDoc } from "@/lib/journal";
import { journalOptions } from "@/lib/journal-options";
import { EntryForm } from "../../entry-form";

export default async function EditEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("journal_entries", "update");
  const id = Number((await params).id);
  const doc = Number.isInteger(id) ? await entryDoc(db, id) : null;
  if (!doc) notFound();
  if (doc.e.sourceType || doc.e.status === "posted") redirect(`/journal?open=${id}`);
  const opts = await journalOptions();
  return (
    <div className="animate-rise">
      <div className="mb-5 flex items-center gap-2 text-sm text-gray-500">
        <Link href="/journal" className="hover:text-brand-700">
          القيود اليومية
        </Link>
        <span>›</span>
        <span className="ltr-nums font-semibold text-brand-900">{doc.e.number}</span>
      </div>
      <EntryForm
        {...opts}
        entryId={id}
        canPost={can(user.perms, "journal_entries", "approve")}
        initial={{
          entryDate: doc.e.entryDate,
          description: doc.e.description ?? "",
          reference: doc.e.reference ?? "",
          lines: doc.lines.map(({ l }) => ({ accountId: String(l.accountId), description: l.description ?? "", costCenterId: l.costCenterId ? String(l.costCenterId) : "", partyId: l.partyId ? String(l.partyId) : "", debit: Number(l.debit) ? String(Number(l.debit)) : "", credit: Number(l.credit) ? String(Number(l.credit)) : "" })),
        }}
      />
    </div>
  );
}
