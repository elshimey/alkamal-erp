import Link from "next/link";
import { db } from "@/db";
import { getDriverContext } from "@/lib/driver-auth";
import { driverTrips, type TripStage } from "@/lib/driver-app";
import { ownerDocuments } from "@/lib/documents";
import { todayRiyadh } from "@/lib/dates";
import { Icon, Truck } from "@/components/icons";
import { isRtl } from "@/data/driver-i18n";
import { Pill, Section, STATUS_TONE } from "../driver-ui";

const ORDER: TripStage[] = ["loading", "in_transit", "border", "delivery"];

export default async function DriverHome() {
  const { driver, t, lang } = await getDriverContext();
  const arrow = isRtl(lang) ? "←" : "→";
  if (!driver) return null;
  const today = todayRiyadh();
  const [open, past, docs] = await Promise.all([
    driverTrips(db, driver.id, { open: true }),
    driverTrips(db, driver.id, { open: false, limit: 10 }),
    Promise.all([ownerDocuments(db, "driver", driver.id, today), driver.vehicle ? ownerDocuments(db, "vehicle", driver.vehicle.id, today) : []]).then(([a, b]) => [...a, ...b]),
  ]);
  const expired = docs.filter((d) => d.state === "expired").length;
  const soon = docs.filter((d) => d.state === "soon").length;

  return (
    <>
      {driver.vehicle ? (
        <Link
          href="/driver/trips/new"
          className="animate-rise group relative mb-4 flex items-center gap-4 overflow-hidden rounded-2xl bg-brand-600 p-4 text-asphalt-900 shadow-[0_8px_24px_-10px_rgba(233,161,0,0.7)] transition active:scale-[0.98]"
        >
          <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-asphalt-900 text-brand-500">
            <Icon name="waybill" className="size-6" />
          </span>
          <span className="flex-1">
            <span className="block font-display text-lg font-bold">{t.newTrip}</span>
            <span className="block text-sm text-asphalt-900/70">{t.startTrip}</span>
          </span>
          <Truck className="w-20 transition group-hover:-translate-x-1 rtl:group-hover:translate-x-1" />
        </Link>
      ) : (
        <p className="mb-4 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900">{t.noVehicle}</p>
      )}

      <Link
        href="/driver/documents"
        className={`mb-4 flex items-center justify-between gap-3 rounded-2xl border p-3.5 text-sm shadow-sm transition active:scale-[0.99] ${expired ? "border-red-200 bg-red-50 text-red-900" : soon ? "border-amber-200 bg-amber-50 text-amber-900" : "border-gray-200 bg-white text-gray-700"}`}
      >
        <span className="flex items-center gap-2 font-medium">
          <Icon name="document" className="size-5" />
          {t.docs.card}
        </span>
        <span className="flex items-center gap-1.5">
          {expired > 0 && <Pill tone="red">{`${expired} ${t.docs.states.expired}`}</Pill>}
          {soon > 0 && <Pill tone="amber">{`${soon} ${t.docs.states.soon}`}</Pill>}
          <span>{arrow}</span>
        </span>
      </Link>

      <Section title={t.activeTrips}>
        {open.length === 0 && <p className="py-3 text-center text-sm text-gray-500">{t.noTrips}</p>}
        <ul className="space-y-3">
          {open.map((w, i) => {
            const stages = ORDER.filter((x) => x !== "border" || w.isInternational);
            const reached = w.lastStage ? stages.indexOf(w.lastStage) + 1 : 0;
            return (
              <li key={w.id} className="stagger animate-rise" style={{ "--i": i } as React.CSSProperties}>
                <Link href={`/driver/trips/${w.id}`} className="block rounded-xl border border-gray-200 p-3 transition hover:border-brand-600 active:bg-gray-50">
                  <div className="flex items-center justify-between gap-2">
                    <span className="ltr-nums text-xs text-gray-500">{w.number}</span>
                    <Pill tone={STATUS_TONE[w.status]}>{t.status[w.status]}</Pill>
                  </div>
                  <div className="mt-1.5 font-semibold text-asphalt-900">
                    <bdi>{w.from}</bdi> <span className="text-brand-600">{arrow}</span> <bdi>{w.to}</bdi>
                  </div>
                  <div className="text-sm text-gray-500">{w.customer}</div>
                  <div className="mt-3 flex gap-1">
                    {stages.map((st, k) => (
                      <div key={st} className="flex-1">
                        <div className={`h-1.5 rounded-full ${k < reached ? "bg-brand-600" : "bg-gray-200"}`} />
                        <div className={`mt-1 text-center text-[10px] ${k < reached ? "text-asphalt-900" : "text-gray-400"}`}>{t.stages[st]}</div>
                      </div>
                    ))}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </Section>

      {past.length > 0 && (
        <Section title={t.pastTrips}>
          <ul className="divide-y divide-gray-100">
            {past.map((w) => (
              <li key={w.id}>
                <Link href={`/driver/trips/${w.id}`} className="flex items-center justify-between gap-2 py-2.5 text-sm">
                  <span>
                    <span className="block font-medium">
                      <bdi>{w.from}</bdi> {arrow} <bdi>{w.to}</bdi>
                    </span>
                    <span className="ltr-nums text-xs text-gray-400">
                      {w.date} · {w.number}
                    </span>
                  </span>
                  <Pill tone={STATUS_TONE[w.status]}>{t.status[w.status]}</Pill>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}
