import "server-only";
import { createHash } from "node:crypto";
import { baseSql } from "@/db";
import { currentSchema } from "@/db/tenant";
import { mailConfigured, sendMail } from "@/lib/mailer";
import { DRIVER_DICT } from "@/data/driver-i18n";

// سجل الأخطاء غير المتوقعة: يُحفظ في platform.error_log ويظهر لمالك المنصة في /owner#errors،
// ويُرسل بريد تنبيه أول مرة يظهر فيها الخطأ في اليوم لكل شركة (حتى 20 رسالة يومياً) إلى ERROR_ALERT_EMAIL أو SMTP_USER.
// البريد يذكر اسم الشركة ورمز دخولها، والمستخدم ودوره، وشرحاً بسيطاً لما حدث وما يُفعل.

const MAX_MAILS_PER_DAY = 20;
const APP_URL = process.env.APP_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "https://alkamal-erp.vercel.app");

// الشركة جزء من البصمة: نفس الخطأ في شركتين يصل عنه بريدان (لكل شركة واحد)
const fingerprintOf = (message: string, stack: string, schema: string | null) =>
  createHash("sha1")
    .update((schema ?? "") + "|" + message.replace(/\d+/g, "#") + "|" + (stack.split("\n").find((l) => l.includes("/src/") || l.trim().startsWith("at ")) ?? ""))
    .digest("hex");

export type Requester = { name: string; login: string; roles: string[] };

/** المستخدم صاحب الطلب الحالي إن أمكن معرفته (لا يرمي أبداً). */
export async function currentRequester(): Promise<Requester | null> {
  try {
    const { getCurrentUser } = await import("@/lib/auth");
    const u = await getCurrentUser();
    return u ? { name: u.name, login: u.login, roles: u.roles.map((r) => r.nameAr) } : null;
  } catch {
    return null;
  }
}

/** اسم القسم بالعربية من مسار الصفحة، ليفهم المدير أين حدث الخطأ دون معرفة المسارات. */
function placeOf(path: string | undefined) {
  if (!path) return null;
  const p = path.split("?")[0];
  if (p.startsWith("/driver")) return "تطبيق السائق";
  if (p.startsWith("/owner")) return "لوحة مالك المنصة";
  if (p.startsWith("/login")) return "صفحة الدخول";
  if (p.startsWith("/share")) return "رابط مشاركة مستند مع العميل";
  return "شاشات المكتب";
}

/** شرح بسيط للأخطاء المعروفة وما يفعله المدير؛ وغيرها خطأ برمجي يُرسل للدعم. */
export function explainError(message: string): { what: string; todo: string; bug: boolean } {
  if (Object.values(DRIVER_DICT).some((d) => message.startsWith(d.notLinked)))
    return {
      what: "دخل مستخدم إلى تطبيق السائق بحساب غير مربوط بسائق (حساب مكتب، أو سائق لم يُربط حسابه بملفه، أو أُلغي ربطه). البرنامج نفسه سليم.",
      todo: "إن كان سائقاً: من «الأسطول ← السائقون» افتح السائق واربطه باسم دخوله. وإن كان موظف مكتب: يستخدم البرنامج العادي لا تطبيق السائق.",
      bug: false,
    };
  return {
    what: "خطأ غير متوقع داخل البرنامج ظهر للمستخدم أثناء عمله.",
    todo: "أرسل هذا البريد إلى Claude في مشروع الكمال لإصلاحه. التفاصيل الفنية في صفحة أخطاء البرنامج.",
    bug: true,
  };
}

/** يسجل الخطأ ولا يرمي أبداً: فشل التسجيل نفسه لا يجب أن يكسر طلب المستخدم. */
export async function recordError(err: unknown, ctx: { path?: string; sql?: typeof baseSql; user?: Requester | null } = {}) {
  const sql = ctx.sql ?? baseSql;
  try {
    const e = err instanceof Error ? err : new Error(String(err));
    // أخطاء الاستعلام: السبب الحقيقي في cause، ونص الاستعلام الطويل يُختصر
    const cause = (e as { cause?: unknown }).cause;
    const message = (
      e.message?.startsWith("Failed query") && cause instanceof Error ? `${cause.message} · ${e.message.slice(14, 120)}…` : e.message || e.name || "خطأ غير معروف"
    ).slice(0, 1000);
    const schema = await currentSchema().catch(() => null);
    const user = ctx.user !== undefined ? ctx.user : await currentRequester();
    const who = user ? `${user.name} (اسم الدخول: ${user.login}${user.roles.length ? "، الدور: " + user.roles.join("، ") : ""})` : "غير معروف (لم يكن مسجلاً للدخول)";
    // المستخدم يُحفظ أول التفاصيل فيظهر في صفحة الأخطاء أيضاً
    const stack = (`المستخدم: ${who}\n` + (e.stack ?? "")).slice(0, 4000);
    const [row] = await sql<{ inserted: boolean }[]>`
      insert into platform.error_log (fingerprint, schema_name, path, message, stack)
      values (${fingerprintOf(message, e.stack ?? "", schema)}, ${schema}, ${ctx.path ?? null}, ${message}, ${stack})
      on conflict (fingerprint, day) do update set count = platform.error_log.count + 1, last_at = now(), path = coalesce(excluded.path, platform.error_log.path)
      returning (xmax = 0) as inserted`;
    if (!row?.inserted) return;
    await sql`delete from platform.error_log where day < current_date - 90`;
    const to = process.env.ERROR_ALERT_EMAIL || process.env.SMTP_USER;
    if (!to || !mailConfigured()) return;
    const [today] = await sql<{ n: number }[]>`select count(*)::int as n from platform.error_log where day = current_date`;
    if (today.n > MAX_MAILS_PER_DAY) return;
    const [t] = schema ? await sql<{ name: string; slug: string }[]>`select name, slug from platform.tenants where schema_name = ${schema}` : [];
    const company = t ? `${t.name} (رمز الدخول: ${t.slug})` : (schema ?? "—");
    const place = placeOf(ctx.path);
    const x = explainError(message);
    const lines = [
      `الشركة: ${company}`,
      `المستخدم: ${who}`,
      `المكان: ${place ? `${place} · ` : ""}${ctx.path ?? "—"}`,
      `الوقت: ${new Date().toLocaleString("en-GB", { timeZone: "Asia/Riyadh" })} (بتوقيت الرياض)`,
      `نص الخطأ كما ظهر: ${message}`,
      "",
      `ماذا حدث: ${x.what}`,
      `ماذا أفعل: ${x.todo}`,
      "",
      `صفحة أخطاء البرنامج: ${APP_URL}/owner#errors`,
    ];
    await sendMail({
      to,
      fromName: "تنبيهات البرنامج",
      subject: `${x.bug ? "خطأ في البرنامج" : "تنبيه"} · ${t?.name ?? schema ?? ""}: ${message.slice(0, 70)}`,
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
