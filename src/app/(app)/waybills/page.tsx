import Link from "next/link";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can, hasSpecial, scopeFor } from "@/lib/permissions";
import { customerOptions, driverOptions, partyOptions, routeOptions, shipperSuggestions, vehicleOptions } from "@/lib/lookups";
import { todayRiyadh } from "@/lib/dates";
import { WAYBILL_STATUS, type WaybillStatus } from "@/data/waybills";
import { SheetEditor } from "@/components/sheet-editor";
import { DocSheet, type DocSheetRow } from "@/components/doc-sheet";
import { AddModeBar, ListActions, ViewToggle } from "@/components/list-actions";
import { Card, PageHeader } from "@/components/ui";
import { EDITABLE } from "@/lib/waybills";
import { bulkWaybills, saveWaybillSheet, saveWaybills } from "./actions";
import { WaybillTable } from "./waybill-table";

const TABS: { key: WaybillStatus | "all"; label: string }[] = [
  { key: "all", label: "الكل" },
  ...(Object.entries(WAYBILL_STATUS) as [WaybillStatus, { label: string }][]).map(([key, v]) => ({ key, label: v.label })),
];

const SHEET_TONE: Record<WaybillStatus, "gray" | "green" | "blue" | "amber" | "red"> = {
  draft: "gray",
  in_transit: "amber",
  delivered: "blue",
  approved: "green",
  invoiced: "green",
  rejected: "red",
};

export default async function WaybillsPage({ searchParams }: { searchParams: Promise<{ status?: string; add?: string; view?: string }> }) {
  const user = await requirePermission("waybills", "view");
  const { status: rawStatus, add, view: rawView } = await searchParams;
  const status = rawStatus && rawStatus in WAYBILL_STATUS ? (rawStatus as WaybillStatus) : undefined;
  const showPrices = hasSpecial(user.perms, "view_prices");
  const canCreate = can(user.perms, "waybills", "create");
  const canUpdate = can(user.perms, "waybills", "update");
  const adding = add === "1" && canCreate;
  const view = rawView === "sheet" ? "sheet" : "table";

  const carrier = alias(s.parties, "carrier");
  const where: SQL[] = [];
  // السائق يرى شحناته فقط
  if (scopeFor(user.perms, "waybills", "view") === "own") where.push(eq(s.drivers.userId, user.id));
  const counts = await db
    .select({ status: s.waybills.status, n: sql<number>`count(*)::int` })
    .from(s.waybills)
    .leftJoin(s.drivers, eq(s.drivers.id, s.waybills.driverId))
    .where(where.length ? and(...where) : undefined)
    .groupBy(s.waybills.status);
  if (status) where.push(eq(s.waybills.status, status));

  const [routes, customers, vehicles, drivers, carriers, shippers, list] = await Promise.all([
    routeOptions(),
    customerOptions(),
    vehicleOptions(),
    driverOptions(),
    partyOptions("carrier"),
    adding ? shipperSuggestions() : Promise.resolve([]),
    db
      .select({
        w: s.waybills,
        customer: s.parties.nameAr,
        plate: s.vehicles.plate,
        carrier: carrier.nameAr,
        driver: s.employees.nameAr,
      })
      .from(s.waybills)
      .innerJoin(s.parties, eq(s.parties.id, s.waybills.customerId))
      .leftJoin(s.vehicles, eq(s.vehicles.id, s.waybills.vehicleId))
      .leftJoin(carrier, eq(carrier.id, s.waybills.carrierId))
      .leftJoin(s.drivers, eq(s.drivers.id, s.waybills.driverId))
      .leftJoin(s.employees, eq(s.employees.id, s.drivers.employeeId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(s.waybills.waybillDate), desc(s.waybills.id))
      .limit(300),
  ]);
  const routeLabel = new Map(routes.map((r) => [r.value, r.label]));
  const countOf = (k: string) => (k === "all" ? counts.reduce((a, c) => a + c.n, 0) : (counts.find((c) => c.status === k)?.n ?? 0));

  return (
    <>
      <PageHeader title="الشحنات" description="كل شحنة رحلة واحدة. السعر من العقد الساري والعمولة من المسار تلقائياً، والقيد يُرحّل عند الاعتماد.">
        {!adding && <ListActions bulkHref={canUpdate && `/waybills?view=sheet${status ? `&status=${status}` : ""}`} addHref={canCreate && "/waybills?add=1"} addLabel="إدخال شحنات" />}
      </PageHeader>
      {adding && <AddModeBar backHref="/waybills" backLabel="الشحنات" title="إدخال شحنات" />}
      {adding && (
        <Card className="mb-6">
          <>
            <SheetEditor
                templateName="الشحنات"
                action={saveWaybills}
                initialRows={4}
                columns={[
                  { key: "date", label: "التاريخ", type: "date", required: true, placeholder: todayRiyadh() },
                  { key: "customerId", label: "العميل", type: "select", required: true, options: customers, width: "11rem", create: "customer" },
                  { key: "routeId", label: "المسار", type: "select", required: true, options: routes, width: "13rem", create: "route" },
                  { key: "vehicleId", label: "المركبة", type: "select", options: vehicles, width: "8rem", create: "vehicle" },
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
          </>
        </Card>
      )}
      {!adding && (
        <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
      <nav className="flex flex-1 flex-wrap gap-2 text-sm">
        {TABS.map((t) => {
          const active = (t.key === "all" && !status) || t.key === status;
          return (
            <Link
              key={t.key}
              href={`/waybills?${new URLSearchParams({ ...(t.key === "all" ? {} : { status: t.key }), ...(view === "sheet" ? { view } : {}) })}`}
              className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 transition ${
                active ? "bg-asphalt-900 font-semibold text-brand-500" : "bg-white text-gray-600 shadow-sm hover:bg-brand-50"
              }`}
            >
              {t.label}
              <span className={`ltr-nums rounded-full px-1.5 text-xs ${active ? "bg-white/10" : "bg-gray-100"}`}>{countOf(t.key)}</span>
            </Link>
          );
        })}
      </nav>
        <ViewToggle base="/waybills" params={{ status }} view={view} />
      </div>
      {view === "sheet" ? (
        <>
          <DocSheet
            action={saveWaybillSheet}
            emptyText="لا توجد شحنات بهذه الحالة"
            columns={[
              { key: "status", label: "الحالة", type: "badge", width: "6rem" },
              { key: "number", label: "الرقم", ltr: true, width: "8rem" },
              { key: "date", label: "التاريخ", type: "date", width: "7rem" },
              { key: "customer", label: "العميل", width: "11rem" },
              { key: "route", label: "المسار", width: "12rem" },
              { key: "executor", label: "المنفّذ", width: "8rem" },
              { key: "shipper", label: "المرسل", editable: true, width: "10rem" },
              { key: "consignee", label: "المستلم", editable: true, width: "10rem" },
              ...(showPrices ? [{ key: "amount", label: "المبلغ", type: "number" as const, editable: true, width: "6.5rem" }] : []),
              { key: "commission", label: "عمولة السائق", type: "number", editable: true, width: "6.5rem" },
              { key: "carrierCost", label: "تكلفة الناقل", type: "number", editable: true, width: "6.5rem" },
              { key: "weight", label: "الوزن (طن)", type: "number", editable: true, width: "5.5rem" },
              { key: "container", label: "رقم الحاوية", ltr: true, editable: true, width: "7rem" },
              { key: "deliveryNote", label: "رقم إذن التسليم", ltr: true, editable: true, width: "7rem" },
              { key: "notes", label: "ملاحظات", editable: true, width: "12rem" },
            ]}
            rows={list.map(({ w, customer, plate, carrier }): DocSheetRow => ({
              id: w.id,
              href: `/waybills/${w.id}`,
              editable: canUpdate && EDITABLE.includes(w.status),
              cells: {
                number: w.number,
                date: w.waybillDate,
                customer,
                route: routeLabel.get(String(w.routeId)) ?? "—",
                executor: plate ?? (carrier ? `${carrier} (ناقل)` : "—"),
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
            }))}
          />
        </>
      ) : (
      <WaybillTable
        rows={list.map(({ w, customer, plate, carrier, driver }) => ({
          id: w.id,
          number: w.number,
          date: w.waybillDate,
          customer,
          route: routeLabel.get(String(w.routeId)) ?? "—",
          executor: plate ?? (carrier ? `${carrier} (ناقل)` : "—"),
          driver: driver ?? w.carrierDriverName ?? "—",
          amount: showPrices ? Number(w.amount) : null,
          status: w.status,
          rejectionReason: w.rejectionReason,
        }))}
        showPrices={showPrices}
        canDeliver={can(user.perms, "waybills", "update")}
        canApprove={can(user.perms, "waybills", "approve")}
        canOverride={hasSpecial(user.perms, "override_controls")}
        action={bulkWaybills}
      />
      )}
        </>
      )}
    </>
  );
}
