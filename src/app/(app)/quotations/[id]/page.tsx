import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getCompany, getInvoiceTemplate } from "@/lib/company";
import { quotationDoc, QUOTE_STATUS } from "@/lib/quotations";
import { todayRiyadh } from "@/lib/dates";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { QuotationDocument } from "@/components/commercial-documents";
import { PrintButton } from "@/components/print-button";
import { SendDocument } from "@/components/send-document";
import { Badge, Input } from "@/components/ui";
import { convertQuotation, quotationStatus, removeQuotation } from "../actions";

export default async function QuotationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("sales_invoices", "view");
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const [doc, company, template] = await Promise.all([quotationDoc(db, id), getCompany(db), getInvoiceTemplate(db)]);
  if (!doc) notFound();
  const { q } = doc;
  const canUpdate = can(user.perms, "sales_invoices", "update") && !q.salesInvoiceId;
  const canInvoice = can(user.perms, "sales_invoices", "create") && !q.salesInvoiceId && q.status !== "rejected";
  const next = { draft: ["sent", "تعليم كمُرسل"], sent: ["accepted", "قبِله العميل"], accepted: null, rejected: ["draft", "إعادة لمسودة"] } as const;
  const step = next[q.status];

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <Link href="/quotations" className="text-sm text-brand-700 hover:underline">
          ← عروض الأسعار
        </Link>
        <Badge tone={QUOTE_STATUS[q.status].tone}>{QUOTE_STATUS[q.status].label}</Badge>
        {q.salesInvoiceId && (
          <Link href={`/invoices/${q.salesInvoiceId}`} className="text-sm font-medium text-brand-700 hover:underline">
            فُوتر ← عرض الفاتورة
          </Link>
        )}
        <span className="ms-auto flex flex-wrap items-center gap-2">
          {canUpdate && step && (
            <ActionForm action={quotationStatus.bind(null, id, step[0])}>
              <SubmitButton variant="secondary">{step[1]}</SubmitButton>
            </ActionForm>
          )}
          {canUpdate && (q.status === "sent" || q.status === "draft") && (
            <ActionForm action={quotationStatus.bind(null, id, "rejected")}>
              <SubmitButton variant="secondary" className="text-red-700">
                رفضه العميل
              </SubmitButton>
            </ActionForm>
          )}
          <SendDocument kind="quotations" id={id} label={`عرض سعر رقم ${q.number}`} company={company.nameAr} phone={doc.customer.mobile} email={doc.customer.email} />
          <PrintButton />
        </span>
      </div>

      {canInvoice && (
        <ActionForm action={convertQuotation.bind(null, id)} className="mb-4 flex flex-wrap items-end gap-3 rounded-2xl border border-brand-500/50 bg-brand-50 p-4 print:hidden">
          <div className="flex-1 text-sm text-gray-700">
            <div className="font-semibold text-asphalt-900">تحويل إلى فاتورة مبيعات</div>
            تُنشأ فاتورة مسودة بنفس السطور والأسعار لتراجعها ثم تصدرها، ويُعلَّم العرض مقبولاً.
          </div>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-gray-600">تاريخ الفاتورة</span>
            <Input name="invoiceDate" type="date" defaultValue={todayRiyadh()} required />
          </label>
          <SubmitButton>إنشاء الفاتورة</SubmitButton>
        </ActionForm>
      )}

      <QuotationDocument company={company} doc={doc} template={template} />

      {can(user.perms, "sales_invoices", "delete") && !q.salesInvoiceId && (
        <details className="mt-6 text-sm print:hidden">
          <summary className="cursor-pointer text-gray-400 hover:text-red-700">حذف العرض</summary>
          <ActionForm action={removeQuotation.bind(null, id)} className="mt-2">
            <SubmitButton variant="secondary" className="text-red-700">
              تأكيد حذف العرض
            </SubmitButton>
          </ActionForm>
        </details>
      )}
    </div>
  );
}
