import Link from "next/link";
import { and, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { driverOptions } from "@/lib/lookups";
import { cashAccounts } from "@/lib/invoices";
import { supplierBalances, supplierOptions } from "@/lib/purchases";
import { todayRiyadh } from "@/lib/dates";
import { PAYMENT_KINDS } from "@/data/purchases";
import { PAYMENT_METHODS, RECEIPT_STATUS } from "@/data/sales";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { SheetEditor } from "@/components/sheet-editor";
import { AddModeBar, ListActions } from "@/components/list-actions";
import { Badge, Card, EmptyRow, PageHeader, Table, Td } from "@/components/ui";
import { post, remove, revert, savePayments } from "./actions";
import { fmt } from "@/lib/format";

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ add?: string }> }) {
  const user = await requirePermission("payments", "view");
  const canCreate = can(user.perms, "payments", "create");
  const adding = (await searchParams).add === "1" && canCreate;
  const cash = alias(s.accounts, "cash");
  const [suppliers, drivers, cashes, openInvoices, balances, list] = await Promise.all([
    supplierOptions(db),
    driverOptions(),
    cashAccounts(db),
    db
      .select({ id: s.purchaseInvoices.id, number: s.purchaseInvoices.number, no: s.purchaseInvoices.supplierInvoiceNo, supplier: s.parties.nameAr, total: s.purchaseInvoices.total, paid: s.purchaseInvoices.paidAmount })
      .from(s.purchaseInvoices)
      .innerJoin(s.parties, eq(s.parties.id, s.purchaseInvoices.supplierId))
      .where(and(eq(s.purchaseInvoices.status, "posted"), sql`${s.purchaseInvoices.paidAmount} < ${s.purchaseInvoices.total}`))
      .orderBy(s.purchaseInvoices.dueDate),
    supplierBalances(db),
    db
      .select({
        p: s.payments,
        party: s.parties.nameAr,
        driver: s.employees.nameAr,
        cash: cash.nameAr,
        entry: s.journalEntries.number,
        invoices: sql<string | null>`(select string_agg(i.number, '، ') from payment_allocations a join purchase_invoices i on i.id = a.invoice_id where a.payment_id = ${s.payments.id})`,
      })
      .from(s.payments)
      .innerJoin(cash, eq(cash.id, s.payments.cashAccountId))
      .leftJoin(s.parties, eq(s.parties.id, s.payments.partyId))
      .leftJoin(s.drivers, eq(s.drivers.id, s.payments.driverId))
      .leftJoin(s.employees, eq(s.employees.id, s.drivers.employeeId))
      .leftJoin(s.journalEntries, eq(s.journalEntries.id, s.payments.journalEntryId))
      .orderBy(desc(s.payments.paymentDate), desc(s.payments.id))
      .limit(300),
  ]);

  return (
    <>
      <PageHeader title="سندات الصرف" description="سداد الموردين والورش والناقلين والمحطات، وصرف العهد للسائقين، من الصندوق أو البنك.">
        {!adding && <ListActions addHref={canCreate && "/payments?add=1"} addLabel="إدخال سندات صرف" />}
      </PageHeader>
      {adding && <AddModeBar backHref="/payments" backLabel="سندات الصرف" title="إدخال سندات صرف" />}
      <div className="mb-6 grid gap-6 xl:grid-cols-3">
        {adding && (
          <Card className="xl:col-span-3">
            {cashes.length === 0 ? (
              <p className="text-sm text-gray-500">أضف حساب صندوق أو بنك تفصيلياً تحت 1101 أو 1102 أولاً.</p>
            ) : (
              <>
                <SheetEditor
                  templateName="سندات الصرف"
                  action={savePayments}
                  initialRows={3}
                  columns={[
                    { key: "date", label: "التاريخ", type: "date", placeholder: todayRiyadh() },
                    { key: "partyId", label: "المورد / الناقل", type: "select", options: suppliers, width: "11rem", create: "supplier" },
                    { key: "driverId", label: "أو عهدة سائق", type: "select", options: drivers, width: "9rem" },
                    { key: "amount", label: "المبلغ", type: "number", required: true, width: "7rem" },
                    { key: "currency", label: "العملة", type: "select", options: [{ value: "SAR", label: "SAR" }, { value: "KWD", label: "KWD" }], width: "5rem", placeholder: "SAR" },
                    { key: "rate", label: "سعر الصرف", type: "number", width: "6rem", placeholder: "تلقائي" },
                    { key: "method", label: "الطريقة", type: "select", required: true, options: Object.entries(PAYMENT_METHODS).map(([value, label]) => ({ value, label })), width: "6rem" },
                    { key: "cashAccountId", label: "من الصندوق / البنك", type: "select", required: true, options: cashes.map((a) => ({ value: String(a.id), label: `${a.code} ${a.nameAr}` })), width: "12rem" },
                    { key: "invoiceId", label: "على الفاتورة", type: "select", options: openInvoices.map((i) => ({ value: String(i.id), label: `${i.number} · ${i.supplier} · متبقي ${fmt(Number(i.total) - Number(i.paid))}` })), width: "13rem" },
                    { key: "reference", label: "المرجع / الشيك", ltr: true, width: "8rem" },
                    { key: "notes", label: "ملاحظات", width: "9rem" },
                  ]}
                />
                <p className="mt-2 text-xs text-gray-500">
                  {can(user.perms, "payments", "approve") ? "تُرحَّل السندات فور الحفظ." : "تُحفظ مسودة حتى يرحّلها المحاسب."} السداد يُخصص على الفاتورة المختارة أو على الأقدم استحقاقاً، والباقي يسدد أرصدة الجهة من الشحنات.
                </p>
              </>
            )}
          </Card>
        )}
        {!adding && (
        <Card title="المستحق للجهات الدائنة" className="xl:col-span-3">
          {balances.length === 0 ? (
            <p className="text-sm text-gray-500">لا أرصدة مستحقة.</p>
          ) : (
            <ul className="grid gap-x-8 text-sm sm:grid-cols-2 xl:grid-cols-4">
              {balances.map((b) => (
                <li key={b.id} className="flex items-center justify-between border-b border-gray-100 py-2">
                  <span>{b.name}</span>
                  <span className={`ltr-nums font-semibold ${b.balance < 0 ? "text-emerald-700" : "text-brand-900"}`}>{fmt(b.balance)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-gray-500">من القيود المرحّلة: فواتير الموردين، وتكاليف الناقلين والديزل الآجل من الشحنات، ومخصوماً منها السداد. السالب دفعة مقدمة.</p>
        </Card>
        )}
      </div>

      {!adding && (
      <Table head={["الرقم", "التاريخ", "النوع", "إلى", "المبلغ", "الطريقة", "من", "المخصص على", "الحالة", ""]}>
        {list.length === 0 && <EmptyRow cols={10}>لا توجد سندات صرف بعد</EmptyRow>}
        {list.map(({ p, party, driver, cash: box, entry, invoices }) => (
          <tr key={p.id}>
            <Td className="ltr-nums font-medium whitespace-nowrap">{p.number}</Td>
            <Td className="ltr-nums whitespace-nowrap">{p.paymentDate}</Td>
            <Td className="text-xs">{PAYMENT_KINDS[p.kind]}</Td>
            <Td>{party ?? driver}</Td>
            <Td className="ltr-nums font-semibold">
              {fmt(p.amount)} <span className="text-xs font-normal text-gray-400">{p.currencyCode}</span>
            </Td>
            <Td>{PAYMENT_METHODS[p.method]}</Td>
            <Td className="text-xs">{box}</Td>
            <Td className="text-xs">
              {invoices ? (
                invoices
              ) : p.kind === "supplier" ? (
                <Link href="/purchases" className="text-gray-400">
                  رصيد الجهة
                </Link>
              ) : (
                "—"
              )}
            </Td>
            <Td>
              <Badge tone={RECEIPT_STATUS[p.status].tone}>{RECEIPT_STATUS[p.status].label}</Badge>
              {entry && <div className="ltr-nums mt-1 text-[11px] text-gray-400">{entry}</div>}
            </Td>
            <Td>
              <div className="flex gap-2">
                {p.status === "draft" && can(user.perms, "payments", "approve") && (
                  <ActionForm action={post.bind(null, p.id)} resetOnSuccess={false}>
                    <SubmitButton variant="secondary">ترحيل</SubmitButton>
                  </ActionForm>
                )}
                {p.status === "posted" && can(user.perms, "payments", "revert") && (
                  <ActionForm action={revert.bind(null, p.id)} resetOnSuccess={false}>
                    <SubmitButton variant="secondary">إرجاع</SubmitButton>
                  </ActionForm>
                )}
                {p.status === "draft" && can(user.perms, "payments", "delete") && (
                  <ActionForm action={remove.bind(null, p.id)} resetOnSuccess={false}>
                    <SubmitButton variant="secondary">حذف</SubmitButton>
                  </ActionForm>
                )}
              </div>
            </Td>
          </tr>
        ))}
      </Table>
      )}
    </>
  );
}
