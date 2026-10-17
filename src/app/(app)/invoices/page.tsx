import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { invoicingQueue } from "@/lib/invoices";
import { todayRiyadh } from "@/lib/dates";
import { INVOICE_STATUS, ZATCA_STATUS, paymentState } from "@/data/sales";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, EmptyRow, Input, PageHeader, Table, Td } from "@/components/ui";
import { invoiceAll, invoiceCustomer } from "./actions";

const fmt = (v: string | number) => Number(v).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function InvoicesPage() {
  const user = await requirePermission("sales_invoices", "view");
  const canCreate = can(user.perms, "sales_invoices", "create");
  const today = todayRiyadh();
  const [queue, invoices] = await Promise.all([
    invoicingQueue(db),
    db
      .select({ i: s.salesInvoices, customer: s.parties.nameAr })
      .from(s.salesInvoices)
      .innerJoin(s.parties, eq(s.parties.id, s.salesInvoices.customerId))
      .orderBy(desc(s.salesInvoices.invoiceDate), desc(s.salesInvoices.id))
      .limit(300),
  ]);

  return (
    <>
      <PageHeader title="الفواتير" description="فاتورة تجميعية لعدة بوالص معتمدة، سطر لكل بوليصة بمركز تكلفة مركبتها. الإيراد والضريبة يُقيدان عند الإصدار." />

      {canCreate && (
        <Card title="بوالص معتمدة بانتظار الفوترة" className="mb-6">
          {queue.length === 0 ? (
            <p className="text-sm text-gray-500">لا توجد بوالص معتمدة غير مفوترة.</p>
          ) : (
            <>
              <ActionForm action={invoiceAll} className="mb-4 flex flex-wrap items-center gap-3" resetOnSuccess={false}>
                <span className="text-sm text-gray-600">تاريخ الفاتورة</span>
                <Input name="invoiceDate" type="date" defaultValue={today} className="w-44" />
                <SubmitButton>فوترة الكل (فاتورة لكل عميل)</SubmitButton>
              </ActionForm>
              <Table head={["العميل", "العملة", "عدد البوالص", "الفترة", "المبلغ قبل الضريبة", ""]}>
                {queue.map((q) => (
                  <tr key={`${q.customerId}-${q.currencyCode}`}>
                    <Td className="font-medium">{q.customer}</Td>
                    <Td>{q.currencyCode}</Td>
                    <Td className="ltr-nums">{q.count}</Td>
                    <Td className="ltr-nums text-gray-500">
                      {q.from} ← {q.to}
                    </Td>
                    <Td className="ltr-nums font-semibold">{fmt(q.amount)}</Td>
                    <Td>
                      <ActionForm action={invoiceCustomer.bind(null, q.customerId, q.currencyCode)} resetOnSuccess={false}>
                        <input type="hidden" name="invoiceDate" value={today} />
                        <SubmitButton variant="secondary">إنشاء فاتورة</SubmitButton>
                      </ActionForm>
                    </Td>
                  </tr>
                ))}
              </Table>
            </>
          )}
        </Card>
      )}

      <Table head={["الرقم", "التاريخ", "الاستحقاق", "العميل", "الإجمالي", "المسدد", "المتبقي", "الحالة", "السداد", "الزكاة"]}>
        {invoices.length === 0 && <EmptyRow cols={10}>لا توجد فواتير بعد</EmptyRow>}
        {invoices.map(({ i, customer }) => {
          const total = Number(i.total);
          const paid = Number(i.paidAmount);
          const pay = paymentState(total, paid);
          const overdue = i.status === "issued" && paid < total && i.dueDate < today;
          return (
            <tr key={i.id}>
              <Td className="font-medium">
                <Link href={`/invoices/${i.id}`} className="ltr-nums text-brand-700 hover:underline">
                  {i.number}
                </Link>
              </Td>
              <Td className="ltr-nums">{i.invoiceDate}</Td>
              <Td className={`ltr-nums ${overdue ? "font-semibold text-red-600" : ""}`}>{i.dueDate}</Td>
              <Td>{customer}</Td>
              <Td className="ltr-nums font-semibold">
                {fmt(total)} <span className="text-xs font-normal text-gray-400">{i.currencyCode}</span>
              </Td>
              <Td className="ltr-nums">{fmt(paid)}</Td>
              <Td className="ltr-nums">{fmt(total - paid)}</Td>
              <Td>
                <Badge tone={INVOICE_STATUS[i.status].tone}>{INVOICE_STATUS[i.status].label}</Badge>
              </Td>
              <Td>{i.status === "issued" ? <Badge tone={overdue ? "red" : pay.tone}>{overdue ? "متأخرة" : pay.label}</Badge> : "—"}</Td>
              <Td className="text-xs text-gray-500">{i.status === "issued" ? ZATCA_STATUS[i.zatcaStatus] : "—"}</Td>
            </tr>
          );
        })}
      </Table>
    </>
  );
}
