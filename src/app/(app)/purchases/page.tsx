import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { vehicleOptions } from "@/lib/lookups";
import { expenseAccountOptions, supplierOptions } from "@/lib/purchases";
import { todayRiyadh } from "@/lib/dates";
import { PURCHASE_STATUS } from "@/data/purchases";
import { paymentState } from "@/data/sales";
import { SheetEditor } from "@/components/sheet-editor";
import { Badge, Card, EmptyRow, PageHeader, Table, Td } from "@/components/ui";
import { savePurchases } from "./actions";

const fmt = (v: string | number) => Number(v).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function PurchasesPage() {
  const user = await requirePermission("purchase_invoices", "view");
  const today = todayRiyadh();
  const [suppliers, accounts, vehicles, list] = await Promise.all([
    supplierOptions(db),
    expenseAccountOptions(db),
    vehicleOptions(),
    db
      .select({ i: s.purchaseInvoices, supplier: s.parties.nameAr })
      .from(s.purchaseInvoices)
      .innerJoin(s.parties, eq(s.parties.id, s.purchaseInvoices.supplierId))
      .orderBy(desc(s.purchaseInvoices.invoiceDate), desc(s.purchaseInvoices.id))
      .limit(300),
  ]);

  return (
    <>
      <PageHeader title="فواتير الموردين" description="مشتريات الصيانة وقطع الغيار والإطارات والخدمات. كل سطر على حسابه ومركبته، وضريبة المدخلات تُسترد تلقائياً." />
      {can(user.perms, "purchase_invoices", "create") && (
        <Card title="إدخال فواتير" className="mb-6">
          {suppliers.length === 0 ? (
            <p className="text-sm text-gray-500">
              أضف الموردين والورش من{" "}
              <Link href="/parties" className="text-brand-700 underline">
                جهات الاتصال
              </Link>{" "}
              أولاً.
            </p>
          ) : (
            <>
              <SheetEditor
                templateName="فواتير الموردين"
                action={savePurchases}
                initialRows={4}
                columns={[
                  { key: "date", label: "التاريخ", type: "date", required: true, placeholder: today },
                  { key: "supplierId", label: "المورد", type: "select", required: true, options: suppliers, width: "11rem" },
                  { key: "supplierInvoiceNo", label: "رقم فاتورته", required: true, ltr: true, width: "7rem" },
                  { key: "accountId", label: "الحساب", type: "select", required: true, options: accounts, width: "14rem" },
                  { key: "vehicleId", label: "المركبة", type: "select", options: vehicles, width: "8rem" },
                  { key: "description", label: "البيان", width: "12rem" },
                  { key: "amount", label: "المبلغ قبل الضريبة", type: "number", required: true, width: "7rem" },
                  { key: "vat", label: "الضريبة", type: "select", options: [{ value: "15", label: "15%" }, { value: "0", label: "بدون" }], width: "5rem", placeholder: "15%" },
                  { key: "dueDate", label: "الاستحقاق", type: "date", placeholder: "بعد 30 يوماً" },
                  { key: "currency", label: "العملة", type: "select", options: [{ value: "SAR", label: "SAR" }, { value: "KWD", label: "KWD" }], width: "5rem", placeholder: "SAR" },
                ]}
              />
              <p className="mt-2 text-xs text-gray-500">
                الصفوف التي لها نفس المورد ورقم الفاتورة تُحفظ فاتورة واحدة بعدة سطور. حساب الذمة يُحدد من دور الجهة (مورد، ورشة، محطة، ناقل، مخلص). تكاليف الناقلين والديزل الآجل المسجلة على البوالص لا تُدخل هنا مرة ثانية؛ تُسدد مباشرة من{" "}
                <Link href="/payments" className="text-brand-700 underline">
                  سندات الصرف
                </Link>
                .
              </p>
            </>
          )}
        </Card>
      )}

      <Table head={["الرقم", "التاريخ", "المورد", "رقم فاتورته", "الإجمالي", "المتبقي", "الاستحقاق", "الحالة", "السداد"]}>
        {list.length === 0 && <EmptyRow cols={9}>لا توجد فواتير موردين بعد</EmptyRow>}
        {list.map(({ i, supplier }) => {
          const total = Number(i.total);
          const paid = Number(i.paidAmount);
          const pay = paymentState(total, paid);
          const overdue = i.status === "posted" && paid < total && i.dueDate < today;
          return (
            <tr key={i.id}>
              <Td className="font-medium">
                <Link href={`/purchases/${i.id}`} className="ltr-nums text-brand-700 hover:underline">
                  {i.number}
                </Link>
              </Td>
              <Td className="ltr-nums">{i.invoiceDate}</Td>
              <Td>{supplier}</Td>
              <Td className="ltr-nums">{i.supplierInvoiceNo}</Td>
              <Td className="ltr-nums font-semibold">
                {fmt(total)} <span className="text-xs font-normal text-gray-400">{i.currencyCode}</span>
              </Td>
              <Td className="ltr-nums">{fmt(total - paid)}</Td>
              <Td className={`ltr-nums ${overdue ? "font-semibold text-red-600" : ""}`}>{i.dueDate}</Td>
              <Td>
                <Badge tone={PURCHASE_STATUS[i.status].tone}>{PURCHASE_STATUS[i.status].label}</Badge>
              </Td>
              <Td>{i.status === "posted" ? <Badge tone={overdue ? "red" : pay.tone}>{overdue ? "متأخرة" : pay.label}</Badge> : "—"}</Td>
            </tr>
          );
        })}
      </Table>
    </>
  );
}
