import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getCompany, getInvoiceTemplate } from "@/lib/company";
import { orderDoc, PO_STATUS } from "@/lib/purchasing";
import { todayRiyadh } from "@/lib/dates";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { PurchaseOrderDocument } from "@/components/commercial-documents";
import { PrintButton } from "@/components/print-button";
import { SendDocument } from "@/components/send-document";
import { Badge, Input, Select } from "@/components/ui";
import { invoiceOrder, orderStatus, removeOrder } from "../../purchase-requests/actions";

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("purchase_invoices", "view");
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const [doc, company, template, warehouses] = await Promise.all([
    orderDoc(db, id),
    getCompany(db),
    getInvoiceTemplate(db),
    db.select({ id: s.warehouses.id, nameAr: s.warehouses.nameAr }).from(s.warehouses).where(eq(s.warehouses.isActive, true)),
  ]);
  if (!doc) notFound();
  const { o } = doc;
  const hasStock = doc.lines.some((l) => l.productId);
  const canApprove = can(user.perms, "purchase_invoices", "approve");
  const canRevert = can(user.perms, "purchase_invoices", "revert");
  const canInvoice = can(user.perms, "purchase_invoices", "create") && o.status === "approved";

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <Link href="/purchase-orders" className="text-sm text-brand-700 hover:underline">
          ← أوامر الشراء
        </Link>
        <Badge tone={PO_STATUS[o.status].tone}>{PO_STATUS[o.status].label}</Badge>
        {o.purchaseInvoiceId && (
          <Link href={`/purchases?open=${o.purchaseInvoiceId}`} className="text-sm font-medium text-brand-700 hover:underline">
            فُوتر ← فاتورة المورد
          </Link>
        )}
        <span className="ms-auto flex flex-wrap items-center gap-2">
          {o.status === "draft" && canApprove && (
            <ActionForm action={orderStatus.bind(null, id, "approved")}>
              <SubmitButton>اعتماد الأمر</SubmitButton>
            </ActionForm>
          )}
          {(o.status === "approved" || o.status === "cancelled") && canRevert && (
            <ActionForm action={orderStatus.bind(null, id, "draft")}>
              <SubmitButton variant="secondary">إعادة لمسودة</SubmitButton>
            </ActionForm>
          )}
          {(o.status === "draft" || o.status === "approved") && canRevert && (
            <ActionForm action={orderStatus.bind(null, id, "cancelled")}>
              <SubmitButton variant="secondary" className="text-red-700">
                إلغاء الأمر
              </SubmitButton>
            </ActionForm>
          )}
          <SendDocument to="للمورد" kind="purchase-orders" id={id} label={`أمر شراء رقم ${o.number}`} company={company.nameAr} phone={doc.supplier.mobile} email={doc.supplier.email} />
          <PrintButton />
        </span>
      </div>

      {o.status === "draft" && (
        <p className="mb-4 rounded-xl bg-amber-50 px-4 py-2 text-sm text-amber-800 print:hidden">الأمر مسودة: اعتمده قبل إرساله للمورد، ثم حوّله لفاتورة عند وصول فاتورة المورد.</p>
      )}

      {canInvoice && (
        <ActionForm action={invoiceOrder.bind(null, id)} className="mb-4 flex flex-wrap items-end gap-3 rounded-2xl border border-brand-500/50 bg-brand-50 p-4 print:hidden">
          <div className="min-w-56 flex-1 text-sm text-gray-700">
            <div className="font-semibold text-asphalt-900">وصلت فاتورة المورد؟ حوّل الأمر إلى فاتورة</div>
            تُنشأ فاتورة مورد مسودة بنفس السطور والأسعار لتراجعها ثم تعتمدها{hasStock ? "، وتدخل الأصناف المستودع المختار عند الاعتماد" : ""}.
          </div>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-gray-600">رقم فاتورة المورد</span>
            <Input name="supplierInvoiceNo" required dir="ltr" className="w-36" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-gray-600">تاريخ الفاتورة</span>
            <Input name="invoiceDate" type="date" defaultValue={todayRiyadh()} required />
          </label>
          {hasStock && (
            <label className="text-sm">
              <span className="mb-1 block text-xs text-gray-600">المستودع</span>
              <Select name="warehouseId" required defaultValue={warehouses[0] ? String(warehouses[0].id) : ""}>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.nameAr}
                  </option>
                ))}
              </Select>
            </label>
          )}
          <SubmitButton>إنشاء فاتورة المورد</SubmitButton>
        </ActionForm>
      )}

      <PurchaseOrderDocument company={company} doc={doc} template={template} />

      {can(user.perms, "purchase_invoices", "delete") && o.status !== "invoiced" && (
        <details className="mt-6 text-sm print:hidden">
          <summary className="cursor-pointer text-gray-400 hover:text-red-700">حذف الأمر</summary>
          <ActionForm action={removeOrder.bind(null, id)} className="mt-2">
            <SubmitButton variant="secondary" className="text-red-700">
              تأكيد حذف الأمر
            </SubmitButton>
          </ActionForm>
        </details>
      )}
    </div>
  );
}
