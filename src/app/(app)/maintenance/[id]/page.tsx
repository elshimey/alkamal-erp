import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { cashAccounts } from "@/lib/invoices";
import { todayRiyadh } from "@/lib/dates";
import { LINE_KINDS, MAINTENANCE_PROVIDERS, MAINTENANCE_STATUS, MAINTENANCE_TYPES, maintenanceAccountCode } from "@/data/maintenance";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { SheetEditor } from "@/components/sheet-editor";
import { Badge, Card, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { approveOrder, completeOrder, deleteOrder, removeLine, revertOrder, saveLines } from "../actions";

const fmt = (v: string | number) => Number(v).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function MaintenanceOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("maintenance", "view");
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const cash = alias(s.accounts, "cash");
  const [row] = await db
    .select({
      o: s.maintenanceOrders,
      plate: s.vehicles.plate,
      supplier: s.parties.nameAr,
      cash: cash.nameAr,
      request: s.breakdownRequests,
      plan: s.maintenancePlans.title,
      entry: s.journalEntries.number,
    })
    .from(s.maintenanceOrders)
    .innerJoin(s.vehicles, eq(s.vehicles.id, s.maintenanceOrders.vehicleId))
    .leftJoin(s.parties, eq(s.parties.id, s.maintenanceOrders.supplierId))
    .leftJoin(cash, eq(cash.id, s.maintenanceOrders.cashAccountId))
    .leftJoin(s.breakdownRequests, eq(s.breakdownRequests.id, s.maintenanceOrders.breakdownRequestId))
    .leftJoin(s.maintenancePlans, eq(s.maintenancePlans.id, s.maintenanceOrders.planId))
    .leftJoin(s.journalEntries, eq(s.journalEntries.id, s.maintenanceOrders.journalEntryId))
    .where(eq(s.maintenanceOrders.id, id));
  if (!row) notFound();
  const { o } = row;
  const [lines, cashes] = await Promise.all([
    db.select().from(s.maintenanceLines).where(eq(s.maintenanceLines.orderId, id)).orderBy(asc(s.maintenanceLines.lineNo)),
    cashAccounts(db),
  ]);
  const draft = o.status === "draft";
  const canEdit = draft && can(user.perms, "maintenance", "update");

  return (
    <>
      <PageHeader
        title={`أمر الصيانة ${o.number}`}
        description={`${row.plate} · ${MAINTENANCE_TYPES[o.type]} · ${row.supplier ?? MAINTENANCE_PROVIDERS.internal} · ${o.orderDate}${o.supplierInvoiceNo ? ` · فاتورة ${o.supplierInvoiceNo}` : ""}`}
      >
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={MAINTENANCE_STATUS[o.status].tone}>{MAINTENANCE_STATUS[o.status].label}</Badge>
          {row.entry && <span className="ltr-nums text-xs text-gray-500">القيد {row.entry}</span>}
          {o.status === "approved" && can(user.perms, "maintenance", "revert") && (
            <ActionForm action={revertOrder.bind(null, id)} resetOnSuccess={false}>
              <SubmitButton variant="secondary">إرجاع لمسودة</SubmitButton>
            </ActionForm>
          )}
          <Link href="/maintenance" className="text-sm text-brand-700 hover:underline">
            ← أوامر الصيانة
          </Link>
        </div>
      </PageHeader>
      {(row.request || row.plan) && (
        <p className="-mt-3 mb-5 text-sm text-gray-600">
          {row.request ? `من طلب العطل ${row.request.number}: ${row.request.description}` : `من الصيانة الدورية: ${row.plan}`}
        </p>
      )}

      <Table head={["#", "النوع", "الوصف", "الكمية", "السعر", "المبلغ", "الضريبة", "الإجمالي", ""]}>
        {lines.length === 0 && (
          <tr>
            <td colSpan={9} className="px-4 py-6 text-center text-sm text-amber-700">
              أضف بنداً واحداً على الأقل قبل الاعتماد.
            </td>
          </tr>
        )}
        {lines.map((l) => (
          <tr key={l.id}>
            <Td className="ltr-nums">{l.lineNo}</Td>
            <Td>{LINE_KINDS[l.kind]}</Td>
            <Td>{l.description}</Td>
            <Td className="ltr-nums">{Number(l.quantity)}</Td>
            <Td className="ltr-nums">{fmt(l.unitPrice)}</Td>
            <Td className="ltr-nums">{fmt(l.amount)}</Td>
            <Td className="ltr-nums">{fmt(l.vatAmount)}</Td>
            <Td className="ltr-nums font-medium">{fmt(Number(l.amount) + Number(l.vatAmount))}</Td>
            <Td>
              {canEdit && (
                <form action={removeLine.bind(null, id, l.id)}>
                  <button className="text-xs text-red-600 hover:underline">إزالة</button>
                </form>
              )}
            </Td>
          </tr>
        ))}
      </Table>
      <div className="mt-4 mb-6 flex justify-end">
        <dl className="w-full max-w-xs rounded-2xl bg-white p-4 text-sm shadow-sm">
          <div className="flex justify-between py-1">
            <dt className="text-gray-500">قبل الضريبة</dt>
            <dd className="ltr-nums">{fmt(o.subtotal)}</dd>
          </div>
          <div className="flex justify-between py-1">
            <dt className="text-gray-500">ضريبة المدخلات</dt>
            <dd className="ltr-nums">{fmt(o.vatTotal)}</dd>
          </div>
          <div className="flex justify-between border-t border-gray-100 pt-2 font-semibold text-brand-900">
            <dt>الإجمالي</dt>
            <dd className="ltr-nums">{fmt(o.total)}</dd>
          </div>
          <div className="mt-2 text-xs text-gray-500">
            مدين حساب <span className="ltr-nums">{maintenanceAccountCode(o.type)}</span> على مركز تكلفة {row.plate}، دائن {row.supplier ?? row.cash ?? "الصندوق عند الاعتماد"}
          </div>
        </dl>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {canEdit && (
          <Card title="إضافة بنود" className="lg:col-span-2">
            <SheetEditor
              templateName="بنود أمر الصيانة"
              action={saveLines.bind(null, id)}
              initialRows={3}
              columns={[
                { key: "kind", label: "النوع", type: "select", required: true, options: Object.entries(LINE_KINDS).map(([value, label]) => ({ value, label })), width: "8rem" },
                { key: "description", label: "الوصف", required: true, width: "16rem" },
                { key: "quantity", label: "الكمية", type: "number", width: "5rem", placeholder: "1" },
                { key: "unitPrice", label: "سعر الوحدة", type: "number", required: true, width: "7rem" },
                { key: "vat", label: "الضريبة", type: "select", options: [{ value: "15", label: "15%" }, { value: "0", label: "بدون" }], width: "5rem", placeholder: "15%" },
              ]}
            />
          </Card>
        )}
        {draft && can(user.perms, "maintenance", "approve") && (
          <Card title="الاعتماد وترحيل القيد">
            <ActionForm action={approveOrder.bind(null, id)} resetOnSuccess={false} className="flex flex-wrap items-end gap-3">
              {o.provider === "internal" && (
                <Field label="القطع اشتُريت من">
                  <Select name="cashAccountId" defaultValue={o.cashAccountId ?? ""}>
                    <option value="">اختر الصندوق</option>
                    {cashes.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.nameAr}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <SubmitButton>اعتماد الأمر</SubmitButton>
            </ActionForm>
            <p className="mt-2 text-xs text-gray-500">تصبح المركبة «في الصيانة» حتى إكمال الأمر.</p>
          </Card>
        )}
        {o.status === "approved" && can(user.perms, "maintenance", "update") && (
          <Card title="إكمال الصيانة وإعادة المركبة للعمل">
            <ActionForm action={completeOrder.bind(null, id)} resetOnSuccess={false} className="flex flex-wrap items-end gap-3">
              <Field label="تاريخ الإكمال">
                <Input name="completedDate" type="date" defaultValue={todayRiyadh()} />
              </Field>
              <Field label="قراءة العداد">
                <Input name="odometer" type="number" min={0} defaultValue={o.odometer ?? ""} className="w-32" />
              </Field>
              <SubmitButton>إكمال</SubmitButton>
            </ActionForm>
          </Card>
        )}
        {o.status === "completed" && (
          <Card title="مكتمل">
            <p className="text-sm text-gray-600">
              اكتمل في <span className="ltr-nums">{o.completedDate}</span>
              {o.odometer ? ` عند العداد ${o.odometer.toLocaleString("en")} كم` : ""}.
            </p>
          </Card>
        )}
        {draft && can(user.perms, "maintenance", "delete") && (
          <Card title="حذف المسودة">
            <ActionForm action={deleteOrder.bind(null, id)} className="flex gap-2">
              <Input name="reason" placeholder="سبب الحذف" className="flex-1" />
              <SubmitButton variant="secondary">حذف</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
