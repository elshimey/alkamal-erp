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
import { listAttachments } from "@/lib/attachments";
import { EXPENSE_PAYERS, EXPENSE_STATUS } from "@/data/purchases";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { SheetEditor } from "@/components/sheet-editor";
import { AddModeBar, ListActions } from "@/components/list-actions";
import { Badge, Card, EmptyRow, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { DialogButton } from "@/components/dialog-button";
import { approve, approveMany, approveReviewed, reject, remove, revert, saveExpenses } from "./actions";
import { fmt } from "@/lib/format";

type Status = keyof typeof EXPENSE_STATUS;

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ status?: string; add?: string }> }) {
  const user = await requirePermission("expenses", "view");
  const { status: raw, add } = await searchParams;
  const adding = add === "1" && can(user.perms, "expenses", "create");
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
      .select({
        e: s.expenses,
        account: s.accounts.nameAr,
        code: s.accounts.code,
        plate: s.vehicles.plate,
        driver: s.employees.nameAr,
        cash: cash.nameAr,
        waybill: s.waybills.number,
        entry: s.journalEntries.number,
        maintenance: s.maintenanceTypes.nameAr,
      })
      .from(s.expenses)
      .innerJoin(s.accounts, eq(s.accounts.id, s.expenses.accountId))
      .leftJoin(cash, eq(cash.id, s.expenses.cashAccountId))
      .leftJoin(s.vehicles, eq(s.vehicles.id, s.expenses.vehicleId))
      .leftJoin(s.drivers, eq(s.drivers.id, s.expenses.driverId))
      .leftJoin(s.employees, eq(s.employees.id, s.drivers.employeeId))
      .leftJoin(s.waybills, eq(s.waybills.id, s.expenses.waybillId))
      .leftJoin(s.journalEntries, eq(s.journalEntries.id, s.expenses.journalEntryId))
      .leftJoin(s.maintenanceTypes, eq(s.maintenanceTypes.id, s.expenses.maintenanceTypeId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(s.expenses.expenseDate), desc(s.expenses.id))
      .limit(300),
  ]);
  const photos = new Map((await listAttachments(db, "expenses", list.map((r) => r.e.id))).map((a) => [a.entityId, a.id]));
  // مصروف قال السائق إن الشركة دفعته لا يُعتمد جماعياً؛ يحدد المعتمد صندوقه أولاً
  const pending = list.filter((x) => x.e.status === "pending" && !(x.e.payer === "driver_custody" && x.e.reportedPayer === "company")).map((x) => x.e.id);
  const canApprove = can(user.perms, "expenses", "approve");

  return (
    <>
      <PageHeader title="المصروفات" description="مصروفات الطريق والمكتب المدفوعة من عهدة السائق أو من الصندوق والبنك. تُقيد على المركبة عند الاعتماد.">
        {!adding && <ListActions addHref={can(user.perms, "expenses", "create") && "/expenses?add=1"} addLabel="إدخال مصروفات" />}
      </PageHeader>
      {adding && <AddModeBar backHref="/expenses" backLabel="المصروفات" title="إدخال مصروفات" />}
      <div className="mb-6 grid gap-6 xl:grid-cols-3">
        {adding && (
          <Card className="xl:col-span-3">
            <SheetEditor
              templateName="المصروفات"
              action={saveExpenses}
              initialRows={4}
              columns={[
                { key: "date", label: "التاريخ", type: "date", placeholder: today },
                { key: "payer", label: "الدافع", type: "select", required: true, options: Object.entries(EXPENSE_PAYERS).map(([value, label]) => ({ value, label })), width: "8rem" },
                { key: "driverId", label: "السائق", type: "select", options: drivers, width: "9rem", create: "driver" },
                { key: "cashAccountId", label: "أو الصندوق", type: "select", options: cashes.map((a) => ({ value: String(a.id), label: a.nameAr })), width: "9rem" },
                { key: "accountId", label: "نوع المصروف", type: "select", required: true, options: accounts, width: "13rem" },
                { key: "vehicleId", label: "المركبة", type: "select", options: vehicles, width: "8rem", create: "vehicle" },
                { key: "waybillId", label: "الشحنة", type: "select", options: waybills.map((w) => ({ value: String(w.id), label: `${w.number} · ${w.date}` })), width: "11rem" },
                { key: "description", label: "البيان", width: "10rem" },
                { key: "amount", label: "المبلغ قبل الضريبة", type: "number", required: true, width: "6rem" },
                { key: "vat", label: "الضريبة", type: "number", width: "5rem", placeholder: "0" },
                { key: "vendor", label: "المحل", width: "8rem" },
                { key: "reference", label: "رقم الإيصال", ltr: true, width: "7rem" },
              ]}
            />
            <p className="mt-2 text-xs text-gray-500">
              اختيار الشحنة يملأ المركبة والسائق تلقائياً. {canApprove ? "تُعتمد المصروفات فور الحفظ." : "تبقى بانتظار الاعتماد حتى يعتمدها المحاسب."}
            </p>
          </Card>
        )}
        {!adding && custody.length > 0 && (
          <Card title="أرصدة عهد السائقين" className="xl:col-span-3">
            <ul className="grid gap-x-8 text-sm sm:grid-cols-2 xl:grid-cols-4">
              {custody.map((c) => (
                <li key={c.id} className="flex items-center justify-between border-b border-gray-100 py-2">
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

      {!adding && (
        <>
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
        {list.map(({ e, account, code, plate, driver, cash: box, waybill, entry, maintenance }) => (
          <tr key={e.id}>
            <Td className="ltr-nums font-medium whitespace-nowrap">{e.number}</Td>
            <Td className="ltr-nums whitespace-nowrap">{e.expenseDate}</Td>
            <Td>
              <span className="ltr-nums text-xs text-gray-400">{code}</span> {account}
            </Td>
            <Td>
              {e.description}
              {photos.has(e.id) && (
                <a href={`/files/${photos.get(e.id)}`} target="_blank" rel="noreferrer" className="ms-1 text-xs font-medium text-brand-700 hover:underline">
                  📷 الإيصال
                </a>
              )}
              {maintenance && <div className="text-xs text-gray-500">نوع الصيانة: {maintenance}</div>}
              {waybill && <div className="ltr-nums text-xs text-gray-400">{waybill}</div>}
              {e.driverKind && <div className="text-[11px] text-sky-700">📱 من تطبيق السائق</div>}
            </Td>
            <Td>{plate ?? "—"}</Td>
            <Td className="text-xs">
              {e.payer === "driver_custody" ? `عهدة ${driver ?? ""}` : box}
              {e.status === "pending" && e.reportedPayer === "company" && <div className="font-medium text-amber-700">السائق: دفعت الشركة</div>}
            </Td>
            <Td className="ltr-nums font-semibold">{fmt(e.amount)}</Td>
            <Td className="ltr-nums">{Number(e.vatAmount) ? fmt(e.vatAmount) : "—"}</Td>
            <Td>
              <Badge tone={EXPENSE_STATUS[e.status].tone}>{EXPENSE_STATUS[e.status].label}</Badge>
              {e.rejectReason && <div className="text-xs text-red-600">{e.rejectReason}</div>}
              {e.status === "voided" && e.voidReason && <div className="text-xs text-gray-500">{e.voidReason}</div>}
              {entry && <div className="ltr-nums text-[11px] text-gray-400">{entry}</div>}
            </Td>
            <Td>
              <div className="flex flex-wrap gap-2">
                {e.status === "pending" && canApprove && (
                  <>
                    {e.driverKind ? (
                      <DialogButton label="مراجعة واعتماد" title={`اعتماد مصروف السائق ${e.number}`} className="!border-brand-600 !bg-brand-50 font-semibold !text-brand-900">
                        <ActionForm action={approveReviewed.bind(null, e.id)} resetOnSuccess={false} className="flex flex-col gap-3 text-sm">
                          <p className="rounded-lg bg-gray-50 px-3 py-2">
                            {e.description} · المبلغ الإجمالي <b className="ltr-nums">{fmt(Number(e.amount) + Number(e.vatAmount))}</b>
                            <br />
                            قال السائق: <b>{e.reportedPayer === "company" ? "دفعت الشركة" : "من عهدتي"}</b>
                            {photos.has(e.id) && (
                              <a href={`/files/${photos.get(e.id)}`} target="_blank" rel="noreferrer" className="ms-2 font-medium text-brand-700 hover:underline">
                                📷 عرض الإيصال
                              </a>
                            )}
                          </p>
                          <Field label="من دفع فعلاً">
                            <Select name="payer" defaultValue={e.reportedPayer === "company" ? "cash" : "driver_custody"}>
                              <option value="driver_custody">عهدة السائق {driver ?? ""} (يُخصم من عهدته)</option>
                              <option value="cash">الشركة: صندوق أو بنك (لا يُخصم من العهدة)</option>
                            </Select>
                          </Field>
                          <Field label="الصندوق أو البنك (إن دفعت الشركة)">
                            <Select name="cashAccountId" defaultValue="">
                              <option value="">—</option>
                              {cashes.map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.nameAr}
                                </option>
                              ))}
                            </Select>
                          </Field>
                          <Field label="حساب المصروف">
                            <Select name="accountId" defaultValue={String(e.accountId)}>
                              {accounts.map((a) => (
                                <option key={a.value} value={a.value}>
                                  {a.label}
                                </option>
                              ))}
                            </Select>
                          </Field>
                          <div className="grid grid-cols-2 gap-3">
                            <Field label="الضريبة ضمن المبلغ">
                              <Input name="vat" inputMode="decimal" dir="ltr" defaultValue={Number(e.vatAmount) ? String(e.vatAmount) : ""} placeholder="0" />
                            </Field>
                            <Field label="المورد (اختياري)">
                              <Input name="vendor" defaultValue={e.vendorName ?? ""} />
                            </Field>
                          </div>
                          <p className="text-xs text-gray-500">الضريبة تُفصل من المبلغ الإجمالي لاسترداد ضريبة المدخلات (15% من المبلغ قبلها = الإجمالي × 15 ÷ 115).</p>
                          <SubmitButton>اعتماد وترحيل القيد</SubmitButton>
                        </ActionForm>
                      </DialogButton>
                    ) : (
                      <ActionForm action={approve.bind(null, e.id)} resetOnSuccess={false}>
                        <SubmitButton variant="secondary">اعتماد</SubmitButton>
                      </ActionForm>
                    )}
                    <ActionForm action={reject.bind(null, e.id)} className="flex gap-1">
                      <Input name="reason" placeholder="سبب الرفض" className="w-28" />
                      <SubmitButton variant="secondary">رفض</SubmitButton>
                    </ActionForm>
                  </>
                )}
                {(e.status === "approved" || e.status === "rejected") && can(user.perms, "expenses", "revert") && (
                  <ActionForm action={revert.bind(null, e.id)} resetOnSuccess={false}>
                    <SubmitButton variant="secondary">إرجاع</SubmitButton>
                  </ActionForm>
                )}
                {e.status !== "approved" && !e.driverKind && can(user.perms, "expenses", "delete") && (
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
      )}
    </>
  );
}
