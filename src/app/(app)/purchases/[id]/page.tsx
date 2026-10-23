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
import { PurchaseInvoiceDocument } from "@/components/purchase-invoice";
import { Badge, Card, Input, PageHeader, Table, Td } from "@/components/ui";
import { purchaseInvoiceDoc } from "@/lib/purchases";
import { post, remove, revert } from "../actions";
import { fmt } from "@/lib/format";

export default async function PurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("purchase_invoices", "view");
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const [doc, allocations] = await Promise.all([
    purchaseInvoiceDoc(db, id),
    db
      .select({ a: s.paymentAllocations, p: s.payments })
      .from(s.paymentAllocations)
      .innerJoin(s.payments, eq(s.payments.id, s.paymentAllocations.paymentId))
      .where(eq(s.paymentAllocations.invoiceId, id))
      .orderBy(asc(s.payments.paymentDate)),
  ]);
  if (!doc) notFound();
  const { i } = doc;
  const row = { ...doc, supplier: doc.supplier.nameAr };
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

      <div className="mb-6">
        <PurchaseInvoiceDocument doc={doc} />
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
