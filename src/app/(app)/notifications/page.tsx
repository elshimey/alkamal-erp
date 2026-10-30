import Link from "next/link";
import { db } from "@/db";
import { requireUser } from "@/lib/auth";
import { todayRiyadh } from "@/lib/dates";
import { userAlerts, withReadState } from "@/lib/alerts";
import { Icon } from "@/components/icons";
import { Card, PageHeader } from "@/components/ui";
import { MarkAllButton, OpenAlert } from "./open-alert";

const TONE = { red: "bg-red-50 text-red-700", amber: "bg-amber-50 text-amber-800", blue: "bg-sky-50 text-sky-700" } as const;

export default async function NotificationsPage() {
  const user = await requireUser();
  const list = await withReadState(db, user.id, await userAlerts(db, user, todayRiyadh()));
  const unread = list.filter((a) => !a.read);
  const read = list.filter((a) => a.read);
  const section = (title: string, items: typeof list) =>
    items.length > 0 && (
      <Card title={title} className="mb-4">
        <ul className="divide-y divide-gray-100">
          {items.map((a) => (
            <li key={a.key}>
              <OpenAlert alertKey={a.key} href={a.href} className={`flex w-full items-center gap-3 py-3 text-start text-sm transition hover:bg-gray-50 ${a.read ? "text-gray-500" : "font-medium text-gray-900"}`}>
                <span className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${a.read ? "bg-gray-100 text-gray-400" : TONE[a.tone]}`}>
                  <Icon name={a.icon} className="size-5" />
                </span>
                <span className="flex-1">{a.text}</span>
                <span className="text-xs text-brand-700">فتح ←</span>
              </OpenAlert>
            </li>
          ))}
        </ul>
      </Card>
    );
  return (
    <>
      <PageHeader title="التنبيهات" description="ما يحتاج تدخلك حسب صلاحياتك: طلبات تنتظر اعتمادك، ووثائق تقترب من الانتهاء، وطلبات السائقين. الضغط على تنبيه يفتح الشاشة المعنية، ويعود التنبيه غير مقروء إذا تغيّر عدده.">
        {unread.length > 0 && <MarkAllButton />}
      </PageHeader>
      {list.length === 0 && (
        <Card>
          <p className="py-8 text-center text-sm text-gray-500">
            لا توجد تنبيهات الآن. <Link href="/" className="text-brand-700 hover:underline">لوحة القيادة</Link>
          </p>
        </Card>
      )}
      {section(`غير مقروءة (${unread.length})`, unread)}
      {section(`مقروءة (${read.length})`, read)}
    </>
  );
}
