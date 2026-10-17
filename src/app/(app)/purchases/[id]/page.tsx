import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { PURCHASE_STATUS } from "@/data/purchases";
import { PAYMENT_METHODS, paymentState } from "@/data/sales";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Input, PageHeader, Table, Td } from "@/components/ui";
import { post, remove, revert } from "../actions";

const fmt = (v: string | number) => Number(v).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function PurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("purchase_invoices", "view");
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const [row] = await db
    .select({ i: s.purchaseInvoices, supplier: s.parties.nameAr, payable: s.accounts.nameAr, payableCode: s.accounts.code, entry: s.journalEntries.number })
    .from(s.purchaseInvoices)
    .innerJoin(s.parties, eq(s.parties.id, s.purchaseInvoices.supplierId))
    .innerJoin(s.accounts, eq(s.accounts.id, s.purchaseInvoices.payableAccountId))
    .leftJoin(s.journalEntries, eq(s.journalEntries.id, s.purchaseInvoices.journalEntryId))
    .where(eq(s.purchaseInvoices.id, id));
  if (!row) notFound();
  const { i } = row;
  const [lines, allocations] = await Promise.all([
    db
      .select({ l: s.purchaseInvoiceLines, code: s.accounts.code, account: s.accounts.nameAr, cc: s.costCenters.nameAr })
      .from(s.purchaseInvoiceLines)
      .innerJoin(s.accounts, eq(s.accounts.id, s.purchaseInvoiceLines.accountId))
      .leftJoin(s.costCenters, eq(s.costCenters.id, s.purchaseInvoiceLines.costCenterId))
      .where(eq(s.purchaseInvoiceLines.invoiceId, id))
      .orderBy(asc(s.purchaseInvoiceLines.lineNo)),
    db
      .select({ a: s.paymentAllocations, p: s.payments })
      .from(s.paymentAllocations)
      .innerJoin(s.payments, eq(s.payments.id, s.paymentAllocations.paymentId))
      .where(eq(s.paymentAllocations.invoiceId, id))
      .orderBy(asc(s.payments.paymentDate)),
  ]);
  const total = Number(i.total);
  const paid = Number(i.paidAmount);
  const pay = paymentState(total, paid);
  const draft = i.status === "draft";

  return (
    <>
      <PageHeader title={`فاتورة المورد ${i.number}`} description={`${row.supplier} · فاتورته ${i.supplierInvoiceNo} · ${i.invoiceDate} · الاستحقاق ${i.dueDate}`}>
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={PURCHASE_STATUS[i.status].tone}>{PURCHASE_STATUS[i.status].label}</Badge>
          {!draft && <Badge tone={pay.tone}>{pay.label}</Badge>}
          {row.entry && <span className="ltr-nums text-xs text-gray-500">القيد {row.entry}</span>}
          {draft && can(user.perms, "purchase_invoices", "approve") && (
            <ActionForm action={post.bind(null, id)} resetOnSuccess={false}>
              <SubmitButton>ترحيل القيد</SubmitButton>
            </ActionForm>
          )}
          {!draft && can(user.perms, "purchase_invoices", "revert") && (
            <ActionForm action={revert.bind(null, id)} resetOnSuccess={false}>
              <SubmitButton variant="secondary">إرجاع لمسودة</SubmitButton>
            </ActionForm>
          )}
          <Link href="/purchases" className="text-sm text-brand-700 hover:underline">
            ← فواتير الموردين
          </Link>
        </div>
      </PageHeader>

      <Table head={["#", "الحساب", "المركبة / المركز", "البيان", "المبلغ", "الضريبة", "الإجمالي"]}>
        {lines.map(({ l, code, account, cc }) => (
          <tr key={l.id}>
            <Td className="ltr-nums">{l.lineNo}</Td>
            <Td>
              <span className="ltr-nums text-gray-500">{code}</span> {account}
            </Td>
            <Td>{cc ?? "—"}</Td>
            <Td>{l.description}</Td>
            <Td className="ltr-nums">{fmt(l.amount)}</Td>
            <Td className="ltr-nums">{fmt(l.vatAmount)}</Td>
            <Td className="ltr-nums font-medium">{fmt(Number(l.amount) + Number(l.vatAmount))}</Td>
          </tr>
        ))}
      </Table>
      <div className="mt-4 mb-6 flex justify-end">
        <dl className="w-full max-w-xs rounded-2xl bg-white p-4 text-sm shadow-sm">
          <div className="flex justify-between py-1">
            <dt className="text-gray-500">قبل الضريبة</dt>
            <dd className="ltr-nums">{fmt(i.subtotal)}</dd>
          </div>
          <div className="flex justify-between py-1">
            <dt className="text-gray-500">ضريبة المدخلات</dt>
            <dd className="ltr-nums">{fmt(i.vatTotal)}</dd>
          </div>
          <div className="flex justify-between border-t border-gray-100 pt-2 font-semibold text-brand-900">
            <dt>الإجمالي</dt>
            <dd className="ltr-nums">
              {fmt(total)} {i.currencyCode}
            </dd>
          </div>
          <div className="mt-2 text-xs text-gray-500">
            دائنة لحساب <span className="ltr-nums">{row.payableCode}</span> {row.payable}
          </div>
        </dl>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {!draft && (
          <Card title="سندات الصرف المخصصة">
            {allocations.length === 0 ? (
              <p className="text-sm text-gray-500">
                لا توجد. سدّد من{" "}
                <Link href="/payments" className="text-brand-700 underline">
                  سندات الصرف
                </Link>
                .
              </p>
            ) : (
              <Table head={["السند", "التاريخ", "الطريقة", "المخصص"]}>
                {allocations.map(({ a, p }) => (
                  <tr key={p.id}>
                    <Td className="ltr-nums">{p.number}</Td>
                    <Td className="ltr-nums">{p.paymentDate}</Td>
                    <Td>{PAYMENT_METHODS[p.method]}</Td>
                    <Td className="ltr-nums font-medium">{fmt(a.amount)}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        )}
        {draft && can(user.perms, "purchase_invoices", "delete") && (
          <Card title="حذف المسودة">
            <ActionForm action={remove.bind(null, id)} className="flex gap-2">
              <Input name="reason" placeholder="سبب الحذف" className="flex-1" />
              <SubmitButton variant="secondary">حذف</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
