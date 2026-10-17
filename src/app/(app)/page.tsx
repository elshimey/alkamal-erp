import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { todayRiyadh } from "@/lib/dates";
import { EXPIRY_ALERT_DAYS, expiringDocuments } from "@/lib/fleet";
import { DOCUMENT_TYPES } from "@/data/fleet";
import { ExpiryBadge } from "@/components/expiry-badge";
import { CountUp } from "@/components/count-up";
import { Icon, Truck, type IconName } from "@/components/icons";
import { Table, Td } from "@/components/ui";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const user = await requireUser();
  const { denied } = await searchParams;
  const [counts] = (await db.execute(sql`
    select
      (select count(*) from vehicles)::int as vehicles,
      (select count(*) from drivers where status = 'active')::int as drivers,
      (select count(*) from accounts)::int as accounts,
      (select count(*) from users where is_active)::int as users,
      (select count(*) from journal_entries where status = 'posted')::int as entries
  `)) as unknown as { vehicles: number; drivers: number; accounts: number; users: number; entries: number }[];

  const today = todayRiyadh();
  const due = can(user.perms, "fleet_documents", "view") ? await expiringDocuments(db, today) : [];
  const stats: { label: string; value: number; icon: IconName; href?: string }[] = [
    { label: "المركبات", value: counts.vehicles, icon: "truck", href: "/vehicles" },
    { label: "السائقون النشطون", value: counts.drivers, icon: "driver", href: "/drivers" },
    { label: "المستخدمون النشطون", value: counts.users, icon: "user", href: "/users" },
    { label: "القيود المرحّلة", value: counts.entries, icon: "ledger" },
  ];
  const now = new Date();
  const gregorian = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Riyadh" }).format(now);
  const hijri = new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura-nu-latn", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Riyadh" }).format(now);

  return (
    <>
      {/* لوحة الترحيب: طريق تعبره شاحنة */}
      <section className="relative mb-7 overflow-hidden rounded-2xl bg-asphalt-900 px-7 pt-7 pb-16 text-white shadow-lg">
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-brand-500">{gregorian}</p>
            <h1 className="mt-1 text-3xl font-semibold">أهلاً، {user.name}</h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/60">
              لوحة البداية. تظهر هنا مؤشرات التشغيل والربحية عند إضافة وحدات البوالص والفواتير.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full bg-white/[0.06] px-4 py-2 text-xs text-white/70">
            <Icon name="calendar" className="size-4 text-brand-500" />
            {hijri}
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-0 h-12 bg-asphalt-800">
          <div className="road-line-h road-moving-h absolute inset-x-0 bottom-3 opacity-80" />
          <div className="drive-across absolute bottom-2">
            <Truck className="truck-bump w-16" spinning />
          </div>
        </div>
      </section>
      {denied && (
        <p className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">ليست لديك صلاحية لفتح الصفحة المطلوبة.</p>
      )}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s, i) => {
          const body = (
            <div className="group relative h-full overflow-hidden rounded-2xl border border-black/[0.06] bg-white p-5 shadow-[0_4px_16px_-8px_rgba(27,33,38,0.1)] transition duration-300 hover:-translate-y-1 hover:shadow-lg">
              <div className="flex items-start justify-between gap-3">
                <div className="text-sm text-gray-500">{s.label}</div>
                <span className="flex size-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700 transition group-hover:bg-brand-600 group-hover:text-brand-900">
                  <Icon name={s.icon} />
                </span>
              </div>
              <CountUp value={s.value} className="mt-3 block font-display text-4xl font-semibold text-brand-900" />
              {/* خط طريق يمتد أسفل البطاقة عند المرور */}
              <div className="road-line-h absolute inset-x-0 bottom-0 h-1 origin-right scale-x-0 transition-transform duration-500 group-hover:scale-x-100" />
            </div>
          );
          return (
            <div key={s.label} className="animate-rise stagger" style={{ "--i": i } as React.CSSProperties}>
              {s.href ? (
                <Link href={s.href} className="block h-full">
                  {body}
                </Link>
              ) : (
                body
              )}
            </div>
          );
        })}
      </div>
      {due.length > 0 && (
        <section className="animate-rise stagger mt-9" style={{ "--i": 4 } as React.CSSProperties}>
          <h2 className="mb-3 flex items-center gap-2 font-semibold text-brand-900">
            <Icon name="alert" className="size-5 text-red-600" />
            وثائق منتهية أو تنتهي خلال {EXPIRY_ALERT_DAYS} يوماً ({due.length})
          </h2>
          <Table head={["صاحب الوثيقة", "النوع", "الانتهاء", "الحالة"]}>
            {due.map(({ doc, plate, driverName }) => (
              <tr key={doc.id}>
                <Td className="font-medium">{plate ?? driverName}</Td>
                <Td>{DOCUMENT_TYPES[doc.type]}</Td>
                <Td className="ltr-nums">{doc.expiryDate}</Td>
                <Td>
                  <ExpiryBadge expiryDate={doc.expiryDate} today={today} />
                </Td>
              </tr>
            ))}
          </Table>
        </section>
      )}
    </>
  );
}
