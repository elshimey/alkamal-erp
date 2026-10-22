// كل نوع مستند قابل للطباعة والتصدير والمشاركة: صلاحيته، وطريقة جلبه ورسمه كما في معاينته
import type { ReactNode } from "react";
import { db } from "@/db";
import type { Entity } from "@/lib/permissions";
import { getCompany, getInvoiceTemplate } from "@/lib/company";
import { salesInvoiceDoc } from "@/lib/invoices";
import { purchaseInvoiceDoc } from "@/lib/purchases";
import { receiptDoc } from "@/lib/receipts";
import { noteDoc } from "@/lib/notes";
import { entryDoc } from "@/lib/journal";
import { violationDoc } from "@/lib/violations";
import { orderDoc, requestDoc } from "@/lib/maintenance";
import { custodyDoc } from "@/lib/hr";
import { waybillDoc } from "@/lib/waybills";
import { invoiceQrSvg } from "@/lib/zatca-qr";
import { TaxInvoiceDocument } from "@/components/tax-invoice";
import { PurchaseInvoiceDocument } from "@/components/purchase-invoice";
import { ReceiptVoucher } from "@/components/receipt-voucher";
import { NoteDocument } from "@/components/note-document";
import { JournalVoucher } from "@/components/journal-voucher";
import { ViolationDocument } from "@/components/violation-document";
import { BreakdownRequestDocument, MaintenanceOrderDocument } from "@/components/maintenance-document";
import { CustodyDocument } from "@/components/custody-document";
import { WaybillDocument } from "@/components/waybill-document";

type Company = Awaited<ReturnType<typeof getCompany>>;
type Template = Awaited<ReturnType<typeof getInvoiceTemplate>>;
export type DocKind = { title: string; entity: Entity; render: (id: number, c: Company, t: Template) => Promise<{ name: string; node: ReactNode } | null> };

export const DOC_KINDS: Record<string, DocKind> = {
  waybills: {
    title: "بوالص الشحن",
    entity: "waybills",
    render: async (id, c, t) => {
      const d = await waybillDoc(db, id);
      return d && { name: d.w.number, node: <WaybillDocument company={c} doc={d} template={t} /> };
    },
  },
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
  maintenance: {
    title: "أوامر الصيانة",
    entity: "maintenance",
    render: async (id, c, t) => {
      const d = await orderDoc(db, id);
      return d && { name: d.o.number, node: <MaintenanceOrderDocument company={c} doc={d} template={t} /> };
    },
  },
  breakdowns: {
    title: "بلاغات الأعطال",
    entity: "maintenance",
    render: async (id, c, t) => {
      const d = await requestDoc(db, id);
      return d && { name: d.r.number, node: <BreakdownRequestDocument company={c} doc={d} template={t} /> };
    },
  },
  custody: {
    title: "إقرارات العُهد",
    entity: "custody",
    render: async (id, c, t) => {
      const d = await custodyDoc(db, id);
      return d && { name: d.c.number, node: <CustodyDocument company={c} doc={d} template={t} /> };
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

