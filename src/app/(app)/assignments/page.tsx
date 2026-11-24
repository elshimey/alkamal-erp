import { and, asc, desc, eq, isNotNull, isNull, notInArray } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can, hasSpecial } from "@/lib/permissions";
import { todayRiyadh } from "@/lib/dates";
import Link from "next/link";
import { EmptyRow, PageHeader, Table, Td } from "@/components/ui";
import { ListActions } from "@/components/list-actions";
import { HandoverForm } from "./handover-form";
import { HandoverDocument } from "@/components/handover-document";
import { Icon } from "@/components/icons";
import { getCompany, getInvoiceTemplate } from "@/lib/company";
import { handoverByAssignment, handoverDoc, handoverItemNames, itemsOfAssignment } from "@/lib/handovers";
import { HANDOVER_KIND } from "@/data/handovers";
import { DocCards, sheetBtn, sheetPrimary } from "@/components/doc-card";
import { RecordCardFace, TapCard, cardShell } from "@/components/list-card";
import { fmtDate } from "@/lib/format";
import { saveHandoverAction } from "./actions";

const baseQuery = () =>
  db
    .select({ a: s.vehicleAssignments, plate: s.vehicles.plate, odometer: s.vehicles.odometer, driver: s.employees.nameAr })
    .from(s.vehicleAssignments)
    .innerJoin(s.vehicles, eq(s.vehicles.id, s.vehicleAssignments.vehicleId))
    .innerJoin(s.drivers, eq(s.drivers.id, s.vehicleAssignments.driverId))
    .innerJoin(s.employees, eq(s.employees.id, s.drivers.employeeId));

export default async function AssignmentsPage({ searchParams }: { searchParams: Promise<{ new?: string; release?: string; handover?: string; doc?: string }> }) {
  const user = await requirePermission("vehicles", "view");
  const canEdit = can(user.perms, "vehicles", "update");
  const today = todayRiyadh();

  const open = await baseQuery().where(isNull(s.vehicleAssignments.toDate)).orderBy(asc(s.vehicles.plate));
  const history = await baseQuery()
    .where(isNotNull(s.vehicleAssignments.toDate))
    .orderBy(desc(s.vehicleAssignments.toDate))
    .limit(50);
  const busyDrivers = open.map((o) => o.a.driverId);
  const [heads, freeDrivers] = await Promise.all([
    db
      .select({ id: s.vehicles.id, plate: s.vehicles.plate, odometer: s.vehicles.odometer, make: s.vehicles.make, model: s.vehicles.model, year: s.vehicles.year, chassis: s.vehicles.chassis })
      .from(s.vehicles)
      .where(and(eq(s.vehicles.status, "active"), eq(s.vehicles.assetKind, "head")))
      .orderBy(asc(s.vehicles.plate)),
    db
      .select({ id: s.drivers.id, name: s.employees.nameAr, nationalId: s.employees.nationalId })
      .from(s.drivers)
      .innerJoin(s.employees, eq(s.employees.id, s.drivers.employeeId))
      .where(and(eq(s.drivers.status, "active"), busyDrivers.length ? notInArray(s.drivers.id, busyDrivers) : undefined))
      .orderBy(asc(s.employees.nameAr)),
  ]);
  const docs = await handoverByAssignment(db, [...open.map((o) => o.a.id), ...history.map((h) => h.a.id)]);
  const driverOpts = freeDrivers.map((d) => ({ value: String(d.id), label: d.name }));
  const sp = await searchParams;
  const releasing = canEdit ? open.find((o) => o.a.id === Number(sp.release)) : undefined;
  const handing = canEdit ? open.find((o) => o.a.id === Number(sp.handover)) : undefined;
  const formKind = handing ? "transfer" : releasing ? "return" : sp.new === "1" && canEdit ? "receive" : null;
  const [company, template] = await Promise.all([getCompany(db), getInvoiceTemplate(db)]);
  const openDoc = sp.doc ? await handoverDoc(db, Number(sp.doc)) : null;
  const formData = formKind
    ? {
        itemNames: await handoverItemNames(db),
        assignments: await Promise.all(
          open.map(async ({ a, driver, odometer }) => ({
            id: a.id,
            vehicleId: a.vehicleId,
            driverId: a.driverId,
            driver,
            fromDate: a.fromDate,
            odometer: Math.max(a.odometerStart ?? 0, odometer ?? 0),
            items: await itemsOfAssignment(db, a.id),
          })),
        ),
        driverIds: Object.fromEntries(
          (await db.select({ id: s.drivers.id, nid: s.employees.nationalId }).from(s.drivers).innerJoin(s.employees, eq(s.employees.id, s.drivers.employeeId))).map((d) => [String(d.id), d.nid]),
        ),
      }
    : null;
  const printLink = (id: number, label: string) => (
    <Link href={`/assignments?doc=${id}`} scroll={false} prefetch={false} className="inline-flex items-center gap-1 text-sm text-brand-800 hover:underline">
      <Icon name="document" className="size-3.5" />
      {label}
    </Link>
  );

  return (
    <>
      <PageHeader title="الإسناد والتسليم" description="من يقود كل مركبة ومتى، ومحضر كل استلام وتسليم يُطبع ليوقّع عليه السائق. منه يُعرف السائق وقت المخالفة، ويُحدَّث عداد المركبة.">
        <ListActions newHref={canEdit && "/assignments?new=1"} newLabel="محضر استلام / تسليم" />
      </PageHeader>
      {openDoc && (
        <section className="animate-flyout mb-6 rounded-2xl bg-gray-100/70 shadow-inner">
          <div className="flex flex-wrap items-center gap-3 rounded-t-2xl border-b border-gray-200 bg-white px-5 py-3">
            <Link href="/assignments" scroll={false} aria-label="إغلاق المعاينة" className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100">
              <Icon name="close" className="size-4" />
            </Link>
            <span className="ltr-nums font-display text-lg font-semibold text-brand-900">{openDoc.h.number}</span>
            <span className="text-sm text-gray-500">{HANDOVER_KIND[openDoc.h.kind].title} · {openDoc.plate}</span>
            <div className="ms-auto flex flex-wrap items-center gap-2">
              <Link href={`/print/handovers?ids=${openDoc.h.id}&print=1`} target="_blank" className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-brand-900 shadow-sm hover:bg-brand-500">
                طباعة المحضر
              </Link>
              <Link href={`/print/handovers?ids=${openDoc.h.id}&pdf=1`} target="_blank" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50">
                تنزيل PDF
              </Link>
            </div>
          </div>
          <div className="p-4 sm:p-6">
            <div className="mx-auto max-w-3xl">
              <HandoverDocument company={company} doc={openDoc} template={template} compact />
            </div>
          </div>
        </section>
      )}
      <h2 className="mb-3 font-semibold text-gray-800">المسندة حالياً</h2>
      <DocCards empty="لا توجد مركبات مسندة">
        {open.map(({ a, plate, driver }) => {
          const face = (
            <RecordCardFace
              avatar="🚛"
              name={plate}
              sub={`مع ${driver} منذ ${fmtDate(a.fromDate)}`}
              status={{ label: "مسندة", tone: "blue" }}
              facts={[
                ["عداد الاستلام", a.odometerStart != null ? `${a.odometerStart.toLocaleString("en")} كم` : "—"],
                ...(docs.opened.get(a.id) ? ([["المحضر", <span key="d" className="ltr-nums">{docs.opened.get(a.id)!.number}</span>]] as [string, React.ReactNode][]) : []),
              ]}
            />
          );
          return (
            <TapCard
              key={a.id}
              tone="blue"
              label={`إسناد ${plate}`}
              face={face}
              header={<RecordCardFace avatar="🚛" name={plate} sub={`مع ${driver} منذ ${fmtDate(a.fromDate)}`} />}
              footer={
                canEdit ? (
                  <>
                    <Link href={`/assignments?handover=${a.id}`} scroll={false} className={sheetPrimary}>
                      تسليم لسائق آخر
                    </Link>
                    <Link href={`/assignments?release=${a.id}`} scroll={false} className={sheetBtn}>
                      تسليم للشركة
                    </Link>
                    {docs.opened.get(a.id) && (
                      <Link href={`/assignments?doc=${docs.opened.get(a.id)!.id}`} scroll={false} className={sheetBtn}>
                        طباعة المحضر
                      </Link>
                    )}
                  </>
                ) : undefined
              }
            />
          );
        })}
      </DocCards>
      <div className="max-md:hidden">
      <Table head={["المركبة", "السائق", "منذ", "عداد الاستلام", "المحضر", ""]}>
        {open.length === 0 && <EmptyRow cols={6}>لا توجد مركبات مسندة</EmptyRow>}
        {open.map(({ a, plate, driver }) => (
          <tr key={a.id}>
            <Td className="font-medium">{plate}</Td>
            <Td>{driver}</Td>
            <Td className="ltr-nums">{fmtDate(a.fromDate)}</Td>
            <Td className="ltr-nums">{a.odometerStart?.toLocaleString("en") ?? "—"}</Td>
            <Td>{docs.opened.get(a.id) ? printLink(docs.opened.get(a.id)!.id, docs.opened.get(a.id)!.number) : <span className="text-gray-400">—</span>}</Td>
            <Td>
              {canEdit && (
                <span className="flex flex-wrap gap-2">
                  <Link href={`/assignments?release=${a.id}`} scroll={false} prefetch={false} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 shadow-sm hover:bg-gray-50">
                    تسليم للشركة
                  </Link>
                  <Link href={`/assignments?handover=${a.id}`} scroll={false} prefetch={false} className="rounded-lg border border-brand-300 bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-900 shadow-sm hover:bg-brand-100">
                    تسليم لسائق آخر
                  </Link>
                </span>
              )}
            </Td>
          </tr>
        ))}
      </Table>
      </div>
      <h2 className="mt-8 mb-3 font-semibold text-gray-800">السجل</h2>
      <DocCards empty="لا يوجد سجل بعد">
        {history.map(({ a, plate, driver }) => (
          <div key={a.id} className={`${cardShell} before:bg-st-neutral-dot`}>
            <RecordCardFace
              avatar="🚛"
              name={plate}
              sub={driver}
              facts={[
                ["الفترة", <span key="p" className="ltr-nums">{fmtDate(a.fromDate)} – {a.toDate ? fmtDate(a.toDate) : ""}</span>],
                ["الكيلومترات", a.odometerEnd != null && a.odometerStart != null ? (a.odometerEnd - a.odometerStart).toLocaleString("en") : "—"],
                ...(a.notes ? ([["ملاحظات", a.notes]] as [string, string][]) : []),
                ...(docs.closed.get(a.id) ? ([["محضر التسليم", <Link key="d" href={`/assignments?doc=${docs.closed.get(a.id)!.id}`} className="ltr-nums text-brand-800 underline">{docs.closed.get(a.id)!.number}</Link>]] as [string, React.ReactNode][]) : []),
              ]}
            />
          </div>
        ))}
      </DocCards>
      <div className="max-md:hidden">
      <Table head={["المركبة", "السائق", "من", "إلى", "الكيلومترات", "ملاحظات", "المحاضر"]}>
        {history.length === 0 && <EmptyRow cols={7}>لا يوجد سجل بعد</EmptyRow>}
        {history.map(({ a, plate, driver }) => (
          <tr key={a.id}>
            <Td>{plate}</Td>
            <Td>{driver}</Td>
            <Td className="ltr-nums">{fmtDate(a.fromDate)}</Td>
            <Td className="ltr-nums">{fmtDate(a.toDate)}</Td>
            <Td className="ltr-nums">
              {a.odometerEnd != null && a.odometerStart != null ? (a.odometerEnd - a.odometerStart).toLocaleString("en") : "—"}
            </Td>
            <Td className="text-xs text-gray-500">{a.notes ?? ""}</Td>
            <Td>
              <span className="flex flex-col gap-1">
                {docs.opened.get(a.id) && printLink(docs.opened.get(a.id)!.id, docs.opened.get(a.id)!.number)}
                {docs.closed.get(a.id) && printLink(docs.closed.get(a.id)!.id, docs.closed.get(a.id)!.number)}
              </span>
            </Td>
          </tr>
        ))}
      </Table>
      </div>

      {formKind && formData && (
        <HandoverForm
          key={`${formKind}-${releasing?.a.id ?? handing?.a.id ?? 0}`}
          action={saveHandoverAction}
          closeHref="/assignments"
          initialKind={formKind}
          initialAssignment={(releasing ?? handing)?.a.id}
          vehicles={heads}
          assignments={formData.assignments}
          drivers={driverOpts}
          driverIds={formData.driverIds}
          itemNames={formData.itemNames}
          today={today}
          rep={user.name}
          canOverride={hasSpecial(user.perms, "override_controls")}
          company={company}
          template={template}
        />
      )}
    </>
  );
}
