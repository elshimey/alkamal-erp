import Link from "next/link";
import { and, desc, eq, gte, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { driverOptions, vehicleOptions } from "@/lib/lookups";
import { cashAccounts } from "@/lib/invoices";
import { custodyBalances, expenseAccountOptions } from "@/lib/purchases";
import { todayRiyadh } from "@/lib/dates";
import { EXPENSE_PAYERS, EXPENSE_STATUS } from "@/data/purchases";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { SheetEditor } from "@/components/sheet-editor";
import { Badge, Card, EmptyRow, Input, PageHeader, Table, Td } from "@/components/ui";
import { approve, approveMany, reject, remove, revert, saveExpenses } from "./actions";

const fmt = (v: string | number) => Number(v).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
type Status = keyof typeof EXPENSE_STATUS;

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = await requirePermission("expenses", "view");
  const { status: raw } = await searchParams;
  const status: Status | undefined = raw && raw in EXPENSE_STATUS ? (raw as Status) : undefined;
  const today = todayRiyadh();
  const since = new Date(Date.parse(today) - 60 * 86_400_000).toISOString().slice(0, 10);
  const cash = alias(s.accounts, "cash");
  const where: SQL[] = [];
  if (status) where.push(eq(s.expenses.status, status));

  const [accounts, drivers, vehicles, cashes, waybills, custody, list] = await Promise.all([
    expenseAccountOptions(db),
    driverOptions(),
    vehicleOptions(),
    cashAccounts(db),
    db
      .select({ id: s.waybills.id, number: s.waybills.number, date: s.waybills.waybillDate })
      .from(s.waybills)
      .where(and(eq(s.waybills.execution, "fleet"), gte(s.waybills.waybillDate, since)))
      .orderBy(desc(s.waybills.waybillDate)),
    can(user.perms, "drivers", "view") ? custodyBalances(db) : Promise.resolve([]),
    db
      .select({ e: s.expenses, account: s.accounts.nameAr, code: s.accounts.code, plate: s.vehicles.plate, driver: s.employees.nameAr, cash: cash.nameAr, waybill: s.waybills.number, entry: s.journalEntries.number })
      .from(s.expenses)
      .innerJoin(s.accounts, eq(s.accounts.id, s.expenses.accountId))
      .leftJoin(cash, eq(cash.id, s.expenses.cashAccountId))
      .leftJoin(s.vehicles, eq(s.vehicles.id, s.expenses.vehicleId))
      .leftJoin(s.drivers, eq(s.drivers.id, s.expenses.driverId))
      .leftJoin(s.employees, eq(s.employees.id, s.drivers.employeeId))
      .leftJoin(s.waybills, eq(s.waybills.id, s.expenses.waybillId))
      .leftJoin(s.journalEntries, eq(s.journalEntries.id, s.expenses.journalEntryId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(s.expenses.expenseDate), desc(s.expenses.id))
      .limit(300),
  ]);
  const pending = list.filter((x) => x.e.status === "pending").map((x) => x.e.id);
  const canApprove = can(user.perms, "expenses", "approve");

  return (
    <>
      <PageHeader title="المصروفات" description="مصروفات الطريق والمكتب المدفوعة من عهدة السائق أو من الصندوق والبنك. تُقيد على المركبة عند الاعتماد." />
      <div className="mb-6 grid gap-6 xl:grid-cols-3">
        {can(user.perms, "expenses", "create") && (
          <Card title="إدخال مصروفات" className="xl:col-span-2">
            <SheetEditor
              templateName="المصروفات"
              action={saveExpenses}
              initialRows={4}
              columns={[
                { key: "date", label: "التاريخ", type: "date", required: true, placeholder: today },
                { key: "payer", label: "الدافع", type: "select", required: true, options: Object.entries(EXPENSE_PAYERS).map(([value, label]) => ({ value, label })), width: "8rem" },
                { key: "driverId", label: "السائق", type: "select", options: drivers, width: "9rem" },
                { key: "cashAccountId", label: "أو الصندوق", type: "select", options: cashes.map((a) => ({ value: String(a.id), label: a.nameAr })), width: "9rem" },
                { key: "accountId", label: "نوع المصروف", type: "select", required: true, options: accounts, width: "13rem" },
                { key: "vehicleId", label: "المركبة", type: "select", options: vehicles, width: "8rem" },
                { key: "waybillId", label: "البوليصة", type: "select", options: waybills.map((w) => ({ value: String(w.id), label: `${w.number} · ${w.date}` })), width: "11rem" },
                { key: "description", label: "البيان", width: "10rem" },
                { key: "amount", label: "المبلغ قبل الضريبة", type: "number", required: true, width: "6rem" },
                { key: "vat", label: "الضريبة", type: "number", width: "5rem", placeholder: "0" },
                { key: "vendor", label: "المحل", width: "8rem" },
                { key: "reference", label: "رقم الإيصال", ltr: true, width: "7rem" },
              ]}
            />
            <p className="mt-2 text-xs text-gray-500">
              اختيار البوليصة يملأ المركبة والسائق تلقائياً. {canApprove ? "تُعتمد المصروفات فور الحفظ." : "تبقى بانتظار الاعتماد حتى يعتمدها المحاسب."}
            </p>
          </Card>
        )}
        {custody.length > 0 && (
          <Card title="أرصدة عهد السائقين">
            <ul className="divide-y divide-gray-100 text-sm">
              {custody.map((c) => (
                <li key={c.id} className="flex items-center justify-between py-2">
                  <span>{c.name}</span>
                  <span className={`ltr-nums font-semibold ${c.balance < 0 ? "text-red-600" : "text-emerald-700"}`}>{fmt(c.balance)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-gray-500">
              الموجب نقد لدى السائق، والسالب صرفه من جيبه ويستحق تعويضاً. اصرف العهدة من{" "}
              <Link href="/payments" className="text-brand-700 underline">
                سندات الصرف
              </Link>
              .
            </p>
          </Card>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        {[{ key: undefined, label: "الكل" }, ...(Object.keys(EXPENSE_STATUS) as Status[]).map((k) => ({ key: k, label: EXPENSE_STATUS[k].label }))].map((t) => (
          <Link
            key={t.label}
            href={t.key ? `/expenses?status=${t.key}` : "/expenses"}
            className={`rounded-full px-3.5 py-1.5 transition ${t.key === status ? "bg-asphalt-900 font-semibold text-brand-500" : "bg-white text-gray-600 shadow-sm hover:bg-brand-50"}`}
          >
            {t.label}
          </Link>
        ))}
        {canApprove && pending.length > 0 && (
          <ActionForm action={approveMany.bind(null, pending)} resetOnSuccess={false} className="ms-auto">
            <SubmitButton>اعتماد المعلّق ({pending.length})</SubmitButton>
          </ActionForm>
        )}
      </div>

      <Table head={["الرقم", "التاريخ", "النوع", "البيان", "المركبة", "الدافع", "المبلغ", "الضريبة", "الحالة", ""]}>
        {list.length === 0 && <EmptyRow cols={10}>لا توجد مصروفات</EmptyRow>}
        {list.map(({ e, account, code, plate, driver, cash: box, waybill, entry }) => (
          <tr key={e.id}>
            <Td className="ltr-nums font-medium whitespace-nowrap">{e.number}</Td>
            <Td className="ltr-nums whitespace-nowrap">{e.expenseDate}</Td>
            <Td>
              <span className="ltr-nums text-xs text-gray-400">{code}</span> {account}
            </Td>
            <Td>
              {e.description}
              {waybill && <div className="ltr-nums text-xs text-gray-400">{waybill}</div>}
            </Td>
            <Td>{plate ?? "—"}</Td>
            <Td className="text-xs">{e.payer === "driver_custody" ? `عهدة ${driver ?? ""}` : box}</Td>
            <Td className="ltr-nums font-semibold">{fmt(e.amount)}</Td>
            <Td className="ltr-nums">{Number(e.vatAmount) ? fmt(e.vatAmount) : "—"}</Td>
            <Td>
              <Badge tone={EXPENSE_STATUS[e.status].tone}>{EXPENSE_STATUS[e.status].label}</Badge>
              {e.rejectReason && <div className="text-xs text-red-600">{e.rejectReason}</div>}
              {entry && <div className="ltr-nums text-[11px] text-gray-400">{entry}</div>}
            </Td>
            <Td>
              <div className="flex flex-wrap gap-2">
                {e.status === "pending" && canApprove && (
                  <>
                    <ActionForm action={approve.bind(null, e.id)} resetOnSuccess={false}>
                      <SubmitButton variant="secondary">اعتماد</SubmitButton>
                    </ActionForm>
                    <ActionForm action={reject.bind(null, e.id)} className="flex gap-1">
                      <Input name="reason" placeholder="سبب الرفض" className="w-28" />
                      <SubmitButton variant="secondary">رفض</SubmitButton>
                    </ActionForm>
                  </>
                )}
                {e.status !== "pending" && can(user.perms, "expenses", "revert") && (
                  <ActionForm action={revert.bind(null, e.id)} resetOnSuccess={false}>
                    <SubmitButton variant="secondary">إرجاع</SubmitButton>
                  </ActionForm>
                )}
                {e.status !== "approved" && can(user.perms, "expenses", "delete") && (
                  <ActionForm action={remove.bind(null, e.id)} resetOnSuccess={false}>
                    <SubmitButton variant="secondary">حذف</SubmitButton>
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
