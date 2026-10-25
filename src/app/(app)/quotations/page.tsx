import Link from "next/link";
import { ComboField } from "@/components/combo-box";
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
import { DocSheet, type DocSheetRow } from "@/components/doc-sheet";
import { AddModeBar, ListActions, ViewToggle } from "@/components/list-actions";
import { saveQuotation, saveQuotationSheet } from "./actions";
import { fmt } from "@/lib/format";

const plusDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

export default async function QuotationsPage({ searchParams }: { searchParams: Promise<{ new?: string; add?: string; view?: string }> }) {
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
  const sp = await searchParams;
  const adding = canCreate && (sp.add === "1" || sp.new === "1" || rows.length === 0);
  const view = sp.view === "sheet" ? "sheet" : "table";
  const canUpdate = can(user.perms, "sales_invoices", "update");

  return (
    <>
      <PageHeader title="عروض الأسعار" description="عرض سعر للعميل بالمسارات والأسعار، يُرسل بالواتساب أو البريد ويُطبع، وعند قبوله يتحول بضغطة إلى فاتورة مسودة.">
        {!adding && <ListActions bulkHref={canUpdate && "/quotations?view=sheet"} newHref={canCreate && "/quotations?add=1"} newLabel="عرض سعر جديد" />}
      </PageHeader>

      {adding && rows.length > 0 && <AddModeBar backHref="/quotations" backLabel="عروض الأسعار" title="عرض سعر جديد" />}
      {adding && (
        <div className="mb-6 rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm">
          <ActionForm action={saveQuotation} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="العميل">
              <ComboField name="customerId" options={customers} create="customer" required placeholder="ابحث عن العميل…" />
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
                  { key: "routeId", label: "المسار", type: "select", width: "14rem", create: "route", options: routes.map((r) => ({ ...r, fill: { description: `نقل ${r.label}` } })) },
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
        </div>
      )}

      {!adding && (
        <div className="mb-3 flex justify-end">
          <ViewToggle base="/quotations" params={{}} view={view} />
        </div>
      )}
      {!adding && view === "sheet" && (
        <DocSheet
          action={saveQuotationSheet}
          emptyText="لا توجد عروض أسعار"
          columns={[
            { key: "status", label: "الحالة", type: "badge", width: "6rem" },
            { key: "number", label: "الرقم", ltr: true, width: "8rem" },
            { key: "date", label: "التاريخ", type: "date", editable: true, width: "8.5rem" },
            { key: "validUntil", label: "صالح حتى", type: "date", editable: true, width: "8.5rem" },
            { key: "customer", label: "العميل", width: "12rem" },
            { key: "currency", label: "العملة", width: "4rem" },
            { key: "total", label: "الإجمالي", type: "number", width: "7rem" },
            { key: "notes", label: "ملاحظات", editable: true, width: "14rem" },
            { key: "terms", label: "الشروط", editable: true, width: "16rem" },
          ]}
          rows={rows.map(({ q, customer }): DocSheetRow => ({
            id: q.id,
            href: `/quotations/${q.id}`,
            editable: canUpdate && q.status === "draft",
            cells: { number: q.number, date: q.quoteDate, validUntil: q.validUntil, customer, currency: q.currencyCode, total: q.total, notes: q.notes, terms: q.terms },
            badges: { status: { label: QUOTE_STATUS[q.status].label, tone: QUOTE_STATUS[q.status].tone } },
          }))}
        />
      )}
      {!adding && view === "table" && (
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
      )}
    </>
  );
}
