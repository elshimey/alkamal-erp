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
import { assignVehicle, createDriver, createVehicle, driverOnDate, expiringDocuments, releaseAssignment } from "@/lib/fleet";
import { addSubAccount } from "@/lib/accounts";
import { activeContract, createContract, createLocation, createParty, createRoute, priceTrip, setContractStatus } from "@/lib/operations";

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

  describe("السائقون والإسناد والوثائق", () => {
    let vehicleId: number;
    let driverA: number;
    let driverB: number;

    beforeAll(async () => {
      const v = await createVehicle(db, { plate: "د هـ و 5678", chassis: "CH-2", odometer: 1000 });
      vehicleId = v.id;
    });

    it("السائق ينشئ موظفه وحساب رواتبه وحساب عهدته", async () => {
      const d = await createDriver(db, { nameAr: "سائق أول", mobile: "0500000010" });
      driverA = d.id;
      expect(d.payableAccountCode).toBe("210701");
      expect(d.custodyAccountCode).toBe("110501");
      const [emp] = await db.select().from(s.employees).where(eq(s.employees.id, d.employeeId));
      expect(emp.jobTitle).toBe("سائق");
      const [custodyParent] = await db.select().from(s.accounts).where(eq(s.accounts.code, "1105"));
      expect(custodyParent.isPostable).toBe(false);
      driverB = (await createDriver(db, { nameAr: "سائق ثانٍ" })).id;
    });

    it("مركبة واحدة لسائق واحد في نفس الوقت", async () => {
      await assignVehicle(db, { vehicleId, driverId: driverA, fromDate: `${YEAR}-06-01`, odometerStart: 1200 });
      await expect(assignVehicle(db, { vehicleId, driverId: driverB, fromDate: `${YEAR}-06-02` })).rejects.toThrow("مسندة");
      const [v] = await db.select().from(s.vehicles).where(eq(s.vehicles.id, vehicleId));
      expect(v.odometer).toBe(1200);
    });

    it("التسليم يغلق الإسناد ويحدّث العداد، ويُعرف من كان يقود في تاريخ معيّن", async () => {
      const [open] = await db.select().from(s.vehicleAssignments).where(eq(s.vehicleAssignments.driverId, driverA));
      await expect(
        releaseAssignment(db, { assignmentId: open.id, toDate: `${YEAR}-06-10`, odometerEnd: 1100 }),
      ).rejects.toThrow();
      await releaseAssignment(db, { assignmentId: open.id, toDate: `${YEAR}-06-10`, odometerEnd: 3500 });
      await assignVehicle(db, { vehicleId, driverId: driverB, fromDate: `${YEAR}-06-11` });
      const [v] = await db.select().from(s.vehicles).where(eq(s.vehicles.id, vehicleId));
      expect(v.odometer).toBe(3500);
      expect(await driverOnDate(db, vehicleId, `${YEAR}-06-05`)).toBe(driverA);
      expect(await driverOnDate(db, vehicleId, `${YEAR}-06-20`)).toBe(driverB);
      expect(await driverOnDate(db, vehicleId, `${YEAR}-05-20`)).toBeNull();
    });

    it("تنبيه الوثائق قبل 30 يوماً من الانتهاء", async () => {
      await db.insert(s.fleetDocuments).values([
        { vehicleId, type: "insurance", expiryDate: `${YEAR}-07-15` },
        { driverId: driverA, type: "license", expiryDate: `${YEAR}-09-30` },
      ]);
      const due = await expiringDocuments(db, `${YEAR}-07-01`);
      expect(due.map((d) => d.doc.type)).toEqual(["insurance"]);
      expect(due[0].plate).toBe("د هـ و 5678");
      await expect(db.insert(s.fleetDocuments).values({ type: "other", expiryDate: `${YEAR}-01-01` })).rejects.toThrow();
    });
  });

  describe("العملاء والمسارات والعقود", () => {
    it("المسار دولي إذا اختلفت الدولتان، والعقد يسعّر الرحلة", async () => {
      const countries = await db.select().from(s.locations);
      const sa = countries.find((c) => c.countryCode === "SA")!;
      const kw = countries.find((c) => c.countryCode === "KW")!;
      const dammam = await createLocation(db, { parentId: sa.id, nameAr: "الدمام" });
      const riyadh = await createLocation(db, { parentId: sa.id, nameAr: "الرياض" });
      const kuwait = await createLocation(db, { parentId: kw.id, nameAr: "مدينة الكويت" });
      expect(dammam.level).toBe("city");
      expect(kuwait.countryCode).toBe("KW");
      const local = await createRoute(db, { fromLocationId: dammam.id, toLocationId: riyadh.id, distanceKm: 400, driverCommission: 150 });
      const intl = await createRoute(db, { fromLocationId: dammam.id, toLocationId: kuwait.id, distanceKm: 450 });
      expect(local.isInternational).toBe(false);
      expect(intl.isInternational).toBe(true);

      const supplierOnly = await createParty(db, { nameAr: "مورد", roles: ["supplier"] });
      await expect(
        createContract(db, { customerId: supplierOnly.id, number: "X", fromDate: `${YEAR}-01-01`, toDate: `${YEAR}-12-31` }),
      ).rejects.toThrow("ليست عميلاً");

      const customer = await createParty(db, { nameAr: "شركة المراعي", roles: ["customer"] });
      const c1 = await createContract(db, { customerId: customer.id, number: "C-1", fromDate: `${YEAR}-01-01`, toDate: `${YEAR}-12-31` });
      await expect(setContractStatus(db, c1.id, "active")).rejects.toThrow("بند تسعير");
      await db.insert(s.contractRates).values({ contractId: c1.id, method: "route_fixed", routeId: local.id, price: "2800" });
      await setContractStatus(db, c1.id, "active");

      const c2 = await createContract(db, { customerId: customer.id, number: "C-2", fromDate: `${YEAR}-06-01`, toDate: `${YEAR + 1}-05-31` });
      await db.insert(s.contractRates).values({ contractId: c2.id, method: "route_fixed", routeId: local.id, price: "2900" });
      await expect(setContractStatus(db, c2.id, "active")).rejects.toThrow("تتداخل");

      expect((await activeContract(db, customer.id, `${YEAR}-03-01`))?.number).toBe("C-1");
      expect(await activeContract(db, customer.id, `${YEAR + 1}-03-01`)).toBeNull();
      const price = await priceTrip(db, customer.id, `${YEAR}-03-01`, { routeId: local.id });
      expect(price?.amount).toBe(2800);
      expect(await priceTrip(db, customer.id, `${YEAR}-03-01`, { routeId: intl.id })).toBeNull();

      await expect(
        db.insert(s.contractRates).values({ contractId: c1.id, method: "per_km_vehicle_type", price: "2" }),
      ).rejects.toThrow();
    });
  });
});
