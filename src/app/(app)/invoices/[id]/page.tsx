import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { todayRiyadh } from "@/lib/dates";
import { COMPANY } from "@/data/company";
import { INVOICE_STATUS, PAYMENT_METHODS, ZATCA_STATUS, paymentState } from "@/data/sales";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { LogoMark } from "@/components/logo";
import { PrintButton } from "@/components/print-button";
import { Badge, Card, Input, PageHeader, Table, Td } from "@/components/ui";
import { addWaybills, issue, remove, removeLine, revert } from "../actions";

const fmt = (v: string | number) => Number(v).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("sales_invoices", "view");
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
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

  const [lines, allocations, available] = await Promise.all([
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
  ]);
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
              ← الفواتير
            </Link>
          </div>
        </PageHeader>
        {!draft && <p className="-mt-3 mb-5 text-xs text-gray-500">{ZATCA_STATUS[i.zatcaStatus]} · الربط مع بوابة الزكاة يُضاف في مرحلة لاحقة.</p>}
      </div>

      {/* الفاتورة كما تُطبع */}
      <article className="mb-6 rounded-2xl border border-black/[0.06] bg-white p-8 shadow-[0_4px_16px_-8px_rgba(27,33,38,0.08)] print:border-0 print:p-0 print:shadow-none">
        <header className="flex flex-wrap items-start justify-between gap-6 border-b-4 border-brand-600 pb-5">
          <div className="flex items-center gap-3">
            <LogoMark size={48} />
            <div>
              <div className="font-display text-xl font-semibold text-brand-900">{COMPANY.nameAr}</div>
              <div className="text-xs text-gray-500">{COMPANY.address}</div>
              {COMPANY.vatNumber && <div className="ltr-nums text-xs text-gray-500">الرقم الضريبي {COMPANY.vatNumber}</div>}
              {COMPANY.crNumber && <div className="ltr-nums text-xs text-gray-500">السجل التجاري {COMPANY.crNumber}</div>}
            </div>
          </div>
          <div className="text-end">
            <div className="font-display text-2xl font-semibold text-brand-900">فاتورة ضريبية{draft ? " (مسودة)" : ""}</div>
            <div className="ltr-nums mt-1 text-sm text-gray-600">{i.number}</div>
            <div className="mt-1 text-xs text-gray-500">
              التاريخ <span className="ltr-nums">{i.invoiceDate}</span> · الاستحقاق <span className="ltr-nums">{i.dueDate}</span>
            </div>
          </div>
        </header>
        <section className="grid gap-4 py-5 text-sm sm:grid-cols-2">
          <div>
            <div className="text-xs text-gray-500">العميل</div>
            <div className="font-semibold text-gray-800">{customer.nameAr}</div>
            {customer.vatNumber && <div className="ltr-nums text-xs text-gray-500">الرقم الضريبي {customer.vatNumber}</div>}
            {customer.nationalAddress && <div className="text-xs text-gray-500">{customer.nationalAddress}</div>}
          </div>
          <div className="sm:text-end">
            <div className="text-xs text-gray-500">العملة</div>
            <div className="font-semibold text-gray-800">
              {i.currencyCode}
              {i.currencyCode !== "SAR" && <span className="ltr-nums ms-2 text-xs font-normal text-gray-500">سعر الصرف {Number(i.exchangeRate)}</span>}
            </div>
          </div>
        </section>
        <table className="w-full text-sm">
          <thead className="bg-asphalt-900 text-white/85 print:bg-gray-100 print:text-gray-800">
            <tr>
              {["#", "البيان", "المبلغ", "الضريبة %", "الضريبة", "الإجمالي", ""].map((h, k) => (
                <th key={k} className="px-3 py-2.5 text-start font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {lines.map((l) => (
              <tr key={l.id} className={l.kind === "expense" ? "text-gray-600" : ""}>
                <td className="ltr-nums px-3 py-2">{l.lineNo}</td>
                <td className="px-3 py-2">
                  {l.kind === "waybill" && l.waybillId ? (
                    <Link href={`/waybills/${l.waybillId}`} className="hover:text-brand-700 print:no-underline">
                      نقل · {l.description}
                    </Link>
                  ) : (
                    <span className="ps-4">↳ {l.description}</span>
                  )}
                </td>
                <td className="ltr-nums px-3 py-2">{fmt(l.amount)}</td>
                <td className="ltr-nums px-3 py-2">{Number(l.vatRate)}%</td>
                <td className="ltr-nums px-3 py-2">{fmt(l.vatAmount)}</td>
                <td className="ltr-nums px-3 py-2 font-medium">{fmt(Number(l.amount) + Number(l.vatAmount))}</td>
                <td className="px-3 py-2 print:hidden">
                  {canUpdate && (
                    <form action={removeLine.bind(null, id, l.id)}>
                      <button className="text-xs text-red-600 hover:underline">إزالة</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-5 flex justify-end">
          <dl className="w-full max-w-xs text-sm">
            {[
              ["الإجمالي قبل الضريبة", i.subtotal],
              ["ضريبة القيمة المضافة", i.vatTotal],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between border-b border-gray-100 py-1.5">
                <dt className="text-gray-500">{k}</dt>
                <dd className="ltr-nums">{fmt(v)}</dd>
              </div>
            ))}
            <div className="flex justify-between py-2 text-base font-semibold text-brand-900">
              <dt>الإجمالي المستحق</dt>
              <dd className="ltr-nums">
                {fmt(total)} {i.currencyCode}
              </dd>
            </div>
            {!draft && paid > 0 && (
              <div className="flex justify-between py-1 text-gray-600">
                <dt>المسدد / المتبقي</dt>
                <dd className="ltr-nums">
                  {fmt(paid)} / {fmt(total - paid)}
                </dd>
              </div>
            )}
          </dl>
        </div>
        {i.notes && <p className="mt-4 text-sm text-gray-600">{i.notes}</p>}
      </article>

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
                <Link href="/receipts" className="text-brand-700 underline">
                  سندات القبض
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
