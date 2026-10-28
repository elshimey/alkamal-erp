import Link from "next/link";
import { db } from "@/db";
import { getDriverContext } from "@/lib/driver-auth";
import { driverNotifications, markNotificationsRead, type NotifyKind } from "@/lib/driver-notify";
import { Section } from "../../driver-ui";

const ICON: Record<string, string> = {
  trip_sent: "🚚",
  trip_unsent: "↩️",
  expense_approved: "✅",
  expense_rejected: "❌",
  maint_approved: "🔧",
  maint_rejected: "❌",
  advance_approved: "💵",
  advance_rejected: "❌",
};

export default async function DriverNotifications() {
  const { driver, t } = await getDriverContext();
  if (!driver) return null;
  const rows = await driverNotifications(db, driver.id);
  // فتح الصفحة يعلّم الإشعارات مقروءة، وتبقى الجديدة مميزة في هذه الزيارة
  if (rows.some((n) => !n.readAt)) await markNotificationsRead(db, driver.id);
  const time = (at: Date) => at.toLocaleString("en-GB", { timeZone: "Asia/Riyadh", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  return (
    <Section title={t.x.notifications}>
      {rows.length === 0 && <p className="text-sm text-gray-400">{t.x.noNotifications}</p>}
      <ul className="divide-y divide-gray-100">
        {rows.map((n) => {
          const body = (
            <div className="flex items-start gap-3 py-3">
              <span aria-hidden className="text-xl">{ICON[n.kind] ?? "🔔"}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <b className="text-sm text-asphalt-900">{t.notify[n.kind as NotifyKind] ?? n.title}</b>
                  {!n.readAt && <span className="rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">{t.x.new}</span>}
                </div>
                {n.body && (
                  <p className="text-sm text-gray-600" style={{ unicodeBidi: "plaintext" }}>
                    {n.body}
                  </p>
                )}
                <div className="ltr-nums text-xs text-gray-400">{time(n.createdAt)}</div>
              </div>
            </div>
          );
          return <li key={n.id}>{n.href ? <Link href={n.href} className="block active:bg-gray-50">{body}</Link> : body}</li>;
        })}
      </ul>
    </Section>
  );
}
