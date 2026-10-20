import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getCompany, getInvoiceTemplate } from "@/lib/company";
import { salesInvoiceDoc } from "@/lib/invoices";
import { todayRiyadh } from "@/lib/dates";
import { invoiceQrSvg } from "@/lib/zatca-qr";
import { PageHeader } from "@/components/ui";
import { TemplateEditor } from "./editor";

/** فاتورة للمعاينة: آخر فاتورة مُصدرة، أو نموذج ثابت إن لم توجد فواتير بعد. */
async function sampleInvoice() {
  const [last] = await db
    .select({ id: s.salesInvoices.id })
    .from(s.salesInvoices)
    .where(eq(s.salesInvoices.status, "issued"))
    .orderBy(desc(s.salesInvoices.issuedAt))
    .limit(1);
  const doc = last ? await salesInvoiceDoc(db, last.id) : null;
  if (doc) return { ...doc, lines: doc.lines.slice(0, 4) };
  const today = todayRiyadh();
  const line = (id: number, lineNo: number, description: string, amount: number) => ({
    id,
    invoiceId: 0,
    lineNo,
    kind: "waybill" as const,
    waybillId: null,
    waybillExpenseId: null,
    quantity: null,
    unitPrice: null,
    discountPercent: null,
    description,
    amount: amount.toFixed(2),
    taxCodeId: null,
    vatRate: "15",
    vatAmount: (amount * 0.15).toFixed(2),
    accountId: 0,
    costCenterId: null,
  });
  return {
    i: {
      id: 0,
      number: "INV-0000-000001",
      invoiceDate: today,
      dueDate: today,
      customerId: 0,
      contractId: null,
      currencyCode: "SAR",
      exchangeRate: "1",
      subtotal: "5000.00",
      vatTotal: "750.00",
      total: "5750.00",
      paidAmount: "0",
      status: "issued" as const,
      zatcaStatus: "not_sent" as const,
      zatcaResponse: null,
      notes: null,
      reference: null,
      journalEntryId: null,
      issuedBy: null,
      issuedAt: new Date(),
      createdBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    customer: {
      id: 0,
      kind: "company" as const,
      nameAr: "عميل نموذجي",
      nameEn: null,
      vatNumber: "300000000000003",
      crNumber: "1010000000",
      nationalAddress: "الرياض، المملكة العربية السعودية",
      country: "SA",
      mobile: null,
      email: null,
      defaultCurrency: "SAR",
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    lines: [line(1, 1, "نقل حاوية · الدمام ← الرياض", 3000), line(2, 2, "نقل بضائع · الدمام ← جدة", 2000)],
  };
}

export default async function InvoiceTemplatePage() {
  const user = await requirePermission("settings", "view");
  const [company, template, sample] = await Promise.all([getCompany(db), getInvoiceTemplate(db), sampleInvoice()]);
  const qrSvg = await invoiceQrSvg(company, sample.i);

  return (
    <>
      <PageHeader title="قالب الفاتورة" description="اختر شكل الفاتورة ولونها ولغتها وما يظهر فيها. المعاينة تتغير مباشرة، والقالب يُطبق على كل الفواتير والطباعة بعد الحفظ.">
        <Link href="/settings" className="text-sm text-brand-700 hover:underline">
          → الإعدادات
        </Link>
      </PageHeader>
      <TemplateEditor initial={template} company={company} sample={sample} qrSvg={qrSvg} canEdit={can(user.perms, "settings", "update")} />
    </>
  );
}
