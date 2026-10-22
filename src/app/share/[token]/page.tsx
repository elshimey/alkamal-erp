import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { runInTenant } from "@/db/tenant";
import { getCompany, getInvoiceTemplate } from "@/lib/company";
import { DOC_KINDS } from "@/lib/doc-kinds";
import { resolveShare } from "@/lib/share";
import { SharedDocTools } from "./tools";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** صفحة عامة لمستند أُرسل للعميل: يطّلع عليه ويحمّله PDF أو يطبعه، دون دخول. */
export default async function SharedDocPage({ params }: { params: Promise<{ token: string }> }) {
  const share = await resolveShare((await params).token);
  const kind = share && DOC_KINDS[share.kind];
  if (!share || !kind) notFound();
  const doc = await runInTenant(share.schema, async () => {
    const [company, template] = await Promise.all([getCompany(db), getInvoiceTemplate(db)]);
    const d = await kind.render(share.id, company, template);
    return d && { ...d, company: company.nameAr };
  });
  if (!doc) notFound();
  return (
    <div className="min-h-screen bg-concrete px-3 py-6 print:bg-white print:p-0">
      <div className="mx-auto max-w-4xl">
        <SharedDocTools name={doc.name} company={doc.company} />
        <div data-doc={doc.name} className="bg-white">
          {doc.node}
        </div>
      </div>
    </div>
  );
}
