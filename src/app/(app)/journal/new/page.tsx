import Link from "next/link";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { entryDoc } from "@/lib/journal";
import { journalOptions } from "@/lib/journal-options";
import { todayRiyadh } from "@/lib/dates";
import { EntryForm } from "../entry-form";

export default async function NewEntryPage({ searchParams }: { searchParams: Promise<{ copy?: string }> }) {
  const user = await requirePermission("journal_entries", "create");
  const copyId = Number((await searchParams).copy) || null;
  const [opts, copy] = await Promise.all([journalOptions(), copyId ? entryDoc(db, copyId) : null]);
  return (
    <div className="animate-rise">
      <div className="mb-5 flex items-center gap-2 text-sm text-gray-500">
        <Link href="/journal" className="hover:text-brand-700">
          القيود اليومية
        </Link>
        <span>›</span>
        <span className="font-semibold text-brand-900">{copy ? `نسخة من ${copy.e.number}` : "قيد جديد"}</span>
      </div>
      <EntryForm
        {...opts}
        canPost={can(user.perms, "journal_entries", "approve")}
        initial={{
          entryDate: todayRiyadh(),
          description: copy?.e.description ?? "",
          reference: "",
          lines: (copy?.lines ?? []).map(({ l }) => ({ accountId: String(l.accountId), description: l.description ?? "", costCenterId: l.costCenterId ? String(l.costCenterId) : "", partyId: l.partyId ? String(l.partyId) : "", debit: Number(l.debitBase) ? String(Number(l.debitBase)) : "", credit: Number(l.creditBase) ? String(Number(l.creditBase)) : "" })),
        }}
      />
    </div>
  );
}
