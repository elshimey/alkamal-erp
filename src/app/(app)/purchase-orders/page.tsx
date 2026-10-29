import Link from "next/link";
import { ComboField } from "@/components/combo-box";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listOrders, orderLines, orderTotals, PO_STATUS, requestToOrderLines } from "@/lib/purchasing";
import { expenseAccountOptions, supplierOptions } from "@/lib/purchases";
import { productOptions, vehicleOptions } from "@/lib/lookups";
import { todayRiyadh } from "@/lib/dates";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { LinesEditor } from "@/components/lines-editor";
import { Badge, EmptyRow, Field, Input, PageHeader, Table, Td } from "@/components/ui";
import { saveOrder } from "../purchase-requests/actions";
import { fmt } from "@/lib/format";

export default async function PurchaseOrdersPage({ searchParams }: { searchParams: Promise<{ request?: string }> }) {
  const user = await requirePermission("purchase_invoices", "view");
  const requestId = Number((await searchParams).request) || null;
  const canCreate = can(user.perms, "purchase_invoices", "create");
  const [rows, suppliers, accounts, products, vehicles, prefill] = await Promise.all([
    listOrders(db),
    supplierOptions(db),
    expenseAccountOptions(db),
    productOptions(),
    vehicleOptions(),
    requestId ? requestToOrderLines(db, requestId) : Promise.resolve(null),
  ]);
  const lines = await orderLines(db, rows.map((r) => r.o.id));
  const initial = prefill?.map((l) => ({ productId: l.productId ? String(l.productId) : "", description: l.description, quantity: String(l.quantity), price: l.unitPrice ? String(l.unitPrice) : "", vatRate: "15" }));

  return (
    <>
      <PageHeader title="أوامر الشراء" description="أمر الشراء يُرسل للمورد بالأسعار المتفق عليها، وعند وصول فاتورته يُحوّل الأمر إلى فاتورة مورد بضغطة.">
        <Link href="/purchase-requests" className="text-sm font-medium text-brand-700 hover:underline">
          طلبات الشراء ←
        </Link>
      </PageHeader>

      {canCreate && (
        <details open={!!requestId || rows.length === 0} className="mb-6 rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm">
          <summary className="cursor-pointer font-semibold text-brand-900">+ أمر شراء جديد{requestId ? " من طلب الشراء" : ""}</summary>
          <ActionForm action={saveOrder} className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {requestId && <input type="hidden" name="requestId" value={requestId} />}
            <Field label="المورد">
              <ComboField name="supplierId" options={suppliers} create="supplier" required />
            </Field>
            <Field label="التاريخ">
              <Input name="date" type="date" required defaultValue={todayRiyadh()} />
            </Field>
            <Field label="التوريد قبل" hint="اختياري">
              <Input name="expectedDate" type="date" />
            </Field>
            {!requestId && (
              <Field label="للمركبة" hint="اختياري">
                <ComboField name="vehicleId" options={vehicles} create="vehicle" />
              </Field>
            )}
            <Field label="ملاحظات">
              <Input name="notes" />
            </Field>
            <div className="col-span-full">
              <LinesEditor
                initial={initial}
                totals={{ qty: "quantity", price: "price", vat: "vatRate" }}
                columns={[
                  { key: "productId", label: "الصنف (للمخزون)", type: "select", width: "14rem", options: products, placeholder: "—", create: "product" },
                  { key: "accountId", label: "أو حساب المصروف", type: "select", width: "13rem", options: accounts, placeholder: "—" },
                  { key: "description", label: "الوصف" },
                  { key: "quantity", label: "الكمية", type: "number", width: "6rem", defaultValue: "1" },
                  { key: "price", label: "سعر الوحدة", type: "number", width: "8rem" },
                  { key: "vatRate", label: "الضريبة %", type: "number", width: "5rem", defaultValue: "15" },
                ]}
              />
            </div>
            <div className="col-span-full">
              <SubmitButton>حفظ أمر الشراء</SubmitButton>
            </div>
          </ActionForm>
        </details>
      )}

      <Table head={["الرقم", "التاريخ", "المورد", "الطلب", "المركبة", "الإجمالي", "الحالة", "الفاتورة"]}>
        {rows.length === 0 && <EmptyRow cols={8}>لا توجد أوامر شراء بعد</EmptyRow>}
        {rows.map(({ o, supplier, request, invoice, plate }) => (
          <tr key={o.id} className="hover:bg-brand-50/40">
            <Td className="ltr-nums font-medium whitespace-nowrap">
              <Link href={`/purchase-orders/${o.id}`} className="text-brand-700 hover:underline">
                {o.number}
              </Link>
            </Td>
            <Td className="ltr-nums whitespace-nowrap">{o.orderDate}</Td>
            <Td>{supplier}</Td>
            <Td className="ltr-nums">{request ?? "—"}</Td>
            <Td>{plate ?? "—"}</Td>
            <Td className="ltr-nums whitespace-nowrap">
              {fmt(orderTotals(lines.filter((l) => l.orderId === o.id)).total)} <span className="text-xs text-gray-400">{o.currencyCode}</span>
            </Td>
            <Td>
              <Badge tone={PO_STATUS[o.status].tone}>{PO_STATUS[o.status].label}</Badge>
            </Td>
            <Td className="ltr-nums">
              {invoice && o.purchaseInvoiceId ? (
                <Link href={`/purchases?open=${o.purchaseInvoiceId}`} className="text-brand-700 hover:underline">
                  {invoice}
                </Link>
              ) : (
                "—"
              )}
            </Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
