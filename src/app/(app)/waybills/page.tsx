import Link from "next/link";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { supplierOptions, toTripExpense, tripExpensesForBilling } from "@/lib/purchases";
import { requirePermission } from "@/lib/auth";
import { can, hasSpecial, scopeFor } from "@/lib/permissions";
import { accountOptions, chargeTypeOptions, cityNames, contactCards, customerOptions, driverOptions, locationOptions, partyOptions, shipperSuggestions, vehicleOptions } from "@/lib/lookups";
import { emptyTransport, toTransportDraft } from "@/lib/transport-draft";
import { getCompany, getInvoiceTemplate } from "@/lib/company";
import { todayRiyadh } from "@/lib/dates";
import { fundingAccounts } from "@/lib/invoices";
import { listHref, type DocListParams } from "@/lib/doc-filters";
import { PAGE_SIZE, pageOf } from "@/lib/paging";
import { fmt, fmtDate } from "@/lib/format";
import { EDITABLE, groupMergedWaybills, listWaybills, parseWaybillFilter, waybillComponents, waybillDoc, type WaybillListItem } from "@/lib/waybills";
import { customListOptions } from "@/lib/custom-lists";
import { joinCustom } from "@/data/custom-lists";
import { taxCodeOptions } from "@/lib/tax-codes";
import { WAYBILL_SORTS, WAYBILL_STATUS, type WaybillStatus } from "@/data/waybills";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { ActionButton, ActionsMenu, type MenuItem } from "@/components/actions-menu";
import { DocCard, DocCards, DocGroupCard, Plate, SheetFacts, SheetMoney, SheetTrack, sheetBtn, sheetPrimary } from "@/components/doc-card";
import { MobileSheet } from "@/components/mobile-sheet";
import { BulkPdfButton } from "@/components/bulk-pdf";
import { ClickRow } from "@/components/click-row";
import { DateInput } from "@/components/date-input";
import { DocSheet, type DocSheetRow } from "@/components/doc-sheet";
import { DocToolbar } from "@/components/doc-toolbar";
import { DriverSentTag } from "@/components/driver-sent";
import { CashAccountField } from "@/components/cash-account-field";
import { Icon } from "@/components/icons";
import { RowCheck, SelectAll, SelectionGate, SelectionTotal } from "@/components/row-selection";
import { GroupCheck, GroupToggle } from "@/components/merged-group";
import { SendDocument } from "@/components/send-document";
import { SheetEditor } from "@/components/sheet-editor";
import { AddModeBar } from "@/components/list-actions";
import { Badge, Card, EmptyRow, PageHeader, Pager, Table, Td } from "@/components/ui";
import { BulkBar, EdgeCell, NextStepCell, NumDateCell, RouteLine, StatusCell, StatusTabs, Sub } from "@/components/desk-list";
import { DeskDrawer } from "@/components/desk-drawer";
import { WaybillDocument } from "@/components/waybill-document";
import { bulkWaybillOps, copyWaybill, invoiceOne, issueOne, unmergeOne, removeWaybillAction, saveTransportPanel, saveWaybillPanel, saveWaybills, saveWaybillSheet, sendToDriverAction, unsendFromDriverAction, waybillToStatus } from "./actions";
import { TransportPanel } from "./transport-panel";
import { WaybillEditor, type RouteOption, type WaybillDraft } from "./waybill-editor";
import { pendingTripRequestsCount, requestPrefill } from "@/lib/driver-trip-requests";

const BASE = "/waybills";
const BULK_FORM = "waybill-bulk";

const TABS: { key: string; label: string }[] = [
  { key: "", label: "الكل" },
  { key: "draft", label: "مسودة" },
  { key: "in_transit", label: "في الطريق" },
  { key: "delivered", label: "مُسلَّمة" },
  { key: "pending_invoice", label: "معتمدة · بانتظار الفوترة" },
  { key: "merged", label: "مدمجة" },
  { key: "invoiced", label: "مفوترة" },
  { key: "rejected", label: "مرفوضة" },
];

// حالات تنتظر من المكتب خطوة: تُعلَّم بالأصفر في أزرار الحالات
const ATTN = ["delivered", "pending_invoice"];

const SHEET_TONE: Record<WaybillStatus, "gray" | "green" | "blue" | "amber" | "red"> = {
  draft: "gray",
  in_transit: "blue",
  delivered: "amber",
  approved: "green",
  invoiced: "green",
  rejected: "red",
};

/** حالة الشحنة كما تُعرض: المعتمدة بانتظار الفوترة، أو مدمجة في مسودة، أو مفوترة. */
function waybillState(status: WaybillStatus, invoiceId: number | null, invoiceWaybills: number) {
  // رحلة فاتورة مباشرة: إيرادها في فاتورتها (invoiceWaybills = -1 من القائمة)
  if (invoiceWaybills < 0) return status === "approved" ? { label: "معتمدة", tone: "green" as const, sub: "رحلة فاتورة مباشرة" } : { label: WAYBILL_STATUS[status].label, tone: WAYBILL_STATUS[status].tone, sub: "رحلة فاتورة مباشرة" };
  if (status === "approved" && !invoiceId) return { label: "معتمدة", tone: "amber" as const, sub: "بانتظار الفوترة" };
  if (status === "approved") return invoiceWaybills > 1 ? { label: "مدمجة", tone: "blue" as const } : { label: "في مسودة فاتورة", tone: "blue" as const };
  return { label: WAYBILL_STATUS[status].label, tone: WAYBILL_STATUS[status].tone };
}

const withParam = (url: string, key: string, value: string) => `${url}${url.includes("?") ? "&" : "?"}${key}=${value}`;
const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";
// جوال سعودي محلي (05…) يصبح دولياً لرابط واتساب
const whatsappLink = (mobile: string, text: string) => {
  const digits = mobile.replace(/\D/g, "");
  return `https://wa.me/${digits.startsWith("05") ? `966${digits.slice(1)}` : digits}?text=${encodeURIComponent(text)}`;
};

type Params = DocListParams & { new?: string; add?: string; edit?: string; transport?: string; doc?: string; fromRequest?: string };

export default async function WaybillsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requirePermission("waybills", "view");
  const sp = await searchParams;
  const today = todayRiyadh();
  const showPrices = hasSpecial(user.perms, "view_prices");
  const canCreate = can(user.perms, "waybills", "create");
  const canUpdate = can(user.perms, "waybills", "update");
  const canApprove = can(user.perms, "waybills", "approve");
  const canRevert = can(user.perms, "waybills", "revert");
  const canDelete = can(user.perms, "waybills", "delete");
  const canInvoice = can(user.perms, "sales_invoices", "create");
  const canIssueInvoice = can(user.perms, "sales_invoices", "approve");
  const canOverride = hasSpecial(user.perms, "override_controls");
  const view = sp.view === "sheet" ? "sheet" : "table";
  const lp: DocListParams = { q: sp.q, status: sp.status, period: sp.period, from: sp.from, to: sp.to, sort: sp.sort, view: sp.view, page: sp.page };
  const { page, offset } = pageOf(sp.page);
  const bulkAdding = sp.add === "1" && canCreate;
  // «تحويل لشحنة» من رحلة بدأها السائق: نافذة الشحنة الجديدة نفسها معبأة بالسائق والمركبة والتاريخ
  const prefill = canCreate && sp.fromRequest ? await requestPrefill(db, Number(sp.fromRequest)) : null;
  const creating = (sp.new === "1" || !!prefill) && canCreate;
  const openId = view === "table" ? Number(sp.open) || null : null;
  const editId = canUpdate ? Number(sp.edit) || null : null;
  const transportId = canUpdate ? Number(sp.transport) || null : null;
  const docVariant = sp.doc === "transport" ? "transport" : "waybill";
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "alkamal-erp.vercel.app";
  const appUrl = `${h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")}://${host}`;
  const filter = { ...parseWaybillFilter(sp, today), driverUserId: scopeFor(user.perms, "waybills", "view") === "own" ? user.id : undefined };

  const [{ rows, counts, total: listTotal }, openDoc, editRow, editGoods, transportDoc, company, template] = await Promise.all([
    listWaybills(db, filter, PAGE_SIZE, offset),
    openId ? waybillDoc(db, openId) : Promise.resolve(null),
    editId ? db.select().from(s.waybills).where(eq(s.waybills.id, editId)).then((r) => r[0] ?? null) : Promise.resolve(null),
    editId ? db.select().from(s.waybillGoods).where(eq(s.waybillGoods.waybillId, editId)).orderBy(s.waybillGoods.lineNo) : Promise.resolve([]),
    transportId ? waybillDoc(db, transportId) : Promise.resolve(null),
    getCompany(db),
    getInvoiceTemplate(db),
  ]);
  // الشحنات المدمجة في فاتورة واحدة: صف واحد بسهم يفتح شحناتها (قرار أحمد 2026-11-24)
  const items: WaybillListItem[] = view === "table" ? await groupMergedWaybills(db, rows, filter) : rows.map((row) => ({ kind: "one", row }));
  const cashOpts = canUpdate ? await fundingAccounts(db) : [];
  const pendingRequests = canCreate ? await pendingTripRequestsCount(db) : 0;
  const cashField = <CashAccountField options={cashOpts} deferrable />;
  const transportOpen = !!transportDoc && transportDoc.w.status !== "rejected";
  const editing = !!editRow && EDITABLE.includes(editRow.status);
  const needOptions = view === "sheet" || creating || editing || bulkAdding;
  const [contacts, cities, componentKinds, taxes, editComponents] = await Promise.all([
    creating || editing ? contactCards() : Promise.resolve({}),
    creating || editing || transportOpen ? cityNames() : Promise.resolve([] as string[]),
    creating || editing || bulkAdding ? customListOptions(db, "price_component") : Promise.resolve([]),
    creating || editing || bulkAdding ? taxCodeOptions(db, "sales") : Promise.resolve([]),
    editing && editRow ? waybillComponents(db, editRow.id) : Promise.resolve([]),
  ]);
  // مصاريف على العميل من نافذة الشحنة نفسها
  const [chargeTypes, brokers, chargeCash, savedCharges, tripExpenses, payees] = await Promise.all([
    creating || editing || bulkAdding ? chargeTypeOptions() : Promise.resolve([]),
    creating || editing || bulkAdding ? partyOptions("customs_broker") : Promise.resolve([]),
    // «دفعه: الشركة» من أي حساب في الشجرة (الصناديق والبنوك أولاً في البحث)
    creating || editing || bulkAdding ? accountOptions(["1", "2"]).then((o) => o.filter((x) => x.code !== "1114")) : Promise.resolve([]),
    editing && editRow
      ? db
          .select({ e: s.waybillExpenses, label: s.chargeTypes.nameAr, line: s.salesInvoiceLines.id })
          .from(s.waybillExpenses)
          .innerJoin(s.chargeTypes, eq(s.chargeTypes.id, s.waybillExpenses.chargeTypeId))
          .leftJoin(s.salesInvoiceLines, eq(s.salesInvoiceLines.waybillExpenseId, s.waybillExpenses.id))
          .where(eq(s.waybillExpenses.waybillId, editRow.id))
          .orderBy(s.waybillExpenses.id)
      : Promise.resolve([]),
    editing && editRow ? tripExpensesForBilling(db, [editRow.id]) : Promise.resolve([]),
    creating || editing ? supplierOptions(db) : Promise.resolve([]),
  ]);
  const [customers, routeRows, locs, vehicles, trailers, drivers, carriers, shippers] = needOptions
    ? await Promise.all([
        customerOptions(),
        db.select().from(s.routes).where(eq(s.routes.isActive, true)),
        locationOptions({ includeHidden: true }),
        vehicleOptions("head"),
        vehicleOptions("trailer"),
        driverOptions(),
        partyOptions("carrier"),
        creating || editing || bulkAdding ? shipperSuggestions() : Promise.resolve([] as string[]),
      ])
    : [[], [], [], [], [], [], [], [] as string[]];
  const locName = new Map(locs.map((l) => [l.value, l.label]));
  const routes: RouteOption[] = routeRows
    .map((r) => ({ value: String(r.id), label: `${locName.get(String(r.fromLocationId))} ← ${locName.get(String(r.toLocationId))}`, international: r.isInternational }))
    .sort((a, b) => a.label.localeCompare(b.label, "ar"));

  const listUrl = (patch: Partial<Record<keyof DocListParams, string | undefined>> = {}) => listHref(BASE, lp, patch);
  const back = listUrl(openId ? { open: String(openId) } : {});
  type Row = (typeof rows)[number];
  const editable = (w: Row["w"]) => canUpdate && EDITABLE.includes(w.status);

  const overrideField = canOverride ? (
    <label className="block text-sm">
      <span className="mb-1 block text-gray-600">سبب تجاوز الضوابط (عند الحاجة فقط)</span>
      <input name="overrideReason" className={inputCls} placeholder="مثال: عقد العميل قيد التجديد" />
    </label>
  ) : undefined;

  /** عمليات الشحنة الواحدة في قائمة «العمليات». */
  const menu = (w: Row["w"], invoiceId: number | null, invoice: string | null, driverMobile?: string | null): MenuItem[] => {
    const items: MenuItem[] = [];
    const st = w.status;
    const to = (target: "draft" | "in_transit" | "delivered" | "approved") => waybillToStatus.bind(null, w.id, target);
    if (canUpdate && st === "draft") items.push({ label: "في الطريق", icon: "truck", hint: "تسجيل بدء الرحلة", action: to("in_transit") });
    if (canUpdate && (st === "draft" || st === "in_transit")) items.push({ label: "تم التسليم", icon: "check", action: to("delivered") });
    if (canApprove && (st === "draft" || st === "in_transit" || st === "delivered"))
      items.push({
        label: "اعتماد الشحنة",
        icon: "check",
        hint: "يرحّل قيد التكلفة وتصبح جاهزة للفوترة",
        action: to("approved"),
        confirm: { title: `اعتماد الشحنة ${w.number}`, text: "يُرحّل قيد تكلفة الرحلة (الديزل والعمولة والمصاريف) وتصبح الشحنة جاهزة للفوترة.", submit: "اعتماد", fields: overrideField },
      });
    const dateField = (
      <label className="block text-sm">
        <span className="mb-1 block text-gray-600">تاريخ الفاتورة</span>
        <DateInput name="invoiceDate" defaultValue={today} required className={inputCls} />
      </label>
    );
    if (st === "approved" && !invoiceId && canInvoice)
      items.push({
        label: "إنشاء فاتورة مسودة",
        icon: "invoice",
        hint: "تراجعها ثم تعتمدها من الفواتير",
        divider: true,
        action: invoiceOne.bind(null, w.id),
        confirm: {
          title: `فاتورة مسودة للشحنة ${w.number}`,
          text: "تُنشأ فاتورة مبيعات مسودة بهذه الشحنة وحدها. لجمع عدة شحنات في فاتورة حددها من الجدول واختر «دمج المحدد».",
          submit: "إنشاء المسودة",
          fields: dateField,
        },
      });
    if (st === "approved" && canIssueInvoice && !w.sourceInvoiceId)
      items.push({
        label: invoiceId ? `فوترة (إصدار ${invoice ?? "الفاتورة"})` : "فوترة الشحنة",
        icon: "check",
        hint: invoiceId ? "تصدر فاتورتها المسودة بكل ما فيها" : "فاتورة صادرة ويُرحّل قيد الإيراد",
        divider: !!invoiceId,
        action: issueOne.bind(null, w.id),
        confirm: {
          title: invoiceId ? `إصدار الفاتورة ${invoice ?? ""}` : `فوترة الشحنة ${w.number}`,
          text: invoiceId ? "تصدر الفاتورة المسودة التي فيها هذه الشحنة ويُرحّل قيد الإيراد والضريبة، وتصبح شحناتها «مفوترة»." : "تُنشأ فاتورة لهذه الشحنة وتصدر مباشرة ويُرحّل قيد الإيراد والضريبة.",
          submit: "فوترة",
          fields: invoiceId ? undefined : dateField,
        },
      });
    if (st === "approved" && invoiceId && !w.sourceInvoiceId && can(user.perms, "sales_invoices", "update"))
      items.push({
        label: "فك الدمج",
        icon: "undo",
        hint: "تخرج من المسودة وتعود «بانتظار الفوترة»",
        action: unmergeOne.bind(null, w.id),
        confirm: { title: `فك دمج الشحنة ${w.number}`, text: `تخرج الشحنة من الفاتورة المسودة ${invoice ?? ""} وتعود «معتمدة · بانتظار الفوترة». باقي شحنات الفاتورة تبقى فيها.`, submit: "فك الدمج" },
      });
    if (invoiceId) items.push({ label: `فتح الفاتورة ${invoice ?? ""}`, icon: "invoice", href: `/invoices?open=${invoiceId}`, divider: st !== "approved" });
    if (canRevert && st === "approved" && !invoiceId) {
      items.push({
        label: "إرجاع إلى مُسلَّمة",
        icon: "undo",
        divider: true,
        action: to("delivered"),
        confirm: { title: `إرجاع الشحنة ${w.number}`, text: "يُلغى قيد التكلفة المرحّل وتعود الشحنة «مُسلَّمة» للتعديل.", submit: "إرجاع" },
      });
    }
    if (canUpdate && (st === "delivered" || st === "in_transit" || (st === "approved" && canRevert && !invoiceId))) {
      if (st === "delivered" || st === "approved") items.push({ label: "إرجاع إلى في الطريق", icon: "undo", action: to("in_transit"), confirm: st === "approved" ? { title: `إرجاع الشحنة ${w.number}`, text: "يُلغى قيد التكلفة المرحّل.", submit: "إرجاع" } : undefined });
      items.push({ label: "إرجاع إلى مسودة", icon: "undo", action: to("draft"), confirm: st === "approved" ? { title: `إرجاع الشحنة ${w.number}`, text: "يُلغى قيد التكلفة المرحّل.", submit: "إرجاع" } : undefined });
    }
    if (canUpdate && st === "rejected") items.push({ label: "إعادة إلى مسودة للتصحيح", icon: "undo", action: to("draft") });
    if (canUpdate && st !== "rejected") {
      items.push({ label: "بيانات وثيقة النقل", icon: "pencil", hint: "المرسل والمستلم والبضاعة ورقم لوجستي", href: withParam(listUrl({ open: String(w.id) }), "transport", String(w.id)), divider: true });
      if (w.execution === "fleet" && !w.sentToDriverAt) {
        const custody = Number(w.tripCustody);
        items.push({
          label: "إرسال للسائق",
          icon: "truck",
          hint: custody > 0 ? `مع عهدة رحلة ${fmt(custody)}` : "تظهر الرحلة في تطبيقه ليسجل التحميل والتسليم",
          action: sendToDriverAction.bind(null, w.id),
          confirm: {
            title: `إرسال الشحنة ${w.number} للسائق`,
            text: custody > 0 ? `تظهر في تطبيق السائق، وتُقيد عليه عهدة الرحلة ${fmt(custody)} بسند صرف عهدة.` : "تظهر الرحلة في تطبيق السائق ليستلمها ويسجل التحميل والتسليم. لا توجد عهدة رحلة عليها.",
            submit: "إرسال",
            fields: custody > 0 ? cashField : undefined,
          },
        });
      }
      if (w.sentToDriverAt)
        items.push({
          label: "إلغاء الإرسال للسائق",
          icon: "undo",
          hint: "تُسحب من تطبيقه وتُعكس عهدتها؛ لتعديلها أو حذفها",
          action: unsendFromDriverAction.bind(null, w.id),
          confirm: {
            title: `إلغاء إرسال ${w.number}`,
            text: "تُسحب الرحلة من تطبيق السائق ويُعكس سند عهدتها. لا يتم إن كان السائق سجّل عليها تحميلاً أو تسليماً أو مصروفاً.",
            submit: "إلغاء الإرسال",
          },
        });
      if (w.sentToDriverAt && driverMobile)
        items.push({ label: "تنبيه السائق عبر واتساب", icon: "send", href: whatsappLink(driverMobile, `وثيقة النقل للشحنة ${w.number} جاهزة في تطبيق السائق: ${appUrl}/driver/trips/${w.id}`), newTab: true });
    }
    items.push({ label: "التفاصيل الكاملة", icon: "document", hint: "المراحل والديزل والمصاريف", href: `/waybills/${w.id}`, divider: true });
    if (canCreate) items.push({ label: "نسخ الشحنة", icon: "copy", hint: "شحنة جديدة مسودة بتاريخ اليوم", action: copyWaybill.bind(null, w.id, listUrl()) });
    items.push({ label: "طباعة البوليصة", icon: "printer", href: `/print/waybills?ids=${w.id}&print=1`, newTab: true });
    items.push({ label: "طباعة وثيقة النقل", icon: "printer", href: `/print/transport?ids=${w.id}&print=1`, newTab: true });
    items.push({ label: "تنزيل PDF", icon: "download", href: `/print/waybills?ids=${w.id}&pdf=1`, newTab: true });
    if (canDelete && (st === "draft" || st === "rejected"))
      items.push({
        label: "حذف",
        icon: "trash",
        danger: true,
        divider: true,
        action: removeWaybillAction.bind(null, w.id, listUrl()),
        confirm: {
          title: `حذف الشحنة ${w.number}`,
          text: "تُحذف الشحنة ومراحلها وديزلها ومصاريفها، وتُحفظ نسخة في سجل المحذوفات.",
          submit: "حذف نهائياً",
          fields: (
            <label className="block text-sm">
              <span className="mb-1 block text-gray-600">سبب الحذف</span>
              <input name="reason" required className={inputCls} />
            </label>
          ),
        },
      });
    return items;
  };

  const exportQuery = new URLSearchParams(Object.entries({ q: lp.q, status: lp.status, period: lp.period, sort: lp.sort }).filter((e): e is [string, string] => !!e[1])).toString();
  const pageMenu: MenuItem[] = [
    ...(canCreate
      ? [
          { label: "إدخال عدة شحنات", icon: "grid" as const, href: `${BASE}?add=1`, hint: "ورقة إدخال سريع" },
          { label: "الاستيراد من Excel", icon: "upload" as const, href: "/import/waybills" },
        ]
      : []),
    { label: "تصدير إلى Excel", icon: "download", href: `${BASE}/export?format=xlsx&${exportQuery}`, download: true, divider: canCreate, hint: "حسب الفلتر الحالي" },
    { label: "تصدير إلى CSV", icon: "download", href: `${BASE}/export?format=csv&${exportQuery}`, download: true },
    { label: "نسخ إلى الحافظة", icon: "copy", copyFrom: `${BASE}/export?format=tsv&${exportQuery}`, hint: "للصق مباشرة في Excel" },
  ];

  const draft = (): WaybillDraft | null => {
    const str = (v: string | number | null | undefined) => (v == null ? "" : String(v));
    if (editing && editRow) {
      const w = editRow;
      return {
        number: w.number,
        date: w.waybillDate,
        customerId: str(w.customerId),
        routeId: str(w.routeId),
        execution: w.execution,
        vehicleId: str(w.vehicleId),
        trailerId: str(w.trailerId),
        driverId: str(w.driverId),
        carrierId: str(w.carrierId),
        carrierCost: w.carrierCost != null ? String(Number(w.carrierCost)) : "",
        carrierPlate: str(w.carrierPlate),
        carrierDriverName: str(w.carrierDriverName),
        shipper: w.shipper,
        consignee: w.consignee,
        // السعر الأساسي، والمكونات تُضاف إليه
        amount: showPrices ? String(Number(w.baseAmount ?? w.amount)) : "",
        components: editComponents.map((c) => ({ kind: joinCustom(c.kind, c.classId), label: c.label, quantity: String(Number(c.quantity)), unitPrice: String(Number(c.unitPrice)) })),
        taxCodeId: str(w.taxCodeId),
        commission: String(Number(w.driverCommission)),
        tripCustody: Number(w.tripCustody) ? String(Number(w.tripCustody)) : "",
        sent: !!w.sentToDriverAt,
        weight: w.weightTons != null ? String(Number(w.weightTons)) : "",
        container: str(w.containerNumber),
        deliveryNote: str(w.deliveryNoteNumber),
        customs: str(w.customsDeclaration),
        notes: str(w.notes),
        priceNote: w.priceNote,
        transport: toTransportDraft(w, editGoods),
        charges: [],
        billExpenses: [],
        tripExpenses: tripExpenses.map(toTripExpense),
        savedCharges: savedCharges.map(({ e, label, line }) => ({ label: e.note ? `${label}: ${e.note}` : label, amount: e.amount, payer: e.payer, billTo: e.billTo, invoiced: !!line })),
      };
    }
    if (creating)
      return { date: prefill?.date ?? today, customerId: "", routeId: "", execution: "fleet", vehicleId: prefill ? String(prefill.vehicleId) : "", trailerId: "", driverId: prefill ? String(prefill.driverId) : "", carrierId: "", carrierCost: "", carrierPlate: "", carrierDriverName: "", shipper: "", consignee: "", amount: "", components: [], taxCodeId: "", commission: "", tripCustody: "", weight: "", container: "", deliveryNote: "", customs: "", notes: "", transport: emptyTransport(), charges: [], billExpenses: [] };
    return null;
  };
  const initial = draft();
  const returnTo = view === "sheet" ? listUrl() : listUrl({ open: "{id}", page: creating ? undefined : lp.page }).replace("%7Bid%7D", "{id}");
  const filtered = !!(filter.q || filter.tab || filter.from);
  const openRow = openDoc ? items.flatMap((i) => (i.kind === "one" ? [i.row] : i.rows)).find((r) => r.w.id === openDoc.w.id) : undefined;
  const openInvoiceId = openRow?.invoiceId ?? null;
  const vatOf = (w: Row["w"]) => (w.isInternational ? 0 : 15);
  const exec = (r: Row) => r.plate ?? (r.carrier ? `${r.carrier} (ناقل)` : "—");

  /** الخطوة التالية تحت مبلغ البطاقة على الجوال */
  const nextStep = (r: Row) => {
    const w = r.w;
    if (w.status === "draft" && w.execution === "fleet" && !w.sentToDriverAt) return "أرسلها للسائق";
    if (w.status === "delivered") return canApprove ? "تنتظر اعتمادك" : "تنتظر الاعتماد";
    if (w.status === "approved" && !r.invoiceId && r.invoiceWaybills >= 0) return "جاهزة للفوترة";
    if (w.status === "rejected") return w.rejectionReason ? `مرفوضة: ${w.rejectionReason}` : null;
    return null;
  };
  /** زر «الخطوة التالية» في صف الكمبيوتر: نفس بند العمليات باسم قصير، والأصفر لما ينتظر إجراءً منا */
  const rowNext = (r: Row): { item?: MenuItem; label?: string; go?: boolean; note?: string } => {
    const w = r.w;
    const items = menu(w, r.invoiceId, r.invoice);
    const find = (p: string) => items.find((i) => i.label.startsWith(p));
    const pick = (p: string, label: string, go: boolean, note: string) => {
      const item = find(p);
      return item ? { item, label, go } : { note };
    };
    const st = w.status;
    if (st === "invoiced") return { note: "اكتملت" };
    if ((st === "draft" || st === "in_transit") && w.execution === "fleet") return w.sentToDriverAt ? { note: "عند السائق" } : pick("إرسال للسائق", "أرسلها للسائق", true, "مسودة");
    if (st === "draft" || st === "in_transit" || st === "delivered") return pick("اعتماد الشحنة", "اعتمدها", true, "تنتظر الاعتماد");
    if (st === "approved" && r.invoiceId) return pick("فتح الفاتورة", "افتح الفاتورة", false, "في فاتورة");
    if (st === "approved") return pick("إنشاء فاتورة مسودة", "حوّلها لفاتورة", true, "بانتظار الفوترة");
    if (st === "rejected") return pick("إعادة إلى مسودة", "صحّحها", false, "مرفوضة");
    return {};
  };
  const splitRoute = (route: string | null) => {
    const [from = "", to = ""] = (route ?? "").split(" ← ");
    return { from, to };
  };
  // الجوال: بطاقة لكل شحنة (قرار أحمد 2026-11-22)، ولمسها يفتح المعاينة من الأسفل
  const mobileList = (
    <div className="md:hidden">
      <DocCards empty={filtered ? "لا توجد شحنات بهذه الشروط" : "لا توجد شحنات بعد؛ اضغط «إنشاء»"}>
        {items.map((it) => {
          if (it.kind === "group") {
            const g = it;
            const issued = g.invoice.status === "issued";
            const routes = new Set(g.rows.map((r) => r.route)).size;
            return (
              <DocGroupCard
                key={`inv-${g.invoice.id}`}
                number={g.invoice.number}
                href={`/invoices?open=${g.invoice.id}`}
                status={issued ? { label: "مفوترة", tone: "green" } : { label: "مدمجة", tone: "blue" }}
                count={g.rows.length}
                party={g.rows[0].customer}
                meta={`${issued ? "فاتورة صادرة" : "مسودة فاتورة"} · ${routes} ${routes === 1 ? "مسار" : "مسارات"}`}
                amount={showPrices ? fmt(g.rows.reduce((t, r) => t + Number(r.w.amount), 0)) : null}
                currency={g.rows[0].w.currencyCode}
                next={issued ? null : canIssueInvoice ? "أصدرها" : null}
                open={g.rows.some((r) => r.w.id === openId)}
                kids={g.rows.map((r) => ({
                  key: r.w.id,
                  href: listUrl({ open: String(r.w.id) }),
                  number: r.w.number,
                  line: `${r.route} · ${exec(r)} · ${fmtDate(r.w.waybillDate)}`,
                  amount: showPrices ? fmt(r.w.amount) : null,
                  active: r.w.id === openId,
                }))}
              />
            );
          }
          const r = it.row;
          const { w } = r;
          const st = waybillState(w.status, r.invoiceId, r.invoiceWaybills);
          return (
            <DocCard
              key={w.id}
              href={listUrl({ open: String(w.id) })}
              number={w.number}
              status={st}
              date={w.waybillDate}
              party={r.customer}
              route={{ ...splitRoute(r.route), international: w.isInternational }}
              meta={
                <>
                  <Plate>{exec(r)}</Plate>
                  <span className="flex min-w-0 items-center gap-1 truncate">
                    <Icon name="user" className="size-3.5 shrink-0" />
                    {r.driver ?? w.carrierDriverName ?? "—"}
                  </span>
                </>
              }
              amount={showPrices ? fmt(w.amount) : null}
              currency={w.currencyCode}
              next={nextStep(r)}
              active={w.id === openId}
            />
          );
        })}
      </DocCards>
      <Pager page={page} size={PAGE_SIZE} total={listTotal.n} hrefFor={(p) => listUrl({ page: p > 1 ? String(p) : undefined, open: undefined })} />
    </div>
  );
  type ListRow = (typeof rows)[number];
  const deskRow = (r: ListRow, kid?: { of: string; open: boolean; last: boolean }) => {
                  const { w } = r;
                  const open = listUrl({ open: String(w.id) });
                  const st = waybillState(w.status, r.invoiceId, r.invoiceWaybills);
                  const nx = rowNext(r);
                  return (
                    <ClickRow key={w.id} href={open} kidOf={kid?.of} hidden={kid ? !kid.open : undefined} className={`transition hover:bg-brand-50/40 ${w.id === openId ? "bg-brand-50/70" : kid ? "bg-[#fcfaf4]" : ""}`}>
                      <Td>{(canUpdate || canApprove || canInvoice) && <RowCheck form={BULK_FORM} id={w.id} amount={showPrices ? w.amount : "0"} group={kid?.of} />}</Td>
                      <NumDateCell number={w.number} date={w.waybillDate} href={open} kid={kid ? (kid.last ? "last" : "mid") : undefined} />
                      <Td>
                        <span className="font-medium text-gray-800">{r.customer}</span>
                        <RouteLine {...splitRoute(r.route)} international={w.isInternational} />
                      </Td>
                      <Td className="whitespace-nowrap">
                        {r.plate ? <Plate>{r.plate}</Plate> : r.carrier ? <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700">ناقل: {r.carrier}</span> : "—"}
                        <Sub>{r.driver ?? w.carrierDriverName ?? "—"}</Sub>
                      </Td>
                      {showPrices && (
                        <Td className="whitespace-nowrap">
                          <span className="ltr-nums font-display font-semibold text-asphalt-900">{fmt(w.amount)}</span> <span className="text-xs text-gray-400">{w.currencyCode}</span>
                          <Sub>قبل الضريبة</Sub>
                        </Td>
                      )}
                      <StatusCell status={st} sub={w.status === "rejected" ? w.rejectionReason : "sub" in st ? st.sub : null}>
                        {r.invoiceId ? (
                          <Sub className="whitespace-nowrap">
                            فاتورة{" "}
                            <Link href={`/invoices?open=${r.invoiceId}`} className="ltr-nums text-brand-700 hover:underline">
                              {r.invoice}
                            </Link>
                          </Sub>
                        ) : (
                          <DriverSentTag sentAt={w.sentToDriverAt} acceptedAt={w.driverAcceptedAt} fleet={w.execution === "fleet" && (w.status === "draft" || w.status === "in_transit")} />
                        )}
                      </StatusCell>
                      <NextStepCell {...nx} />
                      <EdgeCell tone={st.tone} />
                    </ClickRow>
                  );
  };
  // صف الفاتورة المدمجة: رقمها وعدد شحناتها ومجموعها، والسهم يفتح الشحنات تحته
  const deskGroup = (g: Extract<WaybillListItem, { kind: "group" }>) => {
    const key = `inv-${g.invoice.id}`;
    const issued = g.invoice.status === "issued";
    const st = issued ? { label: "مفوترة", tone: "green" as const } : { label: "مدمجة", tone: "blue" as const };
    const href = `/invoices?open=${g.invoice.id}`;
    const routes = [...new Set(g.rows.map((r) => r.route))];
    const plates = new Set(g.rows.map((r) => r.plate ?? r.carrier).filter(Boolean)).size;
    const dates = g.rows.map((r) => r.w.waybillDate).sort();
    const startOpen = g.rows.some((r) => r.w.id === openId);
    const total = g.rows.reduce((t, r) => t + Number(r.w.amount), 0);
    return [
      <tr key={key} className="bg-[#f6f3ea] transition hover:bg-[#f1ecdd]" data-merged-group={g.invoice.number}>
        <Td>{(canUpdate || canApprove || canInvoice) && <GroupCheck form={BULK_FORM} group={key} />}</Td>
        <td className="px-4 py-2.5 whitespace-nowrap">
          <span className="flex items-center">
            <GroupToggle group={key} count={g.rows.length} defaultOpen={startOpen} />
            <span>
              <Link href={href} className="ltr-nums font-semibold text-asphalt-900 hover:text-brand-700 hover:underline">
                {g.invoice.number}
              </Link>
              <span className="ms-1.5 rounded-full bg-asphalt-900 px-2 py-px text-[11px] font-semibold text-brand-500">{g.rows.length} شحنات</span>
              <Sub>
                {issued ? "فاتورة صادرة" : "مسودة فاتورة"} · <span className="ltr-nums">{dates[0] === dates[dates.length - 1] ? fmtDate(dates[0]) : `${fmtDate(dates[0])} - ${fmtDate(dates[dates.length - 1])}`}</span>
              </Sub>
            </span>
          </span>
        </td>
        <Td>
          <span className="font-medium text-gray-800">{g.rows[0].customer}</span>
          <RouteLine {...splitRoute(routes[0])} />
          {routes.length > 1 && <Sub>و{routes.length - 1} {routes.length - 1 === 1 ? "مسار آخر" : "مسارات أخرى"}</Sub>}
        </Td>
        <Td className="whitespace-nowrap">
          <Sub>{plates > 1 ? `${plates} مركبات` : (g.rows[0].plate ?? g.rows[0].carrier ?? "—")}</Sub>
        </Td>
        {showPrices && (
          <Td className="whitespace-nowrap">
            <span className="ltr-nums font-display font-semibold text-asphalt-900">{fmt(total)}</span> <span className="text-xs text-gray-400">{g.rows[0].w.currencyCode}</span>
            <Sub>قبل الضريبة</Sub>
          </Td>
        )}
        <StatusCell status={st} sub={`${g.rows.length} شحنات في فاتورة واحدة`} />
        {issued ? <NextStepCell note="اكتملت" /> : canIssueInvoice ? <NextStepCell href={href} label="أصدرها" go /> : <NextStepCell note="في مسودة فاتورة" />}
        <EdgeCell tone={st.tone} />
      </tr>,
      ...g.rows.map((r, i) => deskRow(r, { of: key, open: startOpen, last: i === g.rows.length - 1 })),
    ];
  };
  // الخطوة الرئيسية في معاينة الجوال: أول ما ينطبق من هذه، والباقي في «العمليات»
  const PRIMARY = ["إرسال للسائق", "اعتماد الشحنة", "إنشاء فاتورة مسودة", "تم التسليم", "فتح الفاتورة"];
  const openMenu = openDoc ? menu(openDoc.w, openInvoiceId, openRow?.invoice ?? null, openDoc.driverMobile) : [];
  const openPrimary = PRIMARY.map((p) => openMenu.find((i) => i.label.startsWith(p))).find(Boolean);
  const WB_STEPS = ["مسودة", "في الطريق", "مُسلَّمة", "معتمدة", "مفوترة"];
  const mobileSheet = openDoc && (
    <MobileSheet
      closeHref={listUrl()}
      label={`معاينة الشحنة ${openDoc.w.number}`}
      header={
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="ltr-nums font-display text-[17px] font-semibold text-brand-900">{openDoc.w.number}</span>
            {(() => {
              const st = waybillState(openDoc.w.status, openInvoiceId, openRow?.invoiceWaybills ?? 0);
              return <Badge tone={st.tone}>{st.label}</Badge>;
            })()}
          </div>
          <p className="mt-1 truncate text-[13px] text-gray-600">{openDoc.customer}</p>
        </>
      }
      footer={
        <>
          {openPrimary && <ActionButton item={openPrimary} className={sheetPrimary} />}
          <Link href={`/waybills/${openDoc.w.id}`} className={sheetBtn}>
            <Icon name="expand" className="size-4" />
            فتح كاملة
          </Link>
          <ActionsMenu items={openMenu.filter((i) => i !== openPrimary)} label="العمليات" className={sheetBtn} />
        </>
      }
    >
      <SheetTrack
        from={openDoc.from ?? undefined}
        to={openDoc.to ?? undefined}
        steps={WB_STEPS}
        at={openDoc.w.status === "rejected" ? 2 : { draft: 0, in_transit: 1, delivered: 2, approved: 3, invoiced: 4 }[openDoc.w.status]}
        muted={openDoc.w.status === "draft"}
      />
      {openDoc.w.status === "rejected" && openDoc.w.rejectionReason && <p className="mt-3 rounded-xl bg-st-bad-bg px-3 py-2.5 text-[12.5px] text-st-bad-fg">سبب الرفض: {openDoc.w.rejectionReason}</p>}
      {openInvoiceId && (
        <p className="mt-3 rounded-xl bg-st-ok-bg px-3 py-2.5 text-[12.5px] text-st-ok-fg">
          الشحنة في الفاتورة <span className="ltr-nums">{openRow?.invoice}</span>
          {openDoc.w.status === "approved" ? " (مسودة)" : ""}.{" "}
          <Link href={`/invoices?open=${openInvoiceId}`} className="font-semibold underline">
            فتح الفاتورة
          </Link>
        </p>
      )}
      <SheetFacts
        items={[
          ["المركبة", openDoc.plate ? <Plate>{openDoc.plate}</Plate> : (openRow && exec(openRow)) || "—"],
          ["السائق", openDoc.driver ?? openDoc.w.carrierDriverName ?? "—"],
          ["التاريخ", <span key="d" className="ltr-nums">{fmtDate(openDoc.w.waybillDate)}</span>],
          ["الضريبة", openDoc.w.isInternational ? "صفرية · نقل دولي" : "15% · داخلي"],
          ["عمولة السائق", <span key="c" className="ltr-nums">{fmt(openDoc.w.driverCommission)}</span>],
          ["السائق والتطبيق", openDoc.w.execution !== "fleet" ? "ناقل" : openDoc.w.sentToDriverAt ? (openDoc.w.driverAcceptedAt ? "استلمها" : "أُرسلت له") : "لم تُرسل"],
        ]}
      />
      {showPrices && (
        <SheetMoney
          lines={[
            ["قبل الضريبة", fmt(openDoc.w.amount)],
            [`الضريبة ${vatOf(openDoc.w)}%`, fmt((Number(openDoc.w.amount) * vatOf(openDoc.w)) / 100)],
          ]}
          total={["الإجمالي", `${fmt(Number(openDoc.w.amount) * (1 + vatOf(openDoc.w) / 100))} ${openDoc.w.currencyCode}`]}
        />
      )}
      {Number(openDoc.w.tripCustody) > 0 && <p className="mt-3 text-xs text-gray-500">عهدة الرحلة {fmt(openDoc.w.tripCustody)}</p>}
    </MobileSheet>
  );

  // الكمبيوتر: معاينة جانبية فوق القائمة بنفس محتوى معاينة الجوال، وتحته المستند نفسه (قرار أحمد 2026-11-23)
  const deskDrawer = openDoc && (
    <DeskDrawer
      closeHref={listUrl()}
      label={`معاينة الشحنة ${openDoc.w.number}`}
      header={
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-lg font-semibold text-brand-900">
              شحنة <span className="ltr-nums">{openDoc.w.number}</span>
            </span>
            {(() => {
              const st = waybillState(openDoc.w.status, openInvoiceId, openRow?.invoiceWaybills ?? 0);
              return <Badge tone={st.tone}>{st.label}</Badge>;
            })()}
          </div>
          <p className="mt-0.5 truncate text-sm text-gray-600">
            {openDoc.customer} · <span className="ltr-nums">{fmtDate(openDoc.w.waybillDate)}</span>
          </p>
        </>
      }
      footer={
        <>
          {openPrimary && <ActionButton item={openPrimary} className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-brand-900 shadow-sm hover:bg-brand-500 disabled:opacity-60" />}
          <Link href={`/waybills/${openDoc.w.id}`} className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-gray-300 bg-white px-3 text-sm text-gray-700 shadow-sm hover:bg-gray-50">
            <Icon name="expand" className="size-4" />
            فتح كاملة
          </Link>
          {editable(openDoc.w) && (
            <Link href={withParam(listUrl({ open: String(openDoc.w.id) }), "edit", String(openDoc.w.id))} scroll={false} className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-gray-300 bg-white px-3 text-sm text-gray-700 shadow-sm hover:bg-gray-50">
              <Icon name="pencil" className="size-4" />
              تعديل
            </Link>
          )}
          <SendDocument kind="waybills" id={openDoc.w.id} label={`بوليصة شحن رقم ${openDoc.w.number}`} company={company.nameAr} phone={openDoc.customerMobile} email={openDoc.customerEmail} />
          <span className="ms-auto">
            <ActionsMenu items={openMenu} label="العمليات" />
          </span>
        </>
      }
    >
      <SheetTrack
        from={openDoc.from ?? undefined}
        to={openDoc.to ?? undefined}
        steps={WB_STEPS}
        at={openDoc.w.status === "rejected" ? 2 : { draft: 0, in_transit: 1, delivered: 2, approved: 3, invoiced: 4 }[openDoc.w.status]}
        muted={openDoc.w.status === "draft"}
      />
      {openDoc.w.status === "rejected" && openDoc.w.rejectionReason && <p className="mt-3 rounded-xl bg-st-bad-bg px-3 py-2.5 text-sm text-st-bad-fg">سبب الرفض: {openDoc.w.rejectionReason}</p>}
      {openInvoiceId && (
        <p className="mt-3 rounded-xl bg-st-ok-bg px-3 py-2.5 text-sm text-st-ok-fg">
          الشحنة في الفاتورة <span className="ltr-nums">{openRow?.invoice}</span>
          {openDoc.w.status === "approved" ? " (مسودة)" : ""}.{" "}
          <Link href={`/invoices?open=${openInvoiceId}`} className="font-semibold underline">
            فتح الفاتورة
          </Link>
        </p>
      )}
      <SheetFacts
        items={[
          ["المسار", `${openDoc.from ?? ""} ← ${openDoc.to ?? ""} (${openDoc.w.isInternational ? "دولي، ضريبة صفرية" : "داخلي، ضريبة 15%"})`],
          ["المركبة", openDoc.plate ? <Plate>{openDoc.plate}</Plate> : (openRow && exec(openRow)) || "—"],
          ["السائق", openDoc.driver ?? openDoc.w.carrierDriverName ?? "—"],
          ["عمولة السائق", <span key="c" className="ltr-nums">{fmt(openDoc.w.driverCommission)}</span>],
          ["عهدة الرحلة", <span key="t" className="ltr-nums">{Number(openDoc.w.tripCustody) > 0 ? fmt(openDoc.w.tripCustody) : "—"}</span>],
          ["السائق والتطبيق", openDoc.w.execution !== "fleet" ? "ناقل" : openDoc.w.sentToDriverAt ? (openDoc.w.driverAcceptedAt ? "استلمها" : "أُرسلت له") : "لم تُرسل"],
          ...(openDoc.w.logistiNumber ? [["رقم لوجستي", openDoc.w.logistiNumber] as [string, string]] : []),
        ]}
      />
      {showPrices && (
        <SheetMoney
          lines={[
            ["قبل الضريبة", fmt(openDoc.w.amount)],
            [`الضريبة ${vatOf(openDoc.w)}%`, fmt((Number(openDoc.w.amount) * vatOf(openDoc.w)) / 100)],
          ]}
          total={["الإجمالي", `${fmt(Number(openDoc.w.amount) * (1 + vatOf(openDoc.w) / 100))} ${openDoc.w.currencyCode}`]}
        />
      )}
      <div className="mt-5 rounded-2xl bg-gray-100/70 p-3 shadow-inner">
        <div className="mb-3 flex items-center gap-2">
          {(
            [
              ["waybill", "البوليصة"],
              ["transport", "وثيقة النقل"],
            ] as const
          ).map(([k, l]) => (
            <Link
              key={k}
              href={k === "transport" ? withParam(listUrl({ open: String(openDoc.w.id) }), "doc", "transport") : listUrl({ open: String(openDoc.w.id) })}
              scroll={false}
              replace
              className={`rounded-full px-3 py-1 text-sm ${docVariant === k ? "bg-asphalt-900 font-semibold text-brand-500" : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"}`}
            >
              {l}
            </Link>
          ))}
        </div>
        <WaybillDocument company={company} doc={openDoc} template={template} compact variant={docVariant} />
      </div>
    </DeskDrawer>
  );

  return (
    <>
      <PageHeader title="الشحنات" description="كل شحنة رحلة واحدة. السعر من العقد الساري والعمولة من المسار تلقائياً، والضريبة من المسار (الدولي صفري والداخلي 15%)، والقيد يُرحّل عند الاعتماد.">
        {canCreate && !bulkAdding && (
          <Link href="/waybills/driver-requests" className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50">
            رحلات بدأها السائقون
            {pendingRequests > 0 && <span className="ltr-nums rounded-full bg-amber-100 px-1.5 text-xs font-semibold text-amber-900">{pendingRequests}</span>}
          </Link>
        )}
        {canCreate && !bulkAdding && (
          <Link href={withParam(listUrl(), "new", "1")} scroll={false} className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-brand-900 shadow-sm transition hover:bg-brand-500">
            + إنشاء
          </Link>
        )}
      </PageHeader>

      {bulkAdding ? (
        <>
          <AddModeBar backHref={BASE} backLabel="الشحنات" title="إدخال عدة شحنات" />
          <Card className="mb-6">
            <SheetEditor
              templateName="الشحنات"
              action={saveWaybills}
              initialRows={4}
              columns={[
                { key: "date", label: "التاريخ", type: "date", placeholder: today },
                { key: "customerId", label: "العميل", type: "select", required: true, options: customers, width: "11rem", create: "customer" },
                { key: "routeId", label: "المسار", type: "select", required: true, options: routes, width: "13rem", create: "route" },
                { key: "vehicleId", label: "المركبة", type: "select", options: vehicles, width: "8rem", create: "vehicle" },
                ...(trailers.length ? [{ key: "trailerId", label: "المقطورة", type: "select" as const, options: trailers, width: "8rem" }] : []),
                { key: "driverId", label: "السائق", type: "select", options: drivers, width: "9rem", create: "driver", autoVehicle: { key: "vehicleId", dateKey: "date" } },
                { key: "carrierId", label: "أو ناقل خارجي", type: "select", options: carriers, width: "9rem", create: "carrier" },
                { key: "carrierCost", label: "تكلفة الناقل", type: "number", width: "6rem" },
                { key: "shipper", label: "المرسل", required: true, width: "10rem", suggest: shippers },
                { key: "consignee", label: "المستلم", required: true, width: "10rem", suggest: shippers },
                ...(showPrices ? [{ key: "amount", label: "المبلغ", type: "number" as const, width: "6rem", placeholder: "من العقد" }] : []),
                ...(showPrices
                  ? [1, 2, 3].flatMap((n) => [
                      { key: `comp${n}`, label: `مكون السعر ${n}`, type: "select" as const, options: componentKinds, width: "9rem" },
                      { key: `comp${n}Qty`, label: `كمية ${n}`, type: "number" as const, width: "4.5rem", placeholder: "1" },
                      { key: `comp${n}Price`, label: `سعر المكون ${n}`, type: "number" as const, width: "6rem" },
                    ])
                  : []),
                { key: "taxCodeId", label: "نوع الضريبة", type: "select", options: taxes, width: "12rem", placeholder: "حسب المسار" },
                { key: "commission", label: "عمولة السائق", type: "number", width: "6rem", placeholder: "من المسار" },
                { key: "tripCustody", label: "عهدة الرحلة", type: "number", width: "6rem" },
                { key: "carrierPlate", label: "لوحة الناقل", width: "7rem" },
                { key: "carrierDriver", label: "سائق الناقل", width: "8rem" },
                { key: "deliveryAddress", label: "عنوان التسليم", width: "10rem" },
                { key: "weight", label: "الوزن (طن)", type: "number", width: "5rem" },
                { key: "container", label: "رقم الحاوية", ltr: true, width: "7rem" },
                { key: "deliveryNote", label: "رقم مذكرة التسليم", ltr: true, width: "7rem" },
                { key: "customs", label: "رقم البيان الجمركي", ltr: true, width: "7rem" },
                // مصاريف على العميل (حتى ثلاثة): دفعتها الشركة من حساب أو المخلص؛ ما دفعه السائق من إيصاله فقط
                ...[1, 2, 3].flatMap((n) => [
                  { key: `charge${n}`, label: `مصروف على العميل ${n}`, type: "select" as const, options: chargeTypes, width: "9rem" },
                  { key: `charge${n}Amount`, label: `مبلغ المصروف ${n}`, type: "number" as const, width: "6rem" },
                  {
                    key: `charge${n}From`,
                    label: `دفعه ${n}`,
                    type: "select" as const,
                    width: "12rem",
                    options: [...brokers.map((b) => ({ value: `b:${b.value}`, label: `المخلص: ${b.label}` })), ...chargeCash.map((a) => ({ value: `a:${a.value}`, label: a.label, code: a.code }))],
                  },
                ]),
                { key: "notes", label: "ملاحظات", width: "9rem" },
              ]}
            />
            <p className="mt-2 text-xs text-gray-500">
              اكتب أول حروف العميل أو المسار أو المركبة لتظهر النتائج، أو اختر «+ إضافة» لإضافة جديد دون مغادرة الصفحة. اترك السائق فارغاً ليؤخذ السائق المسند للمركبة في تاريخ الرحلة. مصاريف العميل هنا ما دفعته الشركة أو المخلص؛ ما دفعه السائق من عهدته يُحمَّل من إيصاله.
            </p>
          </Card>
        </>
      ) : (
        <>
          <StatusTabs
            label="حالة الشحنات"
            tabs={TABS.map((t) => ({
              key: t.key,
              label: t.label,
              href: listUrl({ status: t.key || undefined, open: undefined, page: undefined }),
              count: counts[t.key || "all"] ?? 0,
              attn: ATTN.includes(t.key),
              active: (lp.status ?? "") === t.key,
            }))}
            summary={
              listTotal.n > 0 && showPrices ? (
                <>
                  الإجمالي قبل الضريبة <b className="ltr-nums font-display text-sm font-semibold text-asphalt-900">{fmt(listTotal.amount)}</b>
                </>
              ) : null
            }
          />

          <DocToolbar
            base={BASE}
            params={lp}
            statuses={{}}
            exportName="الشحنات"
            count={listTotal.n}
            noun="شحنة"
            pay={false}
            sorts={WAYBILL_SORTS}
            exportable={false}
            placeholder="ابحث برقم الشحنة أو العميل أو المرسل أو اللوحة أو المدينة أو المبلغ"
            extra={
              <>
                {view !== "sheet" && rows.length > 0 && (
                  <span className="max-md:hidden">
                    <BulkPdfButton kind="waybills" ids={rows.map((r) => r.w.id)} />
                  </span>
                )}
                <ActionsMenu items={pageMenu} />
              </>
            }
          />

          {view === "sheet" ? (
            <>
            <DocSheet
              action={saveWaybillSheet}
              emptyText={filtered ? "لا توجد شحنات بهذه الشروط" : "لا توجد شحنات بعد"}
              columns={[
                { key: "status", label: "الحالة", type: "badge", width: "6rem" },
                { key: "number", label: "الرقم", ltr: true, width: "8rem" },
                { key: "date", label: "التاريخ", type: "date", editable: true, width: "8.5rem" },
                { key: "customerId", label: "العميل", type: "select", editable: true, options: customers, create: "customer", width: "11rem" },
                { key: "routeId", label: "المسار", type: "select", editable: true, options: routes, create: "route", width: "12rem" },
                { key: "tax", label: "الضريبة", width: "6rem" },
                { key: "vehicleId", label: "المركبة", type: "select", editable: true, options: vehicles, create: "vehicle", width: "8rem" },
                { key: "driverId", label: "السائق", type: "select", editable: true, options: drivers, create: "driver", width: "9rem", autoVehicle: { key: "vehicleId", dateKey: "date" } },
                { key: "shipper", label: "المرسل", editable: true, width: "10rem" },
                { key: "consignee", label: "المستلم", editable: true, width: "10rem" },
                ...(showPrices ? [{ key: "amount", label: "المبلغ", type: "number" as const, editable: true, width: "6.5rem" }] : []),
                { key: "commission", label: "عمولة السائق", type: "number", editable: true, width: "6.5rem" },
                { key: "carrierCost", label: "تكلفة الناقل", type: "number", editable: true, width: "6.5rem" },
                { key: "weight", label: "الوزن (طن)", type: "number", editable: true, width: "5.5rem" },
                { key: "container", label: "رقم الحاوية", ltr: true, editable: true, width: "7rem" },
                { key: "deliveryNote", label: "رقم سند التسليم", ltr: true, editable: true, width: "7rem" },
                { key: "notes", label: "ملاحظات", editable: true, width: "12rem" },
              ]}
              rows={rows.map((r): DocSheetRow => {
                const { w } = r;
                return {
                  id: w.id,
                  href: withParam(listUrl(), "edit", String(w.id)),
                  editable: editable(w),
                  cells: {
                    number: w.number,
                    date: w.waybillDate,
                    customerId: String(w.customerId),
                    routeId: String(w.routeId),
                    tax: w.isInternational ? "دولي · صفر" : "داخلي · 15%",
                    vehicleId: w.execution === "fleet" ? String(w.vehicleId ?? "") : "",
                    driverId: w.execution === "fleet" ? String(w.driverId ?? "") : "",
                    shipper: w.shipper,
                    consignee: w.consignee,
                    amount: showPrices ? w.amount : null,
                    commission: w.driverCommission,
                    carrierCost: w.execution === "carrier" ? w.carrierCost : null,
                    weight: w.weightTons,
                    container: w.containerNumber,
                    deliveryNote: w.deliveryNoteNumber,
                    notes: w.notes,
                  },
                  badges: { status: w.status === "approved" ? waybillState(w.status, r.invoiceId, r.invoiceWaybills) : { label: WAYBILL_STATUS[w.status].label, tone: SHEET_TONE[w.status] } },
                };
              })}
            />
            <Pager page={page} size={PAGE_SIZE} total={listTotal.n} hrefFor={(p) => listUrl({ page: p > 1 ? String(p) : undefined })} />
            </>
          ) : (
            <>
              {mobileList}
              {mobileSheet}
              <div className="max-md:hidden">
              {(canUpdate || canApprove || canInvoice) && (
                <ActionForm id={BULK_FORM} action={bulkWaybillOps} resetOnSuccess={false}>
                  <input type="hidden" name="op" defaultValue="" />
                  <SelectionGate form={BULK_FORM} empty={null}>
                    <BulkBar>
                      <SelectionTotal form={BULK_FORM} noun="شحنة" />
                      <span className="mx-1 h-6 w-px bg-white/15" aria-hidden />
                      {canUpdate && (
                        <ConfirmSubmit
                          op="send_driver"
                          className="!py-1.5"
                          title="إرسال الشحنات المحددة للسائقين"
                          text="تظهر كل رحلة في تطبيق سائقها، وما عليه عهدة رحلة تُصرف له بسند عهدة من الحساب المختار. ما أُرسل من قبل لا يُعاد إرساله."
                          submit="إرسال"
                          fields={cashField}
                        >
                          إرسال للسائق
                        </ConfirmSubmit>
                      )}
                      {canApprove && (
                        <SubmitButton op="approved" variant="secondary" pendingLabel="جارٍ الاعتماد…" className="!py-1.5">
                          اعتماد
                        </SubmitButton>
                      )}
                      {(canInvoice || canIssueInvoice) && (
                        <span className="flex flex-wrap items-center gap-1.5 rounded-lg bg-white/10 p-1 ps-2">
                          <DateInput name="invoiceDate" defaultValue={today} aria-label="تاريخ الفاتورة" title="تاريخ الفاتورة" className="h-8 w-32 rounded-md border border-white/10 bg-white px-2 text-sm text-gray-800" />
                          {canInvoice && (
                            <SubmitButton op="merge" variant="secondary" pendingLabel="جارٍ الدمج…" className="!py-1.5">
                              دمج المحدد
                            </SubmitButton>
                          )}
                          {canIssueInvoice && (
                            <ConfirmSubmit
                              op="invoice"
                              className="!py-1.5"
                              title="فوترة الشحنات المحددة"
                              text="تصدر فاتورة كل شحنة ويُرحّل قيد الإيراد والضريبة. الشحنة المدمجة تصدر فاتورتها المسودة بكل ما فيها، وغير المدمجة تأخذ فاتورة مستقلة. لجمع عدة شحنات في فاتورة واحدة اضغط «دمج المحدد» أولاً."
                              submit="فوترة"
                            >
                              فوترة المحدد
                            </ConfirmSubmit>
                          )}
                        </span>
                      )}
                      {canUpdate && (
                        <details data-dropdown className="relative">
                          <summary className="flex cursor-pointer list-none items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 shadow-sm hover:bg-gray-50">
                            تغيير الحالة
                            <span aria-hidden className="text-xs text-gray-400">▴</span>
                          </summary>
                          <div className="absolute start-0 bottom-full z-30 mb-2 flex w-52 flex-col rounded-xl border border-gray-200 bg-white p-1 text-gray-800 shadow-lg">
                            {(["in_transit", "delivered", "draft"] as const).map((op) => (
                              <SubmitButton key={op} op={op} variant="secondary" className="!justify-start !border-0 !text-start !shadow-none">
                                {op === "draft" ? "إرجاع إلى مسودة" : `إلى «${WAYBILL_STATUS[op].label}»`}
                              </SubmitButton>
                            ))}
                            <ConfirmSubmit
                              op="unsend_driver"
                              className="!justify-start !border-0 !text-start !shadow-none"
                              title="إلغاء إرسال الشحنات المحددة"
                              text="تُسحب كل رحلة من تطبيق سائقها ويُعكس سند عهدتها، فتصبح قابلة للتعديل والحذف. ما سجّل عليه السائق تحميلاً أو تسليماً أو مصروفاً لا يُلغى."
                              submit="إلغاء الإرسال"
                            >
                              إلغاء الإرسال للسائق
                            </ConfirmSubmit>
                            {can(user.perms, "sales_invoices", "update") && (
                              <ConfirmSubmit
                                op="unmerge"
                                className="!justify-start !border-0 !text-start !shadow-none"
                                title="فك دمج الشحنات المحددة"
                                text="تخرج كل شحنة محددة من فاتورتها المسودة وتعود «معتمدة · بانتظار الفوترة». المسودة التي لا يبقى فيها شيء تُحذف. الفواتير الصادرة لا تتأثر."
                                submit="فك الدمج"
                              >
                                فك الدمج
                              </ConfirmSubmit>
                            )}
                          </div>
                        </details>
                      )}
                      {canOverride && <input name="overrideReason" placeholder="سبب التجاوز عند الاعتماد (اختياري)" className="h-9 w-56 rounded-lg border border-white/10 bg-white px-2.5 text-sm text-gray-800" />}
                    </BulkBar>
                  </SelectionGate>
                </ActionForm>
              )}
              <Table head={[(canUpdate || canApprove || canInvoice) && rows.length ? <SelectAll key="all" form={BULK_FORM} /> : "", "الشحنة", "العميل والمسار", "التنفيذ", ...(showPrices ? ["المبلغ"] : []), "الحالة", "الخطوة التالية", ""]}>
                {rows.length === 0 && <EmptyRow cols={showPrices ? 8 : 7}>{filtered ? "لا توجد شحنات بهذه الشروط" : "لا توجد شحنات بعد؛ اضغط «إنشاء»"}</EmptyRow>}
                {items.map((it) => (it.kind === "one" ? deskRow(it.row) : deskGroup(it)))}
              </Table>
              <Pager page={page} size={PAGE_SIZE} total={listTotal.n} hrefFor={(p) => listUrl({ page: p > 1 ? String(p) : undefined, open: undefined })} />
              </div>
              {deskDrawer}
            </>
          )}
        </>
      )}

      {initial && (
        <WaybillEditor
          key={editing ? `edit-${editId}` : "new"}
          title={editing ? `تعديل الشحنة ${initial.number}` : "شحنة جديدة"}
          initial={initial}
          customers={customers}
          routes={routes}
          vehicles={vehicles}
          trailers={trailers}
          drivers={drivers}
          carriers={carriers}
          shippers={shippers}
          contacts={contacts}
          cities={cities}
          showPrices={showPrices}
          componentKinds={componentKinds}
          taxes={taxes}
          chargeTypes={chargeTypes}
          brokers={brokers}
          payees={payees}
          cashAccounts={chargeCash}
          company={company}
          template={template}
          action={saveWaybillPanel.bind(null, editing ? editId : null)}
          closeHref={prefill ? "/waybills/driver-requests" : back}
          savedHref={returnTo}
          fromRequest={prefill ? { id: prefill.id, driver: prefill.driver, canFinish: canApprove && canIssueInvoice } : undefined}
        />
      )}
      {transportOpen && transportDoc && (
        <TransportPanel
          key={`transport-${transportDoc.w.id}`}
          doc={transportDoc}
          initial={toTransportDraft(transportDoc.w, transportDoc.goods)}
          cities={cities}
          company={company}
          template={template}
          action={saveTransportPanel.bind(null, transportDoc.w.id)}
          closeHref={withParam(listUrl({ open: String(transportDoc.w.id) }), "doc", "transport")}
        />
      )}
    </>
  );
}
