import Link from "next/link";
import { ComboField } from "@/components/combo-box";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listRequests, PR_STATUS, requestLines } from "@/lib/purchasing";
import { productOptions, vehicleOptions } from "@/lib/lookups";
import { todayRiyadh } from "@/lib/dates";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { LinesEditor } from "@/components/lines-editor";
import { Badge, EmptyRow, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { removeRequest, requestDecision, saveRequest } from "./actions";

export default async function PurchaseRequestsPage() {
  const user = await requirePermission("purchase_invoices", "view");
  const [rows, products, vehicles] = await Promise.all([listRequests(db), productOptions(), vehicleOptions()]);
  const lines = await requestLines(db, rows.map((r) => r.r.id));
  const canCreate = can(user.perms, "purchase_invoices", "create");
  const canApprove = can(user.perms, "purchase_invoices", "approve");
  const canRevert = can(user.perms, "purchase_invoices", "revert");
  const canDelete = can(user.perms, "purchase_invoices", "delete");

  return (
    <>
      <PageHeader title="طلبات الشراء" description="الورشة أو التشغيل يطلب القطع والإطارات والمستلزمات، والمدير يعتمد، ثم يصدر للطلب المعتمد أمر شراء للمورد.">
        <Link href="/purchase-orders" className="text-sm font-medium text-brand-700 hover:underline">
          أوامر الشراء ←
        </Link>
      </PageHeader>

      {canCreate && (
        <details open={rows.length === 0} className="mb-6 rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm">
          <summary className="cursor-pointer font-semibold text-brand-900">+ طلب شراء جديد</summary>
          <ActionForm action={saveRequest} className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="التاريخ">
              <Input name="date" type="date" required defaultValue={todayRiyadh()} />
            </Field>
            <Field label="مطلوب قبل" hint="اختياري">
              <Input name="neededBy" type="date" />
            </Field>
            <Field label="للمركبة" hint="اختياري؛ تُحمّل عليها التكلفة">
              <ComboField name="vehicleId" options={vehicles} create="vehicle" />
            </Field>
            <Field label="ملاحظات">
              <Input name="notes" />
            </Field>
            <div className="col-span-full">
              <LinesEditor
                totals={{ qty: "quantity", price: "price" }}
                columns={[
                  { key: "productId", label: "الصنف", type: "select", width: "16rem", options: products, placeholder: "صنف من المخزون أو اكتب الوصف", create: "product" },
                  { key: "description", label: "الوصف" },
                  { key: "quantity", label: "الكمية", type: "number", width: "6rem" },
                  { key: "price", label: "السعر التقديري", type: "number", width: "8rem" },
                ]}
              />
            </div>
            <div className="col-span-full">
              <SubmitButton>حفظ الطلب</SubmitButton>
            </div>
          </ActionForm>
        </details>
      )}

      <Table head={["الرقم", "التاريخ", "الأصناف", "المركبة", "مطلوب قبل", "مقدم الطلب", "الحالة", ""]}>
        {rows.length === 0 && <EmptyRow cols={8}>لا توجد طلبات شراء بعد</EmptyRow>}
        {rows.map(({ r, plate, by }) => (
          <tr key={r.id}>
            <Td className="ltr-nums font-medium whitespace-nowrap">{r.number}</Td>
            <Td className="ltr-nums whitespace-nowrap">{r.requestDate}</Td>
            <Td className="text-xs">
              {lines
                .filter((l) => l.requestId === r.id)
                .map((l) => (
                  <div key={l.id}>
                    {l.description} × <span className="ltr-nums">{Number(l.quantity).toLocaleString("en")}</span>
                  </div>
                ))}
              {r.notes && <div className="text-gray-400">{r.notes}</div>}
              {r.rejectReason && <div className="text-red-600">سبب الرفض: {r.rejectReason}</div>}
            </Td>
            <Td>{plate ?? "—"}</Td>
            <Td className="ltr-nums">{r.neededBy ?? "—"}</Td>
            <Td className="text-xs">{by ?? "—"}</Td>
            <Td>
              <Badge tone={PR_STATUS[r.status].tone}>{PR_STATUS[r.status].label}</Badge>
            </Td>
            <Td>
              <div className="flex flex-wrap items-center gap-2">
                {r.status === "draft" && canApprove && (
                  <ActionForm action={requestDecision.bind(null, r.id, "approve")}>
                    <SubmitButton className="!px-2 !py-1 text-xs">اعتماد</SubmitButton>
                  </ActionForm>
                )}
                {r.status === "approved" && canCreate && (
                  <Link href={`/purchase-orders?request=${r.id}`} className="rounded-lg bg-brand-600 px-2 py-1 text-xs font-semibold text-brand-900">
                    إصدار أمر شراء
                  </Link>
                )}
                {(r.status === "approved" || r.status === "rejected") && canRevert && (
                  <ActionForm action={requestDecision.bind(null, r.id, "reopen")}>
                    <SubmitButton variant="secondary" className="!px-2 !py-1 text-xs">
                      لمسودة
                    </SubmitButton>
                  </ActionForm>
                )}
                {r.status === "draft" && canApprove && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-gray-500 hover:text-red-700">رفض</summary>
                    <ActionForm action={requestDecision.bind(null, r.id, "reject")} className="mt-1 flex gap-1">
                      <Input name="reason" placeholder="السبب" required className="!h-8 !text-xs" />
                      <SubmitButton variant="secondary" className="!px-2 !py-1 text-xs text-red-700">
                        رفض
                      </SubmitButton>
                    </ActionForm>
                  </details>
                )}
                {(r.status === "draft" || r.status === "rejected") && canDelete && (
                  <ActionForm action={removeRequest.bind(null, r.id)}>
                    <SubmitButton variant="secondary" className="!px-2 !py-1 text-xs text-red-700">
                      حذف
                    </SubmitButton>
                  </ActionForm>
                )}
              </div>
            </Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
