import Link from "next/link";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listQuotations, QUOTE_STATUS } from "@/lib/quotations";
import { customerOptions, routeOptions } from "@/lib/lookups";
import { getInvoiceTemplate } from "@/lib/company";
import { todayRiyadh } from "@/lib/dates";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { LinesEditor } from "@/components/lines-editor";
import { Badge, EmptyRow, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { saveQuotation } from "./actions";
import { fmt } from "@/lib/format";

const plusDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

export default async function QuotationsPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const user = await requirePermission("sales_invoices", "view");
  const [rows, customers, routes, currencies, template] = await Promise.all([
    listQuotations(db),
    customerOptions(),
    routeOptions(),
    db.select({ code: s.currencies.code }).from(s.currencies).orderBy(asc(s.currencies.code)),
    getInvoiceTemplate(db),
  ]);
  const canCreate = can(user.perms, "sales_invoices", "create");
  const today = todayRiyadh();
  const openForm = (await searchParams).new === "1" || rows.length === 0;

  return (
    <>
      <PageHeader title="عروض الأسعار" description="عرض سعر للعميل بالمسارات والأسعار، يُرسل بالواتساب أو البريد ويُطبع، وعند قبوله يتحول بضغطة إلى فاتورة مسودة." />

      {canCreate && (
        <details open={openForm} className="mb-6 rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm">
          <summary className="cursor-pointer font-semibold text-brand-900">+ عرض سعر جديد</summary>
          <ActionForm action={saveQuotation} className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="العميل">
              <Select name="customerId" required defaultValue="">
                <option value="" disabled>
                  اختر العميل
                </option>
                {customers.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="التاريخ">
              <Input name="date" type="date" required defaultValue={today} />
            </Field>
            <Field label="صالح حتى">
              <Input name="validUntil" type="date" required defaultValue={plusDays(today, 15)} />
            </Field>
            <Field label="العملة">
              <Select name="currencyCode" defaultValue="SAR">
                {currencies.map((c) => (
                  <option key={c.code}>{c.code}</option>
                ))}
              </Select>
            </Field>
            <div className="col-span-full">
              <LinesEditor
                totals={{ qty: "quantity", price: "price", vat: "vatRate" }}
                columns={[
                  { key: "routeId", label: "المسار", type: "select", width: "14rem", options: routes.map((r) => ({ ...r, fill: { description: `نقل ${r.label}` } })) },
                  { key: "description", label: "البيان", placeholder: "نقل حاوية 40 قدم…" },
                  { key: "quantity", label: "الكمية", type: "number", width: "6rem", defaultValue: "1" },
                  { key: "price", label: "السعر", type: "number", width: "8rem" },
                  { key: "vatRate", label: "الضريبة", type: "select", width: "6rem", defaultValue: "15", options: [{ value: "15", label: "15%" }, { value: "0", label: "صفر (دولي)" }] },
                ]}
              />
            </div>
            <label className="col-span-full text-sm sm:col-span-2">
              <span className="mb-1 block text-gray-600">الشروط</span>
              <textarea name="terms" rows={3} defaultValue={template.terms} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </label>
            <label className="col-span-full text-sm sm:col-span-2">
              <span className="mb-1 block text-gray-600">ملاحظات</span>
              <textarea name="notes" rows={3} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </label>
            <div className="col-span-full">
              <SubmitButton>حفظ العرض</SubmitButton>
            </div>
          </ActionForm>
        </details>
      )}

      <Table head={["الرقم", "التاريخ", "صالح حتى", "العميل", "الإجمالي", "الحالة", "الفاتورة"]}>
        {rows.length === 0 && <EmptyRow cols={7}>لا توجد عروض أسعار بعد</EmptyRow>}
        {rows.map(({ q, customer, invoice }) => {
          const expired = q.status === "sent" && q.validUntil < today;
          return (
            <tr key={q.id}>
              <Td className="ltr-nums font-medium">
                <Link href={`/quotations/${q.id}`} className="text-brand-700 hover:underline">
                  {q.number}
                </Link>
              </Td>
              <Td className="ltr-nums">{q.quoteDate}</Td>
              <Td className={`ltr-nums ${expired ? "text-red-600" : ""}`}>{q.validUntil}</Td>
              <Td>{customer}</Td>
              <Td className="ltr-nums font-semibold whitespace-nowrap">
                {fmt(q.total)} <span className="text-xs text-gray-400">{q.currencyCode}</span>
              </Td>
              <Td>
                <Badge tone={QUOTE_STATUS[q.status].tone}>{expired ? "منتهي الصلاحية" : QUOTE_STATUS[q.status].label}</Badge>
              </Td>
              <Td className="ltr-nums">
                {invoice && q.salesInvoiceId ? (
                  <Link href={`/invoices/${q.salesInvoiceId}`} className="text-brand-700 hover:underline">
                    {invoice}
                  </Link>
                ) : (
                  "—"
                )}
              </Td>
            </tr>
          );
        })}
      </Table>
    </>
  );
}
