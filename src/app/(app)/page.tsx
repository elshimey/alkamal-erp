import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireUser } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const user = await requireUser();
  const { denied } = await searchParams;
  const [counts] = (await db.execute(sql`
    select
      (select count(*) from vehicles)::int as vehicles,
      (select count(*) from accounts)::int as accounts,
      (select count(*) from users where is_active)::int as users,
      (select count(*) from journal_entries where status = 'posted')::int as entries
  `)) as unknown as { vehicles: number; accounts: number; users: number; entries: number }[];

  const stats = [
    { label: "المركبات", value: counts.vehicles, href: "/vehicles" },
    { label: "الحسابات في الشجرة", value: counts.accounts, href: "/accounts" },
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
    </>
  );
}
