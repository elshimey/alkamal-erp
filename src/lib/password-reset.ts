import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type postgres from "postgres";
import { isSchemaName } from "@/db/tenant";
import { hashPassword, MIN_PASSWORD_LENGTH } from "@/lib/password";
import { mailConfigured, sendMail } from "@/lib/mailer";

// استرجاع كلمة المرور بالبريد: رابط صالح ساعة واحدة ولمرة واحدة، يُخزن منه بصمته فقط.
// يصل للبريد المسجل في حساب المستخدم، أو لاسم الدخول نفسه إن كان بريداً.

type Sql = ReturnType<typeof postgres>;
const RESET_MINUTES = 60;
const MAX_PER_HOUR = 3;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const looksLikeEmail = (v: string | null | undefined) => !!v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

interface Account {
  schema: string;
  id: number;
  name: string;
  email: string;
}

/** الحسابات النشطة المطابقة لاسم الدخول أو البريد داخل الشركة صاحبة الرمز. */
async function findAccounts(sql: Sql, company: string, identifier: string): Promise<Account[]> {
  const key = identifier.trim().toLowerCase();
  if (!key) return [];
  const schemas = (await sql<{ schema_name: string }[]>`select schema_name from platform.tenants where slug = ${company.trim().toLowerCase()}`).map((r) => r.schema_name).filter(isSchemaName);
  const found: Account[] = [];
  for (const schema of schemas) {
    const rows = await sql.unsafe<{ id: number; name: string; login: string; email: string | null }[]>(
      `select id, name, login, email from "${schema}".users where is_active and (lower(login) = $1 or lower(email) = $1)`,
      [key],
    );
    for (const u of rows) {
      const email = looksLikeEmail(u.email) ? u.email! : looksLikeEmail(u.login) ? u.login : null;
      if (email) found.push({ schema, id: Number(u.id), name: u.name, email });
    }
  }
  return found;
}

const mask = (email: string) => email.replace(/^(.{2}).*(@.*)$/, "$1•••$2");

/** يرسل رابط الاسترجاع لكل حساب مطابق له بريد. يرد بالبريد المخفي جزئياً، أو null إن لم يوجد بريد (فيُعرض طلب المدير بدلاً منه). */
export async function requestPasswordReset(sql: Sql, company: string, identifier: string, origin: string): Promise<string | null> {
  if (!mailConfigured()) return null;
  const accounts = await findAccounts(sql, company, identifier);
  if (!accounts.length) return null;
  const sentTo: string[] = [];
  for (const a of accounts) {
    const [recent] = await sql<{ n: number }[]>`select count(*)::int as n from platform.password_resets
      where schema_name = ${a.schema} and user_id = ${a.id} and created_at > now() - interval '1 hour'`;
    if (recent.n >= MAX_PER_HOUR) {
      sentTo.push(a.email);
      continue;
    }
    const token = randomBytes(32).toString("base64url");
    await sql`delete from platform.password_resets where expires_at < now() - interval '1 day'`;
    await sql`insert into platform.password_resets (token_hash, schema_name, user_id, expires_at)
      values (${hash(token)}, ${a.schema}, ${a.id}, now() + make_interval(mins => ${RESET_MINUTES}))`;
    const [tenant] = await sql<{ name: string }[]>`select name from platform.tenants where schema_name = ${a.schema}`;
    const company = tenant?.name ?? "نظام إدارة النقل والحسابات";
    const link = `${origin}/login/reset/${token}`;
    try {
      await sendMail({
        to: a.email,
        fromName: company,
        subject: `استرجاع كلمة المرور – ${company}`,
        text: `مرحباً ${a.name}،\n\nطلبتَ استرجاع كلمة المرور. افتح الرابط التالي لتعيين كلمة مرور جديدة (صالح ساعة واحدة):\n${link}\n\nإن لم تطلب ذلك فتجاهل هذه الرسالة، وكلمة مرورك الحالية تبقى كما هي.`,
        html: `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;font-size:15px;line-height:1.8;color:#1b2126">
<p>مرحباً ${escapeHtml(a.name)}،</p>
<p>طلبتَ استرجاع كلمة المرور في <b>${escapeHtml(company)}</b>. اضغط الزر لتعيين كلمة مرور جديدة، والرابط صالح ساعة واحدة.</p>
<p><a href="${link}" style="display:inline-block;background:#e9a100;color:#1b2126;padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:bold">تعيين كلمة مرور جديدة</a></p>
<p style="color:#6b7280;font-size:13px">إن لم تطلب ذلك فتجاهل هذه الرسالة، وكلمة مرورك الحالية تبقى كما هي.</p></div>`,
      });
      sentTo.push(a.email);
    } catch (err) {
      console.error("password reset mail failed", err);
    }
  }
  return sentTo.length ? [...new Set(sentTo.map(mask))].join("، ") : null;
}

function escapeHtml(v: string) {
  return v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** صاحب الرابط إن كان صالحاً (لم يُستخدم ولم ينتهِ). */
export async function resetTarget(sql: Sql, token: string) {
  const [r] = await sql<{ schema_name: string; user_id: number }[]>`select schema_name, user_id from platform.password_resets
    where token_hash = ${hash(token)} and used_at is null and expires_at > now()`;
  if (!r || !isSchemaName(r.schema_name)) return null;
  const [u] = await sql.unsafe<{ name: string; login: string }[]>(`select name, login from "${r.schema_name}".users where id = $1 and is_active`, [r.user_id]);
  return u ? { schema: r.schema_name, userId: Number(r.user_id), name: u.name, login: u.login } : null;
}

/** يعيّن كلمة المرور الجديدة، ويُبطل الرابط وكل روابط المستخدم الأخرى، ويُخرج كل أجهزته. */
export async function completePasswordReset(sql: Sql, token: string, password: string) {
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`كلمة المرور ${MIN_PASSWORD_LENGTH} أحرف على الأقل`);
  const target = await resetTarget(sql, token);
  if (!target) throw new Error("الرابط غير صالح أو انتهت مدته؛ اطلب رابطاً جديداً");
  const passwordHash = await hashPassword(password);
  await sql.begin(async (tx) => {
    await tx.unsafe(`update "${target.schema}".users set password_hash = $1, updated_at = now() where id = $2`, [passwordHash, target.userId]);
    await tx.unsafe(`delete from "${target.schema}".sessions where user_id = $1`, [target.userId]);
    await tx`update platform.password_resets set used_at = now() where schema_name = ${target.schema} and user_id = ${target.userId} and used_at is null`;
    await tx`delete from platform.login_failures where login = lower(${target.login})`;
  });
  return target;
}
