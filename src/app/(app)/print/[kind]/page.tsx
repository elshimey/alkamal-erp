import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { getCompany, getInvoiceTemplate } from "@/lib/company";
import { DOC_KINDS } from "@/lib/doc-kinds";
import { BULK_LIMIT } from "@/components/bulk-pdf";
import { BatchExporter } from "./exporter";

export default async function BatchPrintPage({ params, searchParams }: { params: Promise<{ kind: string }>; searchParams: Promise<{ ids?: string; zip?: string }> }) {
  const kind = DOC_KINDS[(await params).kind];
  if (!kind) notFound();
  await requirePermission(kind.entity, "view");
  const sp = await searchParams;
  const ids = [...new Set((sp.ids ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, BULK_LIMIT);
  const [company, template] = await Promise.all([getCompany(db), getInvoiceTemplate(db)]);
  const docs: { name: string; node: ReactNode }[] = [];
  // دفعات صغيرة حتى لا نستنزف اتصالات قاعدة البيانات
  for (let i = 0; i < ids.length; i += 10) {
    const part = await Promise.all(ids.slice(i, i + 10).map((id) => kind.render(id, company, template)));
    docs.push(...part.filter((d): d is NonNullable<typeof d> => !!d));
  }
  return (
    <div className="mx-auto max-w-4xl">
      <BatchExporter title={`${kind.title} (${docs.length})`} auto={sp.zip === "1"} />
      {docs.length === 0 && <p className="text-center text-sm text-gray-500">لا توجد مستندات</p>}
      <div className="space-y-8 print:space-y-0">
        {docs.map((d, i) => (
          <div key={i} data-doc={d.name} className="break-after-page bg-white">
            {d.node}
          </div>
        ))}
      </div>
    </div>
  );
}
