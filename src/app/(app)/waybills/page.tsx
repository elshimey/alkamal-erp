import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can, hasSpecial, scopeFor } from "@/lib/permissions";
import { customerOptions, driverOptions, locationOptions, partyOptions, shipperSuggestions, vehicleOptions } from "@/lib/lookups";
import { getCompany, getInvoiceTemplate } from "@/lib/company";
import { todayRiyadh } from "@/lib/dates";
import { listHref, type DocListParams } from "@/lib/doc-filters";
import { fmt } from "@/lib/format";
import { EDITABLE, listWaybills, parseWaybillFilter, waybillDoc } from "@/lib/waybills";
import { WAYBILL_SORTS, WAYBILL_STATUS, type WaybillStatus } from "@/data/waybills";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { ActionsMenu, type MenuItem } from "@/components/actions-menu";
import { BulkPdfButton } from "@/components/bulk-pdf";
import { ClickRow } from "@/components/click-row";
import { DateInput } from "@/components/date-input";
import { DocSheet, type DocSheetRow } from "@/components/doc-sheet";
import { DocToolbar } from "@/components/doc-toolbar";
import { Icon } from "@/components/icons";
import { RowCheck, SelectAll, SelectionTotal } from "@/components/row-selection";
import { SendDocument } from "@/components/send-document";
import { SheetEditor } from "@/components/sheet-editor";
import { AddModeBar } from "@/components/list-actions";
import { Badge, Card, EmptyRow, LimitRow, PageHeader, Table, Td } from "@/components/ui";
import { WaybillDocument } from "@/components/waybill-document";
import { bulkWaybillOps, copyWaybill, invoiceOne, rejectWaybillAction, removeWaybillAction, saveWaybillPanel, saveWaybills, saveWaybillSheet, waybillToStatus } from "./actions";
import { WaybillEditor, type RouteOption, type WaybillDraft } from "./waybill-editor";

const BASE = "/waybills";
const BULK_FORM = "waybill-bulk";
const LIMIT = 500;

const TABS: { key: string; label: string }[] = [
  { key: "", label: "الكل" },
  { key: "draft", label: "مسودة" },
  { key: "in_transit", label: "في الطريق" },
  { key: "delivered", label: "مُسلَّمة" },
  { key: "pending_invoice", label: "بانتظار الفوترة" },
  { key: "approved", label: "معتمدة" },
  { key: "invoiced", label: "مفوترة" },
  { key: "rejected", label: "مرفوضة" },
];

const SHEET_TONE: Record<WaybillStatus, "gray" | "green" | "blue" | "amber" | "red"> = {
  draft: "gray",
  in_transit: "blue",
  delivered: "amber",
  approved: "green",
  invoiced: "green",
  rejected: "red",
};

const withParam = (url: string, key: string, value: string) => `${url}${url.includes("?") ? "&" : "?"}${key}=${value}`;
const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";

type Params = DocListParams & { new?: string; add?: string; edit?: string };

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
  const canOverride = hasSpecial(user.perms, "override_controls");
  const view = sp.view === "sheet" ? "sheet" : "table";
  const lp: DocListParams = { q: sp.q, status: sp.status, period: sp.period, sort: sp.sort, view: sp.view };
  const bulkAdding = sp.add === "1" && canCreate;
  const creating = sp.new === "1" && canCreate;
  const openId = view === "table" ? Number(sp.open) || null : null;
  const editId = canUpdate ? Number(sp.edit) || null : null;
  const filter = { ...parseWaybillFilter(sp, today), driverUserId: scopeFor(user.perms, "waybills", "view") === "own" ? user.id : undefined };

  const [{ rows, counts }, openDoc, editRow, company, template] = await Promise.all([
    listWaybills(db, filter, LIMIT),
    openId ? waybillDoc(db, openId) : Promise.resolve(null),
    editId ? db.select().from(s.waybills).where(eq(s.waybills.id, editId)).then((r) => r[0] ?? null) : Promise.resolve(null),
    getCompany(db),
    getInvoiceTemplate(db),
  ]);
  const editing = !!editRow && EDITABLE.includes(editRow.status);
  const needOptions = view === "sheet" || creating || editing || bulkAdding;
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
  const menu = (w: Row["w"], invoiceId: number | null, invoice: string | null): MenuItem[] => {
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
    if (canApprove && (st === "draft" || st === "in_transit" || st === "delivered"))
      items.push({
        label: "رفض وإرجاعها للسائق",
        icon: "ban",
        action: rejectWaybillAction.bind(null, w.id),
        confirm: {
          title: `رفض الشحنة ${w.number}`,
          text: "تعود الشحنة للسائق بالسبب ليصحح بياناتها.",
          submit: "رفض",
          fields: (
            <label className="block text-sm">
              <span className="mb-1 block text-gray-600">سبب الرفض</span>
              <input name="reason" required className={inputCls} />
            </label>
          ),
        },
      });
    if (st === "approved" && !invoiceId && canInvoice)
      items.push({
        label: "فوترة الشحنة",
        icon: "invoice",
        hint: "فاتورة مسودة تراجعها ثم تعتمدها",
        divider: true,
        action: invoiceOne.bind(null, w.id),
        confirm: {
          title: `فوترة الشحنة ${w.number}`,
          text: "تُنشأ فاتورة مبيعات مسودة بهذه الشحنة. لفوترة عدة شحنات معاً حددها من الجدول واختر «فوترة المحدد».",
          submit: "إنشاء الفاتورة",
          fields: (
            <label className="block text-sm">
              <span className="mb-1 block text-gray-600">تاريخ الفاتورة</span>
              <DateInput name="invoiceDate" defaultValue={today} required className={inputCls} />
            </label>
          ),
        },
      });
    if (invoiceId) items.push({ label: `فتح الفاتورة ${invoice ?? ""}`, icon: "invoice", hint: st === "approved" ? "مسودة؛ منها تُخرج الشحنة أو تفك الدمج" : undefined, href: `/invoices?open=${invoiceId}`, divider: true });
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
    items.push({ label: "التفاصيل الكاملة", icon: "document", hint: "المراحل والديزل والمصاريف", href: `/waybills/${w.id}`, divider: true });
    if (canCreate) items.push({ label: "نسخ الشحنة", icon: "copy", hint: "شحنة جديدة مسودة بتاريخ اليوم", action: copyWaybill.bind(null, w.id, listUrl()) });
    items.push({ label: "طباعة البوليصة", icon: "printer", href: `/print/waybills?ids=${w.id}&print=1`, newTab: true });
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
        deliveryAddress: str(w.deliveryAddress),
        amount: showPrices ? String(Number(w.amount)) : "",
        commission: String(Number(w.driverCommission)),
        weight: w.weightTons != null ? String(Number(w.weightTons)) : "",
        container: str(w.containerNumber),
        deliveryNote: str(w.deliveryNoteNumber),
        customs: str(w.customsDeclaration),
        notes: str(w.notes),
        priceNote: w.priceNote,
      };
    }
    if (creating)
      return { date: today, customerId: "", routeId: "", execution: "fleet", vehicleId: "", trailerId: "", driverId: "", carrierId: "", carrierCost: "", carrierPlate: "", carrierDriverName: "", shipper: "", consignee: "", deliveryAddress: "", amount: "", commission: "", weight: "", container: "", deliveryNote: "", customs: "", notes: "" };
    return null;
  };
  const initial = draft();
  const returnTo = view === "sheet" ? listUrl() : listUrl({ open: "{id}" }).replace("%7Bid%7D", "{id}");
  const total = rows.reduce((t, r) => t + Number(r.w.amount), 0);
  const filtered = !!(filter.q || filter.tab || filter.from);
  const openRow = openDoc ? rows.find((r) => r.w.id === openDoc.w.id) : undefined;
  const openInvoiceId = openRow?.invoiceId ?? null;
  const vatOf = (w: Row["w"]) => (w.isInternational ? 0 : 15);
  const exec = (r: Row) => r.plate ?? (r.carrier ? `${r.carrier} (ناقل)` : "—");

  return (
    <>
      <PageHeader title="الشحنات" description="كل شحنة رحلة واحدة. السعر من العقد الساري والعمولة من المسار تلقائياً، والضريبة من المسار (الدولي صفري والداخلي 15%)، والقيد يُرحّل عند الاعتماد.">
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
                { key: "driverId", label: "السائق", type: "select", options: drivers, width: "9rem", create: "driver" },
                { key: "carrierId", label: "أو ناقل خارجي", type: "select", options: carriers, width: "9rem", create: "carrier" },
                { key: "carrierCost", label: "تكلفة الناقل", type: "number", width: "6rem" },
                { key: "shipper", label: "المرسل", required: true, width: "10rem", suggest: shippers },
                { key: "consignee", label: "المستلم", required: true, width: "10rem", suggest: shippers },
                ...(showPrices ? [{ key: "amount", label: "المبلغ", type: "number" as const, width: "6rem", placeholder: "من العقد" }] : []),
                { key: "commission", label: "عمولة السائق", type: "number", width: "6rem", placeholder: "من المسار" },
                { key: "weight", label: "الوزن (طن)", type: "number", width: "5rem" },
                { key: "container", label: "رقم الحاوية", ltr: true, width: "7rem" },
                { key: "notes", label: "ملاحظات", width: "9rem" },
              ]}
            />
            <p className="mt-2 text-xs text-gray-500">
              اكتب أول حروف العميل أو المسار أو المركبة لتظهر النتائج، أو اختر «+ إضافة» لإضافة جديد دون مغادرة الصفحة. اترك السائق فارغاً ليؤخذ السائق المسند للمركبة في تاريخ الرحلة.
            </p>
          </Card>
        </>
      ) : (
        <>
          <nav className="mb-3 flex flex-wrap gap-2 text-sm">
            {TABS.map((t) => {
              const active = (lp.status ?? "") === t.key;
              const n = counts[t.key || "all"] ?? 0;
              return (
                <Link
                  key={t.key || "all"}
                  href={listUrl({ status: t.key || undefined, open: undefined })}
                  scroll={false}
                  className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 transition ${active ? "bg-asphalt-900 font-semibold text-brand-500" : "bg-white text-gray-600 shadow-sm hover:bg-brand-50"} ${t.key === "pending_invoice" && n > 0 && !active ? "ring-1 ring-brand-500" : ""}`}
                >
                  {t.label}
                  <span className={`ltr-nums rounded-full px-1.5 text-xs ${active ? "bg-white/10" : "bg-gray-100"}`}>{n}</span>
                </Link>
              );
            })}
          </nav>

          <DocToolbar
            base={BASE}
            params={lp}
            statuses={{}}
            exportName="الشحنات"
            count={rows.length}
            noun="شحنة"
            pay={false}
            sorts={WAYBILL_SORTS}
            exportable={false}
            placeholder="ابحث برقم الشحنة أو العميل أو المرسل أو اللوحة أو المدينة أو المبلغ"
            extra={<ActionsMenu items={pageMenu} />}
          />

          {view === "sheet" ? (
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
                { key: "driverId", label: "السائق", type: "select", editable: true, options: drivers, create: "driver", width: "9rem" },
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
                  badges: { status: { label: WAYBILL_STATUS[w.status].label, tone: SHEET_TONE[w.status] } },
                };
              })}
            />
          ) : openDoc ? (
            <div className="grid items-start gap-4 lg:grid-cols-[minmax(17rem,22rem)_1fr]">
              <ul className="hidden max-h-[calc(100vh-9rem)] divide-y divide-gray-100 overflow-y-auto rounded-2xl border border-black/[0.06] bg-white shadow-sm lg:sticky lg:top-4 lg:block print:hidden">
                {rows.map(({ w, customer }) => (
                  <li key={w.id}>
                    <Link
                      href={listUrl({ open: String(w.id) })}
                      scroll={false}
                      className={`block border-s-4 px-4 py-3 transition ${w.id === openId ? "border-brand-500 bg-brand-50/70" : "border-transparent hover:bg-gray-50"}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="line-clamp-1 text-sm font-semibold text-gray-800">{customer}</span>
                        {showPrices && <span className="ltr-nums shrink-0 text-sm font-semibold text-brand-900">{fmt(w.amount)}</span>}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
                        <span className="ltr-nums whitespace-nowrap">{w.number}</span>
                        <span className="text-gray-300">|</span>
                        <span className="ltr-nums whitespace-nowrap">{w.waybillDate}</span>
                        <span className="ms-auto">
                          <Badge tone={WAYBILL_STATUS[w.status].tone}>{WAYBILL_STATUS[w.status].label}</Badge>
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>

              <section className="animate-flyout min-w-0 rounded-2xl bg-gray-100/70 shadow-inner">
                <div className="flex flex-wrap items-center gap-3 rounded-t-2xl border-b border-gray-200 bg-white px-5 py-3">
                  <Link href={listUrl()} scroll={false} aria-label="إغلاق المعاينة" title="إغلاق" className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100">
                    <Icon name="close" className="size-4" />
                  </Link>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-display text-lg font-semibold text-brand-900">
                        شحنة <span className="ltr-nums">{openDoc.w.number}</span>
                      </span>
                      <Badge tone={WAYBILL_STATUS[openDoc.w.status].tone}>{WAYBILL_STATUS[openDoc.w.status].label}</Badge>
                      {openDoc.w.status === "approved" && !openInvoiceId && <Badge tone="amber">بانتظار الفوترة</Badge>}
                    </div>
                    <div className="text-xs text-gray-500">
                      {openDoc.customer} · {openDoc.from} ← {openDoc.to} · {openDoc.w.isInternational ? "دولي، ضريبة صفرية" : "داخلي، ضريبة 15%"}
                    </div>
                  </div>
                  <div className="ms-auto flex flex-wrap items-center gap-2">
                    {editable(openDoc.w) && (
                      <Link href={withParam(listUrl({ open: String(openDoc.w.id) }), "edit", String(openDoc.w.id))} scroll={false} className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50">
                        <Icon name="pencil" className="size-4" />
                        تعديل
                      </Link>
                    )}
                    <SendDocument kind="waybills" id={openDoc.w.id} label={`بوليصة شحن رقم ${openDoc.w.number}`} company={company.nameAr} phone={openDoc.customerMobile} email={openDoc.customerEmail} />
                    <ActionsMenu items={menu(openDoc.w, openInvoiceId, openRow?.invoice ?? null)} label="العمليات" />
                  </div>
                </div>
                {openDoc.w.status === "rejected" && openDoc.w.rejectionReason && <p className="border-b border-red-100 bg-red-50 px-5 py-2 text-sm text-red-800">سبب الرفض: {openDoc.w.rejectionReason}</p>}
                {openInvoiceId && (
                  <p className="border-b border-green-100 bg-green-50 px-5 py-2 text-sm text-green-800">
                    الشحنة في الفاتورة {openRow?.invoice}
                    {openDoc.w.status === "approved" ? " (مسودة)" : ""}.{" "}
                    <Link href={`/invoices?open=${openInvoiceId}`} className="font-semibold underline">
                      فتح الفاتورة
                    </Link>
                  </p>
                )}
                {showPrices && (
                  <div className="ltr-nums grid grid-cols-2 gap-3 border-b border-gray-200 bg-white px-5 py-3 text-sm sm:grid-cols-4">
                    <span>
                      <span className="block text-xs text-gray-500">المبلغ قبل الضريبة</span>
                      {fmt(openDoc.w.amount)} <span className="text-xs text-gray-400">{openDoc.w.currencyCode}</span>
                    </span>
                    <span>
                      <span className="block text-xs text-gray-500">الضريبة {vatOf(openDoc.w)}%</span>
                      {fmt((Number(openDoc.w.amount) * vatOf(openDoc.w)) / 100)}
                    </span>
                    <span className="font-semibold">
                      <span className="block text-xs font-normal text-gray-500">الإجمالي</span>
                      {fmt(Number(openDoc.w.amount) * (1 + vatOf(openDoc.w) / 100))}
                    </span>
                    <span className="text-xs text-gray-500">{openDoc.w.priceNote}</span>
                  </div>
                )}
                <div className="p-4 sm:p-6">
                  <div className="mx-auto max-w-3xl">
                    <WaybillDocument company={company} doc={openDoc} template={template} compact />
                  </div>
                </div>
              </section>
            </div>
          ) : (
            <>
              {(canUpdate || canApprove || canInvoice) && (
                <ActionForm id={BULK_FORM} action={bulkWaybillOps} resetOnSuccess={false} className="mb-3 flex flex-wrap items-center gap-3 rounded-2xl bg-white px-4 py-2.5 shadow-sm">
                  <SelectionTotal form={BULK_FORM} noun="شحنة" />
                  <select name="op" required defaultValue="" aria-label="العملية على المحدد" className="h-9 rounded-lg border border-gray-200 bg-white px-2.5 text-sm shadow-sm">
                    <option value="" disabled>
                      اختر العملية…
                    </option>
                    {canInvoice && <option value="invoice">فوترة المحدد (فاتورة مسودة لكل عميل)</option>}
                    <optgroup label="نقل الحالة إلى">
                      {canUpdate && <option value="in_transit">في الطريق</option>}
                      {canUpdate && <option value="delivered">مُسلَّمة</option>}
                      {canApprove && <option value="approved">معتمدة</option>}
                      {canUpdate && <option value="draft">مسودة</option>}
                    </optgroup>
                  </select>
                  {canInvoice && (
                    <label className="flex items-center gap-1.5 text-xs text-gray-500">
                      تاريخ الفاتورة
                      <DateInput name="invoiceDate" defaultValue={today} className="h-9 w-36 rounded-lg border border-gray-200 px-2 text-sm" />
                    </label>
                  )}
                  {canOverride && <input name="overrideReason" placeholder="سبب التجاوز عند الاعتماد (اختياري)" className="h-9 w-56 rounded-lg border border-gray-200 px-2.5 text-sm" />}
                  <SubmitButton variant="secondary">تنفيذ على المحدد</SubmitButton>
                  <span className="ms-auto">
                    <BulkPdfButton kind="waybills" ids={rows.map((r) => r.w.id)} />
                  </span>
                </ActionForm>
              )}
              <Table head={[(canUpdate || canApprove || canInvoice) && rows.length ? <SelectAll key="all" form={BULK_FORM} /> : "", "الرقم", "التاريخ", "العميل", "المسار", "نوع الشحن", "المنفّذ", "السائق", ...(showPrices ? ["المبلغ"] : []), "الحالة", "الفاتورة", ""]}>
                {rows.length === 0 && <EmptyRow cols={showPrices ? 12 : 11}>{filtered ? "لا توجد شحنات بهذه الشروط" : "لا توجد شحنات بعد؛ اضغط «إنشاء»"}</EmptyRow>}
                <LimitRow cols={showPrices ? 12 : 11} shown={rows.length} limit={LIMIT} />
                {rows.map((r) => {
                  const { w } = r;
                  const open = listUrl({ open: String(w.id) });
                  const pending = w.status === "approved" && !r.invoiceId;
                  return (
                    <ClickRow key={w.id} href={open} className="transition hover:bg-brand-50/40">
                      <Td>{(canUpdate || canApprove || canInvoice) && <RowCheck form={BULK_FORM} id={w.id} amount={showPrices ? w.amount : "0"} />}</Td>
                      <Td className="font-medium whitespace-nowrap">
                        <Link href={open} scroll={false} className="ltr-nums text-brand-700 hover:underline">
                          {w.number}
                        </Link>
                      </Td>
                      <Td className="ltr-nums whitespace-nowrap">{w.waybillDate}</Td>
                      <Td>{r.customer}</Td>
                      <Td className="whitespace-nowrap">{r.route}</Td>
                      <Td className="whitespace-nowrap">
                        <span className={`rounded-md px-1.5 py-0.5 text-xs ${w.isInternational ? "bg-sky-50 text-sky-800" : "bg-amber-50 text-amber-800"}`}>{w.isInternational ? "دولي · صفر" : "داخلي · 15%"}</span>
                      </Td>
                      <Td className="ltr-nums whitespace-nowrap">{exec(r)}</Td>
                      <Td className="whitespace-nowrap">{r.driver ?? w.carrierDriverName ?? "—"}</Td>
                      {showPrices && (
                        <Td className="ltr-nums font-semibold whitespace-nowrap">
                          {fmt(w.amount)} <span className="text-xs font-normal text-gray-400">{w.currencyCode}</span>
                        </Td>
                      )}
                      <Td>
                        <Badge tone={pending ? "amber" : WAYBILL_STATUS[w.status].tone}>{pending ? "بانتظار الفوترة" : WAYBILL_STATUS[w.status].label}</Badge>
                        {w.status === "rejected" && w.rejectionReason && <span className="block max-w-48 truncate text-xs text-red-600">{w.rejectionReason}</span>}
                      </Td>
                      <Td className="ltr-nums whitespace-nowrap">
                        {r.invoiceId ? (
                          <Link href={`/invoices?open=${r.invoiceId}`} className="text-brand-700 hover:underline">
                            {r.invoice}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </Td>
                      <Td>
                        <Link href={open} scroll={false} aria-label="معاينة" title="معاينة بجانب القائمة" className="inline-flex rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-brand-700">
                          <Icon name="expand" className="size-4" />
                        </Link>
                      </Td>
                    </ClickRow>
                  );
                })}
              </Table>
              {rows.length > 0 && showPrices && (
                <p className="mt-3 text-xs text-gray-500">
                  إجمالي المعروض قبل الضريبة <span className="ltr-nums font-semibold text-gray-700">{fmt(total)}</span>
                </p>
              )}
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
          showPrices={showPrices}
          company={company}
          template={template}
          action={saveWaybillPanel.bind(null, editing ? editId : null)}
          closeHref={back}
          savedHref={returnTo}
        />
      )}
    </>
  );
}
