import { asc, desc, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { cashAccounts } from "@/lib/invoices";
import { todayRiyadh } from "@/lib/dates";
import { ADVANCE_STATUS } from "@/data/payroll";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { SheetEditor } from "@/components/sheet-editor";
import { Badge, Card, EmptyRow, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { PayrollTabs } from "../tabs";
import { deleteAdvanceAction, payAdvanceAction, revertAdvanceAction, saveAdvances } from "../actions";

const fmt = (v: string | number) => Number(v).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function AdvancesPage() {
  const user = await requirePermission("payroll", "view");
  const [employees, cashes, list] = await Promise.all([
    db.select({ id: s.employees.id, name: s.employees.nameAr }).from(s.employees).where(ne(s.employees.status, "terminated")).orderBy(asc(s.employees.nameAr)),
    cashAccounts(db),
    db
      .select({ a: s.employeeAdvances, name: s.employees.nameAr, cash: s.accounts.nameAr })
      .from(s.employeeAdvances)
      .innerJoin(s.employees, eq(s.employees.id, s.employeeAdvances.employeeId))
      .leftJoin(s.accounts, eq(s.accounts.id, s.employeeAdvances.cashAccountId))
      .orderBy(desc(s.employeeAdvances.advanceDate), desc(s.employeeAdvances.id))
      .limit(300),
  ]);
  const outstanding = list.filter((x) => x.a.status === "paid").reduce((t, x) => t + Number(x.a.amount) - Number(x.a.repaidAmount), 0);

  return (
    <>
      <PageHeader
        title="الرواتب"
        description="السلفة (ومنها مقدم العمولة للسائق) تُصرف من صندوق أو بنك على حساب سلف الموظفين، ويُستقطع قسطها تلقائياً في مسير كل شهر حتى تُسدد."
      >
        <div className="rounded-2xl bg-white px-4 py-3 text-sm shadow-sm">
          المتبقي على الموظفين: <span className="ltr-nums font-semibold text-brand-900">{fmt(outstanding)}</span> ر.س
        </div>
      </PageHeader>
      <PayrollTabs active="advances" />
      {can(user.perms, "payroll", "create") && (
        <Card title="تسجيل سلف" className="mb-6">
          <SheetEditor
            templateName="السلف"
            action={saveAdvances}
            initialRows={3}
            columns={[
              { key: "date", label: "التاريخ", type: "date", placeholder: todayRiyadh() },
              { key: "employeeId", label: "الموظف", type: "select", required: true, options: employees.map((e) => ({ value: String(e.id), label: e.name })), width: "12rem" },
              { key: "amount", label: "المبلغ", type: "number", required: true, width: "7rem" },
              { key: "installment", label: "القسط الشهري", type: "number", width: "7rem", placeholder: "كامل المبلغ" },
              { key: "notes", label: "ملاحظة", width: "16rem", placeholder: "مقدم عمولة" },
            ]}
          />
        </Card>
      )}
      <Table head={["الرقم", "التاريخ", "الموظف", "المبلغ", "القسط", "المسدد", "المتبقي", "الحالة", ""]}>
        {list.length === 0 && <EmptyRow cols={9}>لا توجد سلف</EmptyRow>}
        {list.map(({ a, name, cash }) => (
          <tr key={a.id}>
            <Td className="ltr-nums font-medium whitespace-nowrap">{a.number}</Td>
            <Td className="ltr-nums whitespace-nowrap">{a.advanceDate}</Td>
            <Td className="font-medium">
              {name}
              {a.notes && <div className="text-xs font-normal text-gray-500">{a.notes}</div>}
            </Td>
            <Td className="ltr-nums">{fmt(a.amount)}</Td>
            <Td className="ltr-nums">{fmt(a.installment)}</Td>
            <Td className="ltr-nums">{fmt(a.repaidAmount)}</Td>
            <Td className="ltr-nums font-semibold">{fmt(Number(a.amount) - Number(a.repaidAmount))}</Td>
            <Td>
              <Badge tone={ADVANCE_STATUS[a.status].tone}>{ADVANCE_STATUS[a.status].label}</Badge>
              {cash && <div className="mt-1 text-xs text-gray-500">من {cash}</div>}
            </Td>
            <Td>
              <div className="flex flex-wrap gap-2">
                {a.status === "pending" && can(user.perms, "payroll", "approve") && (
                  <ActionForm action={payAdvanceAction.bind(null, a.id)} resetOnSuccess={false} className="flex gap-1">
                    <Select name="cashAccountId" className="w-36">
                      <option value="">من صندوق / بنك</option>
                      {cashes.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nameAr}
                        </option>
                      ))}
                    </Select>
                    <SubmitButton>صرف</SubmitButton>
                  </ActionForm>
                )}
                {a.status === "pending" && can(user.perms, "payroll", "delete") && (
                  <ActionForm action={deleteAdvanceAction.bind(null, a.id)} className="flex gap-1">
                    <Input name="reason" placeholder="سبب الحذف" className="w-28" />
                    <SubmitButton variant="secondary">حذف</SubmitButton>
                  </ActionForm>
                )}
                {a.status === "paid" && Number(a.repaidAmount) === 0 && can(user.perms, "payroll", "revert") && (
                  <ActionForm action={revertAdvanceAction.bind(null, a.id)} resetOnSuccess={false}>
                    <SubmitButton variant="secondary">إلغاء الصرف</SubmitButton>
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
