import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { todayRiyadh } from "@/lib/dates";
import { customerOptions } from "@/lib/lookups";
import { expenseAccountOptions, supplierOptions } from "@/lib/purchases";
import { NOTE_KINDS, NOTE_SIDES, type NoteKind, type NoteSide } from "@/data/sales";
import { NoteForm } from "./form";

export default async function NewNotePage({ params, searchParams }: { params: Promise<{ side: string }>; searchParams: Promise<{ kind?: string; party?: string; invoice?: string }> }) {
  const sideKey = (await params).side;
  if (!(sideKey in NOTE_SIDES)) notFound();
  const side = sideKey as NoteSide;
  const cfg = NOTE_SIDES[side];
  const user = await requirePermission(cfg.entity, "create");
  const sp = await searchParams;
  const kind: NoteKind = (cfg.kinds as readonly string[]).includes(sp.kind ?? "") ? (sp.kind as NoteKind) : cfg.kinds[0];
  const [parties, accounts, centers, currencies] = await Promise.all([
    side === "sales" ? customerOptions() : supplierOptions(db),
    side === "sales"
      ? db
          .select({ id: s.accounts.id, code: s.accounts.code, nameAr: s.accounts.nameAr })
          .from(s.accounts)
          .where(and(eq(s.accounts.type, "revenue"), eq(s.accounts.isPostable, true), eq(s.accounts.isActive, true)))
          .orderBy(asc(s.accounts.code))
          .then((rows) => rows.map((a) => ({ value: String(a.id), label: `${a.code} ${a.nameAr}` })))
      : expenseAccountOptions(db),
    db.select({ id: s.costCenters.id, code: s.costCenters.code, nameAr: s.costCenters.nameAr }).from(s.costCenters).where(eq(s.costCenters.isActive, true)).orderBy(asc(s.costCenters.code)),
    db.select({ code: s.currencies.code }).from(s.currencies).orderBy(asc(s.currencies.code)),
  ]);
  return (
    <div className="animate-rise">
      <div className="mb-5 flex flex-wrap items-center gap-2 text-sm text-gray-500">
        <Link href={`/notes/${side}`} className="hover:text-brand-700">
          {cfg.title}
        </Link>
        <span>›</span>
        <span className="font-semibold text-brand-900">{NOTE_KINDS[kind].label} جديد</span>
      </div>
      <NoteForm
        side={side}
        kind={kind}
        parties={parties}
        accounts={accounts}
        centers={centers.map((c) => ({ value: String(c.id), label: c.nameAr }))}
        currencies={currencies.map((c) => c.code)}
        today={todayRiyadh()}
        initialParty={sp.party ?? ""}
        initialInvoice={Number(sp.invoice) || null}
        willPost={can(user.perms, cfg.entity, "approve")}
      />
    </div>
  );
}
