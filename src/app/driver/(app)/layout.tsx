import Link from "next/link";
import { getDriverContext } from "@/lib/driver-auth";
import { isRtl } from "@/data/driver-i18n";
import { BrandMark } from "@/components/logo";
import { getBrand } from "@/lib/brand";
import { TabBar } from "../tab-bar";
import { driverLogout } from "../actions";
import { OfflineSync } from "../offline";
import { Icon } from "@/components/icons";
import { db } from "@/db";
import { unreadCount } from "@/lib/driver-notify";

export default async function DriverLayout({ children }: { children: React.ReactNode }) {
  const { user, driver, lang, t } = await getDriverContext();
  const office = user.roles.some((r) => r.key !== "driver");
  const [brand, unread] = await Promise.all([getBrand(true), driver ? unreadCount(db, driver.id) : 0]);
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
          {driver && (
            <Link href="/driver/notifications" aria-label={t.x.notifications} title={t.x.notifications} className="relative flex flex-col items-center gap-0.5 rounded-lg px-1.5 py-1 text-white/80 active:bg-white/10">
              <Icon name="bell" className="size-5" />
              <span className="text-[10px] leading-none">{t.x.notifications}</span>
              {unread > 0 && (
                <span className="ltr-nums absolute -top-1 end-0 min-w-5 rounded-full bg-red-600 px-1 text-center text-[11px] leading-5 font-bold text-white ring-2 ring-asphalt-900">{unread > 99 ? "99+" : unread}</span>
              )}
            </Link>
          )}
          {driver && (
            <form action={driverLogout}>
              <button aria-label={t.logout} title={t.logout} className="flex flex-col items-center gap-0.5 rounded-lg px-1.5 py-1 text-white/80 active:bg-white/10">
                <Icon name="logout" className="size-5" />
                <span className="text-[10px] leading-none">{t.logout}</span>
              </button>
            </form>
          )}
          {driver?.vehicle && (
            <div className="rounded-lg border-2 border-white/80 bg-white px-2 py-1 text-center text-asphalt-900 shadow" title={t.vehicle}>
              <div className="text-[9px] leading-none text-gray-500">{t.vehicle}</div>
              <div className="text-sm leading-tight font-bold whitespace-nowrap">{driver.vehicle.plate}</div>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-md px-4 pt-4">
        {driver && <OfflineSync labels={{ offline: t.offline, pending: t.pendingSync, sending: t.sending, retry: t.sendNow, failed: t.syncFailed }} />}
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
