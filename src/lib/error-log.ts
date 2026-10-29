import "server-only";
import { createHash } from "node:crypto";
import { baseSql } from "@/db";
import { currentSchema } from "@/db/tenant";
import { mailConfigured, sendMail } from "@/lib/mailer";

// سجل الأخطاء غير المتوقعة: يُحفظ في platform.error_log ويظهر لمالك المنصة في /owner،
// ويُرسل بريد تنبيه أول مرة يظهر فيها الخطأ في اليوم (حتى 20 رسالة يومياً) إلى ERROR_ALERT_EMAIL أو SMTP_USER.

const MAX_MAILS_PER_DAY = 20;

const fingerprintOf = (message: string, stack: string) =>
  createHash("sha1")
    .update(message.replace(/\d+/g, "#") + "|" + (stack.split("\n").find((l) => l.includes("/src/") || l.trim().startsWith("at ")) ?? ""))
    .digest("hex");

/** يسجل الخطأ ولا يرمي أبداً: فشل التسجيل نفسه لا يجب أن يكسر طلب المستخدم. */
export async function recordError(err: unknown, ctx: { path?: string; sql?: typeof baseSql } = {}) {
  const sql = ctx.sql ?? baseSql;
  try {
    const e = err instanceof Error ? err : new Error(String(err));
    // أخطاء الاستعلام: السبب الحقيقي في cause، ونص الاستعلام الطويل يُختصر
    const cause = (e as { cause?: unknown }).cause;
    const message = (
      e.message?.startsWith("Failed query") && cause instanceof Error ? `${cause.message} · ${e.message.slice(14, 120)}…` : e.message || e.name || "خطأ غير معروف"
    ).slice(0, 1000);
    const stack = (e.stack ?? "").slice(0, 4000);
    const schema = await currentSchema().catch(() => null);
    const [row] = await sql<{ inserted: boolean }[]>`
      insert into platform.error_log (fingerprint, schema_name, path, message, stack)
      values (${fingerprintOf(message, stack)}, ${schema}, ${ctx.path ?? null}, ${message}, ${stack})
      on conflict (fingerprint, day) do update set count = platform.error_log.count + 1, last_at = now(), path = coalesce(excluded.path, platform.error_log.path)
      returning (xmax = 0) as inserted`;
    if (!row?.inserted) return;
    await sql`delete from platform.error_log where day < current_date - 90`;
    const to = process.env.ERROR_ALERT_EMAIL || process.env.SMTP_USER;
    if (!to || !mailConfigured()) return;
    const [today] = await sql<{ n: number }[]>`select count(*)::int as n from platform.error_log where day = current_date`;
    if (today.n > MAX_MAILS_PER_DAY) return;
    const lines = [`الخطأ: ${message}`, `الشركة: ${schema ?? "—"}`, `الصفحة: ${ctx.path ?? "—"}`, `الوقت: ${new Date().toLocaleString("en-GB", { timeZone: "Asia/Riyadh" })}`, "", "التفاصيل الكاملة في صفحة الشركات المشتركة (أخطاء البرنامج)."];
    await sendMail({
      to,
      fromName: "تنبيهات البرنامج",
      subject: `خطأ في البرنامج: ${message.slice(0, 80)}`,
      text: lines.join("\n"),
      html: `<div dir="rtl" style="font-family:sans-serif">${lines.map((l) => (l ? `<p>${l.replace(/</g, "&lt;")}</p>` : "<br>")).join("")}</div>`,
    });
  } catch (logErr) {
    console.error("error log failed", logErr);
  }
}

export type ErrorRow = { id: number; day: string; schema_name: string | null; path: string | null; message: string; stack: string | null; count: number; last_at: Date };

export async function recentErrors(limit = 30, sql = baseSql) {
  return sql<ErrorRow[]>`select id, day::text, schema_name, path, message, stack, count, last_at from platform.error_log order by last_at desc limit ${limit}`;
}
