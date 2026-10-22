import Link from "next/link";
import { getDriverContext } from "@/lib/driver-auth";
import { isRtl } from "@/data/driver-i18n";
import { BrandMark } from "@/components/logo";
import { getBrand } from "@/lib/brand";
import { TabBar } from "../tab-bar";
import { driverLogout } from "../actions";

export default async function DriverLayout({ children }: { children: React.ReactNode }) {
  const { user, driver, lang, t } = await getDriverContext();
  const office = user.roles.some((r) => r.key !== "driver");
  const brand = await getBrand(true);
  return (
    <div dir={isRtl(lang) ? "rtl" : "ltr"} lang={lang} className="min-h-screen bg-concrete pb-24">
      <header className="relative overflow-hidden bg-asphalt-900 px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-4 text-white">
        <div className="road-line-h road-moving-h absolute inset-x-0 bottom-0 opacity-60" />
        <div className="mx-auto flex max-w-md items-center gap-3">
          <BrandMark logo={brand.logo} size={34} />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[11px] text-white/55">{brand.known ? brand.name : t.appName}</div>
            <div className="truncate font-display text-base font-semibold">{driver ? <>{t.hello} <bdi>{driver.name}</bdi></> : t.appName}</div>
          </div>
          {driver?.vehicle && (
            <div className="rounded-lg border-2 border-white/80 bg-white px-2 py-1 text-center text-asphalt-900 shadow" title={t.vehicle}>
              <div className="text-[9px] leading-none text-gray-500">{t.vehicle}</div>
              <div className="text-sm leading-tight font-bold whitespace-nowrap">{driver.vehicle.plate}</div>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-md px-4 pt-4">
        {driver ? (
          children
        ) : (
          <div className="space-y-4 rounded-2xl bg-white p-6 text-center shadow-sm">
            <p className="text-sm text-gray-500">
              {t.signedInAs} <bdi className="font-semibold text-gray-900">{user.name}</bdi> (<bdi dir="ltr">{user.login}</bdi>)
            </p>
            <p className="text-gray-700">{t.notLinked}</p>
            <form action={driverLogout}>
              <button className="w-full rounded-xl bg-brand-600 px-4 py-3 font-semibold text-brand-900 shadow-sm active:scale-[0.98]">{t.switchAccount}</button>
            </form>
            {office && (
              <Link href="/" className="block text-sm font-medium text-brand-700 hover:underline">
                {t.openOffice}
              </Link>
            )}
          </div>
        )}
      </main>
      {driver && (
        <TabBar
          tabs={[
            { href: "/driver", label: t.tabs.trips, icon: "waybill" },
            { href: "/driver/expenses", label: t.tabs.expenses, icon: "fuel" },
            { href: "/driver/breakdown", label: t.tabs.breakdown, icon: "wrench" },
            { href: "/driver/balance", label: t.tabs.balance, icon: "cash" },
          ]}
        />
      )}
    </div>
  );
}
