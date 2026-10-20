import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { todayRiyadh } from "@/lib/dates";
import { getCompany, getInvoiceTemplate } from "@/lib/company";
import { invoiceQrSvg } from "@/lib/zatca-qr";
import { INVOICE_STATUS, PAYMENT_METHODS, ZATCA_STATUS, paymentState } from "@/data/sales";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { AutoPrint, PrintButton } from "@/components/print-button";
import { TaxInvoiceDocument } from "@/components/tax-invoice";
import { Badge, Card, Input, PageHeader, Table, Td } from "@/components/ui";
import { addWaybills, issue, remove, removeLine, revert } from "../actions";

const fmt = (v: string | number) => Number(v).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function InvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ print?: string }> }) {
  const user = await requirePermission("sales_invoices", "view");
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const print = (await searchParams).print === "1";
  const [row] = await db
    .select({ i: s.salesInvoices, customer: s.parties, contract: s.contracts.number, entry: s.journalEntries.number })
    .from(s.salesInvoices)
    .innerJoin(s.parties, eq(s.parties.id, s.salesInvoices.customerId))
    .leftJoin(s.contracts, eq(s.contracts.id, s.salesInvoices.contractId))
    .leftJoin(s.journalEntries, eq(s.journalEntries.id, s.salesInvoices.journalEntryId))
    .where(eq(s.salesInvoices.id, id));
  if (!row) notFound();
  const { i, customer } = row;
  const draft = i.status === "draft";

  const [lines, allocations, available, company, template] = await Promise.all([
    db.select().from(s.salesInvoiceLines).where(eq(s.salesInvoiceLines.invoiceId, id)).orderBy(asc(s.salesInvoiceLines.lineNo)),
    db
      .select({ a: s.receiptAllocations, r: s.receipts })
      .from(s.receiptAllocations)
      .innerJoin(s.receipts, eq(s.receipts.id, s.receiptAllocations.receiptId))
      .where(eq(s.receiptAllocations.invoiceId, id))
      .orderBy(asc(s.receipts.receiptDate)),
    draft
      ? db
          .select({ id: s.waybills.id, number: s.waybills.number, date: s.waybills.waybillDate, amount: s.waybills.amount })
          .from(s.waybills)
          .where(
            and(
              eq(s.waybills.customerId, i.customerId),
              eq(s.waybills.status, "approved"),
              eq(s.waybills.currencyCode, i.currencyCode),
              sql`not exists (select 1 from sales_invoice_lines l where l.waybill_id = ${s.waybills.id} and l.kind = 'waybill')`,
            ),
          )
          .orderBy(asc(s.waybills.waybillDate))
      : Promise.resolve([]),
    getCompany(db),
    getInvoiceTemplate(db),
  ]);
  const qrSvg = await invoiceQrSvg(company, i);
  const total = Number(i.total);
  const paid = Number(i.paidAmount);
  const pay = paymentState(total, paid);
  const canUpdate = draft && can(user.perms, "sales_invoices", "update");

  return (
    <>
      <div className="print:hidden">
        <PageHeader title={`الفاتورة ${i.number}`} description={`${customer.nameAr} · ${i.invoiceDate}${row.contract ? ` · العقد ${row.contract}` : ""}`}>
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={INVOICE_STATUS[i.status].tone}>{INVOICE_STATUS[i.status].label}</Badge>
            {!draft && <Badge tone={pay.tone}>{pay.label}</Badge>}
            {row.entry && <span className="ltr-nums text-xs text-gray-500">القيد {row.entry}</span>}
            <PrintButton />
            {draft && can(user.perms, "sales_invoices", "approve") && (
              <ActionForm action={issue.bind(null, id)} resetOnSuccess={false}>
                <SubmitButton>إصدار وترحيل القيد</SubmitButton>
              </ActionForm>
            )}
            {!draft && can(user.perms, "sales_invoices", "revert") && (
              <ActionForm action={revert.bind(null, id)} resetOnSuccess={false}>
                <SubmitButton variant="secondary">إرجاع لمسودة</SubmitButton>
              </ActionForm>
            )}
            <Link href="/invoices" className="text-sm text-brand-700 hover:underline">
              ← فواتير المبيعات
            </Link>
          </div>
        </PageHeader>
        {!draft && <p className="-mt-3 mb-5 text-xs text-gray-500">{ZATCA_STATUS[i.zatcaStatus]} · الربط مع بوابة الزكاة يُضاف في مرحلة لاحقة.</p>}
      </div>

      {/* الفاتورة كما تُطبع */}
      <div className="mb-6">
        <TaxInvoiceDocument
          company={company}
          invoice={i}
          customer={customer}
          lines={lines}
          qrSvg={qrSvg}
          template={template}
          lineAction={
            canUpdate
              ? (l) => (
                  <form action={removeLine.bind(null, id, l.id)}>
                    <button className="text-xs text-red-600 hover:underline">إزالة</button>
                  </form>
                )
              : undefined
          }
        />
      </div>
      {print && <AutoPrint />}

      <div className="grid gap-6 lg:grid-cols-2 print:hidden">
        {canUpdate && available.length > 0 && (
          <Card title="إضافة بوالص معتمدة لهذا العميل">
            <ActionForm action={addWaybills.bind(null, id)} className="flex flex-col gap-2">
              <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-100">
                {available.map((w) => (
                  <label key={w.id} className="flex items-center gap-3 border-b border-gray-50 px-3 py-2 text-sm hover:bg-brand-50/60">
                    <input type="checkbox" name="waybillIds" value={w.id} className="accent-brand-600" />
                    <span className="ltr-nums font-medium">{w.number}</span>
                    <span className="ltr-nums text-gray-500">{w.date}</span>
                    <span className="ltr-nums ms-auto">{fmt(w.amount)}</span>
                  </label>
                ))}
              </div>
              <SubmitButton variant="secondary">إضافة المحدد</SubmitButton>
            </ActionForm>
          </Card>
        )}
        {!draft && (
          <Card title="سندات القبض المخصصة">
            {allocations.length === 0 ? (
              <p className="text-sm text-gray-500">
                لا توجد. سجّل القبض من{" "}
                <Link href={`/receipts/new?customer=${i.customerId}&invoice=${i.id}`} className="text-brand-700 underline">
                  تسجيل دفعة لهذه الفاتورة
                </Link>
                .
              </p>
            ) : (
              <Table head={["السند", "التاريخ", "الطريقة", "المخصص"]}>
                {allocations.map(({ a, r }) => (
                  <tr key={r.id}>
                    <Td className="ltr-nums">{r.number}</Td>
                    <Td className="ltr-nums">{r.receiptDate}</Td>
                    <Td>{PAYMENT_METHODS[r.method]}</Td>
                    <Td className="ltr-nums font-medium">{fmt(a.amount)}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        )}
        {draft && can(user.perms, "sales_invoices", "delete") && (
          <Card title="حذف المسودة">
            <ActionForm action={remove.bind(null, id)} className="flex gap-2">
              <Input name="reason" placeholder="سبب الحذف" className="flex-1" />
              <SubmitButton variant="secondary">حذف</SubmitButton>
            </ActionForm>
            <p className="mt-2 text-xs text-gray-500">تعود بوالصها للقائمة بانتظار الفوترة. اليوم {todayRiyadh()}.</p>
          </Card>
        )}
      </div>
    </>
  );
}
