import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { getDriverContext } from "@/lib/driver-auth";
import { driverExpenses, tripCustodySummary, tripDetail } from "@/lib/driver-app";
import { isRtl, type DriverExpenseType } from "@/data/driver-i18n";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { listAttachments } from "@/lib/attachments";
import { DriverForm, PhotoInput } from "../../../offline";
import { undoStageAction } from "../../../actions";
import { CustodyBox, fmt, Pill, Section, STATUS_TONE } from "../../../driver-ui";

const EXPENSE_TONE = { pending: "amber", approved: "green", rejected: "red", voided: "gray" } as const;

export default async function TripPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, driver, t, lang } = await getDriverContext();
  if (!driver) return null;
  const id = Number((await params).id);
  const d = await tripDetail(db, driver.id, id).catch(() => null);
  if (!d) notFound();
  const { trip, stages, fuel, expenses, next, editable } = d;
  const [photos, [box], mine] = await Promise.all([listAttachments(db, "waybills", [trip.id]), tripCustodySummary(db, driver.id, [trip.id]), driverExpenses(db, driver.id, trip.id)]);
  // التراجع عن آخر مرحلة ما دامت الرحلة غير مغلقة
  const lastStage = stages.at(-1);
  const canUndo = !!lastStage && lastStage.createdBy === user.id && ["draft", "in_transit", "delivered"].includes(trip.status);
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
            <PhotoInput label={t.flow.photo} required />
            <PhotoInput name="photo2" label={t.flow.photo2} />
            <SubmitButton pendingLabel={t.saving} className={`flex w-full flex-col items-center gap-1 !rounded-2xl !py-5 text-xl ${step === "delivery" ? "!bg-green-600 !text-white" : ""}`}>
              <span aria-hidden className="text-3xl">{step === "delivery" ? "✅" : "📦"}</span>
              {step === "delivery" ? t.flow.delivered : t.flow.loaded}
            </SubmitButton>
          </DriverForm>
        )
      )}

      {/* وثيقة النقل لا تظهر للسائق حتى الربط مع منصة بيان (لوجستي)؛ وثيقة البرنامج داخلية لا تعتمدها المنافذ */}
      <Section
        title={t.x.tripExpenses}
        action={
          <Link href={`/driver/expenses?trip=${trip.id}`} className="rounded-xl bg-asphalt-900 px-3 py-2 text-sm font-semibold text-brand-500 active:scale-[0.98]">
            {t.x.addForTrip}
          </Link>
        }
      >
        {box && box.custody > 0 && (
          <div className="mb-3">
            <p className="mb-2 text-xs text-gray-500">💵 {t.tripCustodyHint}</p>
            <CustodyBox t={t} box={box} />
          </div>
        )}
        {mine.length === 0 ? (
          <p className="text-sm text-gray-400">{t.nothing}</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {mine.map(({ e }) => (
              <li key={e.id} className={`flex items-center justify-between gap-3 py-2 ${e.status === "voided" ? "opacity-60" : ""}`}>
                <span className="min-w-0 text-sm">
                  {e.driverKind && e.driverKind in t.expenseTypes ? t.expenseTypes[e.driverKind as DriverExpenseType] : e.description}
                  <span className="ltr-nums block text-xs text-gray-400">{e.number}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <b className="ltr-nums text-sm">{fmt(Number(e.amount) + Number(e.vatAmount))}</b>
                  <Pill tone={EXPENSE_TONE[e.status]}>{t.expenseStatus[e.status]}</Pill>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

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
        {canUndo && (
          <details className="mt-2 rounded-xl border border-gray-200 px-3 py-2 [&_summary::-webkit-details-marker]:hidden">
            <summary className="cursor-pointer text-sm font-semibold text-red-700">↩️ {t.x.undo}</summary>
            <ActionForm action={undoStageAction.bind(null, trip.id)} className="mt-2 flex flex-col gap-2">
              <p className="text-sm text-gray-600">{t.x.undoConfirm.replace("{stage}", t.stages[lastStage.stage])}</p>
              <SubmitButton pendingLabel={t.saving} className="!bg-red-600 !text-white">
                {t.x.undo}
              </SubmitButton>
            </ActionForm>
          </details>
        )}
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

      {(fuel.length > 0 || expenses.length > 0) && (
        <Section title={t.x.previous}>
          <ItemList
            empty={t.nothing}
            items={[
              ...fuel.map((f) => ({
                id: `f${f.id}`,
                main: `${t.fuel} · ${f.liters ? `${Number(f.liters).toLocaleString("en")} L · ` : ""}${fmt(Number(f.amount) + Number(f.vatAmount))} ${f.currencyCode}`,
                sub: `${t.fuelSources[f.source as "custody" | "fuel_card"] ?? f.source}${f.invoiceNumber ? ` · #${f.invoiceNumber}` : ""}`,
              })),
              ...expenses.map(({ e, type }) => ({ id: `e${e.id}`, main: `${type} · ${fmt(e.amount)} ${e.currencyCode}`, sub: e.note ?? "" })),
            ]}
          />
        </Section>
      )}
    </>
  );
}

function ItemList({ items, empty }: { items: { id: string; main: string; sub: string }[]; empty: string }) {
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
        </li>
      ))}
    </ul>
  );
}
