import Link from "next/link";
import { EdgeCell } from "@/components/desk-list";
import { PaymentsTabs } from "./tabs";
import { and, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { driverOptions } from "@/lib/lookups";
import { cashAccounts } from "@/lib/invoices";
import { supplierBalances, supplierOptions } from "@/lib/purchases";
import { todayRiyadh } from "@/lib/dates";
import { PAYMENT_KINDS } from "@/data/purchases";
import { PAYMENT_METHODS, RECEIPT_STATUS } from "@/data/sales";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { SheetEditor } from "@/components/sheet-editor";
import { AddModeBar, ListActions } from "@/components/list-actions";
import { Badge, Card, EmptyRow, PageHeader, Table, Td } from "@/components/ui";
import { post, remove, revert, savePaymentSheet, savePayments } from "./actions";
import { PaymentPanel } from "./payment-panel";
import { DocSheet, type DocSheetRow } from "@/components/doc-sheet";
import { DocToolbar } from "@/components/doc-toolbar";
import { DeskDrawer } from "@/components/desk-drawer";
import { periodRange, PERIODS, type Period } from "@/lib/doc-filters";
import { fmt, fmtDate } from "@/lib/format";
import { DocCards } from "@/components/doc-card";
import { DocCardFace, Facts, SheetActions, TapCard } from "@/components/list-card";
import { payFromSheetOptions } from "@/lib/lookups";

type Search = { add?: string; new?: string; edit?: string; open?: string; view?: string; q?: string; period?: string };
const drawerBtn = "inline-flex h-10 items-center gap-1.5 rounded-xl border border-gray-300 bg-white px-3 text-sm text-gray-700 shadow-sm hover:bg-gray-50";

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePermission("payments", "view");
  const sp = await searchParams;
  const canCreate = can(user.perms, "payments", "create");
  const canUpdate = can(user.perms, "payments", "update");
  const canRevert = can(user.perms, "payments", "revert");
  const canPost = can(user.perms, "payments", "approve");
  const adding = sp.add === "1" && canCreate;
  const creating = sp.new === "1" && canCreate;
  const view = sp.view === "sheet" ? "sheet" : "table";
  const q = sp.q?.trim() || undefined;
  const period: Period = sp.period && sp.period in PERIODS ? (sp.period as Period) : "all";
  const href = (patch: Partial<Search> = {}) => {
    const p = new URLSearchParams(Object.entries({ view: sp.view, q: sp.q, period: sp.period, ...patch }).filter((e): e is [string, string] => !!e[1]));
    return p.size ? `/payments?${p}` : "/payments";
  };
  const cash = alias(s.accounts, "cash");
  const where: SQL[] = [];
  if (q) {
    const like = `%${q}%`;
    where.push(or(ilike(s.payments.number, like), ilike(s.parties.nameAr, like), ilike(s.employees.nameAr, like), ilike(s.payments.reference, like), ilike(s.payments.notes, like), ilike(s.payments.amount, like))!);
  }
  const range = periodRange(period, todayRiyadh());
  if (range.from) where.push(gte(s.payments.paymentDate, range.from));
  if (range.to) where.push(lte(s.payments.paymentDate, range.to));
  const editId = canUpdate ? Number(sp.edit) || null : null;
  const editing = editId ? ((await db.select().from(s.payments).where(eq(s.payments.id, editId)))[0] ?? null) : null;
  const [suppliers, drivers, cashes, openInvoices, balances, list] = await Promise.all([
    supplierOptions(db),
    driverOptions(),
    cashAccounts(db),
    db
      .select({ id: s.purchaseInvoices.id, number: s.purchaseInvoices.number, no: s.purchaseInvoices.supplierInvoiceNo, supplier: s.parties.nameAr, total: s.purchaseInvoices.total, paid: s.purchaseInvoices.paidAmount })
      .from(s.purchaseInvoices)
      .innerJoin(s.parties, eq(s.parties.id, s.purchaseInvoices.supplierId))
      .where(and(eq(s.purchaseInvoices.status, "posted"), sql`${s.purchaseInvoices.paidAmount} < ${s.purchaseInvoices.total}`))
      .orderBy(s.purchaseInvoices.dueDate),
    supplierBalances(db),
    db
      .select({
        p: s.payments,
        party: s.parties.nameAr,
        driver: s.employees.nameAr,
        cash: cash.nameAr,
        entry: s.journalEntries.number,
        invoices: sql<string | null>`(select string_agg(i.number, '، ') from payment_allocations a join purchase_invoices i on i.id = a.invoice_id where a.payment_id = ${s.payments.id})`,
      })
      .from(s.payments)
      .innerJoin(cash, eq(cash.id, s.payments.cashAccountId))
      .leftJoin(s.parties, eq(s.parties.id, s.payments.partyId))
      .leftJoin(s.drivers, eq(s.drivers.id, s.payments.driverId))
      .leftJoin(s.employees, eq(s.employees.id, s.drivers.employeeId))
      .leftJoin(s.journalEntries, eq(s.journalEntries.id, s.payments.journalEntryId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(s.payments.paymentDate), desc(s.payments.id))
      .limit(300),
  ]);

  type P = (typeof list)[number]["p"];
  /** يُعدَّل السند ما لم يكن سداداً مبكراً لجدول أقساط (يُلغى من صفحة الأقساط)؛ المرحّل يحتاج صلاحية الإرجاع لأن قيده يُعاد. */
  const editable = (p: P) => canUpdate && (p.status !== "posted" || canRevert);
  const singleInvoice = new Map(
    (
      await db
        .select({ paymentId: s.paymentAllocations.paymentId, invoiceId: sql<number>`min(${s.paymentAllocations.invoiceId})`, n: sql<number>`count(*)::int` })
        .from(s.paymentAllocations)
        .groupBy(s.paymentAllocations.paymentId)
    )
      .filter((a) => a.n === 1)
      .map((a) => [a.paymentId, a.invoiceId]),
  );
  // فاتورة السند المسددة بالكامل تبقى في قائمة الشيت حتى لا يظهر رقمها الداخلي
  const missingInv = [...new Set(singleInvoice.values())].filter((id) => !openInvoices.some((i) => i.id === id));
  if (missingInv.length)
    openInvoices.push(
      ...(await db
        .select({ id: s.purchaseInvoices.id, number: s.purchaseInvoices.number, no: s.purchaseInvoices.supplierInvoiceNo, supplier: s.parties.nameAr, total: s.purchaseInvoices.total, paid: s.purchaseInvoices.paidAmount })
        .from(s.purchaseInvoices)
        .innerJoin(s.parties, eq(s.parties.id, s.purchaseInvoices.supplierId))
        .where(inArray(s.purchaseInvoices.id, missingInv))),
    );
  const openRow = Number(sp.open) ? list.find((r) => r.p.id === Number(sp.open)) : undefined;
  const sheetCash = await payFromSheetOptions(cashes);
  const rowActions = (p: P) => (
    <>
                {editable(p) && (
                  <Link href={href({ edit: String(p.id), open: undefined })} scroll={false} className="inline-flex items-center rounded-lg border border-brand-600 bg-brand-50 px-3 py-1.5 text-sm font-semibold text-brand-900 hover:bg-brand-100">
                    تعديل
                  </Link>
                )}
                {p.status === "draft" && can(user.perms, "payments", "approve") && (
                  <ActionForm action={post.bind(null, p.id)} resetOnSuccess={false}>
                    <SubmitButton variant="secondary">ترحيل</SubmitButton>
                  </ActionForm>
                )}
                {p.status === "posted" && can(user.perms, "payments", "revert") && (
                  <ActionForm action={revert.bind(null, p.id)} resetOnSuccess={false}>
                    <SubmitButton variant="secondary">إرجاع</SubmitButton>
                  </ActionForm>
                )}
                {p.status === "draft" && can(user.perms, "payments", "delete") && (
                  <ActionForm action={remove.bind(null, p.id)} resetOnSuccess={false}>
                    <SubmitButton variant="secondary">حذف</SubmitButton>
                  </ActionForm>
                )}
    </>
  );
  const next = (p: (typeof list)[number]["p"]) => (p.status === "draft" ? "رحّله" : null);

  return (
    <>
      <PageHeader title="سندات الصرف" description="سداد الموردين والورش والناقلين والمحطات، وصرف العهد للسائقين، من الصندوق أو البنك.">
        {!adding && <ListActions newHref={canCreate && href({ new: "1" })} newLabel="سند صرف" addHref={canCreate && "/payments?add=1"} addLabel="إدخال سندات صرف جماعي (شيت)" />}
      </PageHeader>
      {!adding && <PaymentsTabs active="payments" />}
      {adding && <AddModeBar backHref="/payments" backLabel="سندات الصرف" title="إدخال سندات صرف" />}
      <div className="mb-6 grid gap-6 xl:grid-cols-3">
        {adding && (
          <Card className="xl:col-span-3">
            {cashes.length === 0 ? (
              <p className="text-sm text-gray-500">أضف حساب صندوق أو بنك تفصيلياً تحت 1101 أو 1102 أولاً.</p>
            ) : (
              <>
                <SheetEditor
                  templateName="سندات الصرف"
                  action={savePayments}
                  initialRows={3}
                  columns={[
                    { key: "date", label: "التاريخ", type: "date", placeholder: todayRiyadh() },
                    { key: "partyId", label: "المورد / الناقل", type: "select", options: suppliers, width: "11rem", create: "supplier" },
                    { key: "driverId", label: "أو عهدة سائق", type: "select", options: drivers, width: "9rem" },
                    { key: "amount", label: "المبلغ", type: "number", required: true, width: "7rem" },
                    { key: "currency", label: "العملة", type: "select", options: [{ value: "SAR", label: "SAR" }, { value: "KWD", label: "KWD" }], width: "5rem", placeholder: "SAR" },
                    { key: "rate", label: "سعر الصرف", type: "number", width: "6rem", placeholder: "تلقائي" },
                    { key: "method", label: "الطريقة", type: "select", required: true, options: Object.entries(PAYMENT_METHODS).map(([value, label]) => ({ value, label })), width: "6rem" },
                    { key: "cashAccountId", label: "من الصندوق / البنك", type: "select", required: true, options: sheetCash, width: "13rem", create: "account" },
                    { key: "invoiceId", label: "على الفاتورة", type: "select", options: openInvoices.map((i) => ({ value: String(i.id), label: `${i.number} · ${i.supplier} · متبقي ${fmt(Number(i.total) - Number(i.paid))}` })), width: "13rem" },
                    { key: "reference", label: "المرجع / الشيك", ltr: true, width: "8rem" },
                    { key: "notes", label: "ملاحظات", width: "9rem" },
                  ]}
                />
                <p className="mt-2 text-xs text-gray-500">
                  {can(user.perms, "payments", "approve") ? "تُرحَّل السندات فور الحفظ." : "تُحفظ مسودة حتى يرحّلها المحاسب."} السداد يُخصص على الفاتورة المختارة أو على الأقدم استحقاقاً، والباقي يسدد أرصدة الجهة من الشحنات.
                </p>
              </>
            )}
          </Card>
        )}
        {!adding && (
        <Card title="المستحق للجهات الدائنة" className="xl:col-span-3">
          {balances.length === 0 ? (
            <p className="text-sm text-gray-500">لا أرصدة مستحقة.</p>
          ) : (
            <ul className="grid gap-x-8 text-sm sm:grid-cols-2 xl:grid-cols-4">
              {balances.map((b) => (
                <li key={b.id} className="flex items-center justify-between border-b border-gray-100 py-2">
                  <span>{b.name}</span>
                  <span className={`ltr-nums font-semibold ${b.balance < 0 ? "text-emerald-700" : "text-brand-900"}`}>{fmt(b.balance)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-gray-500">من القيود المرحّلة: فواتير الموردين، وتكاليف الناقلين والديزل الآجل من الشحنات، ومخصوماً منها السداد. السالب دفعة مقدمة.</p>
        </Card>
        )}
      </div>

      {!adding && (
        <DocToolbar
          base="/payments"
          params={{ view: sp.view, q: sp.q, period: sp.period }}
          statuses={{}}
          exportName="سندات الصرف"
          count={list.length}
          noun="سند"
          pay={false}
          sorts={{ date_desc: "الأحدث أولاً" }}
          exportable={view !== "sheet"}
          placeholder="ابحث بالرقم أو الجهة أو السائق أو المرجع أو المبلغ"
        />
      )}
      {!adding && view === "sheet" && (
        <DocSheet
          action={savePaymentSheet}
          emptyText={q || period !== "all" ? "لا توجد سندات بهذه الشروط" : "لا توجد سندات صرف بعد"}
          openLabel="فتح نافذة السند"
          addRows={canCreate ? { label: "سند صرف جديد", defaults: { date: todayRiyadh(), method: "transfer", currency: "SAR", cashAccountId: String((cashes.find((a) => a.code.startsWith("1101")) ?? cashes[0])?.id ?? "") } } : undefined}
          columns={[
            { key: "status", label: "الحالة", type: "badge", width: "6rem" },
            { key: "number", label: "الرقم", ltr: true, width: "8rem" },
            { key: "kind", label: "النوع", width: "8rem" },
            { key: "date", label: "التاريخ", type: "date", editable: true, width: "8.5rem" },
            { key: "partyId", label: "المورد / الناقل", type: "select", editable: true, options: suppliers, create: "supplier", width: "11rem" },
            { key: "driverId", label: "أو عهدة سائق", type: "select", editable: true, options: drivers, width: "9rem" },
            { key: "amount", label: "المبلغ", type: "number", editable: true, width: "7rem" },
            { key: "currency", label: "العملة", type: "select", editable: true, options: [{ value: "SAR", label: "SAR" }, { value: "KWD", label: "KWD" }], width: "5rem" },
            { key: "method", label: "الطريقة", type: "select", editable: true, options: Object.entries(PAYMENT_METHODS).map(([value, label]) => ({ value, label })), width: "6rem" },
            { key: "cashAccountId", label: "يُسدد من", type: "select", editable: true, options: sheetCash, create: "account", width: "13rem" },
            { key: "invoiceId", label: "على الفاتورة", type: "select", editable: true, options: openInvoices.map((i) => ({ value: String(i.id), label: `${i.number} · ${i.supplier} · متبقي ${fmt(Number(i.total) - Number(i.paid))}` })), width: "13rem" },
            { key: "reference", label: "المرجع / الشيك", ltr: true, editable: true, width: "8rem" },
            { key: "notes", label: "ملاحظات", editable: true, width: "10rem" },
          ]}
          rows={list.map(({ p, invoices }): DocSheetRow => ({
            id: p.id,
            href: href({ edit: String(p.id) }),
            editable: editable(p),
            cells: {
              number: p.number,
              kind: PAYMENT_KINDS[p.kind],
              date: p.paymentDate,
              partyId: p.kind === "supplier" && p.partyId ? String(p.partyId) : "",
              driverId: p.driverId ? String(p.driverId) : "",
              amount: p.amount,
              currency: p.currencyCode,
              method: p.method,
              cashAccountId: String(p.cashAccountId),
              invoiceId: singleInvoice.has(p.id) ? String(singleInvoice.get(p.id)) : "",
              reference: p.reference,
              notes: p.notes ?? (invoices && !singleInvoice.has(p.id) ? `على ${invoices}` : null),
            },
            badges: { status: { label: RECEIPT_STATUS[p.status].label, tone: RECEIPT_STATUS[p.status].tone } },
          }))}
        />
      )}
      {!adding && view === "table" && (
      <DocCards empty="لا توجد سندات صرف بعد">
        {list.map(({ p, party, driver, cash: box, entry, invoices }) => {
          const st = RECEIPT_STATUS[p.status];
          const face = (
            <DocCardFace
              number={p.number}
              status={st}
              date={fmtDate(p.paymentDate)}
              party={party ?? driver ?? "—"}
              meta={
                <>
                  <span>{PAYMENT_KINDS[p.kind]}</span>
                  {box && <span>من: {box}</span>}
                </>
              }
              amount={fmt(p.amount)}
              currency={p.currencyCode}
              next={next(p)}
            />
          );
          return (
            <TapCard
              key={p.id}
              tone={st.tone}
              label={`سند الصرف ${p.number}`}
              face={face}
              header={<DocCardFace number={p.number} status={st} party={party ?? driver ?? "—"} />}
              details={
                <Facts
                  items={[
                    ["التاريخ", fmtDate(p.paymentDate)],
                    ["المبلغ", <span key="a" className="ltr-nums font-semibold">{fmt(p.amount)} {p.currencyCode}</span>],
                    ["النوع", PAYMENT_KINDS[p.kind]],
                    ["الطريقة", PAYMENT_METHODS[p.method]],
                    ["من", box ?? "—"],
                    ["المخصص على", invoices || (p.kind === "supplier" ? "رصيد الجهة" : "—")],
                    ...(entry ? ([["القيد", <span key="e" className="ltr-nums">{entry}</span>]] as [string, React.ReactNode][]) : []),
                  ]}
                />
              }
              footer={<SheetActions>{rowActions(p)}</SheetActions>}
            />
          );
        })}
      </DocCards>
      )}
      {!adding && view === "table" && (
      <div className="max-md:hidden">
      <Table head={["الرقم", "التاريخ", "النوع", "إلى", "المبلغ", "الطريقة", "من", "المخصص على", "الحالة", "", ""]}>
        {list.length === 0 && <EmptyRow cols={11}>لا توجد سندات صرف بعد</EmptyRow>}
        {list.map(({ p, party, driver, cash: box, entry, invoices }) => (
          <tr key={p.id}>
            <Td className="ltr-nums font-medium whitespace-nowrap">
              <Link href={href({ open: String(p.id) })} scroll={false} className="text-brand-800 hover:underline">
                {p.number}
              </Link>
            </Td>
            <Td className="ltr-nums whitespace-nowrap">{fmtDate(p.paymentDate)}</Td>
            <Td className="text-xs">{PAYMENT_KINDS[p.kind]}</Td>
            <Td>{party ?? driver}</Td>
            <Td className="ltr-nums font-semibold">
              {fmt(p.amount)} <span className="text-xs font-normal text-gray-400">{p.currencyCode}</span>
            </Td>
            <Td>{PAYMENT_METHODS[p.method]}</Td>
            <Td className="text-xs">{box}</Td>
            <Td className="text-xs">
              {invoices ? (
                invoices
              ) : p.kind === "supplier" ? (
                <Link href="/purchases" className="text-gray-400">
                  رصيد الجهة
                </Link>
              ) : (
                "—"
              )}
            </Td>
            <Td>
              <Badge tone={RECEIPT_STATUS[p.status].tone}>{RECEIPT_STATUS[p.status].label}</Badge>
              {entry && <div className="ltr-nums mt-1 text-[11px] text-gray-400">{entry}</div>}
            </Td>
            <Td>
              <div className="flex gap-2">{rowActions(p)}</div>
            </Td>
            <EdgeCell tone={RECEIPT_STATUS[p.status].tone} />
          </tr>
        ))}
      </Table>
      </div>
      )}
      {openRow && !editing && (
        <DeskDrawer
          closeHref={href({ open: undefined })}
          label={`معاينة سند الصرف ${openRow.p.number}`}
          header={
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-display text-lg font-semibold text-brand-900">
                سند صرف <span className="ltr-nums">{openRow.p.number}</span>
              </span>
              <Badge tone={RECEIPT_STATUS[openRow.p.status].tone}>{RECEIPT_STATUS[openRow.p.status].label}</Badge>
            </div>
          }
          footer={
            <>
              {editable(openRow.p) && (
                <Link href={href({ edit: String(openRow.p.id), open: undefined })} scroll={false} className={`${drawerBtn} !border-brand-600 !bg-brand-500 font-semibold !text-brand-900`}>
                  تعديل
                </Link>
              )}
              <span className="flex flex-wrap gap-2">{rowActions(openRow.p)}</span>
            </>
          }
        >
          <Facts
            items={[
              ["التاريخ", fmtDate(openRow.p.paymentDate)],
              ["النوع", PAYMENT_KINDS[openRow.p.kind]],
              ["إلى", openRow.party ?? openRow.driver ?? "—"],
              ["المبلغ", <span key="a" className="ltr-nums font-semibold">{fmt(openRow.p.amount)} {openRow.p.currencyCode}</span>],
              ["الطريقة", PAYMENT_METHODS[openRow.p.method]],
              ["من", openRow.cash ?? "—"],
              ["المخصص على", openRow.invoices || (openRow.p.kind === "supplier" ? "رصيد الجهة" : "—")],
              ["المرجع", openRow.p.reference ?? "—"],
              ["ملاحظات", openRow.p.notes ?? "—"],
              ...(openRow.entry ? ([["القيد", <span key="e" className="ltr-nums">{openRow.entry}</span>]] as [string, React.ReactNode][]) : []),
            ]}
          />
        </DeskDrawer>
      )}
      {(creating || editing) && <PaymentPanel closeHref={href({ new: undefined, edit: undefined })} canPost={canPost} payment={editing} />}
    </>
  );
}
