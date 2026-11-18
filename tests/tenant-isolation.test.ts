// عزل الشركات: كل شركة مشتركة لا ترى ولا تعدّل بيانات شركة أخرى، ولا يفيد تزوير ملف الشركة في المتصفح.
// اختبارات تكامل على قاعدة PostgreSQL حقيقية (TEST_DATABASE_URL) تمسحها في البداية مثل database.test.ts.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// ملفات تعريف المتصفح لطلب وهمي: يقرؤها ويكتبها الدخول وفحص الجلسة كما في الطلب الحقيقي
const jar = new Map<string, string>();
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    has: (name: string) => jar.has(name),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (o: string | { name: string }) => void jar.delete(typeof o === "string" ? o : o.name),
  }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq, sql } from "drizzle-orm";
import postgres from "postgres";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { isSchemaName, runInTenant, tenantClient, tenantFromCookies } from "@/db/tenant";
import { seedReferenceData } from "@/lib/seed";
import * as platform from "@/lib/platform";

const url = process.env.TEST_DATABASE_URL;
const YEAR = 2026;
const HOME_PASS = "home-pass-2026";
const BETA_PASS = "beta-pass-2026";

describe.skipIf(!url)("عزل بيانات الشركات", () => {
  let client: ReturnType<typeof postgres>;
  // db: قاعدة البرنامج نفسها (تتبع الشركة الحالية من ملف الشركة أو runInTenant) كما تعمل الشاشات
  let db: Db;
  let auth: typeof import("@/lib/auth");
  let signIn: typeof import("@/lib/sign-in").signIn;
  const secret = { customerId: 0, expenseId: 0 };

  const asHome = <T>(fn: () => Promise<T>) => runInTenant("public", fn);
  const asBeta = <T>(fn: () => Promise<T>) => runInTenant("t_beta", fn);
  // كل فحص للجلسة طلب جديد: react cache لا يحفظ النتيجة خارج طلب الخادم
  const freshRequest = () => jar.clear();

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    client = postgres(url!, { max: 2, onnotice: () => {} });
    await client`drop schema if exists public cascade`;
    await client`drop schema if exists drizzle cascade`;
    await client`drop schema if exists platform cascade`;
    for (const r of await client`select nspname from pg_namespace where nspname like 't\\_%'`) await client.unsafe(`drop schema "${r.nspname}" cascade`);
    await client`create schema public`;
    const plain = drizzle(client, { schema: s }) as unknown as Db;
    await migrate(plain, { migrationsFolder: "drizzle" });
    await seedReferenceData(plain, YEAR);
    await platform.ensurePlatform(client);
    const { ensureAdminUser } = await import("@/lib/seed");
    await ensureAdminUser(plain, "admin", HOME_PASS);
    await platform.createTenant(client, drizzle(tenantClient(client), { schema: s }) as unknown as Db, {
      name: "شركة بيتا",
      slug: "beta",
      trialDays: 15,
      adminName: "مدير بيتا",
      adminLogin: "beta_admin",
      adminPassword: BETA_PASS,
    });
    ({ db } = await import("@/db"));
    auth = await import("@/lib/auth");
    ({ signIn } = await import("@/lib/sign-in"));

    // بيانات سرية في شركة الكمال: عميل ومصروف معلّق
    const { createParty } = await import("@/lib/operations");
    const { createExpense } = await import("@/lib/purchases");
    await asHome(async () => {
      secret.customerId = (await createParty(db, { nameAr: "عميل سري للكمال", roles: ["customer"] })).id;
      const [office] = await db.select().from(s.accounts).where(eq(s.accounts.code, "6109"));
      const [cash] = await db.select().from(s.accounts).where(eq(s.accounts.code, "110101"));
      secret.expenseId = (await createExpense(db, { expenseDate: `${YEAR}-09-04`, payer: "cash", cashAccountId: cash.id, accountId: office.id, description: "مصروف سري", amount: 70 })).id;
    });
  }, 90_000);

  afterAll(async () => {
    await client?.end();
    const { baseSql } = await import("@/db");
    await baseSql.end({ timeout: 1 });
  });

  it("الدخول برمز الشركة: مستخدم شركة لا يدخل شركة أخرى ولو تشابهت كلمة المرور", async () => {
    freshRequest();
    expect(await signIn("beta", "admin", HOME_PASS)).toHaveProperty("error");
    freshRequest();
    expect(await signIn("home", "beta_admin", BETA_PASS)).toHaveProperty("error");
    freshRequest();
    expect(await signIn("beta", "beta_admin", BETA_PASS)).toMatchObject({ schema: "t_beta" });
  });

  it("تزوير ملف الشركة في المتصفح لا يفتح بيانات شركة أخرى", async () => {
    freshRequest();
    expect(await signIn("beta", "beta_admin", BETA_PASS)).toMatchObject({ schema: "t_beta" });
    expect(jar.get("erp_tenant")).toBe("t_beta");
    expect((await auth.getCurrentUser())?.login).toBe("beta_admin");

    // نفس جلسة بيتا مع ملف شركة الكمال: الجلسة غير موجودة في مخطط الكمال فلا دخول
    const betaSession = jar.get("erp_session")!;
    freshRequest();
    jar.set("erp_session", betaSession);
    jar.set("erp_tenant", "public");
    expect(await auth.getCurrentUser()).toBeNull();
    await expect(auth.requirePermission("expenses", "approve")).rejects.toThrow("REDIRECT /login");

    // قيمة مخطط مصنوعة لحقن SQL تُرفض قبل أن تصل للقاعدة
    for (const bad of ['t_beta"; drop schema public cascade; --', "pg_catalog", "information_schema", "t_", "T_BETA", "public "]) {
      expect(isSchemaName(bad)).toBe(false);
      expect(tenantFromCookies({ get: () => ({ value: bad }), has: () => true })).toBeUndefined();
      expect(() => runInTenant(bad, () => 1)).toThrow("مخطط شركة غير صالح");
    }
    expect(await client`select 1 from pg_namespace where nspname = 'public'`).toHaveLength(1);
  });

  it("نفس الرقم في شركة أخرى سجل مختلف: لا قراءة ولا اعتماد لبيانات الكمال من داخل بيتا", async () => {
    const { listCustomers } = await import("@/lib/customers");
    const { approveExpense } = await import("@/lib/purchases");
    await asBeta(async () => {
      const names = (await listCustomers(db, { today: `${YEAR}-09-04` })).map((c) => c.p.nameAr);
      expect(names).not.toContain("عميل سري للكمال");
      const [sameId] = await db.select().from(s.parties).where(eq(s.parties.id, secret.customerId));
      expect(sameId?.nameAr).not.toBe("عميل سري للكمال");
      // محاولة اعتماد مصروف الكمال برقمه من داخل بيتا: لا يوجد عندها مصروف بهذا الرقم
      await expect(approveExpense(db, secret.expenseId)).rejects.toThrow();
      expect(await db.select().from(s.journalEntries)).toHaveLength(0);
    });
    await asHome(async () => {
      // والكمال نفسها ترى عميلها: الاختبار ليس فارغاً
      expect((await listCustomers(db, { today: `${YEAR}-09-04` })).map((c) => c.p.nameAr)).toContain("عميل سري للكمال");
      const [e] = await db.select().from(s.expenses).where(eq(s.expenses.id, secret.expenseId));
      expect(e.status).toBe("pending");
      expect(e.journalEntryId).toBeNull();
    });
  });

  it("المصروف لا يدخل المحاسبة قبل الاعتماد، والضغط مرتين معاً يعتمده بقيد واحد", async () => {
    const { approveExpense } = await import("@/lib/purchases");
    await asHome(async () => {
      const entries = async () => (await db.select({ n: sql<number>`count(*)::int` }).from(s.journalEntries))[0].n;
      const before = await entries();
      const [e] = await db.select().from(s.expenses).where(eq(s.expenses.id, secret.expenseId));
      expect(e).toMatchObject({ status: "pending", journalEntryId: null });
      const results = await Promise.allSettled([approveExpense(db, e.id), approveExpense(db, e.id)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await entries()).toBe(before + 1);
      const [after] = await db.select().from(s.expenses).where(eq(s.expenses.id, e.id));
      expect(after.status).toBe("approved");
    });
  });

  it("الشركة الجديدة لا ترى قيود الكمال ولا مستخدميها ولا جلساتها", async () => {
    const homeEntries = await asHome(async () => (await db.select().from(s.journalEntries)).length);
    expect(homeEntries).toBeGreaterThan(0);
    await asBeta(async () => {
      expect(await db.select().from(s.journalEntries)).toHaveLength(0);
      expect((await db.select({ login: s.users.login }).from(s.users)).map((u) => u.login)).toEqual(["beta_admin"]);
      const sessions = await db.select({ userId: s.sessions.userId }).from(s.sessions);
      const [admin] = await db.select().from(s.users);
      expect(sessions.every((x) => x.userId === admin.id)).toBe(true);
    });
  });

  it("رابط المشاركة يفتح مستند شركته فقط", async () => {
    const share = await import("@/lib/share");
    const token = await asBeta(() => share.shareLink("invoice", 1));
    expect(await share.resolveShare(token)).toEqual({ schema: "t_beta", kind: "invoice", id: 1 });
    // نفس المستند في الكمال رابطه مختلف
    const homeToken = await asHome(() => share.shareLink("invoice", 1));
    expect(homeToken).not.toBe(token);
    expect((await share.resolveShare(homeToken))?.schema).toBe("public");
    expect(await share.resolveShare("not-a-real-token-xxxxxxxx")).toBeNull();
  });
});
