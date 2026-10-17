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
import { createInvoice, createReceipt, invoicingQueue, issueInvoice, revertInvoice, revertReceipt } from "@/lib/invoices";
import { createExpense, approveExpense, createPayment, createPurchaseInvoice, custodyBalances, postPurchaseInvoice, rejectExpense, revertExpense, revertPayment, revertPurchaseInvoice, supplierBalances } from "@/lib/purchases";
import { addMaintenanceLines, approveBreakdownRequest, approveMaintenanceOrder, completeMaintenanceOrder, createBreakdownRequest, createMaintenanceOrder, deleteMaintenanceOrder, planSchedule, rejectBreakdownRequest, revertMaintenanceOrder, reviewBreakdownRequest, savePlan } from "@/lib/maintenance";
import { alertCounts, financials, operations, periodRange, receivablesAging, vehicleProfit } from "@/lib/dashboard";
import { addExpense, addFuel, approveWaybill, createWaybill, deleteWaybill, recordStage, rejectWaybill, revertWaybill } from "@/lib/waybills";

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

  describe("البوليصة", () => {
    const D = `${YEAR}-08-05`;
    let customerId: number;
    let routeId: number;
    let vehicle: { id: number; costCenterId: number };
    let driver: { id: number; payableAccountId: number; custodyAccountId: number };
    let stationId: number;
    let carrierId: number;
    let firstId: number;

    const linesOf = async (entryId: number) => {
      const rows = await db.select({ l: s.journalLines, code: s.accounts.code }).from(s.journalLines).innerJoin(s.accounts, eq(s.accounts.id, s.journalLines.accountId)).where(eq(s.journalLines.entryId, entryId));
      return rows.map(({ l, code }) => ({ code, debit: Number(l.debitBase), credit: Number(l.creditBase), cc: l.costCenterId, party: l.partyId, driver: l.driverId, waybill: l.waybillId, account: l.accountId }));
    };

    beforeAll(async () => {
      const [sa] = await db.select().from(s.locations).where(eq(s.locations.countryCode, "SA"));
      const jeddah = await createLocation(db, { parentId: sa.id, nameAr: "جدة" });
      const makkah = await createLocation(db, { parentId: sa.id, nameAr: "مكة" });
      routeId = (await createRoute(db, { fromLocationId: jeddah.id, toLocationId: makkah.id, distanceKm: 90, driverCommission: 200 })).id;
      customerId = (await createParty(db, { nameAr: "شركة النخيل", roles: ["customer"] })).id;
      const c = await createContract(db, { customerId, number: "C-9", fromDate: `${YEAR}-01-01`, toDate: `${YEAR}-12-31`, creditLimit: 5000 });
      await db.insert(s.contractRates).values({ contractId: c.id, method: "route_fixed", routeId, price: "3000" });
      await setContractStatus(db, c.id, "active");
      stationId = (await createParty(db, { nameAr: "محطة ساسكو", roles: ["fuel_station"] })).id;
      carrierId = (await createParty(db, { nameAr: "ناقل الشمال", roles: ["carrier"] })).id;
      vehicle = await createVehicle(db, { plate: "ر س ت 999", chassis: "CH-9", odometer: 4000 });
      const d = await createDriver(db, { nameAr: "سائق البوالص" });
      const [emp] = await db.select().from(s.employees).where(eq(s.employees.id, d.employeeId));
      driver = { id: d.id, payableAccountId: emp.payableAccountId!, custodyAccountId: d.custodyAccountId };
      await assignVehicle(db, { vehicleId: vehicle.id, driverId: d.id, fromDate: `${YEAR}-08-01` });
    });

    it("تأخذ السائق المسند والسعر من العقد والعمولة من المسار", async () => {
      const w = await createWaybill(db, { waybillDate: D, customerId, routeId, shipper: "مصنع جدة", consignee: "مستودع مكة", vehicleId: vehicle.id });
      firstId = w.id;
      expect(w.number).toBe(`WB-${YEAR}-000001`);
      expect(w.driverId).toBe(driver.id);
      expect(Number(w.amount)).toBe(3000);
      expect(Number(w.driverCommission)).toBe(200);
      expect(w.execution).toBe("fleet");
      await expect(createWaybill(db, { waybillDate: D, customerId, routeId, shipper: "أ", consignee: "ب", vehicleId: vehicle.id, carrierId })).rejects.toThrow("لا الاثنين");
    });

    it("المراحل تغيّر الحالة وتسجل العداد", async () => {
      await recordStage(db, firstId, "loading", { odometer: 5000 });
      let [w] = await db.select().from(s.waybills).where(eq(s.waybills.id, firstId));
      expect(w.status).toBe("in_transit");
      expect(w.odometerStart).toBe(5000);
      await recordStage(db, firstId, "delivery", { odometer: 5090 });
      [w] = await db.select().from(s.waybills).where(eq(s.waybills.id, firstId));
      expect(w.status).toBe("delivered");
      expect(w.odometerEnd).toBe(5090);
    });

    it("الاعتماد يرحّل قيد التكلفة على المركبة: الديزل حسب مصدره، والعمولة لراتب السائق، والمصاريف من العهدة", async () => {
      await addFuel(db, firstId, { source: "custody", amount: 400, vatAmount: 60, liters: 200 });
      await addFuel(db, firstId, { source: "station_credit", partyId: stationId, amount: 300 });
      const [loading] = await db.select().from(s.chargeTypes).where(eq(s.chargeTypes.nameAr, "تحميل"));
      await addExpense(db, firstId, { chargeTypeId: loading.id, amount: 100 });

      const { entry } = await approveWaybill(db, firstId, { userId: undefined });
      expect(entry).not.toBeNull();
      const [je] = await db.select().from(s.journalEntries).where(eq(s.journalEntries.id, entry!.id));
      expect(je.status).toBe("posted");
      expect(je.sourceType).toBe("waybill");
      const lines = await linesOf(entry!.id);
      const sum = (f: (l: (typeof lines)[number]) => boolean, k: "debit" | "credit") => lines.filter(f).reduce((a, l) => a + l[k], 0);
      expect(sum(() => true, "debit")).toBe(1060);
      expect(sum(() => true, "credit")).toBe(1060);
      expect(sum((l) => l.code === "5101", "debit")).toBe(700);
      expect(sum((l) => l.code === "1108", "debit")).toBe(60);
      expect(sum((l) => l.code === "5102", "debit")).toBe(200);
      expect(sum((l) => l.code === "5104", "debit")).toBe(100);
      expect(sum((l) => l.account === driver.custodyAccountId, "credit")).toBe(560);
      expect(sum((l) => l.account === driver.payableAccountId, "credit")).toBe(200);
      expect(lines.find((l) => l.code === "2103")).toMatchObject({ credit: 300, party: stationId });
      expect(lines.filter((l) => l.code.startsWith("5")).every((l) => l.cc === vehicle.costCenterId && l.driver === driver.id)).toBe(true);
      expect(lines.every((l) => l.waybill === firstId)).toBe(true);
      const [v] = await db.select().from(s.vehicles).where(eq(s.vehicles.id, vehicle.id));
      expect(v.odometer).toBe(5090);
      await expect(addFuel(db, firstId, { source: "custody", amount: 1 })).rejects.toThrow("معتمدة");
    });

    it("تجاوز الحد الائتماني يمنع الاعتماد إلا بصلاحية وسبب", async () => {
      const w = await createWaybill(db, { waybillDate: D, customerId, routeId, shipper: "أ", consignee: "ب", vehicleId: vehicle.id });
      await expect(approveWaybill(db, w.id)).rejects.toThrow("الحد الائتماني");
      await expect(approveWaybill(db, w.id, { canOverride: true })).rejects.toThrow("سبب التجاوز");
      await approveWaybill(db, w.id, { canOverride: true, overrideReason: "موافقة المدير العام" });
      const [row] = await db.select().from(s.waybills).where(eq(s.waybills.id, w.id));
      expect(row.status).toBe("approved");
      expect(row.overrideReason).toBe("موافقة المدير العام");
    });

    it("الإرجاع لمسودة يلغي القيد", async () => {
      const [before] = await db.select().from(s.waybills).where(eq(s.waybills.id, firstId));
      await revertWaybill(db, firstId);
      const [after] = await db.select().from(s.waybills).where(eq(s.waybills.id, firstId));
      expect(after.status).toBe("delivered");
      expect(after.journalEntryId).toBeNull();
      expect(await db.select().from(s.journalEntries).where(eq(s.journalEntries.id, before.journalEntryId!))).toHaveLength(0);
    });

    it("الناقل الخارجي: تكلفته على مركز الناقلين ودائنة للناقل", async () => {
      const w = await createWaybill(db, { waybillDate: D, customerId, routeId, shipper: "أ", consignee: "ب", carrierId, carrierCost: 1500, amount: 1 });
      expect(Number(w.driverCommission)).toBe(0);
      const { entry } = await approveWaybill(db, w.id, { canOverride: true, overrideReason: "اختبار" });
      const lines = await linesOf(entry!.id);
      const [ext] = await db.select().from(s.costCenters).where(eq(s.costCenters.code, "EXT"));
      expect(lines.find((l) => l.code === "5105")).toMatchObject({ debit: 1500, cc: ext.id, party: carrierId });
      expect(lines.find((l) => l.code === "2102")).toMatchObject({ credit: 1500, party: carrierId });
    });

    it("بلا عقد ساري لا تُعتمد، والرفض يعيدها مع السبب، والمسودة تُحذف مع سجل", async () => {
      const other = await createParty(db, { nameAr: "عميل بلا عقد", roles: ["customer"] });
      const w = await createWaybill(db, { waybillDate: D, customerId: other.id, routeId, shipper: "أ", consignee: "ب", vehicleId: vehicle.id });
      expect(w.priceNote).toBe("لا يوجد عقد ساري");
      await expect(approveWaybill(db, w.id)).rejects.toThrow("لا يوجد عقد ساري");
      await rejectWaybill(db, w.id, "صورة العداد غير واضحة");
      await expect(approveWaybill(db, w.id, { canOverride: true, overrideReason: "x" })).rejects.toThrow("مرفوضة");
      await deleteWaybill(db, w.id, { reason: "مكررة" });
      const logs = await db.select().from(s.deletionLog).where(eq(s.deletionLog.entityId, String(w.id)));
      expect(logs[0].entity).toBe("waybill");
    });

    it("الفاتورة التجميعية: سطر لكل بوليصة ومصاريفها المحمّلة، والإيراد والضريبة عند الإصدار", async () => {
      const [waiting] = await db.select().from(s.chargeTypes).where(eq(s.chargeTypes.nameAr, "انتظار"));
      await addExpense(db, firstId, { chargeTypeId: waiting.id, amount: 200, billTo: "customer" });
      await approveWaybill(db, firstId, { canOverride: true, overrideReason: "حد ائتماني مؤقت" });
      const queue = await invoicingQueue(db);
      expect(queue.find((q) => q.customerId === customerId)?.count).toBe(3);

      const inv = await createInvoice(db, { customerId, invoiceDate: `${YEAR}-08-31` });
      expect(inv.number).toBe(`INV-${YEAR}-000001`);
      const lines = await db.select().from(s.salesInvoiceLines).where(eq(s.salesInvoiceLines.invoiceId, inv.id));
      expect(lines.filter((l) => l.kind === "waybill")).toHaveLength(3);
      expect(lines.filter((l) => l.kind === "expense").map((l) => Number(l.amount))).toEqual([200]);
      let [row] = await db.select().from(s.salesInvoices).where(eq(s.salesInvoices.id, inv.id));
      expect(Number(row.subtotal)).toBe(6201);
      expect(Number(row.vatTotal)).toBe(930.15);
      expect(Number(row.total)).toBe(7131.15);
      expect(row.dueDate).toBe(`${YEAR}-09-30`);
      await expect(createInvoice(db, { customerId, invoiceDate: `${YEAR}-08-31` })).rejects.toThrow("لا توجد بوالص");

      const entry = await issueInvoice(db, inv.id);
      const jl = await linesOf(entry.id);
      const sum = (code: string, k: "debit" | "credit") => jl.filter((l) => l.code === code).reduce((a, l) => a + l[k], 0);
      expect(Math.round(sum("1103", "debit") * 100) / 100).toBe(7131.15);
      expect(sum("4101", "credit")).toBe(6001);
      expect(sum("4104", "credit")).toBe(200);
      expect(Math.round(sum("2109", "credit") * 100) / 100).toBe(930.15);
      expect(jl.filter((l) => l.code === "4101").every((l) => l.cc !== null && l.party === customerId)).toBe(true);
      const [w] = await db.select().from(s.waybills).where(eq(s.waybills.id, firstId));
      expect(w.status).toBe("invoiced");

      await revertInvoice(db, inv.id);
      const [w2] = await db.select().from(s.waybills).where(eq(s.waybills.id, firstId));
      expect(w2.status).toBe("approved");
      await issueInvoice(db, inv.id);
      [row] = await db.select().from(s.salesInvoices).where(eq(s.salesInvoices.id, inv.id));
      expect(row.status).toBe("issued");
    });

    it("سند القبض يرحّل ويُخصص على أقدم فاتورة، ويمنع إرجاع الفاتورة المسددة", async () => {
      const [inv] = await db.select().from(s.salesInvoices).where(eq(s.salesInvoices.customerId, customerId));
      const r1 = await createReceipt(db, { receiptDate: `${YEAR}-09-05`, customerId, amount: 5000, method: "transfer", cashAccountId: acc["110101"], collector: "أحمد", post: true });
      let [row] = await db.select().from(s.salesInvoices).where(eq(s.salesInvoices.id, inv.id));
      expect(Number(row.paidAmount)).toBe(5000);
      await createReceipt(db, { receiptDate: `${YEAR}-09-06`, customerId, amount: 3000, method: "cash", cashAccountId: acc["110101"], post: true });
      [row] = await db.select().from(s.salesInvoices).where(eq(s.salesInvoices.id, inv.id));
      expect(Number(row.paidAmount)).toBe(7131.15);
      await expect(revertInvoice(db, inv.id)).rejects.toThrow("سندات قبض");
      await revertReceipt(db, r1.id);
      [row] = await db.select().from(s.salesInvoices).where(eq(s.salesInvoices.id, inv.id));
      expect(Number(row.paidAmount)).toBe(2131.15);
      await expect(createReceipt(db, { receiptDate: `${YEAR}-09-06`, customerId, amount: 1, method: "cash", cashAccountId: acc["1101"] })).rejects.toThrow("تفصيلياً");
    });

    it("اللوحة الرئيسية: الإيراد والتكلفة من القيود المرحّلة، وربحية المركبة، وأعمار الذمم والتنبيهات", async () => {
      const range = periodRange("month", `${YEAR}-08-31`);
      const fin = await financials(db, range);
      expect(fin.current).toEqual({ revenue: 6201, directCost: 2900, gross: 3301, admin: 0, net: 3301 });
      expect(fin.costs.find((c) => c.key === "fuel")?.amount).toBe(700);
      expect(fin.costs.find((c) => c.key === "carriers")?.amount).toBe(1500);
      const ops = await operations(db, range.from, range.to);
      expect(ops).toMatchObject({ trips: 3, carrier: 1, km: 270, liters: 200, fuelCost: 700, byStatus: { invoiced: 3 } });
      const [truck, ext] = await vehicleProfit(db, range.from, range.to);
      expect(truck).toMatchObject({ vehicleId: vehicle.id, revenue: 6200, cost: 1400, fuel: 700, trips: 2, profit: 4800 });
      expect(ext).toMatchObject({ vehicleId: null, cost: 1500, trips: 1 });
      expect(await receivablesAging(db, `${YEAR}-10-17`)).toMatchObject({ overdueCount: 1, d30: 5000, notDue: 0 });
      expect(await alertCounts(db, `${YEAR}-10-17`)).toMatchObject({ overdue: 1, toApprove: 0, toInvoice: 0, kwdRateDate: null });
    });

    it("فاتورة الورشة: الصيانة على مركز تكلفة المركبة، وضريبة المدخلات، ودائنة لحساب الورش", async () => {
      const workshopId = (await createParty(db, { nameAr: "ورشة الخليج", roles: ["workshop"] })).id;
      const [maint] = await db.select().from(s.accounts).where(eq(s.accounts.code, "5107"));
      await expect(
        createPurchaseInvoice(db, { supplierId: workshopId, supplierInvoiceNo: "W-1", invoiceDate: `${YEAR}-08-20`, lines: [{ accountId: maint.id, description: "تغيير زيت", amount: 800, vatRate: 15 }] }),
      ).rejects.toThrow("يتطلب مركبة");
      await expect(
        createPurchaseInvoice(db, { supplierId: customerId, supplierInvoiceNo: "X", invoiceDate: `${YEAR}-08-20`, lines: [{ accountId: maint.id, description: "x", amount: 1, vehicleId: vehicle.id }] }),
      ).rejects.toThrow("ليست مورداً");
      const inv = await createPurchaseInvoice(db, {
        supplierId: workshopId,
        supplierInvoiceNo: "W-1",
        invoiceDate: `${YEAR}-08-20`,
        lines: [
          { accountId: maint.id, vehicleId: vehicle.id, description: "تغيير زيت", amount: 800, vatRate: 15 },
          { accountId: maint.id, vehicleId: vehicle.id, description: "شغل يد", amount: 200 },
        ],
      });
      expect(inv.number).toBe(`PI-${YEAR}-000001`);
      expect([Number(inv.subtotal), Number(inv.vatTotal), Number(inv.total)]).toEqual([1000, 120, 1120]);
      expect(inv.dueDate).toBe(`${YEAR}-09-19`);
      await expect(createPurchaseInvoice(db, { supplierId: workshopId, supplierInvoiceNo: "W-1", invoiceDate: `${YEAR}-08-21`, lines: [{ accountId: maint.id, vehicleId: vehicle.id, description: "x", amount: 1 }] })).rejects.toThrow("مسجلة مسبقاً");

      const entry = await postPurchaseInvoice(db, inv.id);
      const jl = await linesOf(entry.id);
      const sum = (code: string, k: "debit" | "credit") => jl.filter((l) => l.code === code).reduce((a, l) => a + l[k], 0);
      expect(sum("5107", "debit")).toBe(1000);
      expect(jl.filter((l) => l.code === "5107").every((l) => l.cc === vehicle.costCenterId)).toBe(true);
      expect(sum("1108", "debit")).toBe(120);
      expect(sum("2104", "credit")).toBe(1120);
      expect((await supplierBalances(db)).find((b) => b.id === workshopId)?.balance).toBe(1120);

      // سداد جزئي ثم كامل، والإرجاع ممنوع بعد السداد
      const p1 = await createPayment(db, { paymentDate: `${YEAR}-09-01`, kind: "supplier", partyId: workshopId, amount: 500, method: "transfer", cashAccountId: acc["110101"], post: true });
      let [row] = await db.select().from(s.purchaseInvoices).where(eq(s.purchaseInvoices.id, inv.id));
      expect(Number(row.paidAmount)).toBe(500);
      await expect(revertPurchaseInvoice(db, inv.id)).rejects.toThrow("سندات صرف");
      await createPayment(db, { paymentDate: `${YEAR}-09-02`, kind: "supplier", partyId: workshopId, amount: 700, method: "cash", cashAccountId: acc["110101"], post: true });
      [row] = await db.select().from(s.purchaseInvoices).where(eq(s.purchaseInvoices.id, inv.id));
      expect(Number(row.paidAmount)).toBe(1120);
      expect((await supplierBalances(db)).find((b) => b.id === workshopId)?.balance).toBe(-80);
      // الإرجاع يلغي تخصيص السند الأول فقط؛ الثاني خُصص منه 620 والباقي 80 دفعة مقدمة
      await revertPayment(db, p1.id);
      [row] = await db.select().from(s.purchaseInvoices).where(eq(s.purchaseInvoices.id, inv.id));
      expect(Number(row.paidAmount)).toBe(620);
    });

    it("سداد الناقل يخفض رصيده المسجل من البوالص، وصرف العهدة يرفع رصيد السائق", async () => {
      const before = (await supplierBalances(db)).find((b) => b.id === carrierId)?.balance ?? 0;
      expect(before).toBeGreaterThan(0);
      const p = await createPayment(db, { paymentDate: `${YEAR}-09-03`, kind: "supplier", partyId: carrierId, amount: 500, method: "transfer", cashAccountId: acc["110101"], post: true });
      const jl = await linesOf(p.journalEntryId ?? (await db.select().from(s.payments).where(eq(s.payments.id, p.id)))[0].journalEntryId!);
      expect(jl.find((l) => l.code === "2102")).toMatchObject({ debit: 500, party: carrierId });
      expect((await supplierBalances(db)).find((b) => b.id === carrierId)?.balance).toBe(before - 500);

      const custody = async () => (await custodyBalances(db)).find((c) => c.id === driver.id)!.balance;
      const c0 = await custody();
      await createPayment(db, { paymentDate: `${YEAR}-09-03`, kind: "custody", driverId: driver.id, amount: 1000, method: "cash", cashAccountId: acc["110101"], post: true });
      expect(await custody()).toBe(c0 + 1000);
    });

    it("المصروف من العهدة: معلّق حتى الاعتماد، ثم مدين على المركبة ودائن على عهدة السائق", async () => {
      const [tolls] = await db.select().from(s.accounts).where(eq(s.accounts.code, "5106"));
      const [office] = await db.select().from(s.accounts).where(eq(s.accounts.code, "6109"));
      const custody = async () => (await custodyBalances(db)).find((c) => c.id === driver.id)!.balance;
      const c0 = await custody();
      const e = await createExpense(db, { expenseDate: `${YEAR}-09-04`, payer: "driver_custody", waybillId: firstId, accountId: tolls.id, description: "رسوم طريق", amount: 100, vatAmount: 15 });
      expect(e).toMatchObject({ status: "pending", driverId: driver.id, vehicleId: vehicle.id, costCenterId: vehicle.costCenterId });
      expect(await custody()).toBe(c0);
      const entry = await approveExpense(db, e.id);
      const jl = await linesOf(entry.id);
      expect(jl.find((l) => l.code === "5106")).toMatchObject({ debit: 100, cc: vehicle.costCenterId, driver: driver.id, waybill: firstId });
      expect(jl.find((l) => l.code === "1108")).toMatchObject({ debit: 15 });
      expect(await custody()).toBe(c0 - 115);
      await revertExpense(db, e.id);
      expect(await custody()).toBe(c0);
      await rejectExpense(db, e.id, "بلا إيصال");
      const [r] = await db.select().from(s.expenses).where(eq(s.expenses.id, e.id));
      expect(r).toMatchObject({ status: "rejected", rejectReason: "بلا إيصال" });

      await expect(createExpense(db, { expenseDate: `${YEAR}-09-04`, payer: "cash", accountId: office.id, description: "ضيافة", amount: 50 })).rejects.toThrow("صندوقاً");
      await expect(createExpense(db, { expenseDate: `${YEAR}-09-04`, payer: "cash", cashAccountId: acc["110101"], accountId: acc["110101"], description: "x", amount: 50 })).rejects.toThrow("ليس حساب تكلفة");
      const cashExp = await createExpense(db, { expenseDate: `${YEAR}-09-04`, payer: "cash", cashAccountId: acc["110101"], accountId: office.id, description: "ضيافة", amount: 50, approve: true });
      expect(cashExp.number).toMatch(/^EX-/);
    });

    it("طلب العطل: المشرف يعتمد ما دون الحد، وما فوقه ينتظر المدير، ويتحول إلى أمر صيانة", async () => {
      const small = await createBreakdownRequest(db, { vehicleId: vehicle.id, driverId: driver.id, reportDate: `${YEAR}-09-10`, description: "تسريب زيت", estimatedCost: 800 });
      expect(small).toMatchObject({ number: `BR-${YEAR}-000001`, status: "pending_supervisor" });
      expect((await reviewBreakdownRequest(db, small.id, { limit: 5000 })).status).toBe("approved");
      const big = await createBreakdownRequest(db, { vehicleId: vehicle.id, reportDate: `${YEAR}-09-10`, description: "عمرة مكينة" });
      await expect(reviewBreakdownRequest(db, big.id)).rejects.toThrow("التكلفة التقديرية");
      expect((await reviewBreakdownRequest(db, big.id, { estimatedCost: 18000, limit: 5000 })).status).toBe("pending_approval");
      await expect(createMaintenanceOrder(db, { vehicleId: vehicle.id, orderDate: `${YEAR}-09-11`, type: "mechanical", provider: "internal", breakdownRequestId: big.id })).rejects.toThrow("غير معتمد");
      await approveBreakdownRequest(db, big.id);
      await rejectBreakdownRequest(db, big.id, "يؤجل للعام القادم");
      const [r] = await db.select().from(s.breakdownRequests).where(eq(s.breakdownRequests.id, big.id));
      expect(r.status).toBe("rejected");

      const order = await createMaintenanceOrder(db, { vehicleId: vehicle.id, orderDate: `${YEAR}-09-11`, type: "mechanical", provider: "internal", breakdownRequestId: small.id });
      const [r2] = await db.select().from(s.breakdownRequests).where(eq(s.breakdownRequests.id, small.id));
      expect(r2.status).toBe("in_progress");
      await deleteMaintenanceOrder(db, order.id, { reason: "أُدخل خطأ" });
      const [r3] = await db.select().from(s.breakdownRequests).where(eq(s.breakdownRequests.id, small.id));
      expect(r3.status).toBe("approved");
    });

    it("أمر الصيانة الخارجي: بند إلزامي، قيد على المركبة دائن للورشة، والمركبة في الصيانة حتى الإكمال", async () => {
      const ws = (await createParty(db, { nameAr: "ورشة الصيانة السريعة", roles: ["workshop"] })).id;
      const plan = await savePlan(db, { vehicleId: vehicle.id, type: "consumable", title: "تغيير زيت", intervalDays: 30, lastDoneDate: `${YEAR}-08-01` });
      expect((await planSchedule(db, `${YEAR}-09-05`)).find((p) => p.id === plan.id)).toMatchObject({ due: `${YEAR}-08-31`, days: -5 });

      const o = await createMaintenanceOrder(db, { vehicleId: vehicle.id, orderDate: `${YEAR}-09-12`, type: "consumable", provider: "external", supplierId: ws, supplierInvoiceNo: "Q-77", planId: plan.id, odometer: 4500 });
      await expect(approveMaintenanceOrder(db, o.id)).rejects.toThrow("بنداً واحداً");
      await addMaintenanceLines(db, o.id, [
        { kind: "part", description: "زيت مكينة", quantity: 4, unitPrice: 75 },
        { kind: "part", description: "فلتر", unitPrice: 60 },
        { kind: "labor", description: "أجرة", unitPrice: 100, vatRate: 0 },
      ]);
      const [row] = await db.select().from(s.maintenanceOrders).where(eq(s.maintenanceOrders.id, o.id));
      expect([Number(row.subtotal), Number(row.vatTotal), Number(row.total)]).toEqual([460, 54, 514]);

      const entry = await approveMaintenanceOrder(db, o.id);
      const jl = await linesOf(entry.id);
      expect(jl.filter((l) => l.code === "5107").reduce((a, l) => a + l.debit, 0)).toBe(460);
      expect(jl.filter((l) => l.code === "5107").every((l) => l.cc === vehicle.costCenterId)).toBe(true);
      expect(jl.filter((l) => l.code === "1108").reduce((a, l) => a + l.debit, 0)).toBe(54);
      expect(jl.filter((l) => l.code === "2104").reduce((a, l) => a + l.credit, 0)).toBe(514);
      let [v] = await db.select().from(s.vehicles).where(eq(s.vehicles.id, vehicle.id));
      expect(v.status).toBe("maintenance");
      await expect(createPurchaseInvoice(db, { supplierId: ws, supplierInvoiceNo: "Q-77", invoiceDate: `${YEAR}-09-12`, lines: [{ accountId: jl[0].account, vehicleId: vehicle.id, description: "x", amount: 1 }] })).rejects.toThrow("أمر الصيانة");

      await revertMaintenanceOrder(db, o.id);
      [v] = await db.select().from(s.vehicles).where(eq(s.vehicles.id, vehicle.id));
      expect(v.status).toBe("active");
      await approveMaintenanceOrder(db, o.id);
      await completeMaintenanceOrder(db, o.id, { completedDate: `${YEAR}-09-13`, odometer: 6000 });
      [v] = await db.select().from(s.vehicles).where(eq(s.vehicles.id, vehicle.id));
      expect(v).toMatchObject({ status: "active", odometer: 6000 });
      expect((await planSchedule(db, `${YEAR}-09-13`)).find((p) => p.id === plan.id)).toMatchObject({ lastDoneDate: `${YEAR}-09-13`, due: `${YEAR}-10-13` });
    });

    it("الورشة الداخلية: القطع من الصندوق، والإطارات على حسابها", async () => {
      const o = await createMaintenanceOrder(db, { vehicleId: vehicle.id, orderDate: `${YEAR}-09-14`, type: "tires", provider: "internal" });
      await addMaintenanceLines(db, o.id, [{ kind: "part", description: "إطار", quantity: 2, unitPrice: 900 }]);
      await expect(approveMaintenanceOrder(db, o.id)).rejects.toThrow("الصندوق");
      const entry = await approveMaintenanceOrder(db, o.id, { cashAccountId: acc["110101"] });
      const jl = await linesOf(entry.id);
      expect(jl.find((l) => l.code === "5108")).toMatchObject({ debit: 1800, cc: vehicle.costCenterId });
      expect(jl.filter((l) => l.code === "110101").reduce((a, l) => a + l.credit, 0)).toBe(2070);
      await completeMaintenanceOrder(db, o.id, { completedDate: `${YEAR}-09-14` });
    });
  });
});
