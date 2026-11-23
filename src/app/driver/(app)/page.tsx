import Link from "next/link";
import { db } from "@/db";
import { getDriverContext } from "@/lib/driver-auth";
import { driverTrips } from "@/lib/driver-app";
import { driverTripRequests } from "@/lib/driver-trip-requests";
import { driverDocuments } from "@/lib/driver-docs";
import { todayRiyadh } from "@/lib/dates";
import { Icon } from "@/components/icons";
import { isRtl } from "@/data/driver-i18n";
import { Pill, Section, STATUS_TONE } from "../driver-ui";

export default async function DriverHome() {
  const { driver, t, lang } = await getDriverContext();
  const arrow = isRtl(lang) ? "←" : "→";
  if (!driver) return null;
  const today = todayRiyadh();
  const [open, past, docs, requests] = await Promise.all([
    driverTrips(db, driver.id, { open: true }),
    driverTrips(db, driver.id, { open: false, limit: 10 }),
    driverDocuments(db, driver, today).then((d) => [...d.mine, ...d.vehicle, ...d.trailerDocs]),
    driverTripRequests(db, driver.id),
  ]);
  const time = (at: Date) => at.toLocaleString("en-GB", { timeZone: "Asia/Riyadh", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const expired = docs.filter((d) => d.state === "expired").length;
  const soon = docs.filter((d) => d.state === "soon").length;

  return (
    <>
      {!driver.vehicle && <p className="mb-4 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900">{t.noVehicle}</p>}

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

      {driver.vehicle && (
        <Link href="/driver/trips/new" className="mb-4 flex items-center justify-center gap-2 rounded-2xl bg-asphalt-900 p-4 text-base font-semibold text-brand-500 shadow-sm transition active:scale-[0.99]">
          <span aria-hidden>🚚</span>
          {t.req.start}
        </Link>
      )}

      {requests.length > 0 && (
        <Section title={t.req.title}>
          <ul className="space-y-3">
            {requests.map((r) => (
              <li key={r.id}>
                <Link href={`/driver/requests/${r.id}`} className={`block rounded-xl border p-3 transition active:bg-gray-50 ${r.status === "pending" ? "border-amber-300 bg-amber-50/50" : "border-red-200 bg-red-50/50"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="ltr-nums text-xs text-gray-500">{time(r.requestedAt)}</span>
                    {r.status === "pending" ? <Pill tone="amber">{t.req.waiting}</Pill> : <Pill tone="red">{t.req.rejected}</Pill>}
                  </div>
                  {r.status === "rejected" && r.rejectionReason && <div className="mt-1 text-sm text-red-700">{r.rejectionReason}</div>}
                  {r.status === "pending" && (
                    <div className="mt-3 flex gap-1">
                      {(["loading", "delivery"] as const).map((st) => (
                        <div key={st} className="flex-1">
                          <div className={`h-1.5 rounded-full ${r.stages.includes(st) ? "bg-brand-600" : "bg-gray-200"}`} />
                          <div className={`mt-1 text-center text-[10px] ${r.stages.includes(st) ? "text-asphalt-900" : "text-gray-400"}`}>{t.flow.steps[st]}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={t.activeTrips}>
        {open.length === 0 && <p className="py-3 text-center text-sm text-gray-500">{t.noTrips}</p>}
        <ul className="space-y-3">
          {open.map((w, i) => {
            const fresh = !w.driverAcceptedAt && !w.lastStage;
            const done = [!!w.driverAcceptedAt || !!w.lastStage, !!w.lastStage || w.deliverOnly, w.lastStage === "delivery"];
            return (
              <li key={w.id} className="stagger animate-rise" style={{ "--i": i } as React.CSSProperties}>
                <Link href={`/driver/trips/${w.id}`} className={`block rounded-xl border p-3 transition hover:border-brand-600 active:bg-gray-50 ${fresh ? "border-2 border-brand-600 bg-brand-50" : "border-gray-200"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="ltr-nums text-xs text-gray-500">{w.number}</span>
                    {fresh ? <Pill tone="amber">{t.flow.newTrip}</Pill> : <Pill tone={STATUS_TONE[w.status]}>{t.status[w.status]}</Pill>}
                  </div>
                  <div className="mt-1.5 font-semibold text-asphalt-900">
                    <bdi>{w.from}</bdi> <span className="text-brand-600">{arrow}</span> <bdi>{w.to}</bdi>
                  </div>
                  <div className="text-sm text-gray-500">{w.customer}</div>
                  <div className="mt-3 flex gap-1">
                    {(["accept", "loading", "delivery"] as const).map((st, k) => (
                      <div key={st} className="flex-1">
                        <div className={`h-1.5 rounded-full ${done[k] ? "bg-brand-600" : "bg-gray-200"}`} />
                        <div className={`mt-1 text-center text-[10px] ${done[k] ? "text-asphalt-900" : "text-gray-400"}`}>{t.flow.steps[st]}</div>
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
