import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can, hasSpecial, scopeFor } from "@/lib/permissions";
import { chargeTypeOptions, partyOptions, routeOptions } from "@/lib/lookups";
import { approvalIssues } from "@/lib/waybills";
import { EXPENSE_BILL_TO, EXPENSE_PAYERS, FUEL_SOURCES, TRIP_STAGES, WAYBILL_STATUS } from "@/data/waybills";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { SheetEditor } from "@/components/sheet-editor";
import { Icon } from "@/components/icons";
import { Badge, Card, EmptyRow, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { addStage, approveOne, deleteOne, rejectOne, removeItem, revertOne, saveExpenses, saveFuel, saveWaybillDetails } from "../actions";

const fmt = (v: string | number | null | undefined) =>
  v == null ? "—" : Number(v).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const options = <T extends Record<string, string>>(m: T) => Object.entries(m).map(([value, label]) => ({ value, label }));

export default async function WaybillPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("waybills", "view");
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();

  const carrier = alias(s.parties, "carrier");
  const rep = alias(s.parties, "rep");
  const [row] = await db
    .select({
      w: s.waybills,
      customer: s.parties.nameAr,
      contract: s.contracts.number,
      plate: s.vehicles.plate,
      driver: s.employees.nameAr,
      driverUserId: s.drivers.userId,
      carrier: carrier.nameAr,
      rep: rep.nameAr,
      entry: s.journalEntries.number,
    })
    .from(s.waybills)
    .innerJoin(s.parties, eq(s.parties.id, s.waybills.customerId))
    .leftJoin(s.contracts, eq(s.contracts.id, s.waybills.contractId))
    .leftJoin(s.vehicles, eq(s.vehicles.id, s.waybills.vehicleId))
    .leftJoin(s.drivers, eq(s.drivers.id, s.waybills.driverId))
    .leftJoin(s.employees, eq(s.employees.id, s.drivers.employeeId))
    .leftJoin(carrier, eq(carrier.id, s.waybills.carrierId))
    .leftJoin(rep, eq(rep.id, s.waybills.salesRepId))
    .leftJoin(s.journalEntries, eq(s.journalEntries.id, s.waybills.journalEntryId))
    .where(eq(s.waybills.id, id));
  if (!row) notFound();
  if (scopeFor(user.perms, "waybills", "view") === "own" && row.driverUserId !== user.id) redirect("/?denied=1");
  const { w } = row;

  const station = alias(s.parties, "station");
  const broker = alias(s.parties, "broker");
  const [routes, fuel, expenses, stages, lines, chargeTypes, stations, brokers, issues] = await Promise.all([
    routeOptions(),
    db.select({ f: s.waybillFuel, party: station.nameAr }).from(s.waybillFuel).leftJoin(station, eq(station.id, s.waybillFuel.partyId)).where(eq(s.waybillFuel.waybillId, id)).orderBy(asc(s.waybillFuel.id)),
    db
      .select({ e: s.waybillExpenses, type: s.chargeTypes.nameAr, party: broker.nameAr })
      .from(s.waybillExpenses)
      .innerJoin(s.chargeTypes, eq(s.chargeTypes.id, s.waybillExpenses.chargeTypeId))
      .leftJoin(broker, eq(broker.id, s.waybillExpenses.partyId))
      .where(eq(s.waybillExpenses.waybillId, id))
      .orderBy(asc(s.waybillExpenses.id)),
    db.select().from(s.tripStages).where(eq(s.tripStages.waybillId, id)).orderBy(asc(s.tripStages.at)),
    w.journalEntryId
      ? db
          .select({ l: s.journalLines, code: s.accounts.code, account: s.accounts.nameAr, cc: s.costCenters.nameAr })
          .from(s.journalLines)
          .innerJoin(s.accounts, eq(s.accounts.id, s.journalLines.accountId))
          .leftJoin(s.costCenters, eq(s.costCenters.id, s.journalLines.costCenterId))
          .where(eq(s.journalLines.entryId, w.journalEntryId))
          .orderBy(asc(s.journalLines.lineNo))
      : Promise.resolve([]),
    chargeTypeOptions(),
    Promise.all([partyOptions("fuel_station"), partyOptions("supplier")]).then(([a, b]) => [...a, ...b.filter((x) => !a.some((y) => y.value === x.value))]),
    partyOptions("customs_broker"),
    ["draft", "in_transit", "delivered"].includes(w.status) ? approvalIssues(db, w) : Promise.resolve([]),
  ]);

  const showPrices = hasSpecial(user.perms, "view_prices");
  const editable = ["draft", "in_transit", "delivered", "rejected"].includes(w.status);
  const canUpdate = editable && can(user.perms, "waybills", "update");
  const canApprove = ["draft", "in_transit", "delivered"].includes(w.status) && can(user.perms, "waybills", "approve");
  const canOverride = hasSpecial(user.perms, "override_controls");
  const canRevert = ["approved", "rejected"].includes(w.status) && can(user.perms, "waybills", "revert");
  const canDelete = ["draft", "rejected"].includes(w.status) && can(user.perms, "waybills", "delete");
  const fleet = w.execution === "fleet";
  const route = routes.find((r) => r.value === String(w.routeId))?.label ?? "—";
  const km = w.odometerStart != null && w.odometerEnd != null ? w.odometerEnd - w.odometerStart : null;

  const facts: [string, React.ReactNode][] = [
    ["العميل", row.customer],
    ["العقد", row.contract ?? "—"],
    ["المسار", `${route}${w.isInternational ? " · دولي" : ""}`],
    ["التنفيذ", fleet ? `${row.plate} · ${row.driver}` : `${row.carrier} (ناقل خارجي)${w.carrierPlate ? ` · ${w.carrierPlate}` : ""}`],
    ["المرسل ← المستلم", `${w.shipper} ← ${w.consignee}`],
    ["المسافة", w.distanceKm != null ? `${w.distanceKm} كم` : "—"],
    ["العداد", km != null ? `${w.odometerStart} ← ${w.odometerEnd} (${km} كم)` : (w.odometerStart ?? "—")],
    ["الوزن / الحاوية", `${w.weightTons ?? "—"} طن / ${w.containerNumber ?? "—"}`],
    ...(showPrices ? ([["المبلغ", <span key="a" className="ltr-nums">{`${fmt(w.amount)} ${w.currencyCode}`}</span>]] as [string, React.ReactNode][]) : []),
    ["عمولة السائق", <span key="c" className="ltr-nums">{fmt(w.driverCommission)}</span>],
    ...(row.rep ? ([["المندوب", `${row.rep} · ${fmt(w.salesRepCommission)}`]] as [string, React.ReactNode][]) : []),
    ...(fleet ? [] : ([["تكلفة الناقل", <span key="k" className="ltr-nums">{fmt(w.carrierCost)}</span>]] as [string, React.ReactNode][])),
  ];

  return (
    <>
      <PageHeader title={`البوليصة ${w.number}`} description={`${w.waybillDate}${showPrices && w.priceNote ? ` · السعر: ${w.priceNote}` : ""}`}>
        <div className="flex items-center gap-3">
          <Badge tone={WAYBILL_STATUS[w.status].tone}>{WAYBILL_STATUS[w.status].label}</Badge>
          {row.entry && <span className="ltr-nums text-xs text-gray-500">القيد {row.entry}</span>}
          <Link href="/waybills" className="text-sm text-brand-700 hover:underline">
            ← البوالص
          </Link>
        </div>
      </PageHeader>

      {w.status === "rejected" && w.rejectionReason && (
        <p className="mb-5 flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          <Icon name="alert" className="size-5" />
          سبب الرفض: {w.rejectionReason}
        </p>
      )}
      {w.overrideReason && <p className="mb-5 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">اعتُمدت بتجاوز الضوابط: {w.overrideReason}</p>}

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card title="بيانات الرحلة" className="lg:col-span-2">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            {facts.map(([k, v]) => (
              <div key={k} className="flex flex-col border-b border-gray-100 pb-2">
                <dt className="text-xs text-gray-500">{k}</dt>
                <dd className="mt-0.5 font-medium text-gray-800">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card title="المراجعة والاعتماد">
          <div className="flex flex-col gap-4">
            {issues.length > 0 && (
              <ul className="flex flex-col gap-1 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {issues.map((i) => (
                  <li key={i.code} className="flex items-start gap-2">
                    <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
                    {i.message}
                  </li>
                ))}
              </ul>
            )}
            {canApprove && (
              <ActionForm action={approveOne.bind(null, id)} className="flex flex-col gap-2" resetOnSuccess={false}>
                {issues.length > 0 && canOverride && <Input name="overrideReason" placeholder="سبب تجاوز الضوابط" />}
                <SubmitButton>اعتماد وترحيل القيد</SubmitButton>
              </ActionForm>
            )}
            {canApprove && (
              <ActionForm action={rejectOne.bind(null, id)} className="flex flex-col gap-2">
                <Input name="reason" placeholder="سبب الرفض (يصل للسائق)" />
                <SubmitButton variant="secondary">رفض</SubmitButton>
              </ActionForm>
            )}
            {canRevert && (
              <ActionForm action={revertOne.bind(null, id)} resetOnSuccess={false}>
                <SubmitButton variant="secondary">{w.status === "rejected" ? "إعادة لمسودة للتصحيح" : "إرجاع لمسودة (يلغي القيد)"}</SubmitButton>
              </ActionForm>
            )}
            {canDelete && (
              <ActionForm action={deleteOne.bind(null, id)} className="flex flex-col gap-2">
                <Input name="reason" placeholder="سبب الحذف" />
                <SubmitButton variant="secondary">حذف البوليصة</SubmitButton>
              </ActionForm>
            )}
            {!canApprove && !canRevert && !canDelete && <p className="text-sm text-gray-500">لا إجراءات متاحة في هذه الحالة.</p>}
          </div>
        </Card>
      </div>

      {canUpdate && (
        <Card title="تعديل قبل الاعتماد" className="mb-6">
          <ActionForm action={saveWaybillDetails.bind(null, id)} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" resetOnSuccess={false}>
            {showPrices && (
              <Field label={`المبلغ (${w.currencyCode})`}>
                <Input name="amount" defaultValue={w.amount} dir="ltr" inputMode="decimal" />
              </Field>
            )}
            {fleet ? (
              <Field label="عمولة السائق">
                <Input name="driverCommission" defaultValue={w.driverCommission} dir="ltr" inputMode="decimal" />
              </Field>
            ) : (
              <Field label="تكلفة الناقل">
                <Input name="carrierCost" defaultValue={w.carrierCost ?? ""} dir="ltr" inputMode="decimal" />
              </Field>
            )}
            <Field label="العداد عند البداية">
              <Input name="odometerStart" defaultValue={w.odometerStart ?? ""} dir="ltr" inputMode="numeric" />
            </Field>
            <Field label="العداد عند النهاية">
              <Input name="odometerEnd" defaultValue={w.odometerEnd ?? ""} dir="ltr" inputMode="numeric" />
            </Field>
            <Field label="رقم إشعار التسليم">
              <Input name="deliveryNoteNumber" defaultValue={w.deliveryNoteNumber ?? ""} dir="ltr" />
            </Field>
            <Field label="البيان الجمركي">
              <Input name="customsDeclaration" defaultValue={w.customsDeclaration ?? ""} dir="ltr" />
            </Field>
            <Field label="ملاحظات">
              <Input name="notes" defaultValue={w.notes ?? ""} />
            </Field>
            <div className="flex items-end">
              <SubmitButton>حفظ التعديلات</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      )}

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card title="مراحل الرحلة">
          <ol className="relative mb-4 flex flex-col gap-3 border-s-2 border-dashed border-brand-600/50 ps-5">
            {stages.length === 0 && <li className="text-sm text-gray-400">لم تُسجل مراحل بعد</li>}
            {stages.map((st) => (
              <li key={st.id} className="relative text-sm">
                <span className="absolute -start-[27px] top-1 size-3 rounded-full bg-brand-600 ring-4 ring-brand-100" />
                <div className="font-medium text-gray-800">{TRIP_STAGES[st.stage]}</div>
                <div className="ltr-nums text-xs text-gray-500">
                  {st.at.toLocaleString("en-GB", { timeZone: "Asia/Riyadh", dateStyle: "short", timeStyle: "short" })}
                  {st.odometer != null && ` · ${st.odometer} كم`}
                </div>
                {st.note && <div className="text-xs text-gray-600">{st.note}</div>}
              </li>
            ))}
          </ol>
          {canUpdate && w.status !== "rejected" && (
            <ActionForm action={addStage.bind(null, id)} className="grid grid-cols-2 gap-2">
              <Select name="stage" defaultValue={w.status === "draft" ? "loading" : "delivery"} className="col-span-2">
                {options(TRIP_STAGES).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
              <Input name="odometer" placeholder="العداد" dir="ltr" inputMode="numeric" />
              <Input name="note" placeholder="ملاحظة" />
              <div className="col-span-2">
                <SubmitButton variant="secondary">تسجيل المرحلة</SubmitButton>
              </div>
            </ActionForm>
          )}
        </Card>

        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card title="الديزل">
            <Table head={["المصدر", "المحطة / المزوّد", "اللترات", "المبلغ", "الضريبة", "العملة", "الفاتورة", ""]}>
              {fuel.length === 0 && <EmptyRow cols={8}>لا يوجد ديزل مسجل</EmptyRow>}
              {fuel.map(({ f, party }) => (
                <tr key={f.id}>
                  <Td>{FUEL_SOURCES[f.source]}</Td>
                  <Td>{party ?? "—"}</Td>
                  <Td className="ltr-nums">{f.liters ?? "—"}</Td>
                  <Td className="ltr-nums font-medium">{fmt(f.amount)}</Td>
                  <Td className="ltr-nums">{fmt(f.vatAmount)}</Td>
                  <Td>{f.currencyCode === "SAR" ? "ريال" : `${f.currencyCode} × ${Number(f.exchangeRate)}`}</Td>
                  <Td className="ltr-nums">{f.invoiceNumber ?? "—"}</Td>
                  <Td>
                    {canUpdate && (
                      <form action={removeItem.bind(null, id, "fuel", f.id)}>
                        <button className="text-xs text-red-600 hover:underline">حذف</button>
                      </form>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
            {canUpdate && (
              <div className="mt-4">
                <SheetEditor
                  templateName={`ديزل-${w.number}`}
                  action={saveFuel.bind(null, id)}
                  initialRows={2}
                  columns={[
                    { key: "source", label: "المصدر", type: "select", required: true, options: options(fleet ? FUEL_SOURCES : { fuel_card: FUEL_SOURCES.fuel_card, station_credit: FUEL_SOURCES.station_credit }), width: "8rem" },
                    { key: "partyId", label: "المحطة / المزوّد", type: "select", options: stations, width: "9rem" },
                    { key: "liters", label: "اللترات", type: "number", width: "5rem" },
                    { key: "amount", label: "المبلغ قبل الضريبة", type: "number", required: true, width: "7rem" },
                    { key: "vat", label: "الضريبة", type: "number", width: "5rem" },
                    { key: "currency", label: "العملة", type: "select", options: [{ value: "SAR", label: "ريال" }, { value: "KWD", label: "دينار" }], width: "5rem" },
                    { key: "rate", label: "سعر الصرف", type: "number", width: "5rem", placeholder: "تلقائي" },
                    { key: "odometer", label: "العداد", type: "number", width: "5rem" },
                    { key: "invoice", label: "رقم الفاتورة", ltr: true, width: "6rem" },
                  ]}
                />
              </div>
            )}
          </Card>

          <Card title="مصاريف الرحلة">
            <Table head={["النوع", "المبلغ", "العملة", "على", "الدافع", "ملاحظة", ""]}>
              {expenses.length === 0 && <EmptyRow cols={7}>لا توجد مصاريف</EmptyRow>}
              {expenses.map(({ e, type, party }) => (
                <tr key={e.id}>
                  <Td>{type}</Td>
                  <Td className="ltr-nums font-medium">{fmt(e.amount)}</Td>
                  <Td>{e.currencyCode === "SAR" ? "ريال" : `${e.currencyCode} × ${Number(e.exchangeRate)}`}</Td>
                  <Td>{EXPENSE_BILL_TO[e.billTo]}</Td>
                  <Td>{e.payer === "customs_broker" ? `المخلص: ${party}` : EXPENSE_PAYERS[e.payer]}</Td>
                  <Td>{e.note ?? "—"}</Td>
                  <Td>
                    {canUpdate && (
                      <form action={removeItem.bind(null, id, "expense", e.id)}>
                        <button className="text-xs text-red-600 hover:underline">حذف</button>
                      </form>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
            {canUpdate && (
              <div className="mt-4">
                <SheetEditor
                  templateName={`مصاريف-${w.number}`}
                  action={saveExpenses.bind(null, id)}
                  initialRows={2}
                  columns={[
                    { key: "chargeTypeId", label: "النوع", type: "select", required: true, options: chargeTypes, width: "7rem" },
                    { key: "amount", label: "المبلغ", type: "number", required: true, width: "6rem" },
                    { key: "currency", label: "العملة", type: "select", options: [{ value: "SAR", label: "ريال" }, { value: "KWD", label: "دينار" }], width: "5rem" },
                    { key: "rate", label: "سعر الصرف", type: "number", width: "5rem", placeholder: "تلقائي" },
                    { key: "billTo", label: "على", type: "select", options: options(EXPENSE_BILL_TO), width: "8rem" },
                    { key: "payer", label: "الدافع", type: "select", options: options(fleet ? EXPENSE_PAYERS : { customs_broker: EXPENSE_PAYERS.customs_broker }), width: "7rem" },
                    { key: "partyId", label: "المخلص", type: "select", options: brokers, width: "8rem" },
                    { key: "note", label: "ملاحظة", width: "8rem" },
                  ]}
                />
              </div>
            )}
          </Card>
        </div>
      </div>

      {lines.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 font-semibold text-brand-900">
            <Icon name="ledger" className="size-5 text-brand-700" />
            قيد التكلفة {row.entry}
          </h2>
          <Table head={["الحساب", "مركز التكلفة", "البيان", "مدين", "دائن"]}>
            {lines.map(({ l, code, account, cc }) => (
              <tr key={l.id}>
                <Td>
                  <span className="ltr-nums text-gray-500">{code}</span> {account}
                </Td>
                <Td>{cc ?? "—"}</Td>
                <Td className="text-gray-600">{l.description}</Td>
                <Td className="ltr-nums">{Number(l.debitBase) ? fmt(l.debitBase) : ""}</Td>
                <Td className="ltr-nums">{Number(l.creditBase) ? fmt(l.creditBase) : ""}</Td>
              </tr>
            ))}
            <tr className="bg-gray-50 font-semibold">
              <Td>الإجمالي</Td>
              <Td />
              <Td />
              <Td className="ltr-nums">{fmt(lines.reduce((a, { l }) => a + Number(l.debitBase), 0))}</Td>
              <Td className="ltr-nums">{fmt(lines.reduce((a, { l }) => a + Number(l.creditBase), 0))}</Td>
            </tr>
          </Table>
        </section>
      )}
    </>
  );
}
