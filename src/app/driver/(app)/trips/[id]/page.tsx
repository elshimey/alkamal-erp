import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { getDriverContext } from "@/lib/driver-auth";
import { tripDetail } from "@/lib/driver-app";
import { chargeTypeOptions } from "@/lib/lookups";
import { isRtl } from "@/data/driver-i18n";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { fuelAction, removeTripItem, stageAction, tripExpenseAction } from "../../../actions";
import { DField, DInput, DSelect, fmt, Pill, Section, STATUS_TONE } from "../../../driver-ui";

export default async function TripPage({ params }: { params: Promise<{ id: string }> }) {
  const { driver, t, lang } = await getDriverContext();
  if (!driver) return null;
  const id = Number((await params).id);
  const d = await tripDetail(db, driver.id, id).catch(() => null);
  if (!d) notFound();
  const { trip, stages, fuel, expenses, next, editable } = d;
  const chargeTypes = editable ? await chargeTypeOptions() : [];
  const time = (at: Date) => at.toLocaleString("en-GB", { timeZone: "Asia/Riyadh", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const needsOdometer = next.includes("delivery") && next.length === 1;

  return (
    <>
      <Link href="/driver" className="mb-3 inline-block text-sm text-brand-700">
        ← {t.back}
      </Link>
      <Section>
        <div className="flex items-center justify-between gap-2">
          <span className="ltr-nums text-sm text-gray-500">
            {trip.number} · {trip.date}
          </span>
          <Pill tone={STATUS_TONE[trip.status]}>{t.status[trip.status]}</Pill>
        </div>
        <h1 className="mt-2 text-xl font-bold text-asphalt-900">
          <bdi>{trip.from}</bdi> <span className="text-brand-600">{isRtl(lang) ? "←" : "→"}</span> <bdi>{trip.to}</bdi>
        </h1>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div>
            <dt className="text-xs text-gray-400">{t.customer}</dt>
            <dd className="font-medium">{trip.customer}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-400">{t.consignee}</dt>
            <dd className="font-medium">{trip.consignee}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-400">{t.shipper}</dt>
            <dd>{trip.shipper}</dd>
          </div>
          {trip.containerNumber && (
            <div>
              <dt className="text-xs text-gray-400">{t.container}</dt>
              <dd className="ltr-nums">{trip.containerNumber}</dd>
            </div>
          )}
        </dl>
        {trip.status === "rejected" && (
          <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">
            <b>{t.rejected}:</b> {trip.rejectionReason}
          </p>
        )}
        {trip.status === "delivered" && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{t.waitingApproval}</p>}
        {(trip.status === "approved" || trip.status === "invoiced") && <p className="mt-3 rounded-xl bg-green-50 p-3 text-sm text-green-800">{t.closed}</p>}
      </Section>

      <Section title={t.timeline}>
        <ol className="relative ms-3 border-s-2 border-dashed border-brand-600/50">
          {stages.map((st) => (
            <li key={st.id} className="relative ms-5 pb-4 last:pb-1">
              <span className="absolute -start-[29px] top-1 size-4 rounded-full border-2 border-white bg-brand-600 ring-2 ring-brand-600/30" />
              <div className="font-medium">{t.stages[st.stage]}</div>
              <div className="text-xs text-gray-500"><span className="ltr-nums">
                {time(st.at)}
                {st.odometer != null && ` · ${st.odometer.toLocaleString("en")} km`}
              </span></div>
              {st.note && <div className="text-sm text-gray-600">{st.note}</div>}
            </li>
          ))}
        </ol>
        {next.length > 0 && (
          <ActionForm action={stageAction} className="mt-2 flex flex-col gap-3 rounded-xl bg-brand-50 p-3">
            <input type="hidden" name="waybillId" value={trip.id} />
            <div className="text-sm font-semibold text-asphalt-900">{t.nextStage}</div>
            <div className="flex flex-wrap gap-2">
              {next.map((st, i) => (
                <label key={st} className="cursor-pointer">
                  <input type="radio" name="stage" value={st} defaultChecked={i === 0} className="peer sr-only" />
                  <span className="block rounded-full border border-gray-300 bg-white px-4 py-2 text-sm font-medium peer-checked:border-asphalt-900 peer-checked:bg-asphalt-900 peer-checked:text-brand-500">
                    {t.stages[st]}
                  </span>
                </label>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <DField label={t.odometer} hint={needsOdometer ? undefined : t.optional}>
                <DInput name="odometer" inputMode="numeric" dir="ltr" required={needsOdometer} />
              </DField>
              <DField label={t.note} hint={t.optional}>
                <DInput name="note" />
              </DField>
            </div>
            <SubmitButton pendingLabel={t.saving} className="w-full py-3 text-base">
              {t.record}
            </SubmitButton>
          </ActionForm>
        )}
      </Section>

      <Section title={t.fuel}>
        <ItemList
          empty={t.nothing}
          items={fuel.map((f) => ({
            id: f.id,
            main: `${f.liters ? `${Number(f.liters).toLocaleString("en")} L · ` : ""}${fmt(Number(f.amount) + Number(f.vatAmount))} ${f.currencyCode}`,
            sub: `${t.fuelSources[f.source as "custody" | "fuel_card"] ?? f.source}${f.invoiceNumber ? ` · #${f.invoiceNumber}` : ""}`,
            remove: editable ? removeTripItem.bind(null, trip.id, "fuel", f.id) : undefined,
          }))}
          removeLabel={t.remove}
        />
        {editable && (
          <details className="mt-3 rounded-xl border border-gray-200 p-3 [&_summary::-webkit-details-marker]:hidden">
            <summary className="cursor-pointer text-sm font-semibold text-brand-700">+ {t.addFuel}</summary>
            <ActionForm action={fuelAction} className="mt-3 flex flex-col gap-3">
              <input type="hidden" name="waybillId" value={trip.id} />
              <DField label={t.source}>
                <DSelect name="source" defaultValue="custody">
                  <option value="custody">{t.fuelSources.custody}</option>
                  <option value="fuel_card">{t.fuelSources.fuel_card}</option>
                </DSelect>
              </DField>
              <div className="grid grid-cols-2 gap-3">
                <DField label={t.liters}>
                  <DInput name="liters" inputMode="decimal" dir="ltr" />
                </DField>
                <DField label={`${t.amount} (${t.sar})`}>
                  <DInput name="amount" inputMode="decimal" dir="ltr" required />
                </DField>
                <DField label={t.vat} hint={t.optional}>
                  <DInput name="vatAmount" inputMode="decimal" dir="ltr" />
                </DField>
                <DField label={t.invoiceNo} hint={t.optional}>
                  <DInput name="invoiceNumber" dir="ltr" />
                </DField>
              </div>
              <SubmitButton pendingLabel={t.saving}>{t.save}</SubmitButton>
            </ActionForm>
          </details>
        )}
      </Section>

      <Section title={t.tripExpenses}>
        <ItemList
          empty={t.nothing}
          items={expenses.map(({ e, type }) => ({
            id: e.id,
            main: `${type} · ${fmt(e.amount)} ${e.currencyCode}`,
            sub: e.note ?? "",
            remove: editable ? removeTripItem.bind(null, trip.id, "expense", e.id) : undefined,
          }))}
          removeLabel={t.remove}
        />
        {editable && (
          <details className="mt-3 rounded-xl border border-gray-200 p-3 [&_summary::-webkit-details-marker]:hidden">
            <summary className="cursor-pointer text-sm font-semibold text-brand-700">+ {t.addTripExpense}</summary>
            <ActionForm action={tripExpenseAction} className="mt-3 flex flex-col gap-3">
              <input type="hidden" name="waybillId" value={trip.id} />
              <DField label={t.chargeType}>
                <DSelect name="chargeTypeId" required defaultValue="">
                  <option value="" disabled>
                    {t.choose}
                  </option>
                  {chargeTypes.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </DSelect>
              </DField>
              <div className="grid grid-cols-2 gap-3">
                <DField label={t.amount}>
                  <DInput name="amount" inputMode="decimal" dir="ltr" required />
                </DField>
                <DField label={t.currency}>
                  <DSelect name="currencyCode" defaultValue="SAR">
                    <option value="SAR">SAR</option>
                    <option value="KWD">KWD</option>
                  </DSelect>
                </DField>
              </div>
              <DField label={t.note} hint={t.optional}>
                <DInput name="note" />
              </DField>
              <SubmitButton pendingLabel={t.saving}>{t.save}</SubmitButton>
            </ActionForm>
          </details>
        )}
      </Section>
    </>
  );
}

function ItemList({ items, empty, removeLabel }: { items: { id: number; main: string; sub: string; remove?: () => Promise<void> }[]; empty: string; removeLabel: string }) {
  if (items.length === 0) return <p className="text-sm text-gray-400">{empty}</p>;
  return (
    <ul className="divide-y divide-gray-100">
      {items.map((it) => (
        <li key={it.id} className="flex items-center justify-between gap-3 py-2">
          <div>
            <div className="text-sm font-medium" style={{ unicodeBidi: "plaintext" }}>
              {it.main}
            </div>
            {it.sub && <div className="text-xs text-gray-500">{it.sub}</div>}
          </div>
          {it.remove && (
            <form action={it.remove}>
              <button className="rounded-lg px-2 py-1 text-xs text-red-600 hover:bg-red-50">{removeLabel}</button>
            </form>
          )}
        </li>
      ))}
    </ul>
  );
}
