// المنصة: بيع البرنامج لعدة شركات من رابط واحد.
// - مخطط platform فيه سجل الشركات (tenants) ودليل أسماء الدخول (logins) لمعرفة شركة كل مستخدم.
// - لكل شركة مخطط خاص t_<الرمز> بكل جداول البرنامج؛ شركة البداية في public.
// - النسخة التجريبية: يتوقف الدخول بعد trial_ends_at، وتبقى البيانات حتى يُفعَّل الاشتراك أو تُحذف.
import { readFileSync } from "node:fs";
import path from "node:path";
import type postgres from "postgres";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import * as s from "@/db/schema";
import { HOME_SCHEMA, isSchemaName, runInTenant, schemaForSlug } from "@/db/tenant";
import { ensureAdminUser, seedReferenceData } from "@/lib/seed";
import { hashPassword, MIN_PASSWORD_LENGTH } from "@/lib/password";

type Sql = ReturnType<typeof postgres>;
export type TenantStatus = "trial" | "active" | "suspended";
export interface Tenant {
  id: number;
  slug: string;
  name: string;
  schema_name: string;
  status: TenantStatus;
  trial_ends_at: Date | null;
  contact: string | null;
  created_at: Date;
  activated_at: Date | null;
}

const DAY = 24 * 60 * 60 * 1000;
const SLUG_RE = /^[a-z][a-z0-9]{1,29}$/;

/** ينشئ مخطط المنصة وجداولها ومشغّل دليل الدخول، ويسجل شركة البداية. آمن للتكرار. */
export async function ensurePlatform(sql: Sql, homeName = "الكمال للنقليات") {
  await sql.unsafe(`
    create schema if not exists platform;
    create table if not exists platform.tenants (
      id bigserial primary key,
      slug varchar(30) not null unique,
      name text not null,
      schema_name text not null unique,
      status text not null default 'trial' check (status in ('trial', 'active', 'suspended')),
      trial_ends_at timestamptz,
      contact text,
      created_at timestamptz not null default now(),
      activated_at timestamptz
    );
    create table if not exists platform.logins (
      login varchar(120) primary key,
      schema_name text not null
    );
    create index if not exists logins_schema_idx on platform.logins (schema_name);
    create table if not exists platform.share_links (
      token varchar(40) primary key,
      schema_name text not null,
      kind varchar(30) not null,
      doc_id bigint not null,
      created_at timestamptz not null default now(),
      expires_at timestamptz not null
    );
    create index if not exists share_links_doc_idx on platform.share_links (schema_name, kind, doc_id);
    create table if not exists platform.login_failures (
      login varchar(120) not null,
      at timestamptz not null default now()
    );
    create index if not exists login_failures_idx on platform.login_failures (login, at);
    create table if not exists platform.access_requests (
      id bigserial primary key,
      schema_name text,
      login varchar(120),
      name text not null,
      contact varchar(60) not null,
      created_at timestamptz not null default now(),
      resolved_at timestamptz
    );
    create table if not exists platform.password_resets (
      token_hash varchar(64) primary key,
      schema_name text not null,
      user_id bigint not null,
      created_at timestamptz not null default now(),
      expires_at timestamptz not null,
      used_at timestamptz
    );
    create index if not exists password_resets_user_idx on platform.password_resets (schema_name, user_id, created_at);
    create index if not exists access_requests_open_idx on platform.access_requests (schema_name) where resolved_at is null;
    create or replace function platform.sync_login() returns trigger language plpgsql as $$
    begin
      if tg_op in ('UPDATE', 'DELETE') then
        delete from platform.logins where login = old.login and schema_name = tg_table_schema;
      end if;
      if tg_op in ('INSERT', 'UPDATE') then
        if exists (select 1 from platform.logins where lower(login) = lower(new.login)) then
          raise exception 'اسم الدخول % مستخدم في شركة أخرى؛ اختر اسماً آخر', new.login using errcode = 'unique_violation';
        end if;
        insert into platform.logins (login, schema_name) values (new.login, tg_table_schema);
      end if;
      return coalesce(new, old);
    end $$;
  `);
  await sql`insert into platform.tenants (slug, name, schema_name, status, activated_at)
    values ('home', ${homeName}, ${HOME_SCHEMA}, 'active', now()) on conflict (schema_name) do nothing`;
  await installLoginTrigger(sql, HOME_SCHEMA);
}

export const LOGIN_MAX_FAILURES = 10;
export const LOGIN_LOCK_MINUTES = 15;

/** اسم دخول تجاوز عدد المحاولات الخاطئة في آخر 15 دقيقة: يُوقف دخوله مؤقتاً حتى بكلمة مرور صحيحة. */
export async function loginThrottled(sql: Sql, login: string) {
  const [r] = await sql<{ n: number }[]>`select count(*)::int as n from platform.login_failures
    where login = lower(${login}) and at > now() - make_interval(mins => ${LOGIN_LOCK_MINUTES})`;
  return r.n >= LOGIN_MAX_FAILURES;
}

export async function recordLoginFailure(sql: Sql, login: string) {
  await sql`delete from platform.login_failures where at < now() - interval '1 day'`;
  await sql`insert into platform.login_failures (login) values (lower(${login}))`;
}

export async function clearLoginFailures(sql: Sql, login: string) {
  await sql`delete from platform.login_failures where login = lower(${login})`;
}

// ───────────── «نسيت كلمة المرور أو اسم الدخول» ─────────────
// لا بريد مرسل في البرنامج بعد، فيصل الطلب لمدير النظام في شركة المستخدم (أو لمالك المنصة إن لم يُعرف اسم الدخول)،
// ويعيّن له كلمة مرور جديدة من شاشة المستخدمين ويتواصل معه.

export interface AccessRequest {
  id: number;
  schema_name: string | null;
  login: string | null;
  name: string;
  contact: string;
  created_at: Date;
}

/** يسجل الطلب ويرد دائماً بنفس النتيجة، فلا يُعرف منه هل اسم الدخول موجود. حد 3 طلبات في الساعة لنفس الاسم أو الجوال. */
export async function createAccessRequest(sql: Sql, input: { login?: string; name: string; contact: string }) {
  const login = input.login?.trim().toLowerCase().slice(0, 120) || null;
  const name = input.name.trim().slice(0, 120);
  const contact = input.contact.trim().slice(0, 60);
  if (!name || !contact) throw new Error("اكتب اسمك ووسيلة التواصل معك");
  const [recent] = await sql<{ n: number }[]>`select count(*)::int as n from platform.access_requests
    where created_at > now() - interval '1 hour' and (contact = ${contact} or (${login}::text is not null and login = ${login}))`;
  if (recent.n >= 3) return;
  const [match] = login ? await sql<{ schema_name: string }[]>`select schema_name from platform.logins where lower(login) = ${login} limit 1` : [];
  await sql`delete from platform.access_requests where created_at < now() - interval '90 days'`;
  await sql`insert into platform.access_requests (schema_name, login, name, contact) values (${match?.schema_name ?? null}, ${login}, ${name}, ${contact})`;
}

/** الطلبات المفتوحة لشركة، أو التي لم تُعرف شركتها (null) لمالك المنصة. */
export async function openAccessRequests(sql: Sql, schema: string | null) {
  return schema
    ? sql<AccessRequest[]>`select id, schema_name, login, name, contact, created_at from platform.access_requests where resolved_at is null and schema_name = ${schema} order by created_at desc limit 50`
    : sql<AccessRequest[]>`select id, schema_name, login, name, contact, created_at from platform.access_requests where resolved_at is null and schema_name is null order by created_at desc limit 50`;
}

export async function resolveAccessRequest(sql: Sql, id: number, schema: string | null) {
  await sql`update platform.access_requests set resolved_at = now() where id = ${id} and schema_name is not distinct from ${schema}`;
}

async function installLoginTrigger(sql: Sql, schema: string) {
  await sql.unsafe(`
    insert into platform.logins (login, schema_name) select login, '${schema}' from "${schema}".users on conflict do nothing;
    drop trigger if exists users_sync_login on "${schema}".users;
    create trigger users_sync_login after insert or update of login or delete on "${schema}".users
      for each row execute function platform.sync_login();
  `);
}

/** يطبّق ترحيلات drizzle على مخطط شركة (غير public) ويتتبع ما طُبّق في جدول داخله. */
export async function migrateSchema(sql: Sql, schema: string, dir = path.join(process.cwd(), "drizzle")) {
  if (!isSchemaName(schema) || schema === HOME_SCHEMA) throw new Error("مخطط غير صالح للترحيل");
  const journal = JSON.parse(readFileSync(path.join(dir, "meta", "_journal.json"), "utf8")) as { entries: { tag: string }[] };
  await sql.unsafe(`create schema if not exists "${schema}"; create table if not exists "${schema}".__migrations (tag text primary key, applied_at timestamptz not null default now())`);
  const done = new Set((await sql.unsafe(`select tag from "${schema}".__migrations`)).map((r) => r.tag as string));
  for (const { tag } of journal.entries) {
    if (done.has(tag)) continue;
    const body = readFileSync(path.join(dir, `${tag}.sql`), "utf8")
      .replaceAll('"public".', `"${schema}".`)
      .split("--> statement-breakpoint")
      .map((x) => x.trim())
      .filter(Boolean)
      .join("\n;\n");
    // الملف كله في طلب واحد داخل معاملة: رحلة واحدة لقاعدة البيانات بدل رحلة لكل أمر (مئات الرحلات كانت تتجاوز مهلة الخادم)
    await sql.begin((tx) => tx.unsafe(`set local search_path to "${schema}";\n${body}\n;\ninsert into "${schema}".__migrations (tag) values ('${tag.replaceAll("'", "''")}');`));
  }
}

/** يرحّل كل الشركات المسجلة (عند كل نشر). */
export async function migrateAllTenants(sql: Sql) {
  const rows = await sql<{ schema_name: string }[]>`select schema_name from platform.tenants where schema_name <> ${HOME_SCHEMA}`;
  for (const r of rows) await migrateSchema(sql, r.schema_name);
}

export async function listTenants(sql: Sql) {
  const tenants = await sql<Tenant[]>`select * from platform.tenants order by (schema_name = ${HOME_SCHEMA}) desc, created_at desc`;
  type Stats = { users: number; last_login: Date | null; entries: number; admin_login: string | null; admin_name: string | null; broken?: boolean };
  const stats = await Promise.all(
    tenants.map(async (t): Promise<Stats> => {
      try {
        const [r] = await sql.unsafe(
          `select count(*)::int as users, max(last_login_at) as last_login, (select count(*)::int from "${t.schema_name}".journal_entries) as entries,
            (select u.login from "${t.schema_name}".users u join "${t.schema_name}".user_roles ur on ur.user_id = u.id join "${t.schema_name}".roles r on r.id = ur.role_id
              where r.key = 'admin' and u.is_active order by u.id limit 1) as admin_login,
            (select u.name from "${t.schema_name}".users u join "${t.schema_name}".user_roles ur on ur.user_id = u.id join "${t.schema_name}".roles r on r.id = ur.role_id
              where r.key = 'admin' and u.is_active order by u.id limit 1) as admin_name
           from "${t.schema_name}".users`,
        );
        const s = r as unknown as Stats;
        return { ...s, broken: s.users === 0 && t.schema_name !== HOME_SCHEMA };
      } catch {
        // شركة لم يكتمل إنشاؤها (انقطع التجهيز): تظهر ليُعاد إنشاؤها أو تُحذف
        return { users: 0, last_login: null, entries: 0, admin_login: null, admin_name: null, broken: true };
      }
    }),
  );
  const now = Date.now();
  return tenants.map((t, i) => ({ ...t, id: Number(t.id), ...stats[i], daysLeft: t.trial_ends_at ? Math.ceil((new Date(t.trial_ends_at).getTime() - now) / DAY) : null }));
}

/** حالة شركة: هل يُسمح بالدخول، وكم يوماً بقي من التجربة. يُرجع null إن لم تكن المنصة مهيأة. */
export async function tenantState(sql: Sql, schema: string) {
  try {
    const [t] = await sql<Tenant[]>`select * from platform.tenants where schema_name = ${schema}`;
    if (!t) return null;
    const daysLeft = t.trial_ends_at ? Math.ceil((new Date(t.trial_ends_at).getTime() - Date.now()) / DAY) : null;
    const expired = t.status === "trial" && (daysLeft ?? 0) <= 0;
    const blocked = t.status === "suspended" ? "أوقف اشتراك هذه الشركة؛ تواصل مع مزود البرنامج" : expired ? "انتهت الفترة التجريبية لهذه الشركة؛ تواصل مع مزود البرنامج للاشتراك" : null;
    return { tenant: t, daysLeft, blocked };
  } catch {
    return null;
  }
}

/** مخطط شركة صاحب اسم الدخول (شركة البداية إن لم يُعرف). */
export async function schemaForLogin(sql: Sql, login: string) {
  try {
    const [r] = await sql<{ schema_name: string }[]>`select schema_name from platform.logins where lower(login) = lower(${login}) limit 1`;
    return r?.schema_name ?? HOME_SCHEMA;
  } catch {
    return HOME_SCHEMA;
  }
}

async function tenantById(sql: Sql, id: number) {
  const [t] = await sql<Tenant[]>`select * from platform.tenants where id = ${id}`;
  if (!t) throw new Error("الشركة غير موجودة");
  return t;
}
const guardHome = (t: Tenant) => {
  if (t.schema_name === HOME_SCHEMA) throw new Error("لا يمكن تنفيذ هذا على شركة البداية");
};

/** يجهّز بيانات الشركة الأساسية (شجرة الحسابات، الأدوار، الفترات…) ومدير نظامها. */
async function seedTenant(db: Db, schema: string, admin: { name: string; login: string; password: string }, companyName: string) {
  // معاملة واحدة: يُضبط المخطط مرة واحدة بدل معاملة لكل أمر، ولا تبقى بيانات ناقصة إن فشل شيء
  await runInTenant(schema, () =>
    db.transaction(async (tx) => {
      const t = tx as unknown as Db;
      await seedReferenceData(t);
      await ensureAdminUser(t, admin.login, admin.password);
      await t.update(s.users).set({ name: admin.name }).where(eq(s.users.login, admin.login));
      await t.insert(s.companyProfile).values({ nameAr: companyName }).onConflictDoNothing();
    }),
  );
}

export interface NewTenant {
  name: string;
  slug: string;
  trialDays: number; // 0 = اشتراك فعلي مباشرة
  contact?: string;
  adminName: string;
  adminLogin: string;
  adminPassword: string;
}

/** ينشئ شركة جديدة: مخطط، ترحيل، بيانات أساسية، مدير نظام. */
export async function createTenant(sql: Sql, db: Db, input: NewTenant) {
  const slug = input.slug.trim().toLowerCase();
  if (!SLUG_RE.test(slug)) throw new Error("رمز الشركة: حروف إنجليزية صغيرة وأرقام، يبدأ بحرف، من 2 إلى 30");
  if (input.name.trim().length < 2) throw new Error("اكتب اسم الشركة");
  if (input.adminLogin.trim().length < 3) throw new Error("اسم دخول مدير الشركة إلزامي");
  if (input.adminPassword.length < MIN_PASSWORD_LENGTH) throw new Error(`كلمة المرور ${MIN_PASSWORD_LENGTH} أحرف على الأقل`);
  const login = input.adminLogin.trim();
  // محاولة سابقة انقطعت قبل اكتمالها بنفس الرمز: تُمسح بقاياها ويُعاد الإنشاء
  for (const b of (await listTenants(sql)).filter((x) => x.broken && x.slug === slug)) {
    await dropTenantSchema(sql, b.schema_name);
    await sql`delete from platform.tenants where id = ${b.id}`;
  }
  const [taken] = await sql`select 1 from platform.logins where lower(login) = lower(${login})`;
  if (taken) throw new Error(`اسم الدخول ${login} مستخدم في شركة أخرى`);
  const schema = schemaForSlug(slug);
  const [exists] = await sql`select 1 from platform.tenants where slug = ${slug} or schema_name = ${schema}`;
  if (exists) throw new Error("رمز الشركة مستخدم؛ اختر رمزاً آخر");
  const [nsp] = await sql`select 1 from pg_namespace where nspname = ${schema}`;
  if (nsp) throw new Error("رمز الشركة محجوز؛ اختر رمزاً آخر");

  const trial = input.trialDays > 0;
  const [t] = await sql<Tenant[]>`insert into platform.tenants (slug, name, schema_name, status, trial_ends_at, contact, activated_at)
    values (${slug}, ${input.name.trim()}, ${schema}, ${trial ? "trial" : "active"}, ${trial ? new Date(Date.now() + input.trialDays * DAY).toISOString() : null},
      ${input.contact?.trim() || null}, ${trial ? null : new Date().toISOString()}) returning *`;
  try {
    await migrateSchema(sql, schema);
    await installLoginTrigger(sql, schema);
    await seedTenant(db, schema, { name: input.adminName.trim() || "مدير النظام", login, password: input.adminPassword }, input.name.trim());
  } catch (err) {
    await dropTenantSchema(sql, schema);
    await sql`delete from platform.tenants where id = ${t.id}`;
    throw err;
  }
  return { ...t, id: Number(t.id) };
}

async function dropTenantSchema(sql: Sql, schema: string) {
  if (!isSchemaName(schema) || schema === HOME_SCHEMA) return;
  await sql`delete from platform.logins where schema_name = ${schema}`;
  await sql.unsafe(`drop schema if exists "${schema}" cascade`);
}

/** كلمة مرور جديدة لمدير نظام شركة (حين ينساها أو لم تصله)؛ يعيد اسم دخوله واسمه. */
export async function resetTenantAdminPassword(sql: Sql, db: Db, id: number, password: string) {
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`كلمة المرور ${MIN_PASSWORD_LENGTH} أحرف على الأقل`);
  const t = await tenantById(sql, id);
  guardHome(t);
  const admin = (await listTenants(sql)).find((x) => x.id === Number(t.id));
  if (!admin?.admin_login) throw new Error("لا يوجد مدير نظام نشط في هذه الشركة");
  const passwordHash = await hashPassword(password);
  await runInTenant(t.schema_name, async () => {
    const [u] = await db.update(s.users).set({ passwordHash }).where(eq(s.users.login, admin.admin_login!)).returning({ id: s.users.id });
    // كلمة مرور جديدة تُخرج كل الأجهزة المسجّلة بالقديمة
    if (u) await db.delete(s.sessions).where(eq(s.sessions.userId, u.id));
  });
  return { company: t.name, login: admin.admin_login, name: admin.admin_name ?? "" };
}

/** تحويل التجربة إلى اشتراك فعلي: تبقى كل البيانات كما هي. */
export async function activateTenant(sql: Sql, id: number) {
  const t = await tenantById(sql, id);
  guardHome(t);
  await sql`update platform.tenants set status = 'active', trial_ends_at = null, activated_at = coalesce(activated_at, now()) where id = ${id}`;
}

/** تمديد التجربة أياماً من اليوم أو من نهايتها إن لم تنتهِ. */
export async function extendTrial(sql: Sql, id: number, days: number) {
  const t = await tenantById(sql, id);
  guardHome(t);
  const from = t.trial_ends_at && new Date(t.trial_ends_at) > new Date() ? new Date(t.trial_ends_at).getTime() : Date.now();
  await sql`update platform.tenants set status = 'trial', trial_ends_at = ${new Date(from + days * DAY).toISOString()} where id = ${id}`;
}

export async function setSuspended(sql: Sql, id: number, suspended: boolean) {
  const t = await tenantById(sql, id);
  guardHome(t);
  const status = suspended ? "suspended" : t.trial_ends_at ? "trial" : "active";
  await sql`update platform.tenants set status = ${status} where id = ${id}`;
  if (suspended) await sql.unsafe(`delete from "${t.schema_name}".sessions`);
}

/** حذف شركة نهائياً بكل بياناتها. يلزم كتابة رمزها للتأكيد. */
export async function deleteTenant(sql: Sql, id: number, confirmSlug: string) {
  const t = await tenantById(sql, id);
  guardHome(t);
  if (confirmSlug.trim().toLowerCase() !== t.slug) throw new Error(`اكتب رمز الشركة ${t.slug} للتأكيد`);
  await dropTenantSchema(sql, t.schema_name);
  await sql`delete from platform.tenants where id = ${id}`;
}

/**
 * البدء من جديد: يمسح كل ما سُجّل (فواتير، قيود، شحنات، أسطول…) ويعيد الشركة كأنها جديدة،
 * مع إبقاء المستخدمين بأدوارهم الأساسية وبيانات المنشأة. يلزم كتابة رمز الشركة للتأكيد.
 */
export async function resetTenant(sql: Sql, db: Db, schema: string, confirmSlug: string) {
  const [t] = await sql<Tenant[]>`select * from platform.tenants where schema_name = ${schema}`;
  if (!t) throw new Error("الشركة غير موجودة");
  guardHome(t);
  if (confirmSlug.trim().toLowerCase() !== t.slug) throw new Error(`اكتب رمز الشركة ${t.slug} للتأكيد`);
  const users = await sql.unsafe(`
    select u.name, u.login, u.password_hash, u.locale, u.is_active,
      coalesce(array_agg(r.key) filter (where r.key is not null), '{}') as roles
    from "${schema}".users u
    left join "${schema}".user_roles ur on ur.user_id = u.id
    left join "${schema}".roles r on r.id = ur.role_id and r.key <> 'driver'
    group by u.id`);
  const [profile] = await sql.unsafe(`select row_to_json(c) as j from "${schema}".company_profile c`);
  const [template] = await sql.unsafe(`select row_to_json(c) as j from "${schema}".invoice_template c`).catch(() => []);

  await dropTenantSchema(sql, schema);
  await migrateSchema(sql, schema);
  await installLoginTrigger(sql, schema);
  await runInTenant(schema, async () => {
    await seedReferenceData(db);
    const roles = await db.select().from(s.roles);
    for (const u of users) {
      const keys = (u.roles as string[]).filter((k) => k !== "driver");
      if (!keys.length) continue; // حسابات السائقين تُحذف مع سجلاتهم
      const [row] = await db
        .insert(s.users)
        .values({ name: u.name, login: u.login, passwordHash: u.password_hash, locale: u.locale, isActive: u.is_active })
        .returning({ id: s.users.id });
      const ids = roles.filter((r) => r.key && keys.includes(r.key)).map((r) => r.id);
      if (ids.length) await db.insert(s.userRoles).values(ids.map((roleId) => ({ userId: row.id, roleId })));
    }
  });
  const restore = async (table: string, json: unknown) => {
    if (!json) return;
    await sql.begin(async (tx) => {
      await tx.unsafe(`set local search_path to "${schema}"`);
      await tx.unsafe(`delete from ${table}`);
      await tx.unsafe(`insert into ${table} select * from json_populate_record(null::${table}, $1::json)`, [JSON.stringify({ ...(json as object), updated_by: null })]);
    });
  };
  await restore("company_profile", profile?.j);
  await restore("invoice_template", template?.j);
}
