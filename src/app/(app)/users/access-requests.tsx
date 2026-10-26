import Link from "next/link";
import { sql } from "drizzle-orm";
import { baseSql, db } from "@/db";
import * as s from "@/db/schema";
import { openAccessRequests } from "@/lib/platform";
import { resolveAccessAction } from "./actions";

const when = (d: Date) => new Date(d).toLocaleString("en-GB", { timeZone: "Asia/Riyadh", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const waLink = (contact: string) => {
  const digits = contact.replace(/\D/g, "");
  if (digits.length < 9 || contact.includes("@")) return null;
  return `https://wa.me/${digits.startsWith("05") ? `966${digits.slice(1)}` : digits}`;
};

/** طلبات «نسيت كلمة المرور أو اسم الدخول» المفتوحة: لمدير الشركة في شاشة المستخدمين، ولمالك المنصة (schema = null) لمن لم يُعرف اسم دخوله. */
export async function AccessRequests({ schema, compact = false }: { schema: string | null; compact?: boolean }) {
  const list = await openAccessRequests(baseSql, schema);
  if (!list.length) return null;
  if (compact)
    return (
      <Link href="/users" className="mb-4 block rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 hover:bg-amber-100">
        <b>{list.length}</b> طلب «نسيت كلمة المرور أو اسم الدخول» بانتظارك ← المستخدمون
      </Link>
    );
  const logins = list.map((r) => r.login).filter(Boolean) as string[];
  const users = schema && logins.length ? await db.select({ id: s.users.id, login: s.users.login, name: s.users.name }).from(s.users).where(sql`lower(${s.users.login}) in ${logins}`) : [];
  return (
    <section className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
      <h2 className="mb-1 font-semibold text-amber-900">طلبات «نسيت كلمة المرور أو اسم الدخول»</h2>
      <p className="mb-3 text-xs text-amber-800">
        {schema ? "عيّن للمستخدم كلمة مرور جديدة ثم تواصل معه بها، واضغط «تم» بعدها." : "طلبات لم يُعرف اسم دخول صاحبها؛ تواصل معه لمعرفة شركته."}
      </p>
      <ul className="divide-y divide-amber-200/70 rounded-xl bg-white">
        {list.map((r) => {
          const user = users.find((u) => u.login.toLowerCase() === r.login);
          const wa = waLink(r.contact);
          return (
            <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
              <div className="min-w-40 flex-1">
                <div className="font-medium text-gray-900">{r.name}</div>
                <div className="ltr-nums text-xs text-gray-500" dir="ltr">
                  {r.contact}
                  {r.login ? ` · ${r.login}` : ""} · {when(r.created_at)}
                </div>
              </div>
              {schema && (user ? <span className="text-xs text-gray-600">الحساب: {user.name}</span> : <span className="text-xs text-amber-700">{r.login ? "اسم الدخول غير موجود" : "لم يذكر اسم الدخول"}</span>)}
              <div className="flex items-center gap-2">
                {user && (
                  <Link href={`/records/users/${user.id}`} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-brand-900 hover:bg-brand-500">
                    تعيين كلمة مرور جديدة
                  </Link>
                )}
                {wa && (
                  <a href={wa} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-green-600/30 bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-800 hover:bg-green-100">
                    واتساب
                  </a>
                )}
                <form action={resolveAccessAction.bind(null, r.id, schema)}>
                  <button className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">تم</button>
                </form>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
