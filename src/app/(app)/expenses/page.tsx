import Link from "next/link";
import { EdgeCell } from "@/components/desk-list";
import { and, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { driverOptions, vehicleOptions } from "@/lib/lookups";
import { payFromAccounts } from "@/lib/invoices";
import { custodyBalances, expenseAccountOptions, supplierOptions } from "@/lib/purchases";
import { todayRiyadh } from "@/lib/dates";
import { listAttachments } from "@/lib/attachments";
import { EXPENSE_PAYERS, EXPENSE_STATUS } from "@/data/purchases";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { SheetEditor } from "@/components/sheet-editor";
import { AddModeBar, ListActions } from "@/components/list-actions";
import { Badge, Card, EmptyRow, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { DialogButton } from "@/components/dialog-button";
import { approve, approveMany, approveReviewed, reject, remove, revert, saveExpenseSheet, saveExpenses } from "./actions";
import { DocSheet, type DocSheetRow } from "@/components/doc-sheet";
import { DocToolbar } from "@/components/doc-toolbar";
import { DeskDrawer } from "@/components/desk-drawer";
import { periodRange, PERIODS, type Period } from "@/lib/doc-filters";
import { fmt, fmtDate } from "@/lib/format";
import { DocCards, Plate } from "@/components/doc-card";
import { DocCardFace, Facts, SheetActions, TapCard } from "@/components/list-card";
import { ExpensePanel } from "./expense-panel";
import { AccountField } from "@/components/account-field";
import { payFromSheetOptions, payFromTree, toAccountOptions } from "@/lib/lookups";

type Status = keyof typeof EXPENSE_STATUS;

type Search = { status?: string; add?: string; new?: string; edit?: string; open?: string; view?: string; q?: string; period?: string; back?: string };
const drawerBtn = "inline-flex h-10 items-center gap-1.5 rounded-xl border border-gray-300 bg-white px-3 text-sm text-gray-700 shadow-sm hover:bg-gray-50";

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePermission("expenses", "view");
  const sp = await searchParams;
  const { status: raw, add, new: isNew } = sp;
  const view = sp.view === "sheet" ? "sheet" : "table";
  const q = sp.q?.trim() || undefined;
  const period: Period = sp.period && sp.period in PERIODS ? (sp.period as Period) : "all";
  // رابط القائمة بنفس الفلاتر مع تغيير بعضها (فتح المعاينة، التعديل، الشيت)
  const href = (patch: Partial<Search> = {}) => {
    const p = new URLSearchParams(Object.entries({ status: raw, view: sp.view, q: sp.q, period: sp.period, ...patch }).filter((e): e is [string, string] => !!e[1]));
    return p.size ? `/expenses?${p}` : "/expenses";
  };
  const canUpdate = can(user.perms, "expenses", "update");
  const canRevert = can(user.perms, "expenses", "revert");
  const canCreate = can(user.perms, "expenses", "create");
  const adding = add === "1" && canCreate;
  const creating = isNew === "1" && canCreate;
  const status: Status | undefined = raw && raw in EXPENSE_STATUS ? (raw as Status) : undefined;
  const today = todayRiyadh();
  const since = new Date(Date.parse(today) - 60 * 86_400_000).toISOString().slice(0, 10);
  const cash = alias(s.accounts, "cash");
  const where: SQL[] = [];
  if (status) where.push(eq(s.expenses.status, status));
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
    where.push(or(ilike(s.expenses.number, like), ilike(s.expenses.description, like), ilike(s.accounts.nameAr, like), ilike(s.vehicles.plate, like), ilike(s.employees.nameAr, like), ilike(s.expenses.vendorName, like), ilike(s.expenses.reference, like), ilike(sql`${s.expenses.amount}::text`, like))!);
  }
  const range = periodRange(period, today);
  if (range.from) where.push(gte(s.expenses.expenseDate, range.from));
  if (range.to) where.push(lte(s.expenses.expenseDate, range.to));
  const editId = canUpdate ? Number(sp.edit) || null : null;
  const openId = Number(sp.open) || null;
  // فُتح التعديل من صفحة أخرى (تحت المراجعة): الإغلاق يعود إليها (رابط داخلي فقط)
  const back = sp.back?.startsWith("/") && !sp.back.startsWith("//") ? sp.back : undefined;

  const [accounts, drivers, vehicles, cashes, waybills, custody, list, payees] = await Promise.all([
    expenseAccountOptions(db),
    driverOptions(),
    vehicleOptions(),
    payFromAccounts(db),
    db
      .select({ id: s.waybills.id, number: s.waybills.number, date: s.waybills.waybillDate })
      .from(s.waybills)
      .where(gte(s.waybills.waybillDate, since))
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
    adding || view === "sheet" ? supplierOptions(db) : Promise.resolve([]),
  ]);
  // شحنات المصروفات الظاهرة تبقى في قائمة الشيت ولو أقدم من 60 يوماً
  const missing = [...new Set(list.map((r) => r.e.waybillId).filter((id): id is number => !!id && !waybills.some((w) => w.id === id)))];
  if (missing.length)
    waybills.push(...(await db.select({ id: s.waybills.id, number: s.waybills.number, date: s.waybills.waybillDate }).from(s.waybills).where(inArray(s.waybills.id, missing))));
  const editing = editId ? ((await db.select().from(s.expenses).where(eq(s.expenses.id, editId)))[0] ?? null) : null;
  /** يُعدَّل المصروف ما لم يُسدد بسند صرف أو يُلغه السائق؛ المعتمد يحتاج صلاحية الإرجاع لأن قيده يُعاد. */
  const editable = (e: (typeof list)[number]["e"]) => canUpdate && e.status !== "voided" && !e.paymentId && !e.maintenanceOrderId && (e.status !== "approved" || canRevert);
  const [cashOpts, tree, sheetCash] = await Promise.all([toAccountOptions(cashes), payFromTree(), payFromSheetOptions(cashes)]);
  const photos = new Map((await listAttachments(db, "expenses", list.map((r) => r.e.id))).map((a) => [a.entityId, a.id]));
  // مصروف قال السائق إن الشركة دفعته لا يُعتمد جماعياً؛ يحدد المعتمد صندوقه أولاً
  const pending = list.filter((x) => x.e.status === "pending" && !(x.e.payer === "driver_custody" && x.e.reportedPayer === "company")).map((x) => x.e.id);
  const canApprove = can(user.perms, "expenses", "approve");

  type Row = (typeof list)[number];
  const rowActions = ({ e, driver, waybill }: Pick<Row, "e" | "driver" | "waybill">) => (
    <>
                {editable(e) && (
                  <Link href={href({ edit: String(e.id), open: undefined })} scroll={false} className="inline-flex items-center rounded-lg border border-brand-600 bg-brand-50 px-3 py-1.5 text-sm font-semibold text-brand-900 hover:bg-brand-100">
                    تعديل
                  </Link>
                )}
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
                              <option value="cash">الشركة: صندوق أو بنك أو عهدة موظف (لا يُخصم من عهدة السائق)</option>
                            </Select>
                          </Field>
                          <Field label="الصندوق أو البنك أو عهدة الموظف (إن دفعت الشركة)">
                            <AccountField name="cashAccountId" options={cashOpts} moreOptions={tree} placeholder="—" />
                          </Field>
                          <Field label="حساب المصروف">
                            <AccountField name="accountId" options={accounts} defaultValue={e.accountId} required />
                          </Field>
                          {waybill && (
                            <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                              <input type="checkbox" name="billToCustomer" value="1" defaultChecked={e.billToCustomer} className="mt-0.5 accent-brand-600" />
                              <span>
                                <b>يُحمَّل على العميل</b> ويظهر سطراً في فاتورة الشحنة {waybill}
                                <span className="block text-xs text-gray-600">يُقيد على «مصاريف مستردة من العملاء» 1114 بدل مصروف المركبة، ويُقفل عند الفوترة.</span>
                              </span>
                            </label>
                          )}
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
    </>
  );
  const openRow = openId ? list.find((r) => r.e.id === openId) : undefined;
  const payerText = ({ e, driver, cash: box }: Row) =>
    e.payer === "driver_custody" ? `عهدة ${driver ?? ""}` : e.payer === "unpaid" ? (e.paymentId ? "سُدد بسند صرف" : "لم يُدفع بعد") : box;

  return (
    <>
      <PageHeader title="المصروفات" description="مصروفات الطريق والمكتب المدفوعة من عهدة السائق، أو من الصندوق والبنك وعهدة موظف المكتب. تُقيد على المركبة عند الاعتماد، واختيار الشحنة يربطها بها.">
        {!adding && (
          <ListActions
            newHref={canCreate && `/expenses?new=1${status ? `&status=${status}` : ""}`}
            newLabel="مصروف جديد"
            addHref={canCreate && "/expenses?add=1"}
            addLabel="إدخال مصروفات جماعي (شيت)"
          />
        )}
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
                { key: "driverId", label: "السائق", type: "select", options: drivers, width: "9rem", create: "driver", autoVehicle: { key: "vehicleId", dateKey: "date" } },
                { key: "cashAccountId", label: "أو الصندوق / عهدة موظف", type: "select", options: sheetCash, width: "11rem", create: "account" },
                { key: "partyId", label: "المستفيد (لم يُدفع)", type: "select", options: payees, width: "10rem", create: "supplier" },
                { key: "accountId", label: "نوع المصروف", type: "select", required: true, options: accounts, width: "13rem", create: "account" },
                { key: "vehicleId", label: "المركبة", type: "select", options: vehicles, width: "8rem", create: "vehicle", autoDriver: { key: "driverId", dateKey: "date" } },
                { key: "waybillId", label: "الشحنة", type: "select", options: waybills.map((w) => ({ value: String(w.id), label: `${w.number} · ${w.date}` })), width: "11rem" },
                { key: "billTo", label: "على العميل؟", type: "select", options: [{ value: "customer", label: "نعم، يُفوتر" }], width: "7rem", placeholder: "لا" },
                { key: "description", label: "البيان", width: "10rem" },
                { key: "amount", label: "المبلغ قبل الضريبة", type: "number", required: true, width: "6rem" },
                { key: "vat", label: "الضريبة", type: "number", width: "5rem", placeholder: "0" },
                { key: "vendor", label: "المحل", width: "8rem" },
                { key: "reference", label: "رقم الإيصال", ltr: true, width: "7rem" },
              ]}
            />
            <p className="mt-2 text-xs text-gray-500">
              اختيار الشحنة يملأ المركبة والسائق تلقائياً. ما دفعه موظف المكتب من عهدته: الدافع «الشركة» واختر عهدته في خانة الصندوق. «على العميل» يُقيد على 1114 ويظهر سطراً في فاتورة الشحنة. «لم يُدفع بعد»: اختر المستفيد إن عُرف (وإلا يُقيد على المصروفات المستحقة 2106)، ويُسدد من{" "}
              <Link href="/payments/review?tab=expenses" className="text-brand-700 underline">
                سندات صرف تحت المراجعة
              </Link>
              . {canApprove ? "تُعتمد المصروفات فور الحفظ." : "تبقى بانتظار الاعتماد حتى يعتمدها المحاسب."}
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
            href={href({ status: t.key, open: undefined })}
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

      <DocToolbar
        base="/expenses"
        params={{ status: raw, view: sp.view, q: sp.q, period: sp.period }}
        statuses={{}}
        exportName="المصروفات"
        count={list.length}
        noun="مصروف"
        pay={false}
        sorts={{ date_desc: "الأحدث أولاً" }}
        exportable={view !== "sheet"}
        placeholder="ابحث بالرقم أو البيان أو النوع أو اللوحة أو السائق أو المبلغ"
      />
      {view === "sheet" ? (
        <DocSheet
          action={saveExpenseSheet}
          emptyText={q || status || period !== "all" ? "لا توجد مصروفات بهذه الشروط" : "لا توجد مصروفات بعد"}
          openLabel="فتح نافذة المصروف"
          addRows={canCreate ? { label: "مصروف جديد", defaults: { date: today, payer: "cash", cashAccountId: String((cashes.find((a) => a.code.startsWith("1101")) ?? cashes[0])?.id ?? "") } } : undefined}
          columns={[
            { key: "status", label: "الحالة", type: "badge", width: "7rem" },
            { key: "number", label: "الرقم", ltr: true, width: "8rem" },
            { key: "date", label: "التاريخ", type: "date", editable: true, width: "8.5rem" },
            { key: "accountId", label: "نوع المصروف", type: "select", editable: true, options: accounts, create: "account", width: "13rem" },
            { key: "description", label: "البيان", editable: true, width: "12rem" },
            { key: "driverId", label: "السائق", type: "select", editable: true, options: drivers, create: "driver", width: "9rem", autoVehicle: { key: "vehicleId", dateKey: "date" } },
            { key: "vehicleId", label: "المركبة", type: "select", editable: true, options: vehicles, create: "vehicle", width: "8rem", autoDriver: { key: "driverId", dateKey: "date" } },
            { key: "waybillId", label: "الشحنة", type: "select", editable: true, options: waybills.map((w) => ({ value: String(w.id), label: `${w.number} · ${w.date}` })), width: "11rem" },
            { key: "payer", label: "الدافع", type: "select", editable: true, options: Object.entries(EXPENSE_PAYERS).map(([value, label]) => ({ value, label })), width: "9rem" },
            { key: "cashAccountId", label: "دُفع من (الشركة)", type: "select", editable: true, options: sheetCash, create: "account", width: "11rem" },
            { key: "partyId", label: "المستفيد (لم يُدفع)", type: "select", editable: true, options: payees, create: "supplier", width: "10rem" },
            { key: "amount", label: "المبلغ قبل الضريبة", type: "number", editable: true, width: "7rem" },
            { key: "vat", label: "الضريبة", type: "number", editable: true, width: "5.5rem" },
            { key: "vendor", label: "المحل", editable: true, width: "8rem" },
            { key: "reference", label: "رقم الإيصال", ltr: true, editable: true, width: "7rem" },
          ]}
          rows={list.map(({ e }): DocSheetRow => ({
            id: e.id,
            href: href({ edit: String(e.id) }),
            editable: editable(e),
            cells: {
              number: e.number,
              date: e.expenseDate,
              accountId: String(e.accountId),
              description: e.description,
              driverId: e.driverId ? String(e.driverId) : "",
              vehicleId: e.vehicleId ? String(e.vehicleId) : "",
              waybillId: e.waybillId ? String(e.waybillId) : "",
              payer: e.payer,
              cashAccountId: e.cashAccountId ? String(e.cashAccountId) : "",
              partyId: e.partyId ? String(e.partyId) : "",
              amount: e.amount,
              vat: e.vatAmount,
              vendor: e.vendorName,
              reference: e.reference,
            },
            badges: { status: { label: EXPENSE_STATUS[e.status].label, tone: EXPENSE_STATUS[e.status].tone } },
          }))}
        />
      ) : (
      <>
      <DocCards empty="لا توجد مصروفات">
        {list.map((row) => {
          const { e, account, code, plate, driver, waybill, entry, maintenance } = row;
          const st = EXPENSE_STATUS[e.status];
          const party = e.billToCustomer ? `${account} (على العميل)` : account;
          return (
            <TapCard
              key={e.id}
              tone={st.tone}
              label={`المصروف ${e.number}`}
              face={
                <DocCardFace
                  number={e.number}
                  status={st}
                  date={fmtDate(e.expenseDate)}
                  party={party}
                  meta={
                    <>
                      {plate && <Plate>{plate}</Plate>}
                      {payerText(row) && <span>{payerText(row)}</span>}
                      {waybill && <span className="ltr-nums">{waybill}</span>}
                      {e.driverKind && <span className="text-sky-700">📱 من التطبيق</span>}
                    </>
                  }
                  amount={fmt(e.amount)}
                  next={e.status === "pending" && canApprove ? "ينتظر اعتمادك" : null}
                />
              }
              header={<DocCardFace number={e.number} status={st} party={party} />}
              details={
                <>
                  <Facts
                    items={[
                      ["التاريخ", fmtDate(e.expenseDate)],
                      ["المبلغ", <span key="a" className="ltr-nums font-semibold">{fmt(e.amount)}</span>],
                      ["الحساب", <span key="c"><span className="ltr-nums text-gray-500">{code}</span> {account}</span>],
                      ["الضريبة", Number(e.vatAmount) ? fmt(e.vatAmount) : "—"],
                      ["المركبة", plate ?? "—"],
                      ["السائق", driver ?? "—"],
                      ["الدافع", payerText(row) ?? "—"],
                      ["البيان", e.description || "—"],
                      ...(maintenance ? ([["نوع الصيانة", maintenance]] as [string, React.ReactNode][]) : []),
                      ...(entry ? ([["القيد", <span key="en" className="ltr-nums">{entry}</span>]] as [string, React.ReactNode][]) : []),
                    ]}
                  />
                  {e.rejectReason && <p className="mt-2 text-xs text-red-600">سبب الرفض: {e.rejectReason}</p>}
                  {photos.has(e.id) && (
                    <a href={`/files/${photos.get(e.id)}`} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm font-medium text-brand-700 underline">
                      📷 عرض الإيصال
                    </a>
                  )}
                </>
              }
              footer={<SheetActions>{rowActions(row)}</SheetActions>}
            />
          );
        })}
      </DocCards>
      <div className="max-md:hidden">
      <Table head={["الرقم", "التاريخ", "النوع", "البيان", "المركبة", "الدافع", "المبلغ", "الضريبة", "الحالة", "", ""]}>
        {list.length === 0 && <EmptyRow cols={11}>لا توجد مصروفات</EmptyRow>}
        {list.map(({ e, account, code, plate, driver, cash: box, waybill, entry, maintenance }) => (
          <tr key={e.id}>
            <Td className="ltr-nums font-medium whitespace-nowrap">
              <Link href={href({ open: String(e.id) })} scroll={false} className="text-brand-800 hover:underline">
                {e.number}
              </Link>
            </Td>
            <Td className="ltr-nums whitespace-nowrap">{fmtDate(e.expenseDate)}</Td>
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
              {e.billToCustomer && <div className="text-[11px] font-medium text-amber-700">على العميل (يُفوتر)</div>}
              {e.driverKind && <div className="text-[11px] text-sky-700">📱 من تطبيق السائق</div>}
            </Td>
            <Td>
              {plate ?? "—"}
              {driver && e.payer !== "driver_custody" && <div className="text-xs text-gray-500">{driver}</div>}
            </Td>
            <Td className="text-xs">
              {e.payer === "driver_custody" ? `عهدة ${driver ?? ""}` : e.payer === "unpaid" ? (e.paymentId ? "سُدد بسند صرف" : "لم يُدفع بعد") : box}
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
              <div className="flex flex-wrap gap-2">{rowActions({ e, driver, waybill })}</div>
            </Td>
            <EdgeCell tone={EXPENSE_STATUS[e.status].tone} />
          </tr>
        ))}
      </Table>
      </div>
      </>
      )}
        </>
      )}
      {openRow && !editing && (
        <DeskDrawer
          closeHref={href({ open: undefined })}
          label={`معاينة المصروف ${openRow.e.number}`}
          header={
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-display text-lg font-semibold text-brand-900">
                مصروف <span className="ltr-nums">{openRow.e.number}</span>
              </span>
              <Badge tone={EXPENSE_STATUS[openRow.e.status].tone}>{EXPENSE_STATUS[openRow.e.status].label}</Badge>
            </div>
          }
          footer={
            <>
              {editable(openRow.e) && (
                <Link href={href({ edit: String(openRow.e.id), open: undefined })} scroll={false} className={`${drawerBtn} !border-brand-600 !bg-brand-500 font-semibold !text-brand-900`}>
                  تعديل
                </Link>
              )}
              {!editable(openRow.e) && openRow.e.paymentId && <span className="text-xs text-gray-500">سُدد بسند صرف؛ أرجع السند من «سندات الصرف» لتعديله.</span>}
              <span className="flex flex-wrap gap-2">{rowActions(openRow)}</span>
            </>
          }
        >
          <Facts
            items={[
              ["التاريخ", fmtDate(openRow.e.expenseDate)],
              ["نوع المصروف", <span key="c"><span className="ltr-nums text-gray-500">{openRow.code}</span> {openRow.account}</span>],
              ["البيان", openRow.e.description || "—"],
              ["المبلغ", <span key="a" className="ltr-nums font-semibold">{fmt(openRow.e.amount)}</span>],
              ["الضريبة", Number(openRow.e.vatAmount) ? fmt(openRow.e.vatAmount) : "—"],
              ["المركبة", openRow.plate ?? "—"],
              ["السائق", openRow.driver ?? "—"],
              ["الشحنة", openRow.waybill ?? "—"],
              ["الدافع", payerText(openRow) ?? "—"],
              ["المحل", openRow.e.vendorName ?? "—"],
              ["رقم الإيصال", openRow.e.reference ?? "—"],
              ...(openRow.entry ? ([["القيد", <span key="en" className="ltr-nums">{openRow.entry}</span>]] as [string, React.ReactNode][]) : []),
            ]}
          />
          {openRow.e.billToCustomer && <p className="mt-3 text-sm font-medium text-amber-700">على العميل: يُفوتر مع الشحنة.</p>}
          {openRow.e.rejectReason && <p className="mt-3 text-sm text-red-600">سبب الرفض: {openRow.e.rejectReason}</p>}
          {photos.has(openRow.e.id) && (
            <a href={`/files/${photos.get(openRow.e.id)}`} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm font-medium text-brand-700 underline">
              📷 عرض الإيصال
            </a>
          )}
        </DeskDrawer>
      )}
      {(creating || editing) && <ExpensePanel closeHref={back ?? href({ edit: undefined, new: undefined })} canApprove={canApprove} expense={editing} />}
    </>
  );
}
