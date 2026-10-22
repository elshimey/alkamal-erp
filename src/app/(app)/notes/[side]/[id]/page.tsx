import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { noteDoc } from "@/lib/notes";
import { getCompany, getInvoiceTemplate } from "@/lib/company";
import { NOTE_KINDS, NOTE_SIDES, type NoteSide } from "@/data/sales";
import { AutoPrint, PrintButton } from "@/components/print-button";
import { NoteDocument } from "@/components/note-document";
import { SendDocument } from "@/components/send-document";
import { noteQr } from "@/lib/zatca/service";
import { qrSvg } from "@/lib/zatca-qr";

export default async function NotePage({ params, searchParams }: { params: Promise<{ side: string; id: string }>; searchParams: Promise<{ print?: string }> }) {
  const p = await params;
  if (!(p.side in NOTE_SIDES)) notFound();
  const side = p.side as NoteSide;
  await requirePermission(NOTE_SIDES[side].entity, "view");
  const id = Number(p.id);
  const [doc, company, template] = await Promise.all([Number.isInteger(id) ? noteDoc(db, id) : null, getCompany(db), getInvoiceTemplate(db)]);
  if (!doc || NOTE_KINDS[doc.n.kind].side !== side) notFound();
  const qr = side === "sales" ? await noteQr(db, id) : null;
  return (
    <div className="mx-auto max-w-3xl">
      {(await searchParams).print === "1" && <AutoPrint />}
      <div className="mb-4 flex items-center gap-2 print:hidden">
        <Link href={`/notes/${side}?open=${id}`} className="text-sm text-brand-700 hover:underline">
          ← {NOTE_SIDES[side].title}
        </Link>
        <span className="ms-auto flex items-center gap-2">
          <SendDocument kind="notes" id={id} label={`إشعار رقم ${doc.n.number}`} company={company.nameAr} phone={doc.party.mobile} email={doc.party.email} />
          <PrintButton />
        </span>
      </div>
      <NoteDocument company={company} doc={doc} template={template} qrSvg={qr ? await qrSvg(qr) : null} />
    </div>
  );
}
