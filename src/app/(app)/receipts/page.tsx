import Link from "next/link";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { cashAccounts } from "@/lib/invoices";
import { customerOptions } from "@/lib/lookups";
import { todayRiyadh } from "@/lib/dates";
import { PAYMENT_METHODS, RECEIPT_STATUS } from "@/data/sales";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { SheetEditor } from "@/components/sheet-editor";
import { Badge, Card, EmptyRow, PageHeader, Table, Td } from "@/components/ui";
import { post, remove, revert, saveReceipts } from "./actions";

const fmt = (v: string | number) => Number(v).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function ReceiptsPage() {
  const user = await requirePermission("receipts", "view");
  const canCreate = can(user.perms, "receipts", "create");
  const [customers, cash, openInvoices, list] = await Promise.all([
    customerOptions(),
    cashAccounts(db),
    db
      .select({ id: s.salesInvoices.id, number: s.salesInvoices.number, customer: s.parties.nameAr, total: s.salesInvoices.total, paid: s.salesInvoices.paidAmount })
      .from(s.salesInvoices)
      .innerJoin(s.parties, eq(s.parties.id, s.salesInvoices.customerId))
      .where(and(eq(s.salesInvoices.status, "issued"), sql`${s.salesInvoices.paidAmount} < ${s.salesInvoices.total}`))
      .orderBy(s.salesInvoices.dueDate),
    db
      .select({
        r: s.receipts,
        customer: s.parties.nameAr,
        account: s.accounts.nameAr,
        entry: s.journalEntries.number,
        allocated: sql<string>`coalesce((select sum(a.amount) from receipt_allocations a where a.receipt_id = ${s.receipts.id}), 0)`,
        invoices: sql<string | null>`(select string_agg(i.number, '، ') from receipt_allocations a join sales_invoices i on i.id = a.invoice_id where a.receipt_id = ${s.receipts.id})`,
      })
      .from(s.receipts)
      .innerJoin(s.parties, eq(s.parties.id, s.receipts.customerId))
      .innerJoin(s.accounts, eq(s.accounts.id, s.receipts.cashAccountId))
      .leftJoin(s.journalEntries, eq(s.journalEntries.id, s.receipts.journalEntryId))
      .orderBy(desc(s.receipts.receiptDate), desc(s.receipts.id))
      .limit(300),
  ]);

  return (
    <>
      <PageHeader title="سندات القبض" description="تحصيل من العملاء إلى الصندوق أو البنك. يُخصص على الفاتورة المختارة، أو على الأقدم استحقاقاً إن تُرك فارغاً." />
      {canCreate && (
        <Card title="إدخال سندات قبض" className="mb-6">
          {cash.length === 0 ? (
            <p className="text-sm text-gray-500">
              أضف حساب صندوق أو بنك تفصيلي تحت 1101 أو 1102 من{" "}
              <Link href="/accounts" className="text-brand-700 underline">
                شجرة الحسابات
              </Link>{" "}
              أولاً.
            </p>
          ) : (
            <>
              <SheetEditor
                templateName="سندات القبض"
                action={saveReceipts}
                initialRows={3}
                columns={[
                  { key: "date", label: "التاريخ", type: "date", required: true, placeholder: todayRiyadh() },
                  { key: "customerId", label: "العميل", type: "select", required: true, options: customers, width: "11rem" },
                  { key: "amount", label: "المبلغ", type: "number", required: true, width: "7rem" },
                  { key: "currency", label: "العملة", type: "select", options: [{ value: "SAR", label: "SAR" }, { value: "KWD", label: "KWD" }], width: "5rem", placeholder: "SAR" },
                  { key: "rate", label: "سعر الصرف", type: "number", width: "6rem", placeholder: "تلقائي" },
                  { key: "method", label: "الطريقة", type: "select", required: true, options: Object.entries(PAYMENT_METHODS).map(([value, label]) => ({ value, label })), width: "6rem" },
                  { key: "cashAccountId", label: "الصندوق / البنك", type: "select", required: true, options: cash.map((a) => ({ value: String(a.id), label: `${a.code} ${a.nameAr}` })), width: "12rem" },
                  { key: "invoiceId", label: "على الفاتورة", type: "select", options: openInvoices.map((i) => ({ value: String(i.id), label: `${i.number} · ${i.customer} · متبقي ${fmt(Number(i.total) - Number(i.paid))}` })), width: "13rem" },
                  { key: "collector", label: "المحصّل", width: "8rem" },
                  { key: "reference", label: "المرجع / الشيك", ltr: true, width: "8rem" },
                  { key: "notes", label: "ملاحظات", width: "9rem" },
                ]}
              />
              <p className="mt-2 text-xs text-gray-500">
                {can(user.perms, "receipts", "approve") ? "تُرحَّل السندات فور الحفظ." : "تُحفظ السندات مسودة حتى يرحّلها من يملك صلاحية الاعتماد."}
              </p>
            </>
          )}
        </Card>
      )}

      <Table head={["الرقم", "التاريخ", "العميل", "المبلغ", "الطريقة", "إلى", "المخصص على", "الحالة", ""]}>
        {list.length === 0 && <EmptyRow cols={9}>لا توجد سندات بعد</EmptyRow>}
        {list.map(({ r, customer, account, entry, allocated, invoices }) => {
          const unallocated = r.status === "posted" ? Number(r.amount) - Number(allocated) : 0;
          return (
            <tr key={r.id}>
              <Td className="ltr-nums font-medium">{r.number}</Td>
              <Td className="ltr-nums">{r.receiptDate}</Td>
              <Td>{customer}</Td>
              <Td className="ltr-nums font-semibold">
                {fmt(r.amount)} <span className="text-xs font-normal text-gray-400">{r.currencyCode}</span>
              </Td>
              <Td>{PAYMENT_METHODS[r.method]}</Td>
              <Td className="text-xs">{account}</Td>
              <Td className="text-xs">
                {invoices ?? "—"}
                {unallocated > 0.005 && <div className="text-amber-700">رصيد مقدم {fmt(unallocated)}</div>}
              </Td>
              <Td>
                <Badge tone={RECEIPT_STATUS[r.status].tone}>{RECEIPT_STATUS[r.status].label}</Badge>
                {entry && <div className="ltr-nums mt-1 text-[11px] text-gray-400">{entry}</div>}
              </Td>
              <Td>
                <div className="flex gap-2">
                  {r.status === "draft" && can(user.perms, "receipts", "approve") && (
                    <ActionForm action={post.bind(null, r.id)} resetOnSuccess={false}>
                      <SubmitButton variant="secondary">ترحيل</SubmitButton>
                    </ActionForm>
                  )}
                  {r.status === "posted" && can(user.perms, "receipts", "revert") && (
                    <ActionForm action={revert.bind(null, r.id)} resetOnSuccess={false}>
                      <SubmitButton variant="secondary">إرجاع</SubmitButton>
                    </ActionForm>
                  )}
                  {r.status === "draft" && can(user.perms, "receipts", "delete") && (
                    <ActionForm action={remove.bind(null, r.id)} resetOnSuccess={false}>
                      <SubmitButton variant="secondary">حذف</SubmitButton>
                    </ActionForm>
                  )}
                </div>
              </Td>
            </tr>
          );
        })}
      </Table>
    </>
  );
}
