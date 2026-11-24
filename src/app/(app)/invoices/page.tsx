import { SendDocument } from "@/components/send-document";
import Link from "next/link";
import { and, asc, eq, inArray, like, or } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { supplierOptions, toTripExpense, tripExpensesForBilling } from "@/lib/purchases";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { fundingAccounts, currentTrip, invoicingQueue, listSalesInvoices, salesInvoiceDoc, summarizeSalesInvoices } from "@/lib/invoices";
import { PAGE_SIZE, pageOf } from "@/lib/paging";
import { accountOptions, chargeTypeOptions, driverOptions, partyOptions, routeOptions, shipperSuggestions, vehicleOptions } from "@/lib/lookups";
import { customListOptions } from "@/lib/custom-lists";
import { joinCustom } from "@/data/custom-lists";
import { getCompany, getInvoiceTemplate, invoiceReadiness } from "@/lib/company";
import { invoiceQrSvg } from "@/lib/zatca-qr";
import { clearedQr, getSettings, latestDocument, sendBlocker } from "@/lib/zatca/service";
import { ZatcaPanel } from "@/components/zatca-panel";
import { listHref, parseDocFilter, type DocListParams, type PayFilter } from "@/lib/doc-filters";
import { todayRiyadh } from "@/lib/dates";
import { INVOICE_STATUS, ZATCA_STATUS, paymentState } from "@/data/sales";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { DocSheet, type DocSheetRow } from "@/components/doc-sheet";
import { BulkPdfButton } from "@/components/bulk-pdf";
import { DocToolbar } from "@/components/doc-toolbar";
import { Icon } from "@/components/icons";
import { RowCheck, SelectAll, SelectionGate, SelectionTotal } from "@/components/row-selection";
import { GroupToggle } from "@/components/merged-group";
import { listWaybills } from "@/lib/waybills";
import { WAYBILL_STATUS } from "@/data/waybills";
import { Plate } from "@/components/doc-card";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { ClickRow } from "@/components/click-row";
import { CashAccountField } from "@/components/cash-account-field";
import { DriverSentTag } from "@/components/driver-sent";
import { InvoiceEditor, type InvoiceDraft } from "./invoice-editor";
import { NO_TRIP } from "./trip-draft";
import { invoiceActions } from "./invoice-menu";
import { TaxInvoiceDocument } from "@/components/tax-invoice";
import { Badge, Card, EmptyRow, Input, Pager, PageHeader, Table, Td } from "@/components/ui";
import { AddModeBar, ListActions } from "@/components/list-actions";
import { SheetEditor } from "@/components/sheet-editor";
import { bulkInvoiceOps, invoiceAll, invoiceCustomer, issue, saveInvoicePanel, saveInvoiceRows, saveInvoiceSheet, sendToZatca } from "./actions";
import { ActionsMenu, type MenuItem } from "@/components/actions-menu";
import { DocCard, DocCards, DocGroupCard, SheetFacts, SheetMoney, sheetBtn, sheetPrimary } from "@/components/doc-card";
import { MobileSheet } from "@/components/mobile-sheet";
import { BulkBar, EdgeCell, NextStepCell, NumDateCell, PaidBar, RouteLine, StatusCell, StatusTabs, Sub } from "@/components/desk-list";
import { DeskDrawer } from "@/components/desk-drawer";
import { fmt, fmtDate } from "@/lib/format";
import { toAccountOptions } from "@/lib/lookups";
import { taxCodesFor } from "@/lib/tax-codes";

const BASE = "/invoices";
const BULK_FORM = "invoice-bulk";
const withParam = (url: string, key: string, value: string) => `${url}${url.includes("?") ? "&" : "?"}${key}=${value}`;
const plusDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const STATUSES = { draft: INVOICE_STATUS.draft.label, issued: INVOICE_STATUS.issued.label };
const drawerBtn = "inline-flex h-10 items-center gap-1.5 rounded-xl border border-gray-300 bg-white px-3 text-sm text-gray-700 shadow-sm hover:bg-gray-50";
const INV_TABS: { key: string; label: string; status?: string; pay?: PayFilter; attn?: boolean }[] = [
  { key: "", label: "الكل" },
  { key: "draft", label: "مسودة", status: "draft", attn: true },
  { key: "unpaid", label: "غير مسددة", pay: "unpaid" },
  { key: "partial", label: "مسددة جزئياً", pay: "partial" },
  { key: "overdue", label: "متأخرة", pay: "overdue", attn: true },
  { key: "paid", label: "مسددة", pay: "paid" },
];

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<DocListParams & { new?: string; edit?: string; add?: string }> }) {
  const user = await requirePermission("sales_invoices", "view");
  const sp = await searchParams;
  const canCreate = can(user.perms, "sales_invoices", "create");
  const canIssue = can(user.perms, "sales_invoices", "approve");
  const canUpdate = can(user.perms, "sales_invoices", "update");
  const canRevert = can(user.perms, "sales_invoices", "revert");
  const canDelete = can(user.perms, "sales_invoices", "delete");
  const lp: DocListParams = { q: sp.q, status: sp.status, period: sp.period, sort: sp.sort, view: sp.view, pay: sp.pay, page: sp.page };
  const { page, offset } = pageOf(sp.page);
  const canReceive = can(user.perms, "receipts", "create");
  const today = todayRiyadh();
  const filter = parseDocFilter(sp, Object.keys(STATUSES), today);
  const view = sp.view === "sheet" ? "sheet" : "table";
  const openId = view === "table" ? Number(sp.open) || null : null;
  const [queue, invoices, summary, openDoc, company, template] = await Promise.all([
    canCreate ? invoicingQueue(db) : Promise.resolve([]),
    listSalesInvoices(db, filter, PAGE_SIZE, offset),
    summarizeSalesInvoices(db, filter),
    openId ? salesInvoiceDoc(db, openId) : Promise.resolve(null),
    getCompany(db),
    getInvoiceTemplate(db),
  ]);
  // أزرار الحالات بعددها (بنفس البحث والفترة)؛ الأصفر لما ينتظر إجراءً: مسودة تُصدر، ومتأخرة تُحصّل
  // الفاتورة التي فيها أكثر من شحنة: سهم يفتح شحناتها تحتها (قرار أحمد 2026-11-24)
  const mergedIds = view === "table" ? invoices.filter((x) => x.waybills > 1).map((x) => x.i.id) : [];
  const kidRows = mergedIds.length ? (await listWaybills(db, { invoiceIds: mergedIds, sort: "date_asc" }, 2000)).rows : [];
  const kidsOf = (id: number) => kidRows.filter((r) => r.invoiceId === id);
  const tabCounts = await Promise.all(INV_TABS.map((t) => summarizeSalesInvoices(db, { ...filter, status: t.status, pay: t.pay }).then((r) => r.n)));
  const [zatca, zatcaDoc, blocker] = openDoc ? await Promise.all([getSettings(db), latestDocument(db, { invoiceId: openDoc.i.id }), sendBlocker(db, { invoiceId: openDoc.i.id })]) : [null, null, null];
  const qrSvg = openDoc ? await invoiceQrSvg(company, openDoc.i, await clearedQr(db, openDoc.i.id)) : null;
  const listUrl = (patch: Partial<Record<keyof DocListParams, string | undefined>> = {}) => listHref(BASE, lp, patch);
  const canSend = can(user.perms, "waybills", "update");
  const cashOpts = canSend ? await fundingAccounts(db) : [];
  const invoiceMenu = (d: NonNullable<typeof openDoc>): MenuItem[] => {
    const back = listUrl();
    return invoiceActions(d.i, d.lines, back, { canUpdate, canRevert, canDelete, canSend, trips: d.trips, cashField: <CashAccountField options={cashOpts} />, editHref: withParam(listUrl({ open: String(d.i.id) }), "edit", String(d.i.id)) });
  };

  // نافذة الإنشاء والتعديل
  const editId = canUpdate ? Number(sp.edit) || null : null;
  const creating = canCreate && sp.new === "1";
  // إدخال عدة فواتير مباشرة بنقلها من شيت واحد (مثل «إدخال عدة شحنات»)
  const bulkAdding = canCreate && sp.add === "1";
  const editDoc = editId ? await salesInvoiceDoc(db, editId) : null;
  const editing = !!editDoc && editDoc.i.status === "draft";
  const [customers, revenue, centers, currencies] =
    creating || editing || bulkAdding
      ? await Promise.all([
          db
            .selectDistinct({ id: s.parties.id, nameAr: s.parties.nameAr, vat: s.parties.vatNumber })
            .from(s.parties)
            .innerJoin(s.partyRoles, eq(s.partyRoles.partyId, s.parties.id))
            .where(eq(s.partyRoles.role, "customer"))
            .orderBy(asc(s.parties.nameAr)),
          db
            .select({ id: s.accounts.id, code: s.accounts.code, nameAr: s.accounts.nameAr })
            .from(s.accounts)
            .where(and(eq(s.accounts.isPostable, true), eq(s.accounts.isActive, true), like(s.accounts.code, "4%")))
            .orderBy(asc(s.accounts.code)),
          db.select({ id: s.costCenters.id, code: s.costCenters.code, nameAr: s.costCenters.nameAr }).from(s.costCenters).where(eq(s.costCenters.isActive, true)).orderBy(asc(s.costCenters.code)),
          db.select({ code: s.currencies.code }).from(s.currencies).orderBy(asc(s.currencies.code)),
        ])
      : [[], [], [], []];
  const [tripRoutes, tripVehicles, tripDrivers, editTrip, tripTrailers, tripCarriers, tripShippers, componentKinds] =
    creating || editing || bulkAdding
      ? await Promise.all([
          routeOptions(),
          vehicleOptions("head"),
          driverOptions(),
          editing && editId ? currentTrip(db, editId) : Promise.resolve(null),
          vehicleOptions("trailer"),
          partyOptions("carrier"),
          shipperSuggestions(),
          customListOptions(db, "price_component"),
        ])
      : [[], [], [], null, [], [], [] as string[], []];
  const taxRows = creating || editing || bulkAdding ? await taxCodesFor(db, "sales") : [];
  // مصاريف على العميل: في أي فاتورة جديدة أو مسودة؛ لشحنة فيها، أو على الفاتورة نفسها إن كانت مباشرة
  const invoiceWaybillIds = editing && editDoc ? [...new Set(editDoc.lines.filter((l) => l.kind === "waybill" && l.waybillId).map((l) => l.waybillId!))] : [];
  // مصاريف الفاتورة نفسها وإيصالات رحلتها لا تثبّت العميل (ليست شحنات)
  const ownCharges = new Set(
    editing && editId
      ? (
          await db
            .select({ id: s.waybillExpenses.id })
            .from(s.waybillExpenses)
            .where(or(eq(s.waybillExpenses.invoiceId, editId), editTrip ? eq(s.waybillExpenses.waybillId, editTrip.id) : undefined))
        ).map((r) => r.id)
      : [],
  );
  const [chargeTypes, chargeBrokers, chargeCash, chargeWaybills, tripExpenses, chargePayees] = creating || editing || bulkAdding
    ? await Promise.all([
        chargeTypeOptions(),
        partyOptions("customs_broker"),
        accountOptions(["1", "2"]).then((o) => o.filter((x) => x.code !== "1114")),
        invoiceWaybillIds.length ? db
          .select({ id: s.waybills.id, number: s.waybills.number, execution: s.waybills.execution })
          .from(s.waybills)
          .where(inArray(s.waybills.id, invoiceWaybillIds))
          .orderBy(asc(s.waybills.number))
          .then((r) => r.map((w) => ({ value: String(w.id), label: `الشحنة ${w.number}`, fleet: w.execution === "fleet" }))) : Promise.resolve([]),
        tripExpensesForBilling(db, [...invoiceWaybillIds, ...(editTrip ? [editTrip.id] : [])]).then((r) => r.map(toTripExpense)),
        supplierOptions(db),
      ])
    : [[], [], [], [], [], []];
  const taxOpts = taxRows.map((x) => ({ value: String(x.id), label: `${x.nameAr} (${Number(x.rate)}%)`, rate: Number(x.rate), code: x.code }));
  const taxName = (id: number | null) => taxRows.find((x) => x.id === id)?.nameAr ?? null;
  // البند الإضافي يبدأ بضريبة أول شحنة في الفاتورة وحسابها ومركبتها
  const firstWaybill = editing ? editDoc?.lines.find((l) => l.kind === "waybill") : undefined;
  const vatOut = taxRows.find((x) => x.code === "VAT15-OUT");
  const lineDefaults = {
    taxCodeId: String(firstWaybill?.taxCodeId ?? vatOut?.id ?? ""),
    accountId: firstWaybill ? String(firstWaybill.accountId) : "",
    costCenterId: firstWaybill?.costCenterId ? String(firstWaybill.costCenterId) : "",
  };
  const terms = creating || editing ? await db.select({ customerId: s.contracts.customerId, days: s.contracts.paymentTermsDays }).from(s.contracts) : [];
  const editorInitial = (): InvoiceDraft | null => {
    if (editing && editDoc) {
      const i = editDoc.i;
      return {
        id: i.id,
        number: i.number,
        customerId: String(i.customerId),
        invoiceDate: i.invoiceDate,
        dueDate: i.dueDate,
        currencyCode: i.currencyCode,
        reference: i.reference ?? "",
        notes: i.notes ?? "",
        lines: editDoc.lines
          .filter((l) => l.kind === "manual" && !l.trip)
          .map((l) => ({
            description: l.description,
            quantity: String(Number(l.quantity ?? 1)),
            price: String(Number(l.unitPrice ?? l.amount)),
            discount: l.discountPercent ? String(Number(l.discountPercent)) : "",
            taxCodeId: String(l.taxCodeId ?? (Number(l.vatRate) > 0 ? (vatOut?.id ?? "") : (taxRows.find((x) => x.code === "ZERO")?.id ?? ""))),
            accountId: String(l.accountId),
            costCenterId: l.costCenterId ? String(l.costCenterId) : "",
          })),
        fixedLines: editDoc.lines
          .filter((l) => l.kind !== "manual")
          .map((l) => ({
            id: l.id,
            kind: l.kind === "waybill" ? ("waybill" as const) : ("expense" as const),
            own: l.waybillExpenseId != null && ownCharges.has(l.waybillExpenseId),
            description: l.description,
            amount: String(Number(l.amount)),
            vatAmount: l.vatAmount,
            vatRate: l.vatRate,
            details: l.details,
            cost: l.costAmount,
            taxName: taxName(l.taxCodeId),
          })),
        trip: editTrip
          ? {
              ...NO_TRIP,
              on: true,
              priced: editTrip.priced ?? false,
              routeId: String(editTrip.routeId),
              execution: editTrip.carrierId ? "carrier" : "fleet",
              vehicleId: editTrip.vehicleId ? String(editTrip.vehicleId) : "",
              trailerId: editTrip.trailerId ? String(editTrip.trailerId) : "",
              driverId: editTrip.driverId ? String(editTrip.driverId) : "",
              commission: editTrip.priced && !editTrip.carrierId ? String(editTrip.driverCommission ?? "") : "",
              custody: editTrip.tripCustody ? String(editTrip.tripCustody) : "",
              carrierId: editTrip.carrierId ? String(editTrip.carrierId) : "",
              carrierCost: editTrip.carrierCost != null ? String(editTrip.carrierCost) : "",
              carrierPlate: editTrip.carrierPlate ?? "",
              carrierDriverName: editTrip.carrierDriverName ?? "",
              shipper: editTrip.shipper,
              consignee: editTrip.consignee,
              amount: editTrip.amount != null ? String(editTrip.amount) : "",
              components: (editTrip.priceComponents ?? []).map((c) => ({ kind: joinCustom(c.kind, c.classId ?? null), label: c.label ?? "", quantity: String(c.quantity ?? 1), unitPrice: String(c.unitPrice) })),
              taxCodeId: editTrip.priced && editTrip.taxCodeId ? String(editTrip.taxCodeId) : "",
              weight: editTrip.weightTons != null ? String(editTrip.weightTons) : "",
              container: editTrip.containerNumber ?? "",
              deliveryNote: editTrip.deliveryNoteNumber ?? "",
              customs: editTrip.customsDeclaration ?? "",
              priceNote: editTrip.priced ? editTrip.priceNote : null,
              number: editTrip.number,
              sent: !!editTrip.sentToDriverAt,
            }
          : { ...NO_TRIP },
      };
    }
    if (creating) return { customerId: "", invoiceDate: today, dueDate: plusDays(today, 30), currencyCode: "SAR", reference: "", notes: "", lines: [], fixedLines: [], trip: { ...NO_TRIP } };
    return null;
  };
  const initial = editorInitial();
  const editorBack = listUrl(openId ? { open: String(openId) } : {});
  const returnTo = listUrl({ open: "{id}", page: creating ? undefined : lp.page }).replace("%7Bid%7D", "{id}");
  const domestic = revenue.find((a) => a.code === "4101");

  const state = (i: (typeof invoices)[number]["i"]) => {
    const total = Number(i.total);
    const paid = Number(i.paidAmount);
    const overdue = i.status === "issued" && paid < total && i.dueDate < today;
    const pay = paymentState(total, paid);
    return { total, paid, overdue, pay: i.status === "issued" ? (overdue ? { label: "متأخرة", tone: "red" as const } : pay) : null };
  };

  // الجوال: بطاقة لكل فاتورة بنفس شكل بطاقة الشحنة (قرار أحمد 2026-11-22)
  const mobileList = (
    <div className="md:hidden">
      <DocCards empty={filter.q || filter.status || filter.pay || filter.from ? "لا توجد فواتير بهذه الشروط" : "لا توجد فواتير بعد"}>
        {invoices.map(({ i, customer, waybills }) => {
          const st = state(i);
          const due = st.total - st.paid;
          const kids = kidsOf(i.id);
          if (kids.length > 1)
            return (
              <DocGroupCard
                key={i.id}
                number={i.number}
                href={listUrl({ open: String(i.id) })}
                status={{ label: INVOICE_STATUS[i.status].label, tone: INVOICE_STATUS[i.status].tone }}
                extraBadge={st.pay}
                date={i.invoiceDate}
                count={kids.length}
                party={customer}
                meta={
                  <span className={st.overdue ? "font-semibold text-st-bad-fg" : ""}>
                    الاستحقاق <span className="ltr-nums">{fmtDate(i.dueDate)}</span>
                  </span>
                }
                amount={fmt(st.total)}
                currency={i.currencyCode}
                next={i.status === "draft" ? (canIssue ? "أصدرها" : null) : due > 0.005 ? `باقي ${fmt(due)}` : null}
                kids={kids.map((r) => ({
                  key: r.w.id,
                  href: `/waybills?open=${r.w.id}`,
                  number: r.w.number,
                  line: `${r.route} · ${r.plate ?? r.carrier ?? "—"} · ${fmtDate(r.w.waybillDate)}`,
                  amount: fmt(r.w.amount),
                }))}
              />
            );
          return (
            <DocCard
              key={i.id}
              href={listUrl({ open: String(i.id) })}
              number={i.number}
              status={{ label: INVOICE_STATUS[i.status].label, tone: INVOICE_STATUS[i.status].tone }}
              extraBadge={st.pay}
              date={i.invoiceDate}
              party={customer}
              meta={
                <>
                  {waybills > 0 && <span>{waybills === 1 ? "شحنة واحدة" : `${waybills} شحنات`}</span>}
                  <span className={st.overdue ? "font-semibold text-st-bad-fg" : ""}>
                    الاستحقاق <span className="ltr-nums">{fmtDate(i.dueDate)}</span>
                  </span>
                </>
              }
              amount={fmt(st.total)}
              currency={i.currencyCode}
              next={i.status === "draft" ? (canIssue ? "أصدرها" : null) : due > 0.005 ? `باقي ${fmt(due)}` : null}
              active={i.id === openId}
            />
          );
        })}
      </DocCards>
      <Pager page={page} size={PAGE_SIZE} total={summary.n} hrefFor={(p) => listUrl({ page: p > 1 ? String(p) : undefined, open: undefined })} />
    </div>
  );
  const openState = openDoc ? state(openDoc.i) : null;
  const mobileSheet = openDoc && openState && (
    <MobileSheet
      closeHref={listHref(BASE, sp, { open: undefined })}
      label={`معاينة الفاتورة ${openDoc.i.number}`}
      header={
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="ltr-nums font-display text-[17px] font-semibold text-brand-900">{openDoc.i.number}</span>
            <Badge tone={INVOICE_STATUS[openDoc.i.status].tone}>{INVOICE_STATUS[openDoc.i.status].label}</Badge>
            {openState.pay && <Badge tone={openState.pay.tone}>{openState.pay.label}</Badge>}
          </div>
          <p className="mt-1 truncate text-[13px] text-gray-600">{openDoc.customer.nameAr}</p>
        </>
      }
      footer={
        <>
          {openDoc.i.status === "draft" && canIssue && (
            <ActionForm action={issue.bind(null, openDoc.i.id)} resetOnSuccess={false} className="col-span-2">
              <SubmitButton pendingLabel="جارٍ الإصدار…" className={`w-full ${sheetPrimary}`}>
                اعتماد وإصدار
              </SubmitButton>
            </ActionForm>
          )}
          {openDoc.i.status === "issued" && openState.paid < openState.total && canReceive && (
            <Link href={`/receipts/new?customer=${openDoc.i.customerId}&invoice=${openDoc.i.id}`} className={sheetPrimary}>
              <Icon name="cash" className="size-4.5" />
              تسجيل تحصيل
            </Link>
          )}
          <Link href={`/invoices/${openDoc.i.id}`} className={sheetBtn}>
            <Icon name="expand" className="size-4" />
            فتح كاملة
          </Link>
          {invoiceMenu(openDoc).length > 0 ? (
            <ActionsMenu items={invoiceMenu(openDoc)} label="العمليات" className={sheetBtn} />
          ) : (
            <Link href={`/invoices/${openDoc.i.id}?print=1`} target="_blank" className={sheetBtn}>
              <Icon name="printer" className="size-4" />
              طباعة
            </Link>
          )}
        </>
      }
    >
      <SheetFacts
        items={[
          ["التاريخ", <span key="d" className="ltr-nums">{fmtDate(openDoc.i.invoiceDate)}</span>],
          ["الاستحقاق", <span key="u" className={`ltr-nums ${openState.overdue ? "text-st-bad-fg" : ""}`}>{fmtDate(openDoc.i.dueDate)}</span>],
          ["الشحنات", openDoc.trips.length ? `${openDoc.trips.length}` : "دون شحنة"],
          ["هيئة الزكاة", openDoc.i.status === "issued" ? ZATCA_STATUS[openDoc.i.zatcaStatus] : "بعد الإصدار"],
        ]}
      />
      <SheetMoney
        lines={[
          ["قبل الضريبة", fmt(openDoc.i.subtotal)],
          ["الضريبة", fmt(openDoc.i.vatTotal)],
          ["الإجمالي", fmt(openState.total)],
          ["المسدد", fmt(openState.paid)],
        ]}
        total={["المتبقي", `${fmt(openState.total - openState.paid)} ${openDoc.i.currencyCode}`]}
      />
    </MobileSheet>
  );

  // الكمبيوتر: معاينة جانبية فوق القائمة بمبالغها وأزرارها، وتحتها الفاتورة نفسها (قرار أحمد 2026-11-23)
  const deskDrawer = openDoc && openState && (
    <DeskDrawer
      closeHref={listHref(BASE, sp, { open: undefined })}
      label={`معاينة الفاتورة ${openDoc.i.number}`}
      header={
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-lg font-semibold text-brand-900">
              فاتورة <span className="ltr-nums">{openDoc.i.number}</span>
            </span>
            <Badge tone={INVOICE_STATUS[openDoc.i.status].tone}>{INVOICE_STATUS[openDoc.i.status].label}</Badge>
            {openState.pay && <Badge tone={openState.pay.tone}>{openState.pay.label}</Badge>}
            {openDoc.trips.length > 0 && (
              <Badge tone={openDoc.trips.every((w) => w.sentAt) ? "blue" : openDoc.trips.some((w) => w.sentAt) ? "amber" : "gray"}>
                {openDoc.trips.every((w) => w.sentAt) ? "✓ أُرسلت للسائق" : openDoc.trips.some((w) => w.sentAt) ? `أُرسلت ${openDoc.trips.filter((w) => w.sentAt).length} من ${openDoc.trips.length} للسائق` : "لم تُرسل للسائق"}
              </Badge>
            )}
          </div>
          <p className="mt-0.5 truncate text-sm text-gray-600">
            {openDoc.customer.nameAr}
            {openDoc.i.status === "issued" && ` · ${ZATCA_STATUS[openDoc.i.zatcaStatus]}`}
          </p>
        </>
      }
      footer={
        <>
          {openDoc.i.status === "draft" && canIssue && (
            <ActionForm action={issue.bind(null, openDoc.i.id)} resetOnSuccess={false}>
              <SubmitButton pendingLabel="جارٍ الإصدار…">اعتماد وإصدار</SubmitButton>
            </ActionForm>
          )}
          {openDoc.i.status === "issued" && openState.paid < openState.total && canReceive && (
            <Link href={`/receipts/new?customer=${openDoc.i.customerId}&invoice=${openDoc.i.id}`} className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-brand-900 shadow-sm hover:bg-brand-500">
              <Icon name="cash" className="size-4" />
              تسجيل دفعة
            </Link>
          )}
          <Link href={`/invoices/${openDoc.i.id}`} className={drawerBtn}>
            <Icon name="expand" className="size-4" />
            فتح كاملة
          </Link>
          {openDoc.i.status === "draft" && canUpdate && (
            <Link href={withParam(listUrl({ open: String(openDoc.i.id) }), "edit", String(openDoc.i.id))} scroll={false} className={drawerBtn}>
              <Icon name="pencil" className="size-4" />
              تعديل
            </Link>
          )}
          <Link href={`/invoices/${openDoc.i.id}?print=1`} target="_blank" className={drawerBtn}>
            <Icon name="printer" className="size-4" />
            طباعة
          </Link>
          {openDoc.i.status !== "draft" && <SendDocument kind="invoices" id={openDoc.i.id} label={`فاتورة ضريبية رقم ${openDoc.i.number}`} company={company.nameAr} phone={openDoc.customer.mobile} email={openDoc.customer.email} />}
          {openDoc.i.status === "issued" && can(user.perms, "sales_invoices", "create") && (
            <Link href={`/notes/sales/new?kind=sales_credit&party=${openDoc.i.customerId}&invoice=${openDoc.i.id}`} className={drawerBtn}>
              إشعار دائن
            </Link>
          )}
          {invoiceMenu(openDoc).length > 0 && (
            <span className="ms-auto">
              <ActionsMenu items={invoiceMenu(openDoc)} label="العمليات" />
            </span>
          )}
        </>
      }
    >
      <SheetFacts
        items={[
          ["التاريخ", <span key="d" className="ltr-nums">{fmtDate(openDoc.i.invoiceDate)}</span>],
          ["الاستحقاق", <span key="u" className={`ltr-nums ${openState.overdue ? "text-st-bad-fg" : ""}`}>{fmtDate(openDoc.i.dueDate)}</span>],
          ["الشحنات", openDoc.trips.length ? `${openDoc.trips.length}` : "دون شحنة"],
          ["هيئة الزكاة", openDoc.i.status === "issued" ? ZATCA_STATUS[openDoc.i.zatcaStatus] : "بعد الإصدار"],
        ]}
      />
      <SheetMoney
        lines={[
          ["قبل الضريبة", fmt(openDoc.i.subtotal)],
          ["الضريبة", fmt(openDoc.i.vatTotal)],
          ["الإجمالي", fmt(openState.total)],
          ["المسدد", fmt(openState.paid)],
        ]}
        total={["المتبقي", `${fmt(openState.total - openState.paid)} ${openDoc.i.currencyCode}`]}
      />
      <div className="mt-5 overflow-hidden rounded-2xl bg-gray-100/70 shadow-inner">
        <ReadinessBar company={company} />
        <div className="p-3">
          {openDoc.i.status === "issued" && <ZatcaPanel doc={zatcaDoc} connected={!!zatca?.token} blocker={blocker} partyHref={`/records/parties/${openDoc.i.customerId}`} send={canIssue ? sendToZatca.bind(null, openDoc.i.id) : undefined} />}
          <TaxInvoiceDocument company={company} invoice={openDoc.i} customer={openDoc.customer} lines={openDoc.lines} qrSvg={qrSvg} template={template} photos={openDoc.photos} compact />
        </div>
      </div>
    </DeskDrawer>
  );
  const rowNext = (i: (typeof invoices)[number]["i"], st: ReturnType<typeof state>): { item?: MenuItem; label?: string; go?: boolean; note?: string } => {
    if (i.status === "draft")
      return canIssue
        ? { item: { label: "أصدرها", action: issue.bind(null, i.id), confirm: { title: `اعتماد وإصدار ${i.number}`, text: "تأخذ الفاتورة رقمها الرسمي ويُرحّل قيد الإيراد والضريبة.", submit: "إصدار" } }, go: true }
        : { note: "تنتظر الإصدار" };
    if (i.status !== "issued") return {};
    if (st.paid >= st.total - 0.005) return { note: "اكتملت" };
    return canReceive ? { item: { label: "سجّل تحصيل", href: `/receipts/new?customer=${i.customerId}&invoice=${i.id}` }, go: st.overdue } : { note: "بانتظار التحصيل" };
  };
  const dayMs = 86_400_000;
  const daysLate = (due: string) => Math.round((Date.parse(today) - Date.parse(due)) / dayMs);

  if (bulkAdding) {
    return (
      <>
        <AddModeBar backHref={BASE} backLabel="الفواتير" title="إدخال عدة فواتير" />
        <Card className="mb-6">
          <SheetEditor
            templateName="الفواتير المباشرة"
            action={saveInvoiceRows}
            initialRows={4}
            columns={[
              { key: "date", label: "التاريخ", type: "date", placeholder: today },
              { key: "dueDate", label: "الاستحقاق", type: "date", placeholder: "= التاريخ" },
              { key: "customerId", label: "العميل", type: "select", required: true, options: customers.map((c) => ({ value: String(c.id), label: c.nameAr })), width: "11rem", create: "customer" },
              { key: "routeId", label: "المسار", type: "select", required: true, options: tripRoutes, width: "13rem", create: "route" },
              { key: "shipper", label: "المرسل", required: true, width: "10rem", suggest: tripShippers },
              { key: "consignee", label: "المستلم", required: true, width: "10rem", suggest: tripShippers },
              { key: "vehicleId", label: "المركبة", type: "select", options: tripVehicles, width: "8rem", create: "vehicle", autoDriver: { key: "driverId", dateKey: "date" } },
              { key: "driverId", label: "السائق", type: "select", options: tripDrivers, width: "9rem", create: "driver", autoVehicle: { key: "vehicleId", dateKey: "date" } },
              { key: "carrierId", label: "أو ناقل خارجي", type: "select", options: tripCarriers, width: "9rem", create: "carrier" },
              { key: "carrierCost", label: "تكلفة الناقل", type: "number", width: "6rem" },
              { key: "carrierPlate", label: "لوحة الناقل", width: "7rem" },
              { key: "amount", label: "السعر الأساسي", type: "number", width: "6rem", placeholder: "من العقد" },
              ...[1, 2].flatMap((n) => [
                { key: `comp${n}`, label: `مكون السعر ${n}`, type: "select" as const, options: componentKinds, width: "9rem" },
                { key: `comp${n}Qty`, label: `كمية ${n}`, type: "number" as const, width: "4.5rem", placeholder: "1" },
                { key: `comp${n}Price`, label: `سعر المكون ${n}`, type: "number" as const, width: "6rem" },
              ]),
              { key: "taxCodeId", label: "نوع الضريبة", type: "select", options: taxOpts, width: "12rem", placeholder: "حسب المسار" },
              { key: "commission", label: "عمولة السائق", type: "number", width: "6rem", placeholder: "من المسار" },
              { key: "weight", label: "الوزن (طن)", type: "number", width: "5rem" },
              { key: "container", label: "رقم الحاوية", ltr: true, width: "7rem" },
              ...[1, 2].flatMap((n) => [
                { key: `charge${n}`, label: `مصروف على العميل ${n}`, type: "select" as const, options: chargeTypes, width: "9rem" },
                { key: `charge${n}Amount`, label: `مبلغ المصروف ${n}`, type: "number" as const, width: "6rem" },
                {
                  key: `charge${n}From`,
                  label: `دفعه ${n}`,
                  type: "select" as const,
                  width: "12rem",
                  options: [...chargeBrokers.map((b) => ({ value: `b:${b.value}`, label: `المخلص: ${b.label}` })), ...chargeCash.map((a) => ({ value: `a:${a.value}`, label: a.label, code: a.code }))],
                },
              ]),
              { key: "send", label: "إرسال للسائق", type: "select", options: [{ value: "1", label: "نعم، على مرحلة التسليم" }], width: "10rem", placeholder: "لا" },
              { key: "reference", label: "المرجع", width: "8rem" },
              { key: "notes", label: "ملاحظات", width: "9rem" },
            ]}
          />
          <p className="mt-2 text-xs text-gray-500">
            كل صف فاتورة مباشرة مسودة بنقلها، بنفس قواعد نافذة الفاتورة: السعر الفارغ من العقد الساري، والضريبة من المسار، والسائق الفارغ هو المسند للمركبة. اختر مركبة أو ناقلاً خارجياً (تكلفته دين له عند الإصدار). «إرسال للسائق» يرسلها له «في الطريق» ليضغط «تم التسليم».
          </p>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="فواتير المبيعات" description="فاتورة لشحنة أو لعدة شحنات مدمجة، أو فاتورة مباشرة ببنود حرة. تُحفظ مسودة برقم مسودة، وعند الاعتماد تأخذ رقمها الرسمي ويُقيد الإيراد والضريبة.">
        <ListActions bulkHref={canUpdate && "/invoices?view=sheet&status=draft"} addHref={canCreate && "/invoices?add=1"} addLabel="إدخال عدة فواتير" importHref={canCreate && "/import/sales-invoices"} />
        {canCreate && (
          <Link href={withParam(listUrl(), "new", "1")} scroll={false} className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-brand-900 shadow-sm transition hover:bg-brand-500">
            + إنشاء فاتورة
          </Link>
        )}
      </PageHeader>

      {canCreate && queue.length > 0 && (
        <details className="group mb-5 rounded-2xl border border-brand-500/30 bg-brand-50/60 print:hidden">
          <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-3.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-brand-500 text-brand-900">
              <Icon name="waybill" className="size-4" />
            </span>
            <span className="font-semibold text-brand-900">شحنات معتمدة بانتظار الفوترة</span>
            <Badge tone="amber">{queue.reduce((a, q) => a + q.count, 0)} شحنة</Badge>
            <span className="ms-auto text-xs text-gray-500 group-open:hidden">عرض</span>
          </summary>
          <div className="px-5 pb-4">
            <ActionForm action={invoiceAll} className="mb-3 flex flex-wrap items-center gap-3" resetOnSuccess={false}>
              <span className="text-sm text-gray-600">تاريخ الفاتورة</span>
              <Input name="invoiceDate" type="date" defaultValue={today} className="w-44" />
              <SubmitButton>تحويل الكل إلى مسودات فواتير (مسودة لكل عميل)</SubmitButton>
            </ActionForm>
            <Table head={["العميل", "العملة", "عدد الشحنات", "الفترة", "المبلغ قبل الضريبة", ""]}>
              {queue.map((q) => (
                <tr key={`${q.customerId}-${q.currencyCode}`}>
                  <Td className="font-medium">{q.customer}</Td>
                  <Td>{q.currencyCode}</Td>
                  <Td className="ltr-nums">{q.count}</Td>
                  <Td className="ltr-nums text-gray-500">
                    {q.from} ← {q.to}
                  </Td>
                  <Td className="ltr-nums font-semibold">{fmt(q.amount)}</Td>
                  <Td>
                    <ActionForm action={invoiceCustomer.bind(null, q.customerId, q.currencyCode)} resetOnSuccess={false}>
                      <input type="hidden" name="invoiceDate" value={today} />
                      <SubmitButton variant="secondary">تحويل إلى مسودة فاتورة</SubmitButton>
                    </ActionForm>
                  </Td>
                </tr>
              ))}
            </Table>
          </div>
        </details>
      )}

      <StatusTabs
        label="حالة الفواتير"
        tabs={INV_TABS.map((t, k) => ({
          key: t.key,
          label: t.label,
          href: listUrl({ status: t.status, pay: t.pay, open: undefined, page: undefined }),
          count: tabCounts[k],
          attn: t.attn,
          active: (sp.status ?? undefined) === t.status && (sp.pay ?? undefined) === t.pay,
        }))}
        summary={
          summary.n > 0 ? (
            <>
              الإجمالي <b className="ltr-nums font-display text-sm font-semibold text-asphalt-900">{fmt(summary.total)}</b> · المتبقي{" "}
              <b className="ltr-nums font-display text-sm font-semibold text-asphalt-900">{fmt(summary.due)}</b>
            </>
          ) : null
        }
      />
      <DocToolbar
        base={BASE}
        params={sp}
        statuses={{}}
        pay={false}
        exportName="فواتير-المبيعات"
        count={summary.n}
        extra={
          view !== "sheet" && invoices.length > 0 ? (
            <span className="max-md:hidden">
              <BulkPdfButton kind="invoices" ids={invoices.map((x) => x.i.id)} />
            </span>
          ) : null
        }
      />

      {view === "sheet" ? (
        <>
        <DocSheet
          action={saveInvoiceSheet}
          emptyText="لا توجد فواتير بهذه الشروط"
          columns={[
            { key: "status", label: "الحالة", type: "badge", width: "5.5rem" },
            { key: "number", label: "الرقم", ltr: true, width: "8rem" },
            { key: "invoiceDate", label: "التاريخ", type: "date", editable: true, width: "8.5rem" },
            { key: "dueDate", label: "الاستحقاق", type: "date", editable: true, width: "8.5rem" },
            { key: "customer", label: "العميل", width: "12rem" },
            { key: "currency", label: "العملة", width: "4rem" },
            { key: "waybills", label: "الشحنات", ltr: true, width: "4.5rem" },
            { key: "subtotal", label: "قبل الضريبة", type: "number", width: "7rem" },
            { key: "vat", label: "الضريبة", type: "number", width: "6rem" },
            { key: "total", label: "الإجمالي", type: "number", width: "7rem" },
            { key: "paid", label: "المسدد", type: "number", width: "6.5rem" },
            { key: "due", label: "المتبقي", type: "number", width: "6.5rem" },
            { key: "pay", label: "السداد", type: "badge", width: "6rem" },
            { key: "notes", label: "ملاحظات", editable: true, width: "14rem" },
          ]}
          rows={invoices.map(({ i, customer, waybills }): DocSheetRow => {
            const st = state(i);
            return {
              id: i.id,
              href: `/invoices/${i.id}`,
              editable: i.status === "draft" && can(user.perms, "sales_invoices", "update"),
              cells: {
                number: i.number,
                invoiceDate: i.invoiceDate,
                dueDate: i.dueDate,
                customer,
                currency: i.currencyCode,
                waybills: String(waybills),
                subtotal: i.subtotal,
                vat: i.vatTotal,
                total: i.total,
                paid: i.paidAmount,
                due: String(st.total - st.paid),
                notes: i.notes,
              },
              badges: {
                status: { label: INVOICE_STATUS[i.status].label, tone: INVOICE_STATUS[i.status].tone },
                ...(st.pay ? { pay: st.pay } : {}),
              },
            };
          })}
        />
          <Pager page={page} size={PAGE_SIZE} total={summary.n} hrefFor={(p) => listUrl({ page: p > 1 ? String(p) : undefined })} />
        </>
      ) : (
        <>
          {mobileList}
          {mobileSheet}
          <div className="max-md:hidden">
          {(canIssue || canUpdate || canRevert || canDelete) && (
            <ActionForm id={BULK_FORM} action={bulkInvoiceOps} resetOnSuccess={false}>
              <input type="hidden" name="op" defaultValue="" />
              <SelectionGate form={BULK_FORM} empty={null}>
                <BulkBar>
                  <SelectionTotal form={BULK_FORM} noun="فاتورة" />
                  <span className="mx-1 h-6 w-px bg-white/15" aria-hidden />
                  {canIssue && (
                    <SubmitButton op="issue" pendingLabel="جارٍ الاعتماد…" className="!py-1.5">
                      اعتماد وإصدار
                    </SubmitButton>
                  )}
                  {canUpdate && (
                    <SubmitButton op="merge" variant="secondary" pendingLabel="جارٍ الدمج…" className="!py-1.5">
                      دمج المحدد
                    </SubmitButton>
                  )}
                  {(canUpdate || canRevert || canDelete || canSend) && (
                    <details data-dropdown className="relative">
                      <summary className="flex cursor-pointer list-none items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 shadow-sm hover:bg-gray-50">
                        عمليات أخرى
                        <span aria-hidden className="text-xs text-gray-400">▴</span>
                      </summary>
                      <div className="absolute start-0 bottom-full z-30 mb-2 flex w-56 flex-col rounded-xl border border-gray-200 bg-white p-1 text-gray-800 shadow-lg">
                        {canSend && (
                          <>
                            <ConfirmSubmit
                              op="send_driver"
                              className="!justify-start !border-0 !text-start !shadow-none"
                              title="إرسال رحلات الفواتير المحددة للسائقين"
                              text="تظهر رحلة كل فاتورة في تطبيق سائقها، وما عليه عهدة رحلة تُصرف له بسند عهدة من الحساب المختار. ما أُرسل من قبل لا يُعاد إرساله."
                              submit="إرسال"
                              fields={<CashAccountField options={cashOpts} />}
                            >
                              إرسال للسائق
                            </ConfirmSubmit>
                            <ConfirmSubmit
                              op="unsend_driver"
                              className="!justify-start !border-0 !text-start !shadow-none"
                              title="إلغاء إرسال رحلات الفواتير المحددة"
                              text="تُسحب الرحلات من تطبيق السائقين وتُعكس عهدتها. ما سجّل عليه السائق تحميلاً أو تسليماً أو مصروفاً لا يُلغى."
                              submit="إلغاء الإرسال"
                            >
                              إلغاء الإرسال للسائق
                            </ConfirmSubmit>
                          </>
                        )}
                        {canRevert && (
                          <ConfirmSubmit
                            op="revert"
                            className="!justify-start !border-0 !text-start !shadow-none"
                            title="إرجاع الفواتير المحددة إلى مسودة"
                            text="يُلغى قيد الإيراد والضريبة لكل فاتورة صادرة محددة، وتحتفظ برقمها الرسمي. لا تُرجع فاتورة عليها دفعة سداد، ولا فاتورة اعتمدتها هيئة الزكاة."
                            submit="إرجاع إلى مسودة"
                          >
                            إرجاع إلى مسودة
                          </ConfirmSubmit>
                        )}
                        {canUpdate && (
                          <ConfirmSubmit
                            op="unmerge"
                            className="!justify-start !border-0 !text-start !shadow-none"
                            title="فك دمج الفواتير المحددة"
                            text="كل شحنة أو فاتورة مدمجة في المسودة تصبح فاتورة مسودة مستقلة. لا يُحذف شيء."
                            submit="فك الدمج"
                          >
                            فك الدمج
                          </ConfirmSubmit>
                        )}
                        {canDelete && (
                          <ConfirmSubmit
                            op="delete"
                            danger
                            className="!justify-start !border-0 !text-start !shadow-none"
                            title="حذف المسودات المحددة"
                            text="تُحذف الفواتير المسودة المحددة وتعود شحناتها «معتمدة · بانتظار الفوترة»، وتُحفظ نسخة في سجل المحذوفات. الفواتير الصادرة وما أخذ رقماً رسمياً لا يُحذف."
                            submit="حذف"
                            fields={
                              <label className="block text-sm">
                                <span className="mb-1 block text-gray-600">سبب الحذف</span>
                                <input name="reason" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="مثال: أُنشئت بالخطأ" />
                              </label>
                            }
                          >
                            حذف المسودات
                          </ConfirmSubmit>
                        )}
                      </div>
                    </details>
                  )}
                </BulkBar>
              </SelectionGate>
            </ActionForm>
          )}
          <Table head={[invoices.length && (canIssue || canUpdate || canRevert || canDelete) ? <SelectAll key="all" form={BULK_FORM} /> : "", "الفاتورة", "العميل والاستحقاق", "المبلغ والتحصيل", "الحالة", "الخطوة التالية", ""]}>
            {invoices.length === 0 && <EmptyRow cols={7}>{filter.q || filter.status || filter.pay || filter.from ? "لا توجد فواتير بهذه الشروط" : "لا توجد فواتير بعد"}</EmptyRow>}
            {invoices.map(({ i, customer, waybills, parts, trips, tripsSent }) => {
              const st = state(i);
              const open = listUrl({ open: String(i.id) });
              const due = st.total - st.paid;
              const late = st.overdue ? daysLate(i.dueDate) : 0;
              const tone = st.pay?.tone ?? INVOICE_STATUS[i.status].tone;
              const kids = kidsOf(i.id);
              const key = `inv-${i.id}`;
              return [
                <ClickRow key={i.id} href={open} className={`transition hover:bg-brand-50/40 ${i.id === openId ? "bg-brand-50/70" : kids.length > 1 ? "bg-[#f6f3ea]" : ""}`}>
                  <Td>{(canIssue || canUpdate || canRevert || canDelete) && <RowCheck form={BULK_FORM} id={i.id} amount={i.total} />}</Td>
                  {kids.length > 1 ? (
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <span className="flex items-center">
                        <GroupToggle group={key} count={kids.length} />
                        <span>
                          <Link href={open} scroll={false} className="ltr-nums font-semibold text-asphalt-900 hover:text-brand-700 hover:underline">
                            {i.number}
                          </Link>
                          <span className="ms-1.5 rounded-full bg-asphalt-900 px-2 py-px text-[11px] font-semibold text-brand-500">{kids.length} شحنات</span>
                          <Sub>
                            <span className="ltr-nums">{fmtDate(i.invoiceDate)}</span>
                          </Sub>
                        </span>
                      </span>
                    </td>
                  ) : (
                    <NumDateCell number={i.number} date={i.invoiceDate} href={open} />
                  )}
                  <Td>
                    <span className="font-medium text-gray-800">{customer}</span>
                    <Sub className={st.overdue ? "font-semibold !text-st-bad-fg" : ""}>
                      {i.status === "draft" ? (waybills > 0 ? (waybills === 1 ? "شحنة واحدة" : `${waybills} شحنات`) : "دون شحنة") : st.overdue ? `متأخرة ${late} يوم · استحقت ${fmtDate(i.dueDate)}` : due > 0.005 ? `تستحق ${fmtDate(i.dueDate)}` : "مسددة"}
                    </Sub>
                  </Td>
                  <Td className="whitespace-nowrap">
                    <span className="ltr-nums font-display font-semibold text-asphalt-900">{fmt(st.total)}</span> <span className="text-xs text-gray-400">{i.currencyCode}</span>
                    {i.status === "issued" && (
                      <>
                        <PaidBar total={st.total} paid={st.paid} />
                        <Sub>{due > 0.005 ? <>باقي <span className="ltr-nums">{fmt(due)}</span></> : "حُصّلت كاملة"}</Sub>
                      </>
                    )}
                  </Td>
                  <StatusCell status={INVOICE_STATUS[i.status]} sub={st.pay ? st.pay.label : parts > 1 && i.status === "draft" ? `مدمجة${waybills > 1 ? ` · ${waybills} شحنات` : ""}` : null}>
                    <DriverSentTag fleet={trips > 0} sentAt={tripsSent > 0 ? "1" : null} partial={tripsSent > 0 && tripsSent < trips ? `أُرسلت ${tripsSent} من ${trips} رحلات للسائق` : undefined} />
                  </StatusCell>
                  <NextStepCell {...rowNext(i, st)} />
                  <EdgeCell tone={tone} />
                </ClickRow>,
                ...(kids.length > 1
                  ? kids.map((r, n) => (
                      <ClickRow key={`w-${r.w.id}`} href={`/waybills?open=${r.w.id}`} kidOf={key} hidden className="bg-[#fcfaf4] transition hover:bg-brand-50/40">
                        <Td />
                        <NumDateCell number={r.w.number} date={r.w.waybillDate} href={`/waybills?open=${r.w.id}`} kid={n === kids.length - 1 ? "last" : "mid"} />
                        <Td>
                          <RouteLine from={r.route?.split(" ← ")[0]} to={r.route?.split(" ← ")[1]} />
                          <Sub>
                            {r.plate ? <Plate>{r.plate}</Plate> : r.carrier ? `ناقل: ${r.carrier}` : "—"} {r.driver ?? r.w.carrierDriverName ?? ""}
                          </Sub>
                        </Td>
                        <Td className="whitespace-nowrap">
                          <span className="ltr-nums font-display text-[13px] font-semibold text-gray-800">{fmt(r.w.amount)}</span>
                          <Sub>قبل الضريبة</Sub>
                        </Td>
                        <Td>
                          <Sub>شحنة {WAYBILL_STATUS[r.w.status].label}</Sub>
                        </Td>
                        <Td />
                        <Td />
                      </ClickRow>
                    ))
                  : []),
              ];
            })}
          </Table>
          <Pager page={page} size={PAGE_SIZE} total={summary.n} hrefFor={(p) => listUrl({ page: p > 1 ? String(p) : undefined, open: undefined })} />
          </div>
          {deskDrawer}
        </>
      )}

      {initial && (
        <InvoiceEditor
          key={editing ? `edit-${editId}` : "new"}
          title={editing ? `تعديل الفاتورة ${initial.number}` : "فاتورة مبيعات جديدة"}
          initial={initial}
          customers={customers.map((c) => ({ value: String(c.id), label: c.nameAr, vatNumber: c.vat, days: terms.find((t) => t.customerId === c.id)?.days ?? null }))}
          accounts={await toAccountOptions([...(domestic ? [domestic] : []), ...revenue.filter((a) => a !== domestic)]).then((o) => [...o.filter((x) => x.code === domestic?.code), ...o.filter((x) => x.code !== domestic?.code)])}
          costCenters={centers.map((c) => ({ value: String(c.id), label: c.nameAr }))}
          taxes={taxOpts}
          lineDefaults={lineDefaults}
          chargeOptions={{ chargeTypes, brokers: chargeBrokers, payees: chargePayees, cashAccounts: chargeCash, waybills: chargeWaybills, tripExpenses }}
          currencies={currencies.map((c) => c.code)}
          routes={tripRoutes}
          vehicles={tripVehicles}
          trailers={tripTrailers}
          drivers={tripDrivers}
          carriers={tripCarriers}
          shippers={tripShippers}
          componentKinds={componentKinds}
          custodyAccounts={cashOpts.map((a) => ({ value: String(a.id), label: `${a.nameAr} · ${a.code}` }))}
          canSend={canSend}
          canIssue={canIssue}
          company={company}
          template={template}
          action={saveInvoicePanel.bind(null, editing ? editId : null)}
          closeHref={editorBack}
          savedHref={returnTo}
        />
      )}
    </>
  );
}

function ReadinessBar({ company }: { company: Awaited<ReturnType<typeof getCompany>> }) {
  const r = invoiceReadiness(company);
  if (r.percent === 100)
    return (
      <div className="flex items-center gap-2 border-b border-green-100 bg-green-50 px-5 py-2 text-xs text-green-800">
        <Icon name="shield" className="size-4" />
        بيانات المنشأة مكتملة للفاتورة الضريبية، والرمز بمتطلبات هيئة الزكاة.
      </div>
    );
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-amber-100 bg-amber-50 px-5 py-2 text-xs text-amber-900">
      <Icon name="alert" className="size-4" />
      بيانات المنشأة ناقصة للفاتورة الضريبية: {r.missing.join("، ")}.
      <Link href="/settings/company" className="font-semibold underline">
        أكملها
      </Link>
    </div>
  );
}
