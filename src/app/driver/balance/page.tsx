import { db } from "@/db";
import { getDriverContext } from "@/lib/driver-auth";
import { driverBalances } from "@/lib/driver-app";
import { todayRiyadh } from "@/lib/dates";
import { DRIVER_LANGS, LANG_NAMES } from "@/data/driver-i18n";
import { Icon } from "@/components/icons";
import { logout } from "../../login/actions";
import { languageAction } from "../actions";
import { fmt, Section } from "../driver-ui";

export default async function DriverBalance() {
  const { driver, t, lang } = await getDriverContext();
  if (!driver) return null;
  const b = await driverBalances(db, driver, todayRiyadh());

  return (
    <>
      <div className="animate-rise relative mb-4 overflow-hidden rounded-2xl bg-asphalt-900 p-5 text-white shadow-lg">
        <div className="road-line-h absolute inset-x-0 bottom-0 opacity-40" />
        <div className="text-sm text-white/60">{t.custody}</div>
        <div className="mt-1 font-display text-3xl font-bold text-brand-500"><span className="ltr-nums">
          {fmt(Math.abs(b.custody))} <span className="text-base text-white/60">{t.sar}</span>
        </span></div>
        {b.custody !== 0 && <div className="mt-1 text-sm text-white/70">{b.custody > 0 ? t.custodyPositive : t.custodyNegative}</div>}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3">
        {[
          { label: t.payable, v: b.payable },
          { label: t.monthCommission, v: b.monthCommission },
        ].map((k, i) => (
          <div key={k.label} className="stagger animate-rise rounded-2xl bg-white p-4 shadow-sm" style={{ "--i": i + 1 } as React.CSSProperties}>
            <div className="text-xs text-gray-500">{k.label}</div>
            <div className="mt-1 text-xl font-semibold text-asphalt-900"><span className="ltr-nums">{fmt(k.v)}</span></div>
          </div>
        ))}
      </div>
      {b.pendingCount > 0 && (
        <p className="mb-4 rounded-2xl bg-amber-50 p-3 text-sm text-amber-900">
          {t.pendingExpenses}: <b className="ltr-nums">{fmt(b.pendingExpenses)}</b> ({b.pendingCount})
        </p>
      )}

      <Section title={t.movements}>
        {b.movements.length === 0 && <p className="text-sm text-gray-400">{t.nothing}</p>}
        <ul className="divide-y divide-gray-100">
          {b.movements.map((m, i) => (
            <li key={i} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm">{m.description}</div>
                <div className="text-xs text-gray-400"><span className="ltr-nums">{m.date}</span></div>
              </div>
              <span className={`ltr-nums text-sm font-semibold ${m.debit ? "text-green-700" : "text-red-600"}`}>
                {m.debit ? `+${fmt(m.debit)}` : `−${fmt(m.credit)}`}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={t.language}>
        <form action={languageAction} className="grid grid-cols-2 gap-2">
          {DRIVER_LANGS.map((l) => (
            <button
              key={l}
              name="lang"
              value={l}
              className={`rounded-xl border px-3 py-2.5 text-sm font-medium ${l === lang ? "border-asphalt-900 bg-asphalt-900 text-brand-500" : "border-gray-300 bg-white"}`}
            >
              {LANG_NAMES[l]}
            </button>
          ))}
        </form>
        <p className="mt-3 text-xs text-gray-500">{t.install}</p>
      </Section>

      <form action={logout} className="mb-4">
        <button className="flex w-full items-center justify-center gap-2 rounded-2xl border border-gray-300 bg-white py-3 text-sm text-gray-700">
          <Icon name="logout" className="size-4" />
          {t.logout}
        </button>
      </form>
    </>
  );
}
