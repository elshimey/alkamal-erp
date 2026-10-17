// اختبارات تكامل على قاعدة PostgreSQL حقيقية. تعمل فقط عند ضبط TEST_DATABASE_URL،
// وتمسح تلك القاعدة بالكامل في البداية، فلا تشير بها إلى قاعدة التشغيل.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { ensureAdminUser, seedReferenceData } from "@/lib/seed";
import { createJournalEntry } from "@/lib/ledger";
import { createVehicle } from "@/lib/fleet";
import { addSubAccount } from "@/lib/accounts";

const url = process.env.TEST_DATABASE_URL;
const YEAR = 2026;

describe.skipIf(!url)("قاعدة البيانات", () => {
  let client: ReturnType<typeof postgres>;
  let db: Db;
  const acc: Record<string, number> = {};
  let vehicleCc: number;

  beforeAll(async () => {
    client = postgres(url!, { max: 2, onnotice: () => {} });
    await client`drop schema if exists public cascade`;
    await client`drop schema if exists drizzle cascade`;
    await client`create schema public`;
    db = drizzle(client, { schema: s }) as unknown as Db;
    await migrate(db, { migrationsFolder: "drizzle" });
    await seedReferenceData(db, YEAR);
    await seedReferenceData(db, YEAR); // التكرار آمن
    for (const a of await db.select().from(s.accounts)) acc[a.code] = a.id;
    const v = await createVehicle(db, { plate: "أ ب ج 1234", chassis: "CH-1" });
    vehicleCc = v.costCenterId;
  }, 60_000);

  afterAll(async () => {
    await client?.end();
  });

  it("زرعت شجرة الحسابات مرة واحدة مع الآباء", async () => {
    const rows = await db.select().from(s.accounts);
    expect(rows.length).toBe(115);
    expect(rows.filter((r) => r.parentId === null).length).toBe(7);
  });

  it("المركبة تنشئ مركز تكلفتها", async () => {
    const [cc] = await db.select().from(s.costCenters).where(eq(s.costCenters.id, vehicleCc));
    expect(cc.code).toBe("V-أ ب ج 1234");
    expect(cc.type).toBe("vehicle");
  });

  it("ينشئ مدير النظام مرة واحدة", async () => {
    const first = await ensureAdminUser(db, "admin", "secret-password");
    const second = await ensureAdminUser(db, "admin", "secret-password");
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
  });

  it("يرحّل قيداً متوازناً ويرقّمه", async () => {
    const e = await createJournalEntry(db, {
      entryDate: `${YEAR}-03-10`,
      description: "ديزل",
      post: true,
      lines: [
        { accountId: acc["5101"], debit: 500, costCenterId: vehicleCc },
        { accountId: acc["110101"], credit: 500 },
      ],
    });
    expect(e.number).toBe(`JE-${YEAR}-000001`);
    const [row] = await db.select().from(s.journalEntries).where(eq(s.journalEntries.id, e.id));
    expect(row.status).toBe("posted");
    expect(row.fiscalPeriodId).not.toBeNull();
  });

  it("قاعدة البيانات ترفض ترحيل قيد غير متوازن حتى لو تجاوز الكود التحقق", async () => {
    const [entry] = await db
      .insert(s.journalEntries)
      .values({ number: "T-1", entryDate: `${YEAR}-03-11` })
      .returning();
    await db.insert(s.journalLines).values([
      { entryId: entry.id, lineNo: 1, accountId: acc["110101"], debit: "100" },
      { entryId: entry.id, lineNo: 2, accountId: acc["3101"], credit: "90" },
    ]);
    await expect(
      db.update(s.journalEntries).set({ status: "posted" }).where(eq(s.journalEntries.id, entry.id)),
    ).rejects.toThrow();
  });

  it("يرفض الترحيل على حساب تجميعي", async () => {
    await expect(
      createJournalEntry(db, {
        entryDate: `${YEAR}-03-12`,
        post: true,
        lines: [
          { accountId: acc["1101"], debit: 10 },
          { accountId: acc["3101"], credit: 10 },
        ],
      }),
    ).rejects.toThrow();
  });

  it("يرفض تكلفة تشغيل بلا مركبة", async () => {
    await expect(
      createJournalEntry(db, {
        entryDate: `${YEAR}-03-12`,
        post: true,
        lines: [
          { accountId: acc["5101"], debit: 10 },
          { accountId: acc["110101"], credit: 10 },
        ],
      }),
    ).rejects.toThrow();
  });

  it("يرفض الدينار على صندوق الريال والعكس", async () => {
    await expect(
      createJournalEntry(db, {
        entryDate: `${YEAR}-03-12`,
        post: true,
        lines: [
          { accountId: acc["110103"], debit: 10 },
          { accountId: acc["3101"], credit: 10 },
        ],
      }),
    ).rejects.toThrow();
    const ok = await createJournalEntry(db, {
      entryDate: `${YEAR}-03-12`,
      post: true,
      lines: [
        { accountId: acc["110103"], debit: 100, currencyCode: "KWD", exchangeRate: 12.25 },
        { accountId: acc["3101"], credit: 1225 },
      ],
    });
    expect(ok.id).toBeGreaterThan(0);
  });

  it("القيد المرحّل لا يُعدَّل ولا يُحذف إلا بعد إرجاعه لمسودة", async () => {
    const e = await createJournalEntry(db, {
      entryDate: `${YEAR}-04-01`,
      post: true,
      lines: [
        { accountId: acc["110101"], debit: 50 },
        { accountId: acc["3101"], credit: 50 },
      ],
    });
    await expect(db.delete(s.journalEntries).where(eq(s.journalEntries.id, e.id))).rejects.toThrow();
    await expect(
      db.update(s.journalLines).set({ debit: "60" }).where(eq(s.journalLines.entryId, e.id)),
    ).rejects.toThrow();
    await db.update(s.journalEntries).set({ status: "draft" }).where(eq(s.journalEntries.id, e.id));
    await db.delete(s.journalEntries).where(eq(s.journalEntries.id, e.id));
    expect(await db.select().from(s.journalEntries).where(eq(s.journalEntries.id, e.id))).toHaveLength(0);
  });

  it("الفترة المقفلة تمنع الترحيل والإرجاع", async () => {
    const e = await createJournalEntry(db, {
      entryDate: `${YEAR}-05-05`,
      post: true,
      lines: [
        { accountId: acc["110101"], debit: 70 },
        { accountId: acc["3101"], credit: 70 },
      ],
    });
    await db
      .update(s.fiscalPeriods)
      .set({ status: "closed" })
      .where(eq(s.fiscalPeriods.month, 5));
    await expect(
      db.update(s.journalEntries).set({ status: "draft" }).where(eq(s.journalEntries.id, e.id)),
    ).rejects.toThrow();
    await expect(
      createJournalEntry(db, {
        entryDate: `${YEAR}-05-06`,
        post: true,
        lines: [
          { accountId: acc["110101"], debit: 1 },
          { accountId: acc["3101"], credit: 1 },
        ],
      }),
    ).rejects.toThrow();
  });

  it("إضافة حساب فرعي تجعل الأب تجميعياً وترفض أباً عليه قيود", async () => {
    const bank = await addSubAccount(db, acc["1102"], "بنك الراجحي");
    expect(bank.code).toBe("110201");
    const [parent] = await db.select().from(s.accounts).where(eq(s.accounts.id, acc["1102"]));
    expect(parent.isPostable).toBe(false);
    await expect(addSubAccount(db, acc["3101"], "فرعي")).rejects.toThrow();
  });
});
