import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { getDriverContext } from "@/lib/driver-auth";
import { tripDetail } from "@/lib/driver-app";
import { chargeTypeOptions } from "@/lib/lookups";
import { isRtl } from "@/data/driver-i18n";
import { SubmitButton } from "@/components/action-form";
import { listAttachments } from "@/lib/attachments";
import { DriverForm, PhotoInput } from "../../../offline";
import { removeTripItem } from "../../../actions";
import { DField, DInput, DSelect, fmt, Pill, Section, STATUS_TONE } from "../../../driver-ui";

export default async function TripPage({ params }: { params: Promise<{ id: string }> }) {
  const { driver, t, lang } = await getDriverContext();
  if (!driver) return null;
  const id = Number((await params).id);
  const d = await tripDetail(db, driver.id, id).catch(() => null);
  if (!d) notFound();
  const { trip, stages, fuel, expenses, next, editable } = d;
  const chargeTypes = editable ? await chargeTypeOptions() : [];
  const photos = await listAttachments(db, "waybills", [trip.id]);
  const time = (at: Date) => at.toLocaleString("en-GB", { timeZone: "Asia/Riyadh", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  // ما يضغطه السائق الآن: «استلمت الرحلة» ثم «تم التحميل» ثم «تم التسليم»
  const needsAccept = editable && !trip.driverAcceptedAt && stages.length === 0 && ["draft", "in_transit"].includes(trip.status);
  const step = next[0];

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

      {needsAccept ? (
        <DriverForm actionKey="accept" savedOffline={t.savedOffline} className="mb-3">
          <input type="hidden" name="waybillId" value={trip.id} />
          <SubmitButton pendingLabel={t.saving} className="flex w-full flex-col items-center gap-1 !rounded-2xl !py-5 text-xl">
            <span aria-hidden className="text-3xl">✋</span>
            {t.flow.accept}
          </SubmitButton>
          <p className="mt-1.5 text-center text-xs text-gray-500">{t.flow.acceptHint}</p>
        </DriverForm>
      ) : (
        step && (
          <DriverForm actionKey="stage" savedOffline={t.savedOffline} className="mb-3 flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm">
            <input type="hidden" name="waybillId" value={trip.id} />
            <input type="hidden" name="stage" value={step} />
            <PhotoInput label={t.flow.photo} />
            <PhotoInput name="photo2" label={t.flow.photo2} />
            <SubmitButton pendingLabel={t.saving} className={`flex w-full flex-col items-center gap-1 !rounded-2xl !py-5 text-xl ${step === "delivery" ? "!bg-green-600 !text-white" : ""}`}>
              <span aria-hidden className="text-3xl">{step === "delivery" ? "✅" : "📦"}</span>
              {step === "delivery" ? t.flow.delivered : t.flow.loaded}
            </SubmitButton>
          </DriverForm>
        )
      )}

      {trip.sentToDriverAt && (
        <Link href={`/driver/trips/${trip.id}/document`} className="mb-3 flex items-center justify-between gap-3 rounded-2xl border-2 border-brand-500 bg-brand-50 p-4 shadow-sm">
          <span>
            <span className="block font-semibold text-asphalt-900">📄 {t.transportDoc}</span>
            <span className="block text-xs text-gray-600">
              {t.transportDocHint}
              {trip.logistiNumber && <span className="ltr-nums"> · {trip.logistiNumber}</span>}
            </span>
          </span>
          <span className="shrink-0 rounded-full bg-asphalt-900 px-3 py-1.5 text-sm font-semibold text-brand-500">{t.openDoc}</span>
        </Link>
      )}

      {stages.length > 0 && (
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
      </Section>
      )}

      {photos.length > 0 && (
        <Section title={t.photos}>
          <div className="grid grid-cols-3 gap-2">
            {photos.map((ph) => (
              <a key={ph.id} href={`/driver/files/${ph.id}`} target="_blank" rel="noreferrer" className="block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/driver/files/${ph.id}`} alt="" loading="lazy" className="aspect-square w-full rounded-lg object-cover ring-1 ring-black/10" />
              </a>
            ))}
          </div>
        </Section>
      )}

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
            <DriverForm actionKey="fuel" savedOffline={t.savedOffline} className="mt-3 flex flex-col gap-3">
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
              <PhotoInput label={t.receiptPhoto} />
              <SubmitButton pendingLabel={t.saving}>{t.save}</SubmitButton>
            </DriverForm>
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
            <DriverForm actionKey="tripExpense" savedOffline={t.savedOffline} className="mt-3 flex flex-col gap-3">
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
              <PhotoInput label={t.receiptPhoto} />
              <SubmitButton pendingLabel={t.saving}>{t.save}</SubmitButton>
            </DriverForm>
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
