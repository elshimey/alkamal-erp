import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import type { Entity } from "@/lib/permissions";
import { getCompany, getInvoiceTemplate } from "@/lib/company";
import { salesInvoiceDoc } from "@/lib/invoices";
import { purchaseInvoiceDoc } from "@/lib/purchases";
import { receiptDoc } from "@/lib/receipts";
import { noteDoc } from "@/lib/notes";
import { entryDoc } from "@/lib/journal";
import { violationDoc } from "@/lib/violations";
import { invoiceQrSvg } from "@/lib/zatca-qr";
import { TaxInvoiceDocument } from "@/components/tax-invoice";
import { PurchaseInvoiceDocument } from "@/components/purchase-invoice";
import { ReceiptVoucher } from "@/components/receipt-voucher";
import { NoteDocument } from "@/components/note-document";
import { JournalVoucher } from "@/components/journal-voucher";
import { ViolationDocument } from "@/components/violation-document";
import { BULK_LIMIT } from "@/components/bulk-pdf";
import { BatchExporter } from "./exporter";

type Company = Awaited<ReturnType<typeof getCompany>>;
type Template = Awaited<ReturnType<typeof getInvoiceTemplate>>;
type Kind = { title: string; entity: Entity; render: (id: number, c: Company, t: Template) => Promise<{ name: string; node: ReactNode } | null> };

// كل نوع مستند: صلاحيته، وطريقة جلبه ورسمه كما في معاينته
const KINDS: Record<string, Kind> = {
  invoices: {
    title: "فواتير المبيعات",
    entity: "sales_invoices",
    render: async (id, c, t) => {
      const d = await salesInvoiceDoc(db, id);
      if (!d) return null;
      const qr = await invoiceQrSvg(c, d.i);
      return { name: d.i.number, node: <TaxInvoiceDocument company={c} invoice={d.i} customer={d.customer} lines={d.lines} qrSvg={qr} template={t} /> };
    },
  },
  purchases: {
    title: "فواتير الموردين",
    entity: "purchase_invoices",
    render: async (id) => {
      const d = await purchaseInvoiceDoc(db, id);
      return d && { name: `${d.i.number}-${d.i.supplierInvoiceNo}`, node: <PurchaseInvoiceDocument doc={d} /> };
    },
  },
  receipts: {
    title: "سندات العملاء",
    entity: "receipts",
    render: async (id, c, t) => {
      const d = await receiptDoc(db, id);
      return d && { name: d.r.number, node: <ReceiptVoucher company={c} doc={d} template={t} /> };
    },
  },
  notes: {
    title: "الإشعارات الدائنة والمدينة",
    entity: "sales_invoices",
    render: async (id, c, t) => {
      const d = await noteDoc(db, id);
      return d && { name: d.n.number, node: <NoteDocument company={c} doc={d} template={t} /> };
    },
  },
  journal: {
    title: "القيود اليومية",
    entity: "journal_entries",
    render: async (id, c, t) => {
      const d = await entryDoc(db, id);
      return d && { name: d.e.number, node: <JournalVoucher company={c} doc={d} template={t} /> };
    },
  },
  violations: {
    title: "المخالفات المرورية",
    entity: "violations",
    render: async (id, c, t) => {
      const d = await violationDoc(db, id);
      return d && { name: d.v.number, node: <ViolationDocument company={c} doc={d} template={t} /> };
    },
  },
};

export default async function BatchPrintPage({ params, searchParams }: { params: Promise<{ kind: string }>; searchParams: Promise<{ ids?: string; zip?: string }> }) {
  const kind = KINDS[(await params).kind];
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
