import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { todayRiyadh } from "@/lib/dates";
import { EXPIRY_ALERT_DAYS, expiringDocuments } from "@/lib/fleet";
import { DOCUMENT_TYPES } from "@/data/fleet";
import { ExpiryBadge } from "@/components/expiry-badge";
import { Card, PageHeader, Table, Td } from "@/components/ui";

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
  const stats = [
    { label: "المركبات", value: counts.vehicles, href: "/vehicles" },
    { label: "السائقون النشطون", value: counts.drivers, href: "/drivers" },
    { label: "المستخدمون النشطون", value: counts.users, href: "/users" },
    { label: "القيود المرحّلة", value: counts.entries },
  ];

  return (
    <>
      <PageHeader title={`أهلاً، ${user.name}`} description="لوحة البداية. تظهر هنا مؤشرات التشغيل والربحية عند إضافة وحدات البوالص والفواتير." />
      {denied && (
        <p className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">ليست لديك صلاحية لفتح الصفحة المطلوبة.</p>
      )}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => {
          const body = (
            <Card className="h-full">
              <div className="text-sm text-gray-500">{s.label}</div>
              <div className="ltr-nums mt-2 text-3xl font-bold text-brand-900">{s.value}</div>
            </Card>
          );
          return s.href ? (
            <Link key={s.label} href={s.href} className="block transition hover:-translate-y-0.5">
              {body}
            </Link>
          ) : (
            <div key={s.label}>{body}</div>
          );
        })}
      </div>
      {due.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 font-semibold text-gray-800">
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
