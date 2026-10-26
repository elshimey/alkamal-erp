// اختبارات تكامل على قاعدة PostgreSQL حقيقية. تعمل فقط عند ضبط TEST_DATABASE_URL،
// وتمسح تلك القاعدة بالكامل في البداية، فلا تشير بها إلى قاعدة التشغيل.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { newKeyPair } from "@/lib/zatca/der";
import { clearedQr, submitDocument } from "@/lib/zatca/service";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { and, desc, eq, sql } from "drizzle-orm";
import { closeYear, openYear, reopenYear, setPeriodStatus, yearClosePreview } from "@/lib/periods";
import postgres from "postgres";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { ensureAdminUser, seedReferenceData } from "@/lib/seed";
import { verifyPassword } from "@/lib/password";
import { createJournalEntry } from "@/lib/ledger";
import { getCompany, getInvoiceTemplate, invoiceReadiness, saveCompany, saveInvoiceTemplate } from "@/lib/company";
import { assignVehicle, createDriver, deleteDriver, updateDriver, createVehicle, driverOnDate, releaseAssignment } from "@/lib/fleet";
import { addDocument, saveOwnerDocumentFields, approveSubmission, blockingDocumentIssues, dailySummary, documentRegister, expiringDocuments, listSubmissions, ownerDocuments, rejectSubmission, submitRenewal, summaryText } from "@/lib/documents";
import { addSubAccount } from "@/lib/accounts";
import { activeContract, createContract, createLocation, createParty, createRoute, priceTrip, setContractStatus } from "@/lib/operations";
import { createInvoice, createReceipt, invoicingQueue, issueInvoice, listSalesInvoices, revertInvoice, revertReceipt, updateDraftInvoice } from "@/lib/invoices";
import { parseDocFilter } from "@/lib/doc-filters";
import { createExpense, approveExpense, createPayment, createPurchaseInvoice, custodyBalances, deletePurchaseInvoice, listPurchaseInvoices, postPurchaseInvoice, updateDraftPurchase, rejectExpense, revertExpense, revertPayment, revertPurchaseInvoice, supplierBalances } from "@/lib/purchases";
import { addMaintenanceLines, approveBreakdownRequest, approveMaintenanceOrder, completeMaintenanceOrder, createBreakdownRequest, createMaintenanceOrder, deleteMaintenanceOrder, planSchedule, rejectBreakdownRequest, revertMaintenanceOrder, reviewBreakdownRequest, savePlan, listOrders, orderDoc, updateDraftOrder, createOrdersFrom, listRequests, requestDoc } from "@/lib/maintenance";
import { adjustPayrollLines, approvePayrollRun, bankTransferRows, createAdvance, createEmployee, createPayrollRun, payAdvance, payPayrollRun, refreshPayrollRun, revertAdvance, revertPayrollPayment, revertPayrollRun, updateEmployee } from "@/lib/payroll";
import { createViolation, deleteViolation, listViolations, payViolations, revertViolationPayment, violationSummary } from "@/lib/violations";
import { computePayrollLine } from "@/data/payroll";
import { accountLedger, balanceSheet, costCenterProfit, incomeStatement, previousRange, trialBalance, vatReturn } from "@/lib/reports";
import { alertCounts, cashFlow, financials, operations, periodRange, receivablesAging, vehicleProfit } from "@/lib/dashboard";
import { createDriverExpense, createDriverLogin, linkUserToDriver, removeDriverLogin, resetDriverPassword, driverBalances, driverBreakdowns, driverForUser, driverTrips, isDriverOnly, nextStages, recordDriverStage, reportBreakdown, startTrip, tripDetail } from "@/lib/driver-app";
import { runImport } from "@/lib/importers";
import { applyAdvance, customerCredit, postReceipt } from "@/lib/receipts";
import { createNote, postNote, revertNote } from "@/lib/notes";
import { listCustomers } from "@/lib/customers";
import { createManualEntry, deleteManualEntry, listEntries, postManualEntry, reclassCandidates, reclassify, revertManualEntry, updateManualEntry } from "@/lib/journal";
import { createCashAccount, listCashAccounts, normalizeIban } from "@/lib/banks";
import { exportAllData } from "@/lib/export";
import { createTransfer, deleteTransfer } from "@/lib/transfers";
import { DEFAULT_ECL_RATES, deleteEcl, eclAging, eclCompute, postEcl, provisionBalance } from "@/lib/ecl";
import { createStatement, postLineAsExpense, setStatementStatus, statementDetail } from "@/lib/fuel-cards";
import { createPurchaseOrder, createPurchaseRequest, decideRequest, orderToInvoice, requestToOrderLines, setOrderStatus } from "@/lib/purchasing";
import { createQuotation, quotationToInvoice } from "@/lib/quotations";
import { setupSteps } from "@/lib/setup";
import ExcelJS from "exceljs";
import { getAttachment, listAttachments, onceForOp, saveDataUrl } from "@/lib/attachments";
import * as rec from "@/lib/reconciliation";
import { accrualPreview, postRevenueAccrual, undoRevenueAccrual } from "@/lib/accruals";
import { averageCost, createProduct, createStockDoc, createWarehouse, listProducts, onHand, postStockDoc, productCard, revertStockDoc, saveCount, stockDoc } from "@/lib/inventory";
import { createAsset, deleteAsset, disposeAsset, listAssets, runDepreciation, undoLastDepreciation } from "@/lib/assets";
import { IMPORT_SPECS } from "@/data/import-specs";
import * as hr from "@/lib/hr";
import * as platform from "@/lib/platform";
import { runInTenant, tenantClient } from "@/db/tenant";
import { addExpense, addFuel, approvalIssues, approveWaybill, createWaybill, deleteWaybill, recordStage, rejectWaybill, revertWaybill, updateWaybill } from "@/lib/waybills";

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
    await client`drop schema if exists platform cascade`;
    for (const r of await client`select nspname from pg_namespace where nspname like 't\\_%'`) await client.unsafe(`drop schema "${r.nspname}" cascade`);
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
    expect(rows.length).toBe(116);
    expect(rows.filter((r) => r.parentId === null).length).toBe(7);
  });

  it("بيانات المنشأة: صف واحد، والرقم الضريبي والعنوان الوطني بقواعد الهيئة", async () => {
    expect((await getCompany(db)).nameAr).toBe("الكمال للنقليات");
    const base = { nameAr: "شركة الكمال", nameEn: null, vatNumber: null, crNumber: null, buildingNo: null, street: null, district: null, city: null, postalCode: null, additionalNo: null, phone: null, email: null, website: null, logo: null };
    await expect(saveCompany(db, { ...base, vatNumber: "123456789012345" })).rejects.toThrow("يبدأ بـ 3");
    await expect(saveCompany(db, { ...base, postalCode: "123" })).rejects.toThrow("5 أرقام");
    await expect(saveCompany(db, { ...base, logo: "data:text/html;base64,AAAA" })).rejects.toThrow("الشعار");
    await saveCompany(db, { ...base, vatNumber: "310123456700003", crNumber: "2050197412" });
    const c = await saveCompany(db, { ...base, nameAr: "  الكمال للنقليات  ", vatNumber: "310123456700003", city: "الدمام" });
    expect(c.nameAr).toBe("الكمال للنقليات");
    expect(await db.select().from(s.companyProfile)).toHaveLength(1);
    expect(invoiceReadiness(c).missing).toContain("الشعار");
  });

  it("قالب الفاتورة: صف واحد يُحفظ ويُقرأ مع الافتراضي", async () => {
    expect((await getInvoiceTemplate(db)).layout).toBe("classic");
    await expect(saveInvoiceTemplate(db, { showBank: true })).rejects.toThrow("اسم البنك");
    await saveInvoiceTemplate(db, { layout: "band", accent: "navy", terms: "السداد خلال 30 يوماً" });
    await saveInvoiceTemplate(db, { layout: "minimal", accent: "navy" });
    expect(await getInvoiceTemplate(db)).toMatchObject({ layout: "minimal", accent: "navy", terms: "", showQr: true });
    expect(await db.select().from(s.invoiceTemplate)).toHaveLength(1);
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

    it("سجل الوثائق: التنبيه حسب أيام النوع، والتجديد، والناقص، والمقطورة", async () => {
      const types = await db.select().from(s.documentTypes);
      const code = (c: string) => types.find((t) => t.code === c)!.id;
      // التأمين ينبّه قبل 60 يوماً (الافتراضي)، والرخصة بعد 91 يوماً خارج المدة
      await addDocument(db, { documentTypeId: code("v_insurance"), owner: { kind: "vehicle", id: vehicleId }, expiryDate: `${YEAR}-08-20` });
      await addDocument(db, { documentTypeId: code("d_license"), owner: { kind: "driver", id: driverA }, expiryDate: `${YEAR}-09-30` });
      let due = await expiringDocuments(db, `${YEAR}-07-01`);
      expect(due.map((d) => d.type.code)).toEqual(["v_insurance"]);
      expect(due[0].owner).toBe("د هـ و 5678");
      // التجديد سجل جديد يُسقط تنبيه القديم ويبقيه في التاريخ
      await addDocument(db, { documentTypeId: code("v_insurance"), owner: { kind: "vehicle", id: vehicleId }, expiryDate: `${YEAR + 1}-08-20` });
      due = await expiringDocuments(db, `${YEAR}-07-01`);
      expect(due).toHaveLength(0);
      const docs = await ownerDocuments(db, "vehicle", vehicleId, `${YEAR}-07-01`);
      const ins = docs.find((d) => d.type.code === "v_insurance")!;
      expect(ins.state).toBe("valid");
      expect(ins.history).toHaveLength(1);
      // الاستمارة إلزامية ولم تُسجَّل: ناقصة؛ والتأمين الخليجي اختياري: غير مُدخل
      expect(docs.find((d) => d.type.code === "v_registration")!.state).toBe("missing");
      expect(docs.find((d) => d.type.code === "v_gcc_insurance")!.state).toBe("none");
      const reg = (await documentRegister(db, `${YEAR}-07-01`)).find((r) => r.kind === "vehicle" && r.id === vehicleId)!;
      expect(reg.counts.valid).toBe(1);
      expect(reg.counts.missing).toBeGreaterThan(3);
      // نوع الوثيقة يجب أن يناسب صاحبها، والشركة بلا صاحب
      await expect(addDocument(db, { documentTypeId: code("d_license"), owner: { kind: "vehicle", id: vehicleId }, expiryDate: `${YEAR}-01-01` })).rejects.toThrow();
      await expect(addDocument(db, { documentTypeId: code("t_registration"), owner: { kind: "trailer", id: vehicleId }, expiryDate: `${YEAR}-01-01` })).rejects.toThrow("رأس");
      const { row } = await addDocument(db, { documentTypeId: code("c_cr"), owner: { kind: "company", id: 0 }, expiryDate: `${YEAR}-07-05` });
      expect([row.vehicleId, row.driverId, row.employeeId, row.partyId]).toEqual([null, null, null, null]);
      expect((await expiringDocuments(db, `${YEAR}-07-01`)).map((d) => d.owner)).toEqual(["الشركة"]);
      await db.delete(s.fleetDocuments).where(eq(s.fleetDocuments.id, row.id));
    });

    it("خانات الوثائق في نافذة الصاحب: إضافة، تصحيح، تجديد", async () => {
      const types = await db.select().from(s.documentTypes);
      const fit = types.find((t) => t.code === "v_inspection")!.id;
      const owner = { kind: "vehicle" as const, id: vehicleId };
      const form = (f: Record<string, string>) => {
        const d = new FormData();
        for (const [k, v] of Object.entries(f)) d.set(`doc.${fit}.${k}`, v);
        return d;
      };
      const mine = () => db.select().from(s.fleetDocuments).where(and(eq(s.fleetDocuments.vehicleId, vehicleId), eq(s.fleetDocuments.documentTypeId, fit)));
      // خانات فارغة لا تُنشئ شيئاً
      await db.transaction((tx) => saveOwnerDocumentFields(tx, owner, form({ number: "", issue: "", expiry: "" })));
      expect(await mine()).toHaveLength(0);
      const nums = await db.transaction((tx) => saveOwnerDocumentFields(tx, owner, form({ number: "F-1", issue: `${YEAR}-01-01`, expiry: `${YEAR}-12-31` })));
      expect(nums.get("v_inspection")).toBe("F-1");
      let docs = await mine();
      expect(docs).toHaveLength(1);
      const first = docs[0].id;
      // نفس الانتهاء ورقم مختلف: تصحيح لنفس الوثيقة
      await db.transaction((tx) => saveOwnerDocumentFields(tx, owner, form({ current: String(first), number: "F-1B", issue: `${YEAR}-01-01`, expiry: `${YEAR}-12-31` })));
      docs = await mine();
      expect(docs.map((d) => d.number)).toEqual(["F-1B"]);
      // انتهاء جديد: تجديد بسجل جديد وتبقى السابقة
      await db.transaction((tx) => saveOwnerDocumentFields(tx, owner, form({ current: String(first), number: "", issue: "", expiry: `${YEAR + 1}-12-31` })));
      docs = await mine();
      expect(docs).toHaveLength(2);
      expect(docs.find((d) => d.id !== first)!.number).toBe("F-1B");
      // أخطاء واضحة باسم الوثيقة
      await expect(db.transaction((tx) => saveOwnerDocumentFields(tx, owner, form({ issue: `${YEAR}-05-01`, expiry: `${YEAR}-01-01` })))).rejects.toThrow("الإصدار بعد");
      await expect(db.transaction((tx) => saveOwnerDocumentFields(tx, { kind: "driver", id: driverA }, form({ current: String(first), expiry: `${YEAR}-06-01` })))).rejects.toThrow();
      await db.delete(s.fleetDocuments).where(and(eq(s.fleetDocuments.vehicleId, vehicleId), eq(s.fleetDocuments.documentTypeId, fit)));
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

  describe("الشحنة", () => {
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
      const d = await createDriver(db, { nameAr: "سائق الشحنات" });
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
      // المقطورة (السطحة) أصل مستقل: تُختار في حقلها، ولا تكون هي «المركبة»
      const trailer = await createVehicle(db, { plate: "سطحة 77", chassis: "TRL-77", assetKind: "trailer" });
      await expect(updateWaybill(db, w.id, { trailerId: vehicle.id })).rejects.toThrow("ليست مقطورة");
      await updateWaybill(db, w.id, { trailerId: trailer.id });
      expect((await db.select().from(s.waybills).where(eq(s.waybills.id, w.id)))[0].trailerId).toBe(trailer.id);
      await expect(createWaybill(db, { waybillDate: D, customerId, routeId, shipper: "أ", consignee: "ب", vehicleId: trailer.id })).rejects.toThrow("مقطورة");
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

    it("الوثيقة المانعة المنتهية تمنع الاعتماد والإسناد، والدولية في الرحلات الدولية فقط", async () => {
      const types = await db.select().from(s.documentTypes);
      const code = (c: string) => types.find((t) => t.code === c)!.id;
      const reg = await addDocument(db, { documentTypeId: code("v_registration"), owner: { kind: "vehicle", id: vehicle.id }, expiryDate: "2020-01-01" });
      const gcc = await addDocument(db, { documentTypeId: code("v_gcc_insurance"), owner: { kind: "vehicle", id: vehicle.id }, expiryDate: "2020-01-01" });
      const w = await createWaybill(db, { waybillDate: D, customerId, routeId, shipper: "أ", consignee: "ب", vehicleId: vehicle.id });
      const docs = (await approvalIssues(db, w)).filter((i) => i.code === "documents");
      expect(docs.map((d) => d.message)).toEqual([expect.stringContaining("رخصة السير")]);
      expect(await blockingDocumentIssues(db, [{ kind: "vehicle", id: vehicle.id }], D, true)).toHaveLength(2);
      await expect(assignVehicle(db, { vehicleId: vehicle.id, driverId: driver.id, fromDate: D })).rejects.toThrow("رخصة السير");
      // التجديد يرفع المنع
      await addDocument(db, { documentTypeId: code("v_registration"), owner: { kind: "vehicle", id: vehicle.id }, expiryDate: `${YEAR + 2}-01-01` });
      expect((await approvalIssues(db, w)).some((i) => i.code === "documents")).toBe(false);
      await deleteWaybill(db, w.id, { reason: "اختبار" });
      expect([reg.row.vehicleId, gcc.row.vehicleId]).toEqual([vehicle.id, vehicle.id]);
      await db.delete(s.fleetDocuments).where(eq(s.fleetDocuments.vehicleId, vehicle.id));
    });

    it("السائق يرفع الوثيقة المجددة، والمكتب يعتمدها فتصبح الحالية بصورتها، أو يرفضها بسبب", async () => {
      const types = await db.select().from(s.documentTypes);
      const code = (c: string) => types.find((t) => t.code === c)!.id;
      const photo = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
      const me = { id: driver.id, vehicle: { id: vehicle.id } };
      await expect(submitRenewal(db, me, { documentTypeId: code("v_registration"), photo: null })).rejects.toThrow("صورة");
      await expect(submitRenewal(db, me, { documentTypeId: code("c_cr"), photo })).rejects.toThrow();
      await expect(submitRenewal(db, { ...me, vehicle: null }, { documentTypeId: code("v_registration"), photo })).rejects.toThrow();
      const sub = await submitRenewal(db, me, { documentTypeId: code("v_registration"), number: "R-1", expiryDate: `${YEAR + 1}-06-30`, photo });
      const [pending] = await listSubmissions(db, { status: "pending" });
      expect(pending.sub.id).toBe(sub.id);
      expect(pending.attachmentId).not.toBeNull();
      expect((await dailySummary(db, D)).pending).toBe(1);

      const doc = await approveSubmission(db, sub.id, { expiryDate: `${YEAR + 1}-07-01` });
      expect(doc).toMatchObject({ vehicleId: vehicle.id, number: "R-1", expiryDate: `${YEAR + 1}-07-01` });
      const reg = (await ownerDocuments(db, "vehicle", vehicle.id, D)).find((r) => r.type.code === "v_registration")!;
      expect(reg.current?.doc.id).toBe(doc.id);
      expect(reg.current?.attachmentId).toBe(pending.attachmentId);
      await expect(approveSubmission(db, sub.id, {})).rejects.toThrow("مسبقاً");

      const lic = await submitRenewal(db, me, { documentTypeId: code("d_license"), photo });
      await expect(rejectSubmission(db, lic.id, " ")).rejects.toThrow("سبب");
      await rejectSubmission(db, lic.id, "الصورة غير واضحة");
      const [mine] = await listSubmissions(db, { driverId: driver.id });
      expect(mine.sub).toMatchObject({ status: "rejected", reviewNote: "الصورة غير واضحة" });

      const sum = await dailySummary(db, D);
      expect(sum.pending).toBe(0);
      expect(summaryText(sum, "الكمال")).toContain("ملخص الوثائق اليومي – الكمال");
      await db.delete(s.documentSubmissions);
      await db.delete(s.fleetDocuments).where(eq(s.fleetDocuments.vehicleId, vehicle.id));
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

    it("الفاتورة التجميعية: سطر لكل شحنة ومصاريفها المحمّلة، والإيراد والضريبة عند الإصدار", async () => {
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
      await expect(createInvoice(db, { customerId, invoiceDate: `${YEAR}-08-31` })).rejects.toThrow("لا توجد شحنات");

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

    it("قائمة الفواتير بالبحث والفلترة، وتعديل المسودة من الورقة بقواعدها", async () => {
      const today = `${YEAR}-10-17`;
      const f = (sp: Record<string, string>) => parseDocFilter(sp, ["draft", "issued"], today);
      const [inv] = await listSalesInvoices(db, f({ q: "النخيل" }));
      expect(inv?.i.number).toBe(`INV-${YEAR}-000001`);
      expect(inv.waybills).toBe(3);
      expect(await listSalesInvoices(db, f({ status: "draft" }))).toHaveLength(0);
      expect(await listSalesInvoices(db, f({ pay: "overdue" }))).toHaveLength(1);
      expect(await listSalesInvoices(db, f({ period: "month" }))).toHaveLength(0);
      await expect(updateDraftInvoice(db, inv.i.id, { notes: "x" })).rejects.toThrow("مُصدرة");

      await revertInvoice(db, inv.i.id);
      await updateDraftInvoice(db, inv.i.id, { invoiceDate: `${YEAR}-09-01`, notes: "  دفعة أغسطس " });
      let [row] = await db.select().from(s.salesInvoices).where(eq(s.salesInvoices.id, inv.i.id));
      expect([row.invoiceDate, row.dueDate, row.notes, Number(row.total)]).toEqual([`${YEAR}-09-01`, `${YEAR}-10-01`, "دفعة أغسطس", 7131.15]);
      await expect(updateDraftInvoice(db, inv.i.id, { invoiceDate: `${YEAR}-01-01` })).rejects.toThrow("قبل الشحنة");
      await expect(updateDraftInvoice(db, inv.i.id, { dueDate: `${YEAR}-08-01` })).rejects.toThrow("الاستحقاق قبل");
      await expect(updateDraftInvoice(db, inv.i.id, { invoiceDate: `${YEAR + 1}-01-02` })).rejects.toThrow("سنة أخرى");
      await updateDraftInvoice(db, inv.i.id, { invoiceDate: `${YEAR}-08-31`, dueDate: `${YEAR}-09-30`, notes: "" });
      await issueInvoice(db, inv.i.id);
      [row] = await db.select().from(s.salesInvoices).where(eq(s.salesInvoices.id, inv.i.id));
      expect([row.status, row.invoiceDate, row.dueDate, row.notes]).toEqual(["issued", `${YEAR}-08-31`, `${YEAR}-09-30`, null]);
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

    it("فروق العملة المحققة: تحصيل فاتورة بالدينار بسعر أعلى ربح على 7103، وإرجاع السند يلغيه", async () => {
      const [inv] = await db
        .insert(s.salesInvoices)
        .values({ number: `INV-FX-1`, invoiceDate: `${YEAR}-09-01`, dueDate: `${YEAR}-09-30`, customerId, currencyCode: "KWD", exchangeRate: "12.2", subtotal: "1000", total: "1000", status: "issued" })
        .returning();
      const r = await createReceipt(db, { receiptDate: `${YEAR}-09-10`, customerId, amount: 1000, currencyCode: "KWD", exchangeRate: 12.3, method: "transfer", cashAccountId: acc["110103"], invoiceId: inv.id, post: true });
      const [rc] = await db.select().from(s.receipts).where(eq(s.receipts.id, r.id));
      const lines = await db
        .select({ code: s.accounts.code, d: s.journalLines.debitBase, c: s.journalLines.creditBase })
        .from(s.journalLines)
        .innerJoin(s.accounts, eq(s.accounts.id, s.journalLines.accountId))
        .where(eq(s.journalLines.entryId, rc.journalEntryId!));
      const fx = lines.find((l) => l.code === "7103");
      expect(Number(fx?.c)).toBe(100);
      const ar = lines.filter((l) => l.code === "1103").reduce((t, l) => t + Number(l.c) - Number(l.d), 0);
      expect(Math.round(ar * 100) / 100).toBe(12200);
      await revertReceipt(db, r.id);
      await db.delete(s.salesInvoices).where(eq(s.salesInvoices.id, inv.id));
    });

    it("إقفال السنة: ينقل صافي الربح إلى 3103، ويقفل الأشهر، ولا يظهر في قائمة الدخل، ويُلغى", async () => {
      const Y = YEAR - 3;
      await openYear(db, Y);
      const [other] = await db.select().from(s.accounts).where(eq(s.accounts.code, "4201"));
      await createJournalEntry(db, { entryDate: `${Y}-06-01`, post: true, lines: [{ accountId: acc["110101"], debit: 500 }, { accountId: other.id, credit: 500 }] });
      expect(await yearClosePreview(db, Y)).toEqual({ lines: 1, net: 500 });
      const { net } = await closeYear(db, Y);
      expect(net).toBe(500);
      const inc = await incomeStatement(db, { from: `${Y}-01-01`, to: `${Y}-12-31` });
      expect(inc.current.net).toBe(500);
      const bs = await balanceSheet(db, `${Y}-12-31`);
      expect(bs.sections.find((x) => x.key === "equity")?.lines.find((l) => l.code === "3103")?.amount).toBe(500);
      expect(bs.difference).toBe(0);
      await expect(createJournalEntry(db, { entryDate: `${Y}-07-01`, post: true, lines: [{ accountId: acc["110101"], debit: 1 }, { accountId: other.id, credit: 1 }] })).rejects.toThrow();
      const [p] = await db.select().from(s.fiscalPeriods).where(and(eq(s.fiscalPeriods.year, Y), eq(s.fiscalPeriods.month, 3)));
      await expect(setPeriodStatus(db, p.id, "open")).rejects.toThrow("ألغِ إقفال السنة");
      await reopenYear(db, Y);
      expect(await yearClosePreview(db, Y)).toEqual({ lines: 1, net: 500 });
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

      // الورقة: المرحّلة لا تُعدّل، والمسودة تقبل رقمها وتاريخها بلا تكرار
      await expect(updateDraftPurchase(db, inv.id, { notes: "x" })).rejects.toThrow("مرحّلة");
      const draft = await createPurchaseInvoice(db, { supplierId: workshopId, supplierInvoiceNo: "W-2", invoiceDate: `${YEAR}-08-22`, lines: [{ accountId: maint.id, vehicleId: vehicle.id, description: "فلتر", amount: 50 }] });
      await expect(updateDraftPurchase(db, draft.id, { supplierInvoiceNo: "W-1" })).rejects.toThrow("مسجلة مسبقاً");
      await updateDraftPurchase(db, draft.id, { supplierInvoiceNo: "W-2b", invoiceDate: `${YEAR}-08-25` });
      const [found] = await listPurchaseInvoices(db, parseDocFilter({ q: "w-2B" }, ["draft", "posted"], `${YEAR}-08-31`));
      expect([found?.i.id, found.i.invoiceDate, found.i.dueDate, found.firstLine]).toEqual([draft.id, `${YEAR}-08-25`, `${YEAR}-09-24`, "فلتر"]);
      await deletePurchaseInvoice(db, draft.id, { reason: "اختبار" });

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

    it("سداد الناقل يخفض رصيده المسجل من الشحنات، وصرف العهدة يرفع رصيد السائق", async () => {
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
      // بند ليس من المخزون بلا سعر يُرفض بدل أن يُحفظ بصفر
      await expect(addMaintenanceLines(db, o.id, [{ kind: "labor", description: "أجرة", unitPrice: null }])).rejects.toThrow("إلزامي");
      await addMaintenanceLines(db, o.id, [{ kind: "part", description: "إطار", quantity: 2, unitPrice: 900 }]);
      await expect(approveMaintenanceOrder(db, o.id)).rejects.toThrow("الصندوق");
      const entry = await approveMaintenanceOrder(db, o.id, { cashAccountId: acc["110101"] });
      const jl = await linesOf(entry.id);
      expect(jl.find((l) => l.code === "5108")).toMatchObject({ debit: 1800, cc: vehicle.costCenterId });
      expect(jl.filter((l) => l.code === "110101").reduce((a, l) => a + l.credit, 0)).toBe(2070);
      await completeMaintenanceOrder(db, o.id, { completedDate: `${YEAR}-09-14` });
    });
    it("المسير: الأساسي والبدلات على المركبة أو الإدارة، والتأمينات ونهاية الخدمة والسلف، والعمولات تُصرف ولا تُقيد مرتين", async () => {
      const staff = await createEmployee(db, { nameAr: "محاسب الرواتب", hireDate: "2020-01-01", basicSalary: 8000, housingAllowance: 2000, allowances: 500, isSaudi: true, iban: "SA03 8000 0000 6080 1016 7519" });
      expect(staff.iban).toBe("SA0380000000608010167519");
      await expect(createEmployee(db, { nameAr: "آيبان خطأ", iban: "123" })).rejects.toThrow("الآيبان");
      const [drvRow] = await db.select().from(s.drivers).where(eq(s.drivers.id, driver.id));
      await updateEmployee(db, drvRow.employeeId, { basicSalary: 3000, housingAllowance: 750, hireDate: `${YEAR}-01-01` });

      const adv = await createAdvance(db, { employeeId: drvRow.employeeId, advanceDate: `${YEAR}-08-10`, amount: 1000, installment: 400 });
      await expect(createAdvance(db, { employeeId: drvRow.employeeId, advanceDate: `${YEAR}-08-10`, amount: 100, installment: 200 })).rejects.toThrow("القسط");
      const advEntry = await payAdvance(db, adv.id, { cashAccountId: acc["110101"] });
      expect((await linesOf(advEntry.id)).find((l) => l.code === "1107")).toMatchObject({ debit: 1000 });

      const [{ commission }] = await db
        .select({ commission: sql<string>`coalesce(sum(${s.journalLines.creditBase} - ${s.journalLines.debitBase}), 0)` })
        .from(s.journalLines)
        .innerJoin(s.journalEntries, eq(s.journalEntries.id, s.journalLines.entryId))
        .where(sql`${s.journalEntries.status} = 'posted' and ${s.journalLines.accountId} = ${driver.payableAccountId} and ${s.journalLines.waybillId} is not null and ${s.journalEntries.entryDate} between '${sql.raw(`${YEAR}-08-01`)}' and '${sql.raw(`${YEAR}-08-31`)}'`);

      const run = await createPayrollRun(db, { month: `${YEAR}-08` });
      await expect(createPayrollRun(db, { month: `${YEAR}-08-01` })).rejects.toThrow("موجود");
      await adjustPayrollLines(db, run.id, [
        { employeeId: staff.id, absenceDays: 2 },
        { employeeId: drvRow.employeeId, additions: 100 },
      ]);
      await expect(adjustPayrollLines(db, run.id, [{ employeeId: drvRow.employeeId, advanceDeduction: 1500 }])).rejects.toThrow("المتبقي");
      const lines = await db.select().from(s.payrollLines).where(eq(s.payrollLines.runId, run.id));
      const sl = lines.find((l) => l.employeeId === staff.id)!;
      const dl = lines.find((l) => l.employeeId === drvRow.employeeId)!;
      expect(Number(sl.absenceDeduction)).toBe(700);
      expect(Number(sl.gosiEmployee)).toBe(975);
      expect(Number(sl.gosiEmployer)).toBe(1175);
      expect(Number(sl.eosbAccrual)).toBe(875);
      expect(Number(sl.net)).toBe(10500 - 700 - 975);
      expect(Number(dl.commissions)).toBe(Number(commission));
      expect(Number(dl.advanceDeduction)).toBe(400);
      expect(Number(dl.gosiEmployee)).toBe(0);
      expect(Number(dl.gosiEmployer)).toBe(75);
      expect(Number(dl.eosbAccrual)).toBe(156.25);
      expect(Number(dl.net)).toBe(3850 - 400 + Number(commission));
      expect(dl.costCenterId).toBe(vehicle.costCenterId);

      const entry = await approvePayrollRun(db, run.id);
      const jl = await linesOf(entry.id);
      const sum = (f: (l: (typeof jl)[number]) => boolean, k: "debit" | "credit") => jl.filter(f).reduce((a, l) => a + l[k], 0);
      expect(jl.find((l) => l.code === "5103")).toMatchObject({ debit: 3850, cc: vehicle.costCenterId, driver: driver.id });
      expect(sum((l) => l.code === "6101", "debit")).toBe(9800);
      expect(sum((l) => l.code === "2115", "credit")).toBe(975 + 1175 + 75);
      expect(sum((l) => l.code === "1107", "credit")).toBe(400);
      expect(sum((l) => l.code === "2203", "credit")).toBe(875 + 156.25);
      expect(sum((l) => l.code === "5102", "debit")).toBe(0);
      let [a] = await db.select().from(s.employeeAdvances).where(eq(s.employeeAdvances.id, adv.id));
      expect(Number(a.repaidAmount)).toBe(400);
      await expect(revertAdvance(db, adv.id)).rejects.toThrow("مسير");

      await expect(payPayrollRun(db, run.id, { bankAccountId: acc["110101"], paymentDate: `${YEAR}-08-20` })).rejects.toThrow("قبل نهاية");
      const pay = await payPayrollRun(db, run.id, { bankAccountId: acc["110101"], paymentDate: `${YEAR}-09-01` });
      const bank = await bankTransferRows(db, run.id);
      const pl = await linesOf(pay.id);
      expect(pl.find((l) => l.account === driver.payableAccountId)).toMatchObject({ debit: Number(dl.net) });
      expect(pl.filter((l) => l.code === "110101").reduce((t, l) => t + l.credit, 0)).toBe(bank.reduce((t, r) => t + r.net, 0));
      expect(bank.find((r) => r.name === "محاسب الرواتب")).toMatchObject({ iban: "SA0380000000608010167519", net: 8825 });

      await expect(revertPayrollRun(db, run.id)).rejects.toThrow("الصرف");
      await revertPayrollPayment(db, run.id);
      await revertPayrollRun(db, run.id);
      [a] = await db.select().from(s.employeeAdvances).where(eq(s.employeeAdvances.id, adv.id));
      expect(Number(a.repaidAmount)).toBe(0);
      expect(await db.select().from(s.journalEntries).where(eq(s.journalEntries.id, entry.id))).toHaveLength(0);
    });

    it("التقارير: الميزان متوازن، والمركز المالي يتطابق، وكشف الحساب يطابق الميزان، والدخل من القيود", async () => {
      const from = `${YEAR}-01-01`;
      const to = `${YEAR}-12-31`;
      const tb = await trialBalance(db, { from, to });
      expect(tb.totals.debit).toBe(tb.totals.credit);
      expect(tb.totals.closingDebit).toBe(tb.totals.closingCredit);
      expect(tb.totals.debit).toBeGreaterThan(0);
      const bs = await balanceSheet(db, to);
      expect(bs.difference).toBe(0);
      const inc = await incomeStatement(db, { from, to, ...Object.fromEntries(Object.entries(previousRange(from, to)).map(([k, v]) => [k === "from" ? "compareFrom" : "compareTo", v])) });
      const pl = tb.rows.filter((r) => r.account.level === 1 && /^[4-7]/.test(r.account.code)).reduce((t, r) => t + r.closing - r.opening, 0);
      expect(inc.current.net).toBeCloseTo(-pl, 2);
      expect(inc.previous?.net).toBe(0);
      expect(bs.sections.find((x) => x.key === "equity")!.lines.at(-1)!.amount).toBeCloseTo(inc.current.net, 2);
      const custody = tb.rows.find((r) => r.account.id === driver.custodyAccountId)!;
      const ledger = await accountLedger(db, { accountId: driver.custodyAccountId, from, to });
      expect(ledger.closing).toBe(custody.closing);
      expect(ledger.lines.at(-1)?.balance).toBe(custody.closing);
      const parent = tb.rows.find((r) => r.account.code === "1105")!;
      expect((await accountLedger(db, { accountId: parent.account.id, from, to })).closing).toBe(parent.closing);
      const vat = await vatReturn(db, from, to);
      expect(vat.output).toBe(-tb.rows.find((r) => r.account.code === "2109")!.closing);
      expect(vat.net).toBe(vat.output - vat.input);
      const cc = await costCenterProfit(db, from, to);
      expect(cc.find((c) => c.id === vehicle.costCenterId)!.direct).toBeGreaterThan(0);
      expect(previousRange(`${YEAR}-04-01`, `${YEAR}-06-30`)).toEqual({ from: `${YEAR}-01-01`, to: `${YEAR}-03-31` });
    });

    it("معادلة السطر: الغياب على 30 يوماً، وسقف التأمينات، ونصف شهر قبل خمس سنوات", () => {
      const base = { basic: 50_000, housing: 10_000, otherAllowances: 0, absenceDays: 0, additions: 0, deductions: 0, commissions: 0, advanceDeduction: 0, isSaudi: true, gosiSubject: true, serviceYears: 2 };
      const c = computePayrollLine(base);
      expect(c.gosiEmployee).toBe(4387.5);
      expect(c.eosbAccrual).toBe(2500);
      expect(computePayrollLine({ ...base, gosiSubject: false }).gosiEmployer).toBe(0);
      expect(computePayrollLine({ ...base, isSaudi: false }).gosiEmployee).toBe(0);
    });
  });
  describe("تطبيق السائق", () => {
    const D = "2026-10-05";
    let customerId: number;
    let routeId: number;
    let me: NonNullable<Awaited<ReturnType<typeof driverForUser>>>;
    let otherDriverId: number;
    let userId: number;

    beforeAll(async () => {
      const [sa] = await db.select().from(s.locations).where(eq(s.locations.countryCode, "SA"));
      const a = await createLocation(db, { parentId: sa.id, nameAr: "الخبر" });
      const b = await createLocation(db, { parentId: sa.id, nameAr: "الأحساء" });
      routeId = (await createRoute(db, { fromLocationId: a.id, toLocationId: b.id, distanceKm: 160, driverCommission: 120 })).id;
      customerId = (await createParty(db, { nameAr: "عميل التطبيق", roles: ["customer"] })).id;
      const c = await createContract(db, { customerId, number: "C-APP", fromDate: `${YEAR}-01-01`, toDate: `${YEAR}-12-31` });
      await db.insert(s.contractRates).values({ contractId: c.id, method: "route_fixed", routeId, price: "1800" });
      await setContractStatus(db, c.id, "active");
      const v = await createVehicle(db, { plate: "ت ط ب 777", chassis: "CH-APP", odometer: 10000 });
      const d = await createDriver(db, { nameAr: "سائق التطبيق", mobile: "0555000777", appLanguage: "ur" });
      await assignVehicle(db, { vehicleId: v.id, driverId: d.id, fromDate: `${YEAR}-10-01` });
      otherDriverId = (await createDriver(db, { nameAr: "سائق آخر" })).id;
      userId = (await createDriverLogin(db, { driverId: d.id, login: "0555000777", password: "driver-pass-1" })).id;
      me = (await driverForUser(db, userId))!;
    });

    it("حساب الدخول يُربط بالسائق بدور السائق فقط، ويرى مركبته ولغته", async () => {
      expect(me.vehicle?.plate).toBe("ت ط ب 777");
      expect(me.appLanguage).toBe("ur");
      const roles = await db.select({ key: s.roles.key }).from(s.userRoles).innerJoin(s.roles, eq(s.roles.id, s.userRoles.roleId)).where(eq(s.userRoles.userId, userId));
      expect(isDriverOnly(roles)).toBe(true);
      expect(isDriverOnly([{ key: "driver" }, { key: "accountant" }])).toBe(false);
      await expect(createDriverLogin(db, { driverId: me.id, login: "x-other", password: "driver-pass-1" })).rejects.toThrow("مسبقاً");
      await expect(createDriverLogin(db, { driverId: otherDriverId, login: "0555000777", password: "driver-pass-1" })).rejects.toThrow("مستخدم");
    });

    it("الرحلة تبدأ بالتحميل وتمشي بالمراحل حتى التسليم، والحدود للدولي فقط", async () => {
      const w = await startTrip(db, me, { date: D, customerId, routeId, shipper: "مصنع", consignee: "مستودع", odometer: 10100, userId });
      expect(w.amount).toBe("1800.000");
      let d = await tripDetail(db, me.id, w.id);
      expect(d.trip.status).toBe("in_transit");
      expect(d.next).toEqual(["in_transit", "delivery"]);
      await expect(recordDriverStage(db, me.id, w.id, "border", {})).rejects.toThrow("غير متاحة");
      await expect(tripDetail(db, otherDriverId, w.id)).rejects.toThrow("ليست لك");
      await expect(recordDriverStage(db, otherDriverId, w.id, "delivery", {})).rejects.toThrow("ليست لك");
      await recordDriverStage(db, me.id, w.id, "delivery", { odometer: 10270, userId });
      d = await tripDetail(db, me.id, w.id);
      expect(d.trip.status).toBe("delivered");
      expect(d.next).toEqual([]);
      expect((await driverTrips(db, me.id, { open: true })).map((x) => x.lastStage)).toEqual(["delivery"]);
      await approveWaybill(db, w.id);
      expect(await driverTrips(db, me.id, { open: true })).toHaveLength(0);
      expect(nextStages({ status: "in_transit", isInternational: true }, ["loading"])).toEqual(["in_transit", "border", "delivery"]);
      expect(nextStages({ status: "in_transit", isInternational: true }, ["loading", "border"])).toEqual(["delivery"]);
    });

    it("مصروف السائق ينتظر الاعتماد ثم يُخصم من عهدته، والرصيد يجمع العمولة والمستحق", async () => {
      const e = await createDriverExpense(db, me, { date: D, type: "road", description: "وجبة وموقف", amount: 100, vatAmount: 15, userId });
      expect(e.status).toBe("pending");
      let b = await driverBalances(db, me, D);
      expect(b.pendingExpenses).toBe(115);
      expect(b.custody).toBe(0);
      expect(b.monthCommission).toBe(120);
      expect(b.payable).toBe(120);
      await approveExpense(db, e.id);
      b = await driverBalances(db, me, D);
      expect(b.custody).toBe(-115);
      expect(b.pendingCount).toBe(0);
      expect(b.movements.map((m) => m.credit).sort()).toEqual([100, 15].sort());
      const r = await reportBreakdown(db, me, { date: D, description: "صوت في الفرامل", priority: "urgent", userId });
      expect(r.vehicleId).toBe(me.vehicle!.id);
      expect((await driverBreakdowns(db, me.id))[0].r.status).toBe("pending_supervisor");
    });
  });

  describe("المخالفات المرورية", () => {
    it("تُقيد على السائق المسند أو على الشركة، وتُخصم في المسير مرة واحدة، وتُسدد للمرور بقيد واحد", async () => {
      const linesOf = async (entryId: number) => {
        const rows = await db.select({ l: s.journalLines, code: s.accounts.code }).from(s.journalLines).innerJoin(s.accounts, eq(s.accounts.id, s.journalLines.accountId)).where(eq(s.journalLines.entryId, entryId));
        return rows.map(({ l, code }) => ({ code, debit: Number(l.debitBase), credit: Number(l.creditBase), cc: l.costCenterId, driver: l.driverId, account: l.accountId }));
      };
      const balance = async (accountId: number) => {
        const [r] = await db
          .select({ b: sql<string>`coalesce(sum(${s.journalLines.creditBase} - ${s.journalLines.debitBase}), 0)` })
          .from(s.journalLines)
          .innerJoin(s.journalEntries, eq(s.journalEntries.id, s.journalLines.entryId))
          .where(sql`${s.journalEntries.status} = 'posted' and ${s.journalLines.accountId} = ${accountId}`);
        return Number(r.b);
      };
      const v = await createVehicle(db, { plate: "م خ ل 909", chassis: "CH-VIO" });
      const d = await createDriver(db, { nameAr: "سائق المخالفات" });
      const [drv] = await db.select().from(s.drivers).where(eq(s.drivers.id, d.id));
      await updateEmployee(db, drv.employeeId, { basicSalary: 3000, hireDate: `${YEAR}-01-01` });
      await assignVehicle(db, { vehicleId: v.id, driverId: d.id, fromDate: `${YEAR}-12-01` });
      const [emp] = await db.select().from(s.employees).where(eq(s.employees.id, drv.employeeId));
      const driverPayable = emp.payableAccountId!;
      const payable2108 = acc["2108"];
      const before2108 = await balance(payable2108);

      // السائق يُعرف من الإسناد
      const v1 = await createViolation(db, { violationDate: `${YEAR}-12-05`, vehicleId: v.id, reference: "TR-1001", violationType: "تجاوز السرعة", amount: 500, chargeTo: "driver" });
      expect(v1.driverId).toBe(d.id);
      expect(await linesOf(v1.journalEntryId)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ account: driverPayable, debit: 500, driver: d.id }),
          expect.objectContaining({ code: "2108", credit: 500 }),
        ]),
      );
      await expect(createViolation(db, { violationDate: `${YEAR}-12-07`, vehicleId: v.id, reference: "TR-1001", violationType: "وقوف", amount: 100, chargeTo: "driver" })).rejects.toThrow("مسجل مسبقاً");
      await expect(createViolation(db, { violationDate: `${YEAR}-11-20`, vehicleId: v.id, violationType: "وقوف", amount: 100, chargeTo: "driver" })).rejects.toThrow("لا يوجد سائق");

      // على الشركة: مصروف على مركز تكلفة المركبة
      const v2 = await createViolation(db, { violationDate: `${YEAR}-12-06`, vehicleId: v.id, violationType: "حمولة زائدة", location: "ميزان الخرج", amount: 300, chargeTo: "company" });
      expect((await linesOf(v2.journalEntryId)).find((l) => l.code === "5113")).toMatchObject({ debit: 300, cc: v.costCenterId });

      // المسير يخصمها، ومخالفة لاحقة تمنع الاعتماد حتى التحديث
      const run = await createPayrollRun(db, { month: `${YEAR}-12` });
      let [line] = await db.select().from(s.payrollLines).where(sql`${s.payrollLines.runId} = ${run.id} and ${s.payrollLines.employeeId} = ${drv.employeeId}`);
      expect(Number(line.violations)).toBe(500);
      expect(Number(line.net)).toBe(2500);
      const v3 = await createViolation(db, { violationDate: `${YEAR}-12-10`, vehicleId: v.id, violationType: "قطع إشارة", amount: 200, chargeTo: "driver" });
      await expect(approvePayrollRun(db, run.id)).rejects.toThrow("تحديث المسير");
      await refreshPayrollRun(db, run.id);
      [line] = await db.select().from(s.payrollLines).where(sql`${s.payrollLines.runId} = ${run.id} and ${s.payrollLines.employeeId} = ${drv.employeeId}`);
      expect(Number(line.violations)).toBe(700);
      expect(Number(line.net)).toBe(2300);
      await approvePayrollRun(db, run.id);
      // ذمة السائق بعد الاعتماد = الصافي بالضبط (الخصم قُيد عند التسجيل ولم يتكرر)
      expect(await balance(driverPayable)).toBe(2300);
      await expect(deleteViolation(db, v1.id, { reason: "خطأ" })).rejects.toThrow("أرجعه لمسودة");
      expect((await listViolations(db, { driverId: d.id, chargeTo: "driver" })).map((x) => x.run)).toEqual([run.number, run.number]);

      // السداد للمرور
      await expect(payViolations(db, [v1.id, v2.id], { paymentDate: `${YEAR}-12-05`, cashAccountId: acc["110101"] })).rejects.toThrow("قبل تاريخ");
      const pay = await payViolations(db, [v1.id, v2.id], { paymentDate: `${YEAR}-12-15`, cashAccountId: acc["110101"] });
      const pl = await linesOf(pay.id);
      expect(pl.filter((l) => l.code === "2108").reduce((a, l) => a + l.debit, 0)).toBe(800);
      expect(pl.find((l) => l.code === "110101")).toMatchObject({ credit: 800 });
      expect(await balance(payable2108)).toBe(before2108 + 200);
      await expect(payViolations(db, [v1.id], { paymentDate: `${YEAR}-12-16`, cashAccountId: acc["110101"] })).rejects.toThrow("مسددة مسبقاً");
      await expect(deleteViolation(db, v2.id, { reason: "خطأ" })).rejects.toThrow("ألغِ السداد");
      expect(await revertViolationPayment(db, v2.id)).toBe(2);
      expect(await balance(payable2108)).toBe(before2108 + 1000);
      const sum = await violationSummary(db);
      expect(sum.unpaidCount).toBeGreaterThanOrEqual(3);

      // الحذف يلغي القيد ويُسجل، والمسير المعاد لمسودة يسمح بحذف ما خصمه
      await deleteViolation(db, v2.id, { reason: "مكررة" });
      expect(await db.select().from(s.journalEntries).where(eq(s.journalEntries.id, v2.journalEntryId))).toHaveLength(0);
      await revertPayrollRun(db, run.id);
      await deleteViolation(db, v3.id, { reason: "أُلغيت من المرور" });
      await expect(approvePayrollRun(db, run.id)).rejects.toThrow("تحديث المسير");
      await refreshPayrollRun(db, run.id);
      [line] = await db.select().from(s.payrollLines).where(sql`${s.payrollLines.runId} = ${run.id} and ${s.payrollLines.employeeId} = ${drv.employeeId}`);
      expect(Number(line.violations)).toBe(500);
      const logs = await db.select().from(s.deletionLog).where(eq(s.deletionLog.entity, "traffic_violation"));
      expect(logs).toHaveLength(2);
    });

    it("معادلة السطر تطرح المخالفات من الصافي", () => {
      const base = { basic: 3000, housing: 0, otherAllowances: 0, absenceDays: 0, additions: 0, deductions: 0, commissions: 150, advanceDeduction: 0, isSaudi: false, gosiSubject: false, serviceYears: 1 };
      expect(computePayrollLine({ ...base, violations: 400 }).net).toBe(computePayrollLine(base).net - 400);
    });
  });
  describe("الاستيراد من Excel", () => {
    const rowsOf = (list: Record<string, string>[]) => list.map((values, i) => ({ row: i + 5, values }));
    const line = (o: Record<string, string>) => ({ customer: "مؤسسة الاستيراد", currency: "SAR", invoiceDate: `${YEAR}-11-03`, description: "نقل", quantity: "1", unitPrice: "1000", account: "4101", ...o });

    it("فواتير البيع: التحقق يكشف العميل غير الموجود، ثم يستورد مسودات بسطور حرة", async () => {
      const spec = IMPORT_SPECS["sales-invoices"];
      const rows = rowsOf([
        line({ reference: "OLD-1", quantity: "2", unitPrice: "500", discount: "10" }),
        line({ reference: "OLD-2", taxInclusive: "شامل الضريبة", unitPrice: "1150", costCenter: "أ ب ج 1234" }),
        line({ reference: "OLD-2", description: "رسوم", unitPrice: "100", account: "4103", taxCode: "صفر", taxInclusive: "شامل الضريبة" }),
        line({ reference: "OLD-3", account: "9999" }),
      ]);
      const before = await db.select().from(s.salesInvoices);

      let report = await runImport(db, spec, rows, { dryRun: true });
      expect(report).toMatchObject({ total: 3, ok: 0 });
      expect(report.issues.every((i) => i.missing?.kind === "customer")).toBe(true);
      expect(report.issues[1].rows).toEqual([6, 7]);

      const customers = await runImport(db, IMPORT_SPECS.customers, rowsOf([{ nameAr: "مؤسسة الاستيراد", vatNumber: "300000000000003" }, { nameAr: "مؤسسة الاستيراد" }, { nameAr: "س", vatNumber: "123" }]), { dryRun: false });
      expect(customers.ok).toBe(1);
      expect(customers.issues.map((i) => i.message)).toEqual([expect.stringContaining("مسجل مسبقاً"), "الرقم الضريبي 15 رقماً"]);

      report = await runImport(db, spec, rows, { dryRun: true });
      expect(report.ok).toBe(2);
      expect(report.issues).toEqual([{ rows: [8], message: "الحساب «9999» غير موجود في النظام", missing: { kind: "account", value: "9999" } }]);
      // التحقق لا يكتب شيئاً
      expect(await db.select().from(s.salesInvoices)).toHaveLength(before.length);

      report = await runImport(db, spec, rows, { dryRun: false });
      expect(report.ok).toBe(2);
      const [inv1] = await db.select().from(s.salesInvoices).where(eq(s.salesInvoices.reference, "OLD-1"));
      const n = (i: typeof inv1) => [Number(i.subtotal), Number(i.vatTotal), Number(i.total)];
      expect(inv1).toMatchObject({ status: "draft", dueDate: `${YEAR}-12-03` });
      expect(n(inv1)).toEqual([900, 135, 1035]);
      const [inv2] = await db.select().from(s.salesInvoices).where(eq(s.salesInvoices.reference, "OLD-2"));
      // شامل الضريبة: 1150 = 1000 + 150، والرسوم بنسبة صفر 100
      expect(n(inv2)).toEqual([1100, 150, 1250]);
      const lines2 = await db.select().from(s.salesInvoiceLines).where(eq(s.salesInvoiceLines.invoiceId, inv2.id));
      expect(lines2.map((l) => [l.kind, Number(l.amount), l.costCenterId])).toEqual([
        ["manual", 1000, vehicleCc],
        ["manual", 100, null],
      ]);

      // لا تُستورد الفاتورة مرتين
      report = await runImport(db, spec, rows.slice(0, 1), { dryRun: true });
      expect(report.issues[0].message).toContain("مستوردة مسبقاً");

      // الإصدار يرحّل الإيراد على مركز تكلفة المركبة، وتغيير التاريخ لا يمس السطور الحرة
      await updateDraftInvoice(db, inv2.id, { invoiceDate: `${YEAR}-11-04` });
      expect(await db.select().from(s.salesInvoiceLines).where(eq(s.salesInvoiceLines.invoiceId, inv2.id))).toHaveLength(2);
      const entry = await issueInvoice(db, inv2.id);
      const jl = await db.select().from(s.journalLines).where(eq(s.journalLines.entryId, entry.id));
      expect(jl.find((l) => l.accountId === acc["4101"])).toMatchObject({ costCenterId: vehicleCc });
      expect(Number(jl.find((l) => l.accountId === acc["4101"])!.credit)).toBe(1000);
      expect(jl.reduce((t, l) => t + Number(l.debit), 0)).toBe(1250);
    });

    it("المركبات: حساب الأصل إلزامي ويجب أن يكون أصلاً، واللوحة لا تتكرر", async () => {
      const report = await runImport(
        db,
        IMPORT_SPECS.vehicles,
        rowsOf([
          { plate: "ط ي ك 1", chassis: "IMP-1", assetAccount: "الشاحنات (الرؤوس)", ownership: "مستأجرة", year: "2021" },
          { plate: "ط ي ك 2", chassis: "IMP-2" },
          { plate: "ط ي ك 3", chassis: "IMP-3", assetAccount: "4101" },
          { plate: "ط ي ك 1", chassis: "IMP-4", assetAccount: "120101" },
          { plate: "ط ي ك 5", chassis: "IMP-5", assetAccount: "120102", year: "1900" },
        ]),
        { dryRun: false },
      );
      expect(report.ok).toBe(1);
      expect(report.issues.map((i) => i.message)).toEqual([
        "حساب الأصل مطلوب",
        expect.stringContaining("ليس حساب أصل"),
        "اللوحة ط ي ك 1 مسجلة مسبقاً",
        "سنة الصنع: الحد الأدنى 1980",
      ]);
      const [v] = await db.select().from(s.vehicles).where(eq(s.vehicles.plate, "ط ي ك 1"));
      expect(v).toMatchObject({ assetAccountId: acc["120101"], ownership: "leased", year: 2021 });
      expect(v.costCenterId).toBeGreaterThan(0);
    });
  });
  describe("سندات العملاء والإشعارات", () => {
    let cust: number;
    const invs: { id: number; total: number }[] = [];
    const paid = async (id: number) => Number((await db.select().from(s.salesInvoices).where(eq(s.salesInvoices.id, id)))[0].paidAmount);
    const base = { method: "transfer" as const, cashAccountId: 0 };

    beforeAll(async () => {
      base.cashAccountId = acc["110101"];
      cust = (await createParty(db, { nameAr: "شركة السندات", roles: ["customer"] })).id;
      for (const [ref, price, date] of [["RC-A", "1000", "12-01"], ["RC-B", "2000", "12-02"]] as const) {
        await runImport(db, IMPORT_SPECS["sales-invoices"], [{ row: 5, values: { customer: "شركة السندات", reference: ref, currency: "SAR", invoiceDate: `${YEAR}-${date}`, description: "نقل", quantity: "1", unitPrice: price, account: "4101" } }], { dryRun: false });
        const [i] = await db.select().from(s.salesInvoices).where(eq(s.salesInvoices.reference, ref));
        await issueInvoice(db, i.id);
        invs.push({ id: i.id, total: Number(i.total) });
      }
    });

    it("دفعة عن فواتير بتوزيع يدوي وتعديل خصم: الفاتورة الأولى مسددة جزئياً والقيد متوازن", async () => {
      expect(invs.map((i) => i.total)).toEqual([1150, 2300]);
      await expect(createReceipt(db, { ...base, receiptDate: `${YEAR}-12-05`, customerId: cust, amount: 500, allocations: [{ invoiceId: invs[0].id, amount: 2000 }], post: true })).rejects.toThrow();
      const r = await createReceipt(db, {
        ...base,
        receiptDate: `${YEAR}-12-05`,
        customerId: cust,
        amount: 990,
        allocations: [{ invoiceId: invs[0].id, amount: 1000 }],
        adjustments: [{ accountId: acc["4105"], amount: 10, description: "خصم مسموح به" }],
        post: true,
      });
      expect(await paid(invs[0].id)).toBe(1000);
      expect(await paid(invs[1].id)).toBe(0);
      const [row] = await db.select().from(s.receipts).where(eq(s.receipts.id, r.id));
      const jl = await db.select().from(s.journalLines).where(eq(s.journalLines.entryId, row.journalEntryId!));
      expect(Number(jl.find((l) => l.accountId === acc["4105"])!.debit)).toBe(10);
      expect(Number(jl.find((l) => l.accountId === acc["1103"])!.credit)).toBe(1000);
      await revertReceipt(db, r.id);
      expect(await paid(invs[0].id)).toBe(0);
      expect(await db.select().from(s.receiptAdjustments).where(eq(s.receiptAdjustments.receiptId, r.id))).toHaveLength(0);
      // إعادة الترحيل تستخدم التوزيع المحفوظ
      await postReceipt(db, r.id);
      expect(await paid(invs[0].id)).toBe(1000);
    });

    it("دفعة مقدمة ثم تطبيقها على فاتورة، واسترداد لا يتجاوز الرصيد الدائن", async () => {
      const adv = await createReceipt(db, { ...base, kind: "advance", receiptDate: `${YEAR}-12-06`, customerId: cust, amount: 500, post: true });
      expect((await customerCredit(db, cust)).advances).toBe(500);
      await applyAdvance(db, adv.id, [{ invoiceId: invs[0].id, amount: 150 }], { date: `${YEAR}-12-07` });
      expect(await paid(invs[0].id)).toBe(1150);
      await applyAdvance(db, adv.id, [{ invoiceId: invs[1].id, amount: 100 }], { date: `${YEAR}-12-07` });
      expect(await paid(invs[1].id)).toBe(100);
      await expect(applyAdvance(db, adv.id, [{ invoiceId: invs[1].id, amount: 300 }], { date: `${YEAR}-12-07` })).rejects.toThrow();
      const credit = await customerCredit(db, cust);
      expect(credit.advances).toBe(250);
      await expect(createReceipt(db, { ...base, kind: "refund", receiptDate: `${YEAR}-12-08`, customerId: cust, amount: 400, post: true })).rejects.toThrow();
      await createReceipt(db, { ...base, kind: "refund", receiptDate: `${YEAR}-12-08`, customerId: cust, amount: 250, post: true });
      expect((await customerCredit(db, cust)).available).toBe(0);
      // إرجاع الدفعة المقدمة يلغي تطبيقاتها
      await revertReceipt(db, adv.id);
      expect(await paid(invs[0].id)).toBe(1000);
      await postReceipt(db, adv.id);
      await applyAdvance(db, adv.id, [{ invoiceId: invs[0].id, amount: 150 }, { invoiceId: invs[1].id, amount: 100 }], { date: `${YEAR}-12-07` });
    });

    it("إشعار دائن على فاتورة يخفض الإيراد والضريبة ورصيدها، والزائد رصيد دائن للعميل", async () => {
      await expect(createNote(db, { kind: "sales_credit", noteDate: `${YEAR}-12-09`, partyId: cust, invoiceId: invs[1].id, reason: "", lines: [{ description: "خصم", accountId: acc["4101"], amount: 100, vatRate: 15 }] })).rejects.toThrow("سبب");
      await expect(createNote(db, { kind: "sales_credit", noteDate: `${YEAR}-12-09`, partyId: cust, invoiceId: invs[1].id, reason: "خصم", lines: [{ description: "خصم", accountId: acc["6113"], amount: 100, vatRate: 15 }] })).rejects.toThrow("لا يصلح");
      const n = await createNote(db, { kind: "sales_credit", noteDate: `${YEAR}-12-09`, partyId: cust, invoiceId: invs[1].id, reason: "مرتجع جزئي", lines: [{ description: "تخفيض أجرة", accountId: acc["4101"], amount: 2000, vatRate: 15 }], post: true });
      expect([Number(n.subtotal), Number(n.vatTotal), Number(n.total)]).toEqual([2000, 300, 2300]);
      // رصيد الفاتورة 2200 فيُطبق منها 2200 ويبقى 100 رصيداً دائناً
      expect(await paid(invs[1].id)).toBe(2300);
      const [row] = await db.select().from(s.adjustmentNotes).where(eq(s.adjustmentNotes.id, n.id));
      expect(Number(row.appliedAmount)).toBe(2200);
      const jl = await db.select().from(s.journalLines).where(eq(s.journalLines.entryId, row.journalEntryId!));
      expect(Number(jl.find((l) => l.accountId === acc["4101"])!.debit)).toBe(2000);
      expect(Number(jl.find((l) => l.accountId === acc["2109"])!.debit)).toBe(300);
      expect(Number(jl.find((l) => l.accountId === acc["1103"])!.credit)).toBe(2300);
      expect((await customerCredit(db, cust)).available).toBe(100);
      const [c] = (await listCustomers(db, { today: `${YEAR}-12-31` })).filter((x) => x.p.id === cust);
      expect(c).toMatchObject({ outstanding: 0, credit: 100, openCount: 0 });
      await revertNote(db, n.id);
      expect(await paid(invs[1].id)).toBe(100);
      await postNote(db, n.id);
    });

    it("استيراد سندات القبض: يربط الفاتورة بالرقم المستورد ويرفض الفاتورة غير الموجودة", async () => {
      await runImport(db, IMPORT_SPECS["sales-invoices"], [{ row: 5, values: { customer: "شركة السندات", reference: "RC-C", currency: "SAR", invoiceDate: `${YEAR}-12-10`, description: "نقل", quantity: "1", unitPrice: "100", account: "4101" } }], { dryRun: false });
      const [c] = await db.select().from(s.salesInvoices).where(eq(s.salesInvoices.reference, "RC-C"));
      await issueInvoice(db, c.id);
      const row = (o: Record<string, string>, i: number) => ({ row: i + 5, values: { customer: "شركة السندات", receiptDate: "15/12/2026", amount: "115", cashAccount: "110101", ...o } });
      const report = await runImport(db, IMPORT_SPECS.receipts, [row({ invoice: "RC-C", method: "نقد" }, 0), row({ invoice: "NOPE" }, 1), row({ kind: "دفعة مقدمة", cashAccount: "4101" }, 2), row({ kind: "دفعة مقدمة", amount: "50" }, 3)], { dryRun: false, post: true });
      expect(report.ok).toBe(2);
      expect(report.issues.map((i) => i.missing?.kind ?? i.message)).toEqual(["invoice", expect.stringContaining("ليس صندوقاً")]);
      expect(await paid(c.id)).toBe(115);
    });

    it("إشعار مدين للمورد يخفض ذمته وضريبة المدخلات ورصيد فاتورته", async () => {
      const sup = (await createParty(db, { nameAr: "مورد الإشعارات", roles: ["supplier"] })).id;
      const pi = await createPurchaseInvoice(db, { supplierId: sup, supplierInvoiceNo: "N-1", invoiceDate: `${YEAR}-12-01`, lines: [{ accountId: acc["6113"], description: "لوازم", amount: 1000, vatRate: 15 }] });
      await postPurchaseInvoice(db, pi.id);
      const n = await createNote(db, { kind: "purchase_debit", noteDate: `${YEAR}-12-03`, partyId: sup, invoiceId: pi.id, reason: "مرتجع", lines: [{ description: "مرتجع لوازم", accountId: acc["6113"], amount: 200, vatRate: 15 }], post: true });
      const [p] = await db.select().from(s.purchaseInvoices).where(eq(s.purchaseInvoices.id, pi.id));
      expect(Number(p.paidAmount)).toBe(230);
      const [row] = await db.select().from(s.adjustmentNotes).where(eq(s.adjustmentNotes.id, n.id));
      const jl = await db.select().from(s.journalLines).where(eq(s.journalLines.entryId, row.journalEntryId!));
      expect(Number(jl.find((l) => l.accountId === acc["2101"])!.debit)).toBe(230);
      expect(Number(jl.find((l) => l.accountId === acc["1108"])!.credit)).toBe(30);
      // إشعار دائن من المورد يزيد ذمته ولا يمس رصيد الفاتورة
      const c = await createNote(db, { kind: "purchase_credit", noteDate: `${YEAR}-12-04`, partyId: sup, invoiceId: pi.id, reason: "فرق سعر", lines: [{ description: "فرق", accountId: acc["6113"], amount: 100, vatRate: 0 }], post: true });
      const [cr] = await db.select().from(s.adjustmentNotes).where(eq(s.adjustmentNotes.id, c.id));
      expect(Number(cr.appliedAmount)).toBe(0);
      const jl2 = await db.select().from(s.journalLines).where(eq(s.journalLines.entryId, cr.journalEntryId!));
      expect(Number(jl2.find((l) => l.accountId === acc["2101"])!.credit)).toBe(100);
    });
  });
  describe("المحاسبة: القيود والبنوك والأصول", () => {
    const linesOf = (entryId: number) => db.select().from(s.journalLines).where(eq(s.journalLines.entryId, entryId));

    it("القيد اليدوي: مسودة تُعدّل ثم تُرحّل وتُرجع وتُحذف مع سجل الحذف", async () => {
      await expect(createManualEntry(db, { entryDate: `${YEAR}-07-01`, description: "غير متوازن", lines: [{ accountId: acc["110101"], debit: 100 }, { accountId: acc["3104"], credit: 90 }] })).rejects.toThrow();
      await expect(createManualEntry(db, { entryDate: `${YEAR}-07-01`, description: "بلا مركز", lines: [{ accountId: acc["5110"], debit: 100 }, { accountId: acc["110101"], credit: 100 }], post: true })).rejects.toThrow("مركز");
      const e = await createManualEntry(db, { entryDate: `${YEAR}-07-01`, description: "تمويل من الشريك", reference: "JV-1", lines: [{ accountId: acc["110101"], debit: 500 }, { accountId: acc["3104"], credit: 500 }] });
      expect((await db.select().from(s.journalEntries).where(eq(s.journalEntries.id, e.id)))[0]).toMatchObject({ status: "draft", reference: "JV-1" });
      await updateManualEntry(db, e.id, { entryDate: `${YEAR}-07-02`, description: "تمويل من الشريك", reference: "JV-1", lines: [{ accountId: acc["110101"], debit: 800 }, { accountId: acc["3104"], credit: 800 }] });
      expect((await linesOf(e.id)).map((l) => Number(l.debit) + Number(l.credit))).toEqual([800, 800]);
      await postManualEntry(db, e.id);
      await expect(updateManualEntry(db, e.id, { entryDate: `${YEAR}-07-02`, description: "x", lines: [{ accountId: acc["110101"], debit: 1 }, { accountId: acc["3104"], credit: 1 }] })).rejects.toThrow();
      const found = await listEntries(db, { q: "JV-1" });
      expect(found.map((x) => x.e.id)).toContain(e.id);
      expect(found.find((x) => x.e.id === e.id)).toMatchObject({ total: "800.000", lines: 2 });
      await revertManualEntry(db, e.id);
      await deleteManualEntry(db, e.id, { reason: "تجربة" });
      expect(await db.select().from(s.journalEntries).where(eq(s.journalEntries.id, e.id))).toHaveLength(0);
      const [log] = await db.select().from(s.deletionLog).where(eq(s.deletionLog.entityId, String(e.id)));
      expect(log.reason).toBe("تجربة");
    });

    it("إعادة التصنيف المجمّع: قيد تصحيح يعكس السطور ويقيدها على الحساب والمركز الجديد", async () => {
      const v2 = await createVehicle(db, { plate: "ر س ت 4321", chassis: "CH-RC" });
      const mk = (amount: number) => createManualEntry(db, { entryDate: `${YEAR}-07-05`, description: "ديزل", lines: [{ accountId: acc["5110"], debit: amount, costCenterId: vehicleCc, description: "خطأ حساب" }, { accountId: acc["110101"], credit: amount }], post: true });
      await mk(100);
      await mk(250);
      const cands = await reclassCandidates(db, { accountId: acc["5110"], q: "خطأ حساب" });
      expect(cands).toHaveLength(2);
      const fix = await reclassify(db, { lineIds: cands.map((c) => c.id), targetAccountId: acc["6110"], targetCostCenterId: v2.costCenterId, date: `${YEAR}-07-06` });
      const jl = await linesOf(fix.id);
      const sum = (code: string, side: "debit" | "credit") => jl.filter((l) => l.accountId === acc[code]).reduce((t, l) => t + Number(l[side]), 0);
      expect(sum("5110", "credit")).toBe(350);
      expect(sum("6110", "debit")).toBe(350);
      expect(jl.filter((l) => l.accountId === acc["6110"]).every((l) => l.costCenterId === v2.costCenterId)).toBe(true);
      await expect(reclassify(db, { lineIds: [cands[0].id], targetAccountId: acc["5110"], date: `${YEAR}-07-06` })).rejects.toThrow("نفسه");
    });

    it("الحسابات البنكية: آيبان بخانة تحقق، وحساب فرعي برصيد افتتاحي مقابل الأرباح المبقاة", async () => {
      expect(normalizeIban("sa03 8000 0000 6080 1016 7519")).toBe("SA0380000000608010167519");
      expect(() => normalizeIban("SA0380000000608010167518")).toThrow("التحقق");
      expect(() => normalizeIban("SA038000000060801016751")).toThrow("24");
      await expect(createCashAccount(db, { kind: "bank", nameAr: "بنك بلا اسم" })).rejects.toThrow("اسم البنك");
      const a = await createCashAccount(db, { kind: "bank", nameAr: "الأهلي – جاري", bankName: "البنك الأهلي", iban: "SA0380000000608010167519", openingBalance: 25000, openingDate: `${YEAR}-07-01` });
      expect(a.code.startsWith("1102")).toBe(true);
      const row = (await listCashAccounts(db)).find((r) => r.a.id === a.id)!;
      expect(row.balance).toBe(25000);
      expect(row.bank?.iban).toBe("SA0380000000608010167519");
      const [eq3103] = await db.select({ c: sql<string>`sum(${s.journalLines.credit})` }).from(s.journalLines).where(eq(s.journalLines.accountId, acc["3103"]));
      expect(Number(eq3103.c)).toBeGreaterThanOrEqual(25000);
    });

    it("الأصول الثابتة: إهلاك شهري على مركز المركبة، وإعادة بناء الشهر لأصل متأخر، والاستبعاد بربح", async () => {
      const [vehicle] = await db.select().from(s.vehicles).where(eq(s.vehicles.costCenterId, vehicleCc));
      await expect(createAsset(db, { nameAr: "شاحنة", assetAccountId: acc["120101"], acquisitionDate: `${YEAR}-07-10`, cost: 120000, usefulLifeMonths: 60 })).rejects.toThrow("مركبة");
      await expect(createAsset(db, { nameAr: "x", assetAccountId: acc["5110"], acquisitionDate: `${YEAR}-07-10`, cost: 1, usefulLifeMonths: 6 })).rejects.toThrow("حساب أصل");
      const truck = await createAsset(db, { nameAr: "شاحنة أكتروس", assetAccountId: acc["120101"], vehicleId: vehicle.id, acquisitionDate: `${YEAR}-07-10`, cost: 120000, usefulLifeMonths: 60, offsetAccountId: acc["3104"] });
      expect(truck.costCenterId).toBe(vehicleCc);
      expect(truck.depreciationStart).toBe(`${YEAR}-07-01`);
      const [acq] = await db.select().from(s.journalEntries).where(eq(s.journalEntries.id, (await db.select().from(s.fixedAssets).where(eq(s.fixedAssets.id, truck.id)))[0].acquisitionEntryId!));
      expect(acq.status).toBe("posted");

      const first = await runDepreciation(db, `${YEAR}-08-15`);
      expect(first.map((x) => [x.periodEnd, x.amount])).toEqual([[`${YEAR}-07-31`, 2000], [`${YEAR}-08-31`, 2000]]);
      expect(await runDepreciation(db, `${YEAR}-08-31`)).toEqual([]);

      // أصل إداري أُضيف لاحقاً بتاريخ أغسطس: يُعاد بناء قيد أغسطس شاملاً الأصلين
      const laptop = await createAsset(db, { nameAr: "أجهزة حاسب", assetAccountId: acc["120105"], acquisitionDate: `${YEAR}-08-03`, cost: 12000, usefulLifeMonths: 12 });
      const second = await runDepreciation(db, `${YEAR}-09-30`);
      expect(second.map((x) => [x.periodEnd, x.amount])).toEqual([[`${YEAR}-08-31`, 3000], [`${YEAR}-09-30`, 3000]]);
      const aug = await db.select().from(s.assetDepreciation).where(eq(s.assetDepreciation.periodEnd, `${YEAR}-08-31`));
      expect(new Set(aug.map((d) => d.entryId)).size).toBe(1);
      const augLines = await linesOf(aug[0].entryId);
      expect(augLines.find((l) => l.accountId === acc["5110"])!.costCenterId).toBe(vehicleCc);
      expect(Number(augLines.find((l) => l.accountId === acc["6110"])!.debit)).toBe(1000);
      expect(Number(augLines.find((l) => l.accountId === acc["120201"])!.credit)).toBe(2000);

      let reg = await listAssets(db);
      expect(reg.find((r) => r.a.id === truck.id)).toMatchObject({ accumulated: 6000, book: 114000, monthly: 2000 });
      await expect(deleteAsset(db, laptop.id, { reason: "خطأ" })).rejects.toThrow("إهلاك");

      expect(await undoLastDepreciation(db)).toBe(`${YEAR}-09-30`);
      reg = await listAssets(db);
      expect(reg.find((r) => r.a.id === truck.id)!.accumulated).toBe(4000);

      await expect(disposeAsset(db, truck.id, { date: `${YEAR}-07-31`, proceeds: 0 })).rejects.toThrow("بعد تاريخ");
      const d = await disposeAsset(db, truck.id, { date: `${YEAR}-09-15`, proceeds: 120000, proceedsAccountId: acc["110101"] });
      expect([d.book, d.result]).toEqual([116000, 4000]);
      const dl = await linesOf(d.entry.id);
      expect(Number(dl.find((l) => l.accountId === acc["120101"])!.credit)).toBe(120000);
      expect(Number(dl.find((l) => l.accountId === acc["120201"])!.debit)).toBe(4000);
      expect(Number(dl.find((l) => l.accountId === acc["4202"])!.credit)).toBe(4000);
      // المستبعد لا يُهلك بعد شهر استبعاده
      const again = await runDepreciation(db, `${YEAR}-10-31`);
      const sep = await db.select().from(s.assetDepreciation).where(eq(s.assetDepreciation.periodEnd, `${YEAR}-10-31`));
      expect(sep.map((x) => x.assetId)).toEqual([laptop.id]);
      expect(again.at(-1)!.amount).toBe(1000);
    });

    it("استيراد القيود والمخالفات من Excel", async () => {
      const row = (o: Record<string, string>, i: number) => ({ row: i + 5, values: { reference: "IMP-1", entryDate: `${YEAR}-07-20`, description: "قيد مستورد", ...o } });
      const rows = [row({ account: "110101", debit: "300" }, 0), row({ account: "3104", credit: "300" }, 1), row({ reference: "IMP-2", account: "110101", debit: "10" }, 2), row({ reference: "IMP-2", account: "3104", credit: "9" }, 3)];
      const report = await runImport(db, IMPORT_SPECS["journal-entries"], rows, { dryRun: false, post: true });
      expect(report.ok).toBe(1);
      expect(report.issues).toHaveLength(1);
      const [imp] = await db.select().from(s.journalEntries).where(eq(s.journalEntries.reference, "IMP-1"));
      expect(imp.status).toBe("posted");
      const dup = await runImport(db, IMPORT_SPECS["journal-entries"], rows.slice(0, 2), { dryRun: false });
      expect(dup.ok).toBe(0);

      const [vehicle] = await db.select().from(s.vehicles).where(eq(s.vehicles.costCenterId, vehicleCc));
      const vr = (o: Record<string, string>, i: number) => ({ row: i + 5, values: { violationDate: `${YEAR}-07-21`, vehicle: vehicle.plate, violationType: "تجاوز سرعة", amount: "300", chargeTo: "الشركة", ...o } });
      const vrep = await runImport(db, IMPORT_SPECS.violations, [vr({ reference: "TV-IMP-1" }, 0), vr({ vehicle: "لا توجد" }, 1), vr({ chargeTo: "؟" }, 2)], { dryRun: false });
      expect(vrep.ok).toBe(1);
      expect(vrep.issues).toHaveLength(2);
      const [tv] = await db.select().from(s.trafficViolations).where(eq(s.trafficViolations.reference, "TV-IMP-1"));
      expect(Number(tv.amount)).toBe(300);
    });
  });
  describe("المخزون وقطع الغيار", () => {
    let wh1: number;
    let wh2: number;
    let oil: number;
    let sup: number;
    const linesOf = (entryId: number) => db.select().from(s.journalLines).where(eq(s.journalLines.entryId, entryId));
    const buy = async (no: string, quantity: number, amount: number, post = true) => {
      const pi = await createPurchaseInvoice(db, { supplierId: sup, supplierInvoiceNo: no, invoiceDate: `${YEAR}-08-01`, lines: [{ productId: oil, warehouseId: wh1, quantity, description: "", amount, vatRate: 15 }] });
      if (post) await postPurchaseInvoice(db, pi.id);
      return pi;
    };

    it("الأصناف: المخزني على حساب المخزون والخدمة على مصروفها، والرمز لا يتكرر", async () => {
      [wh1] = (await db.select().from(s.warehouses)).map((w) => w.id);
      wh2 = (await createWarehouse(db, { nameAr: "مستودع الورشة" })).id;
      const p = await createProduct(db, { code: "OIL-1", nameAr: "زيت محرك", kind: "stock", unit: "جالون", purchasePrice: 90, reorderLevel: 5 });
      oil = p.id;
      expect(p.accountId).toBe(acc["1110"]);
      const svc = await createProduct(db, { nameAr: "شغل يد", kind: "service" });
      expect([svc.code, svc.accountId]).toEqual(["S-0002", acc["5107"]]);
      await expect(createProduct(db, { code: "OIL-1", nameAr: "مكرر", kind: "stock" })).rejects.toThrow("مستخدم");
      await expect(createProduct(db, { nameAr: "خطأ", kind: "stock", accountId: acc["5107"] })).rejects.toThrow("مخزون");
      sup = (await createParty(db, { nameAr: "مورد قطع الغيار", roles: ["supplier"] })).id;
    });

    it("فاتورة المورد بصنف مخزني تُدخل الكمية بتكلفتها ومتوسط مرجح، والإرجاع يُخرجها", async () => {
      await expect(createPurchaseInvoice(db, { supplierId: sup, supplierInvoiceNo: "X", invoiceDate: `${YEAR}-08-01`, lines: [{ productId: oil, description: "", amount: 10 }] })).rejects.toThrow("المستودع والكمية");
      const a = await buy("ST-1", 10, 1000);
      const [pa] = await db.select().from(s.purchaseInvoices).where(eq(s.purchaseInvoices.id, a.id));
      const jl = await linesOf(pa.journalEntryId!);
      expect(Number(jl.find((l) => l.accountId === acc["1110"])!.debit)).toBe(1000);
      await buy("ST-2", 10, 1200);
      expect(await onHand(db, oil, wh1)).toBe(20);
      expect(await averageCost(db, oil)).toBe(110);
      const draft = await buy("ST-3", 5, 500, false);
      expect(await onHand(db, oil, wh1)).toBe(20);
      await postPurchaseInvoice(db, draft.id);
      await revertPurchaseInvoice(db, draft.id);
      expect(await onHand(db, oil, wh1)).toBe(20);
    });

    it("أمر الصيانة يصرف القطعة من المستودع بمتوسط التكلفة على مركز المركبة ولا يمس ذمة الورشة", async () => {
      const [vehicle] = await db.select().from(s.vehicles).where(eq(s.vehicles.costCenterId, vehicleCc));
      const o = await createMaintenanceOrder(db, { vehicleId: vehicle.id, orderDate: `${YEAR}-08-05`, type: "mechanical", provider: "internal" });
      await expect(addMaintenanceLines(db, o.id, [{ kind: "part", productId: oil, warehouseId: wh1, description: "", quantity: 50, unitPrice: 0 }])).rejects.toThrow("رصيد");
      await addMaintenanceLines(db, o.id, [{ kind: "part", productId: oil, warehouseId: wh1, description: "", quantity: 5, unitPrice: 0 }]);
      const e = await approveMaintenanceOrder(db, o.id);
      const jl = await linesOf(e.id);
      expect(jl).toHaveLength(2);
      expect(jl.find((l) => l.accountId === acc["5107"])).toMatchObject({ debit: "550.000", costCenterId: vehicleCc });
      expect(Number(jl.find((l) => l.accountId === acc["1110"])!.credit)).toBe(550);
      expect(await onHand(db, oil, wh1)).toBe(15);
      const [mo] = await db.select().from(s.maintenanceOrders).where(eq(s.maintenanceOrders.id, o.id));
      expect(Number(mo.total)).toBe(550);
      // لا يُرجع الاستلام بعد الصرف منه إن نقص الرصيد
      const [st2] = await db.select().from(s.purchaseInvoices).where(eq(s.purchaseInvoices.supplierInvoiceNo, "ST-2"));
      await createStockDoc(db, { kind: "transfer", docDate: `${YEAR}-08-06`, warehouseId: wh1, toWarehouseId: wh2, lines: [{ productId: oil, quantity: 8 }], post: true });
      await expect(revertPurchaseInvoice(db, st2.id)).rejects.toThrow("أرجع الصرف");
      expect([await onHand(db, oil, wh1), await onHand(db, oil, wh2)]).toEqual([7, 8]);
      await revertMaintenanceOrder(db, o.id);
      expect(await onHand(db, oil, wh1)).toBe(12);
    });

    it("التسوية بالنقص والجرد يرحّلان الفروقات مقابل المصروف، والإرجاع يعكسها", async () => {
      await expect(createStockDoc(db, { kind: "adjustment", docDate: `${YEAR}-08-10`, warehouseId: wh1, lines: [{ productId: oil, quantity: -2 }] })).rejects.toThrow("سبب");
      const adj = await createStockDoc(db, { kind: "adjustment", docDate: `${YEAR}-08-10`, warehouseId: wh1, reason: "تالف", lines: [{ productId: oil, quantity: -2 }], post: true });
      const d1 = (await stockDoc(db, adj.id))!;
      const jl = await linesOf(d1.d.journalEntryId!);
      expect(Number(jl.find((l) => l.accountId === acc["6113"])!.debit)).toBe(220);
      expect(await onHand(db, oil, wh1)).toBe(10);
      const cnt = await createStockDoc(db, { kind: "count", docDate: `${YEAR}-08-31`, warehouseId: wh1, lines: [] });
      const doc = (await stockDoc(db, cnt.id))!;
      const line = doc.lines.find((l) => l.l.productId === oil)!;
      expect(Number(line.l.systemQty)).toBe(10);
      await saveCount(db, cnt.id, { [line.l.id]: 11 });
      await postStockDoc(db, cnt.id);
      expect(await onHand(db, oil, wh1)).toBe(11);
      const after = (await stockDoc(db, cnt.id))!;
      expect(Number(after.lines.find((l) => l.l.productId === oil)!.l.quantity)).toBe(1);
      expect(Number((await linesOf(after.d.journalEntryId!)).find((l) => l.accountId === acc["1110"])!.debit)).toBe(110);
      await revertStockDoc(db, cnt.id);
      expect(await onHand(db, oil, wh1)).toBe(10);
      const [row] = (await listProducts(db, { q: "OIL-1" })).filter((r) => r.p.id === oil);
      expect(row).toMatchObject({ qty: 18, avgCost: 110 });
      expect((await productCard(db, oil, wh1)).at(-1)!.balance).toBe(10);
    });

    it("استيراد الأصناف برصيد افتتاحي مقابل الأرباح المبقاة", async () => {
      const rows = [
        { row: 5, values: { code: "TYR-1", nameAr: "إطار 315/80", kind: "مخزني", unit: "حبة", purchasePrice: "900", openingQty: "4" } },
        { row: 6, values: { nameAr: "غسيل", kind: "خدمة" } },
        { row: 7, values: { code: "TYR-1", nameAr: "مكرر" } },
      ];
      const report = await runImport(db, IMPORT_SPECS.products, rows as { row: number; values: Record<string, string> }[], { dryRun: false });
      expect(report.ok).toBe(2);
      expect(report.issues).toHaveLength(1);
      const [tyre] = await db.select().from(s.products).where(eq(s.products.code, "TYR-1"));
      expect(await onHand(db, tyre.id, wh1)).toBe(4);
      expect(await averageCost(db, tyre.id)).toBe(900);
    });
  });

  it("التدفق النقدي في اللوحة: يصنّف بالحساب المقابل ويتجاهل التحويل بين الصناديق", async () => {
    const day = `${YEAR}-06-30`;
    const find = (r: Awaited<ReturnType<typeof cashFlow>>, key: string) => r.sections.flatMap((x) => x.items).find((l) => l.key === key);
    const before = await cashFlow(db, day, day);
    const entry = (description: string, lines: { accountId: number; debit?: number; credit?: number }[]) => createJournalEntry(db, { entryDate: day, description, post: true, lines });
    await entry("إيداع الشريك", [
      { accountId: acc["110101"], debit: 1000 },
      { accountId: acc["3104"], credit: 1000 },
    ]);
    await entry("مصروف نثري", [
      { accountId: acc["6113"], debit: 200 },
      { accountId: acc["110101"], credit: 200 },
    ]);
    await entry("تحويل بين الصناديق", [
      { accountId: acc["110102"], debit: 300 },
      { accountId: acc["110101"], credit: 300 },
    ]);
    const after = await cashFlow(db, day, day);
    expect(after.opening).toBe(before.opening);
    expect(after.closing - before.closing).toBe(800);
    expect(after.inflow - before.inflow).toBe(1000);
    expect(after.outflow - before.outflow).toBe(200);
    expect((find(after, "owners")?.in ?? 0) - (find(before, "owners")?.in ?? 0)).toBe(1000);
    expect(after.sections.find((x) => x.key === "financing")?.items.map((l) => l.key)).toContain("owners");
    expect((find(after, "expenses")?.out ?? 0) - (find(before, "expenses")?.out ?? 0)).toBe(200);
    const office = after.accounts.find((a) => a.code === "110102")!;
    expect(office.in - (before.accounts.find((a) => a.code === "110102")?.in ?? 0)).toBe(300);
  });

  it("الصيانة بآلية الفواتير: بحث وفلترة، تعديل المسودة، أوامر من الخطط والبلاغات، واستيراد الأوامر ببنودها", async () => {
    const v = await createVehicle(db, { plate: "ص ي ن 4321", chassis: "CH-MNT" });
    const ws = await createParty(db, { nameAr: "ورشة المنطقة الصناعية", roles: ["workshop"] });
    const day = `${YEAR}-07-15`;

    const plan = await savePlan(db, { vehicleId: v.id, type: "consumable", title: "زيت وفلاتر", intervalDays: 45 });
    const [fromPlan] = await createOrdersFrom(db, { plans: [plan.id] }, { orderDate: day });
    await expect(createOrdersFrom(db, { plans: [plan.id] }, { orderDate: day })).rejects.toThrow("أمر مفتوح");
    const req = await createBreakdownRequest(db, { vehicleId: v.id, reportDate: day, description: "صوت في القير", estimatedCost: 900 });
    await reviewBreakdownRequest(db, req.id, { limit: 5000 });
    const [fromReq] = await createOrdersFrom(db, { requests: [req.id] }, { orderDate: day });
    expect((await requestDoc(db, req.id))?.order?.number).toBe(fromReq);
    expect((await listRequests(db, { q: "القير" })).map((x) => x.r.id)).toEqual([req.id]);

    const mine = await listOrders(db, { vehicleId: v.id });
    expect(mine.map((x) => x.o.number).sort()).toEqual([fromPlan, fromReq].sort());
    expect(mine.every((x) => x.o.status === "draft" && x.lines === 0)).toBe(true);
    const planOrder = mine.find((x) => x.o.number === fromPlan)!.o;
    expect(planOrder).toMatchObject({ type: "consumable", planId: plan.id, provider: "internal" });

    await updateDraftOrder(db, planOrder.id, { odometer: "120500", notes: " بعد الرحلة " });
    expect((await orderDoc(db, planOrder.id))?.o).toMatchObject({ odometer: 120500, notes: "بعد الرحلة" });
    await expect(updateDraftOrder(db, planOrder.id, { odometer: "-3" })).rejects.toThrow("العداد");

    const spec = IMPORT_SPECS["maintenance-orders"];
    const rows = [
      { ref: "A", orderDate: "16/07/" + YEAR, vehicle: "ص ي ن 4321", type: "ميكانيكا", workshop: "ورشة المنطقة الصناعية", supplierInvoiceNo: "IND-55", lineKind: "قطعة غيار", description: "كلتش", quantity: "1", unitPrice: "1500", vat: "15%" },
      { ref: "A", orderDate: "16/07/" + YEAR, vehicle: "ص ي ن 4321", type: "ميكانيكا", workshop: "ورشة المنطقة الصناعية", supplierInvoiceNo: "IND-55", lineKind: "شغل يد", description: "تركيب", unitPrice: "300", vat: "بدون" },
      { ref: "B", orderDate: `${YEAR}-07-16`, vehicle: "غير موجودة", description: "x", unitPrice: "1" },
      { ref: "C", orderDate: `${YEAR}-07-16`, vehicle: "ص ي ن 4321", workshop: "ورشة لا وجود لها", description: "x", unitPrice: "1" },
    ].map((values, i) => ({ row: i + 5, values: values as Record<string, string> }));
    const dry = await runImport(db, spec, rows, { dryRun: true });
    expect(dry).toMatchObject({ total: 3, ok: 1 });
    expect(dry.issues.map((x) => x.rows)).toEqual([[7], [8]]);
    expect((await listOrders(db, { vehicleId: v.id })).length).toBe(2);
    const real = await runImport(db, spec, rows.slice(0, 2), { dryRun: false });
    expect(real.ok).toBe(1);
    const [imported] = await listOrders(db, { q: "IND-55" });
    expect(imported).toMatchObject({ supplier: "ورشة المنطقة الصناعية", lines: 2 });
    expect([Number(imported.o.subtotal), Number(imported.o.vatTotal), Number(imported.o.total)]).toEqual([1800, 225, 2025]);
    expect(imported.o.supplierId).toBe(ws.id);
    expect((await listOrders(db, { vehicleId: v.id, sort: "amount_desc" }))[0].o.id).toBe(imported.o.id);

    const reqImport = await runImport(db, IMPORT_SPECS["breakdown-requests"], [{ row: 5, values: { reportDate: day, vehicle: "ص ي ن 4321", description: "إضاءة خلفية", priority: "عاجلة" } }], { dryRun: false });
    expect(reqImport.ok).toBe(1);
    expect((await listRequests(db, { vehicleId: v.id, priority: "urgent" })).length).toBe(1);
    const planImport = await runImport(db, IMPORT_SPECS["maintenance-plans"], [{ row: 5, values: { vehicle: "ص ي ن 4321", title: "فحص إطارات", type: "إطارات", intervalDays: "30" } }], { dryRun: false });
    expect(planImport.ok).toBe(1);
    expect((await planSchedule(db, day)).find((p) => p.vehicleId === v.id && p.title === "فحص إطارات")?.type).toBe("tires");
  });

  it("الموارد البشرية: العهد بقيودها، والجزاءات والحوافز والإجازات والغياب في المسير، والتقييم والترقية، ومقدم العمولة بسقفه", async () => {
    const jl = async (entryId: number) =>
      (await db.select({ l: s.journalLines, code: s.accounts.code }).from(s.journalLines).innerJoin(s.accounts, eq(s.accounts.id, s.journalLines.accountId)).where(eq(s.journalLines.entryId, entryId))).map(({ l, code }) => ({ code, account: l.accountId, debit: Number(l.debitBase), credit: Number(l.creditBase) }));
    const emp = await createEmployee(db, { nameAr: "موظفة الموارد", hireDate: `${YEAR}-01-01`, basicSalary: 6000 });

    // العهدة النقدية: تسليم بقيد، ثم تسوية بإعادة ومصروف؛ والافتتاحية بلا قيد
    const cash = await hr.createCustody(db, { kind: "cash", employeeId: emp.id, docDate: `${YEAR}-11-02`, description: "مصاريف المكتب", amount: 1000 });
    await expect(hr.deliverCustody(db, cash.id, { cashAccountId: acc["110101"] })).rejects.toThrow("اعتمد");
    await hr.approveCustody(db, cash.id);
    await expect(hr.deliverCustody(db, cash.id, {})).rejects.toThrow("الصندوق");
    await hr.deliverCustody(db, cash.id, { cashAccountId: acc["110101"] });
    let doc = (await hr.custodyDoc(db, cash.id))!;
    const [withAcc] = await db.select().from(s.employees).where(eq(s.employees.id, emp.id));
    expect(withAcc.custodyAccountId).toBeTruthy();
    expect(await jl(doc.c.journalEntryId!)).toEqual(
      expect.arrayContaining([expect.objectContaining({ account: withAcc.custodyAccountId, debit: 1000 }), expect.objectContaining({ code: "110101", credit: 1000 })]),
    );
    await expect(updateEmployee(db, emp.id, { status: "terminated" })).rejects.toThrow("عهدة");
    await expect(hr.closeCustody(db, cash.id, { outcome: "settled", date: `${YEAR}-11-20`, returnedAmount: 800, spentAmount: 300, expenseAccountId: acc["6105"] })).rejects.toThrow("أكبر");
    await hr.closeCustody(db, cash.id, { outcome: "settled", date: `${YEAR}-11-20`, returnedAmount: 200, cashAccountId: acc["110101"], spentAmount: 300, expenseAccountId: acc["6105"] });
    doc = (await hr.custodyDoc(db, cash.id))!;
    expect(doc.c.status).toBe("settled");
    expect(await jl(doc.c.closeEntryId!)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "110101", debit: 200 }),
        expect.objectContaining({ code: "6105", debit: 300 }),
        expect.objectContaining({ account: withAcc.custodyAccountId, credit: 500 }),
      ]),
    );
    expect(await hr.revertCustody(db, cash.id)).toBe("delivered");
    expect(await db.select().from(s.journalEntries).where(eq(s.journalEntries.id, doc.c.closeEntryId!))).toHaveLength(0);
    await hr.closeCustody(db, cash.id, { outcome: "returned", date: `${YEAR}-11-21`, cashAccountId: acc["110101"] });
    const phone = await hr.createCustody(db, { kind: "in_kind", employeeId: emp.id, docDate: `${YEAR}-01-01`, description: "جوال", amount: 2500, serialNo: "IMEI-1", isOpening: true });
    expect(phone).toMatchObject({ status: "delivered", journalEntryId: null });
    expect((await hr.openCustodyByEmployee(db)).find((x) => x.employeeId === emp.id)).toMatchObject({ n: 1 });

    // الجزاء والحافز والإنذار، والإجازة بدون راتب والغياب، في مسير نوفمبر
    const penalty = await hr.createHrAction(db, { kind: "penalty", employeeId: emp.id, actionDate: `${YEAR}-11-05`, amount: 300, reason: "تأخر متكرر" });
    const incentive = await hr.createHrAction(db, { kind: "incentive", employeeId: emp.id, actionDate: `${YEAR}-11-06`, amount: 500, reason: "إنجاز الإقفال" });
    const warning = await hr.createHrAction(db, { kind: "warning", employeeId: emp.id, actionDate: `${YEAR}-11-07`, reason: "إنذار أول" });
    expect(warning.points).toBe(2);
    await expect(hr.createHrAction(db, { kind: "penalty", employeeId: emp.id, actionDate: `${YEAR}-11-05`, reason: "بلا مبلغ" })).rejects.toThrow("مبلغ");
    for (const a of [penalty, incentive, warning]) await hr.approveHrAction(db, a.id);

    const [annual] = await db.select().from(s.leaveTypes).where(eq(s.leaveTypes.isAnnual, true));
    const [unpaid] = await db.select().from(s.leaveTypes).where(eq(s.leaveTypes.paid, false));
    const long = await hr.createLeave(db, { employeeId: emp.id, typeId: annual.id, fromDate: `${YEAR}-03-01`, toDate: `${YEAR}-03-25` });
    await expect(hr.approveLeave(db, long.id)).rejects.toThrow("الرصيد");
    await hr.cancelLeave(db, long.id);
    const lv = await hr.createLeave(db, { employeeId: emp.id, typeId: unpaid.id, fromDate: `${YEAR}-11-29`, toDate: `${YEAR}-12-02` });
    await expect(hr.createLeave(db, { employeeId: emp.id, typeId: annual.id, fromDate: `${YEAR}-12-01`, toDate: `${YEAR}-12-01` })).rejects.toThrow("تتداخل");
    await hr.approveLeave(db, lv.id);
    await hr.saveAttendance(db, `${YEAR}-11-10`, [{ employeeId: emp.id, status: "absent" }]);
    await hr.saveAttendance(db, `${YEAR}-11-11`, [{ employeeId: emp.id, status: "late", lateMinutes: 25 }]);
    expect((await hr.attendanceMonth(db, `${YEAR}-11`)).find((x) => x.id === emp.id)).toMatchObject({ absent: 1, late: 1, lateMinutes: 25 });
    const bal = await hr.leaveBalances(db, YEAR);
    expect(bal.rows.find((r) => r.id === emp.id)!.balances.find((b) => b.typeId === annual.id)).toMatchObject({ quota: 21, used: 0, left: 21 });

    const run = await createPayrollRun(db, { month: `${YEAR}-11` });
    const [line] = await db.select().from(s.payrollLines).where(sql`${s.payrollLines.runId} = ${run.id} and ${s.payrollLines.employeeId} = ${emp.id}`);
    expect([Number(line.incentives), Number(line.penalties), Number(line.leaveDays), Number(line.absenceDeduction)]).toEqual([500, 300, 3, 600]);
    expect(Number(line.net)).toBe(6000 + 500 - 600 - 300);
    const drv = await createDriver(db, { nameAr: "سائق المقدم" });
    const [drvEmp] = await db.select().from(s.drivers).where(eq(s.drivers.id, drv.id));
    await expect(hr.saveAttendance(db, `${YEAR}-11-12`, [{ employeeId: drvEmp.employeeId, status: "present" }])).rejects.toThrow("الإداريين");
    const entry = await approvePayrollRun(db, run.id);
    const pl = await jl(entry.id);
    expect(pl.find((l) => l.code === "2116")).toMatchObject({ credit: 300 });
    await expect(hr.cancelHrAction(db, penalty.id)).rejects.toThrow("المعتمد");
    await expect(hr.saveAttendance(db, `${YEAR}-11-12`, [{ employeeId: emp.id, status: "present" }])).rejects.toThrow("معتمد");
    await expect(hr.cancelLeave(db, lv.id)).rejects.toThrow("المسير");

    // التقييم: 8 من 10 في كل المعايير = 80، ناقص نقطتي الإنذار
    const criteria = await hr.listCriteria(db, true);
    const ev = await hr.saveEvaluation(db, { employeeId: emp.id, month: `${YEAR}-11`, scores: Object.fromEntries(criteria.map((c) => [String(c.id), 8])) });
    expect([Number(ev.baseScore), Number(ev.deduction), Number(ev.finalScore), ev.warnings]).toEqual([80, 2, 78, 1]);
    await hr.approveEvaluation(db, ev.id);
    await expect(hr.saveEvaluation(db, { employeeId: emp.id, month: `${YEAR}-11`, scores: {} })).rejects.toThrow("معتمد");
    const settings = await hr.getHrSettings(db);
    await hr.saveHrSettings(db, { ...settings, advanceCapDomestic: 1000, advanceCapInternational: 2000, promotionScore: 75, promotionMonths: 1, advanceOpenDay: 1, advanceCloseDay: 20 });
    expect((await hr.promotionCandidates(db)).map((c) => c.employeeId)).toContain(emp.id);
    await hr.promoteEmployee(db, { employeeId: emp.id, effectiveDate: `${YEAR}-12-01`, toTitle: "رئيسة قسم", toBasic: 7000 });
    expect((await db.select().from(s.employees).where(eq(s.employees.id, emp.id)))[0]).toMatchObject({ jobTitle: "رئيسة قسم", basicSalary: "7000.000" });
    expect((await hr.promotionCandidates(db)).map((c) => c.employeeId)).not.toContain(emp.id);

    // مقدم العمولة: داخل النافذة وبالسقف، والاعتماد ينشئ سلفة مصروفة تُستقطع كاملة
    await expect(hr.requestCommissionAdvance(db, { driverId: drv.id, amount: 100, today: `${YEAR}-11-25` })).rejects.toThrow("مفتوحة");
    const req = await hr.requestCommissionAdvance(db, { driverId: drv.id, amount: 600, today: `${YEAR}-11-10` });
    await expect(hr.requestCommissionAdvance(db, { driverId: drv.id, amount: 500, today: `${YEAR}-11-11` })).rejects.toThrow("المتاح");
    expect(await hr.advanceWindow(db, drv.id, `${YEAR}-11-12`)).toMatchObject({ open: true, cap: 1000, used: 600, remaining: 400 });
    const adv = await hr.approveAdvanceRequest(db, req.id, { cashAccountId: acc["110101"] });
    const [paid] = await db.select().from(s.employeeAdvances).where(eq(s.employeeAdvances.id, adv.id));
    expect(paid).toMatchObject({ status: "paid", amount: "600.000", installment: "600.000" });
    expect((await hr.listAdvanceRequests(db, { status: "approved" })).find((x) => x.r.id === req.id)?.advance).toBe(paid.number);

    // السائق في إجازة معتمدة لا يُسند لرحلة
    const dl = await hr.createLeave(db, { employeeId: drvEmp.employeeId, typeId: annual.id, fromDate: `${YEAR}-12-10`, toDate: `${YEAR}-12-14` });
    await hr.approveLeave(db, dl.id);
    expect(await hr.driverLeaveOn(db, drv.id, `${YEAR}-12-12`)).toMatchObject({ number: dl.number });
    expect(await hr.driverLeaveOn(db, drv.id, `${YEAR}-12-15`)).toBeNull();
    const dash = await hr.hrDashboard(db, `${YEAR}-12-12`);
    expect(dash.onLeave.map((x) => x.name)).toContain("سائق المقدم");
  });

  it("التسوية البنكية: تأشير الحركات حتى يصبح الفرق صفراً، والرسوم تُرحّل وتُطابق، والمعلق ينتقل للتسوية التالية", async () => {
    const bank = await createCashAccount(db, { kind: "bank", nameAr: "الراجحي – تسوية", bankName: "مصرف الراجحي", openingBalance: 10000, openingDate: `${YEAR}-11-01` });
    const move = (date: string, amount: number) =>
      createJournalEntry(db, {
        entryDate: date,
        description: amount > 0 ? "إيداع" : "شيك",
        post: true,
        lines: [
          { accountId: bank.id, ...(amount > 0 ? { debit: amount } : { credit: -amount }) },
          { accountId: acc["110101"], ...(amount > 0 ? { credit: amount } : { debit: -amount }) },
        ],
      });
    await move(`${YEAR}-11-10`, 3000);
    await move(`${YEAR}-11-20`, -1200);
    await move(`${YEAR}-11-28`, -500); // شيك لم يُصرف بعد
    await move(`${YEAR}-12-05`, 700); // بعد تاريخ الكشف
    const r = await rec.createReconciliation(db, { accountId: bank.id, statementDate: `${YEAR}-11-30`, statementBalance: 11775 });
    await expect(rec.createReconciliation(db, { accountId: bank.id, statementDate: `${YEAR}-11-30`, statementBalance: 1 })).rejects.toThrow("مسودة");
    let v = (await rec.reconciliationView(db, r.id))!;
    expect(v.items.length).toBe(4); // الافتتاحي + 3 حركات حتى 30 نوفمبر
    expect(v.book).toBe(11300);
    const ids = v.items.filter((i) => i.description !== "شيك" || i.credit === 1200).map((i) => i.id);
    await rec.saveCleared(db, r.id, ids);
    v = (await rec.reconciliationView(db, r.id))!;
    let t = rec.reconciliationTotals(v);
    expect([t.cleared, t.difference, t.outstandingOut]).toEqual([11800, -25, 500]);
    await expect(rec.completeReconciliation(db, r.id)).rejects.toThrow("الفرق");
    await rec.addBankAdjustment(db, r.id, { kind: "fee", amount: 25 });
    v = (await rec.reconciliationView(db, r.id))!;
    t = rec.reconciliationTotals(v);
    expect(t.difference).toBe(0);
    await rec.completeReconciliation(db, r.id);
    // التسوية التالية: المطابق سابقاً رصيد ثابت، والشيك المعلق والإيداع الجديد للتأشير
    const r2 = await rec.createReconciliation(db, { accountId: bank.id, statementDate: `${YEAR}-12-31`, statementBalance: 11975 });
    v = (await rec.reconciliationView(db, r2.id))!;
    expect(v.priorCleared).toBe(11775);
    expect(v.items.map((i) => i.credit || i.debit).sort((a, b) => a - b)).toEqual([500, 700]);
    await rec.saveCleared(db, r2.id, v.items.map((i) => i.id));
    await rec.completeReconciliation(db, r2.id);
    await expect(rec.reopenReconciliation(db, r.id)).rejects.toThrow("لاحقة");
    await rec.reopenReconciliation(db, r2.id);
    await rec.deleteReconciliation(db, r2.id);
    await rec.reopenReconciliation(db, r.id);
  });

  it("الإيراد المستحق غير المفوتر: قيد آخر الشهر على 1112 والإيراد بالمركبة، وعكسه أول الشهر التالي", async () => {
    const Y = YEAR - 1;
    await openYear(db, Y);
    const [w] = (await db.execute(sql`
      insert into waybills (number, waybill_date, customer_id, route_id, shipper, consignee, delivery_address, is_international, currency_code, execution, vehicle_id, driver_id, carrier_id, amount, tax_code_id, status)
      select 'WB-ACR-1', ${`${Y}-06-20`}, customer_id, route_id, 'شاحن', 'مستلم', 'الرياض', false, 'SAR', execution, vehicle_id, driver_id, carrier_id, 4000, tax_code_id, 'approved'
      from waybills where vehicle_id is not null limit 1 returning id`)) as unknown as { id: number }[];
    const p = await accrualPreview(db, `${Y}-06`);
    expect([p.count, p.total]).toEqual([1, 4000]);
    const { entry, reversal } = await postRevenueAccrual(db, `${Y}-06`);
    await expect(postRevenueAccrual(db, `${Y}-06`)).rejects.toThrow("رُحّل");
    const lines = await db
      .select({ code: s.accounts.code, d: s.journalLines.debitBase, c: s.journalLines.creditBase, cc: s.journalLines.costCenterId, entryId: s.journalLines.entryId })
      .from(s.journalLines)
      .innerJoin(s.accounts, eq(s.accounts.id, s.journalLines.accountId))
      .where(sql`${s.journalLines.entryId} in (${entry.id}, ${reversal.id})`);
    const rev = lines.find((l) => l.entryId === entry.id && l.code === "4101")!;
    expect([Number(rev.c), rev.cc]).toEqual([4000, expect.any(Number)]);
    expect(Number(lines.find((l) => l.entryId === entry.id && l.code === "1112")!.d)).toBe(4000);
    expect(Number(lines.find((l) => l.entryId === reversal.id && l.code === "1112")!.c)).toBe(4000);
    const [rv] = await db.select().from(s.journalEntries).where(eq(s.journalEntries.id, reversal.id));
    expect(rv.entryDate).toBe(`${Y}-07-01`);
    await undoRevenueAccrual(db, `${Y}-06`);
    expect((await db.select().from(s.journalEntries).where(sql`${s.journalEntries.id} in (${entry.id}, ${reversal.id})`)).length).toBe(0);
    await db.execute(sql`delete from waybills where id = ${w.id}`);
  });

  it("المنصة: كل شركة ببيانات منفصلة، والتجربة تتوقف وحدها، والتفعيل يبقي البيانات، والبدء من جديد يمسحها", async () => {
    const tdb = drizzle(tenantClient(client), { schema: s }) as unknown as Db;
    await platform.ensurePlatform(client);
    await platform.ensurePlatform(client); // التكرار آمن
    // قفل الدخول: 10 محاولات خاطئة في 15 دقيقة توقف الاسم مؤقتاً، بلا فرق بين الحروف، والدخول الناجح يمسح العدّاد
    for (let i = 0; i < platform.LOGIN_MAX_FAILURES - 1; i++) await platform.recordLoginFailure(client, "Guess_Me");
    expect(await platform.loginThrottled(client, "guess_me")).toBe(false);
    await platform.recordLoginFailure(client, "guess_me");
    expect(await platform.loginThrottled(client, "GUESS_ME")).toBe(true);
    expect(await platform.loginThrottled(client, "someone_else")).toBe(false);
    await platform.clearLoginFailures(client, "guess_me");
    expect(await platform.loginThrottled(client, "guess_me")).toBe(false);
    expect(await platform.schemaForCompany(client, "HOME")).toBe("public");
    expect(await platform.schemaForCompany(client, "nope")).toBeNull();
    // نسيت كلمة المرور: الطلب يصل لشركة الرمز، والرمز المجهول لمالك المنصة، و3 طلبات في الساعة كحد
    await platform.createAccessRequest(client, { company: "home", login: "ADMIN", name: "مدير", contact: "0511111111" });
    await platform.createAccessRequest(client, { company: "unknown", name: "نسي اسمه", contact: "0522222222" });
    for (let i = 0; i < 4; i++) await platform.createAccessRequest(client, { company: "home", login: "admin", name: "مكرر", contact: "0533333333" });
    const home = await platform.openAccessRequests(client, "public");
    expect(home.filter((r) => r.login === "admin")).toHaveLength(3);
    const orphan = await platform.openAccessRequests(client, null);
    expect(orphan.map((r) => r.name)).toContain("نسي اسمه");
    for (const r of [...home, ...orphan]) await platform.resolveAccessRequest(client, r.id, r.schema_name);
    expect(await platform.openAccessRequests(client, "public")).toHaveLength(0);
    // استرجاع بالبريد: الرابط يعيّن كلمة المرور مرة واحدة، والحساب بلا بريد لا يُرسل له شيء
    const pr = await import("@/lib/password-reset");
    process.env.MAIL_TRANSPORT = "log";
    const logged: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((m: string) => void logged.push(String(m)));
    expect(await pr.requestPasswordReset(client, "home", "admin", "https://x.test")).toBeNull();
    await client`update public.users set email = 'boss@example.com' where login = 'admin'`;
    expect(await pr.requestPasswordReset(client, "other", "BOSS@example.com", "https://x.test")).toBeNull();
    expect(await pr.requestPasswordReset(client, "home", "BOSS@example.com", "https://x.test")).toBe("bo•••@example.com");
    spy.mockRestore();
    delete process.env.MAIL_TRANSPORT;
    const resetToken = logged.join("\n").match(/\/login\/reset\/(\S+)/)![1];
    expect((await pr.resetTarget(client, resetToken))?.login).toBe("admin");
    await expect(pr.completePasswordReset(client, resetToken, "short")).rejects.toThrow("أحرف");
    const [before] = await client`select password_hash from public.users where login = 'admin'`;
    await pr.completePasswordReset(client, resetToken, "brand-new-pass");
    const [after] = await client`select password_hash from public.users where login = 'admin'`;
    expect(await verifyPassword("brand-new-pass", after.password_hash)).toBe(true);
    await expect(pr.completePasswordReset(client, resetToken, "another-pass")).rejects.toThrow("غير صالح");
    await client`update public.users set password_hash = ${before.password_hash}, email = null where login = 'admin'`;

    const base = { name: "شركة التجربة", slug: "acme", trialDays: 15, adminName: "مدير أكمي", adminLogin: "acme_admin", adminPassword: "acme-pass-1" };
    await expect(platform.createTenant(client, tdb, { ...base, slug: "Bad-Slug" })).rejects.toThrow("رمز الشركة");
    const t = await platform.createTenant(client, tdb, base);
    expect(t.schema_name).toBe("t_acme");
    await expect(platform.createTenant(client, tdb, { ...base, adminLogin: "other" })).rejects.toThrow("رمز الشركة مستخدم");
    expect(await platform.schemaForCompany(client, "Acme")).toBe("t_acme");
    // الرمز رقمي مسموح، ويمكن تغييره دون المساس بالبيانات
    await expect(platform.setCompanyCode(client, t.id, "home")).rejects.toThrow("مستخدم");
    await platform.setCompanyCode(client, t.id, "1001");
    expect(await platform.schemaForCompany(client, "1001")).toBe("t_acme");
    expect(await platform.schemaForCompany(client, "acme")).toBeNull();
    await platform.setCompanyCode(client, t.id, "acme");
    expect((await platform.listTenants(client)).find((x) => x.slug === "acme")).toMatchObject({ admin_login: "acme_admin", admin_name: "مدير أكمي" });
    // إنشاء انقطع في منتصفه (مهلة الخادم): يظهر «لم يكتمل»، وإعادة الإنشاء بنفس الرمز تمسح بقاياه
    await client`insert into platform.tenants (slug, name, schema_name, status) values ('halfco', 'نصف', 't_halfco', 'active')`;
    await client.unsafe(`create schema t_halfco`);
    expect((await platform.listTenants(client)).find((x) => x.slug === "halfco")).toMatchObject({ broken: true });
    const half = await platform.createTenant(client, tdb, { ...base, slug: "halfco", adminLogin: "half_admin" });
    expect((await platform.listTenants(client)).find((x) => x.slug === "halfco")).toMatchObject({ broken: false, admin_login: "half_admin" });
    await platform.deleteTenant(client, half.id, "halfco");
    await expect(platform.resetTenantAdminPassword(client, tdb, t.id, "short")).rejects.toThrow("أحرف");
    expect(await platform.resetTenantAdminPassword(client, tdb, t.id, "new-pass-2026")).toMatchObject({ login: "acme_admin" });
    await runInTenant("t_acme", async () => {
      const [u] = await tdb.select().from(s.users).where(eq(s.users.login, "acme_admin"));
      expect(await verifyPassword("new-pass-2026", u.passwordHash)).toBe(true);
    });

    // بيانات الشركة الجديدة منفصلة: شجرة حسابات خاصة، لا قيود، ومركبة لا تظهر عند الكمال
    const publicVehicles = (await db.select().from(s.vehicles)).length;
    await runInTenant("t_acme", async () => {
      expect((await tdb.select().from(s.accounts)).length).toBeGreaterThan(50);
      expect(await tdb.select().from(s.journalEntries)).toHaveLength(0);
      const [u] = await tdb.select().from(s.users);
      expect(u).toMatchObject({ login: "acme_admin", name: "مدير أكمي" });
      expect((await getCompany(tdb))?.nameAr).toBe("شركة التجربة");
      await createVehicle(tdb, { plate: "ACME 1", chassis: "AC-1" });
      expect(await tdb.select().from(s.vehicles)).toHaveLength(1);
      // نفس اسم الدخول مسموح في شركة أخرى، ومرفوض داخل نفس الشركة ولو اختلفت الحروف الكبيرة
      await tdb.insert(s.users).values({ name: "x", login: "admin", passwordHash: "x" });
      await expect(tdb.insert(s.users).values({ name: "y", login: "ACME_ADMIN", passwordHash: "x" })).rejects.toThrow();
      await tdb.delete(s.users).where(eq(s.users.login, "admin"));
      // معاملة كاملة داخل الشركة
      await tdb.transaction(async (tx) => {
        await tx.update(s.users).set({ locale: "en" }).where(eq(s.users.login, "acme_admin"));
      });
    });
    expect(await db.select().from(s.vehicles)).toHaveLength(publicVehicles);

    // التجربة: فعّالة ثم تتوقف وحدها بانتهاء المدة
    expect((await platform.tenantState(client, "t_acme"))?.daysLeft).toBe(15);
    expect((await platform.tenantState(client, "t_acme"))?.blocked).toBeNull();
    await client`update platform.tenants set trial_ends_at = now() - interval '1 hour' where id = ${t.id}`;
    expect((await platform.tenantState(client, "t_acme"))?.blocked).toContain("انتهت الفترة التجريبية");
    await platform.extendTrial(client, t.id, 15);
    expect((await platform.tenantState(client, "t_acme"))?.daysLeft).toBe(15);
    await platform.setSuspended(client, t.id, true);
    expect((await platform.tenantState(client, "t_acme"))?.blocked).toContain("أوقف");
    await platform.setSuspended(client, t.id, false);
    await platform.activateTenant(client, t.id);
    const state = await platform.tenantState(client, "t_acme");
    expect(state?.tenant.status).toBe("active");
    expect(state?.blocked).toBeNull();
    await runInTenant("t_acme", async () => expect(await tdb.select().from(s.vehicles)).toHaveLength(1));
    await expect(platform.activateTenant(client, (await client`select id from platform.tenants where schema_name = 'public'`)[0].id)).rejects.toThrow("شركة البداية");

    // البدء من جديد: تُمسح البيانات ويبقى المستخدم بدوره وبيانات المنشأة
    await expect(platform.resetTenant(client, tdb, "t_acme", "wrong")).rejects.toThrow("للتأكيد");
    await platform.resetTenant(client, tdb, "t_acme", "acme");
    await runInTenant("t_acme", async () => {
      expect(await tdb.select().from(s.vehicles)).toHaveLength(0);
      expect((await tdb.select().from(s.accounts)).length).toBeGreaterThan(50);
      const users = await tdb.select({ login: s.users.login, key: s.roles.key }).from(s.users).innerJoin(s.userRoles, eq(s.userRoles.userId, s.users.id)).innerJoin(s.roles, eq(s.roles.id, s.userRoles.roleId));
      expect(users).toEqual([{ login: "acme_admin", key: "admin" }]);
      expect((await getCompany(tdb))?.nameAr).toBe("شركة التجربة");
    });
    expect(await platform.schemaForCompany(client, "acme")).toBe("t_acme");
    expect((await platform.listTenants(client)).map((x) => x.slug)).toEqual(["home", "acme"]);

    // الحذف النهائي
    await expect(platform.deleteTenant(client, t.id, "nope")).rejects.toThrow("للتأكيد");
    await platform.deleteTenant(client, t.id, "acme");
    expect(await client`select 1 from pg_namespace where nspname = 't_acme'`).toHaveLength(0);
    expect(await platform.schemaForCompany(client, "acme")).toBeNull();
    expect(await client`select 1 from platform.logins where schema_name = 't_acme'`).toHaveLength(0);
  }, 20_000);

  it("يعدّل السائق ويحذفه ويربط حسابه ويدير دخوله", async () => {
    const d = await createDriver(db, { nameAr: "سائق للتعديل" });
    await updateDriver(db, d.id, { nameAr: "سائق معدل", mobile: "0509999999", appLanguage: "ur", commissionClass: "international", custodyLimit: 500, status: "on_leave" });
    const [row] = await db.select({ name: s.employees.nameAr, status: s.drivers.status, lang: s.drivers.appLanguage, acc: s.accounts.nameAr }).from(s.drivers).innerJoin(s.employees, eq(s.employees.id, s.drivers.employeeId)).innerJoin(s.accounts, eq(s.accounts.id, s.drivers.custodyAccountId)).where(eq(s.drivers.id, d.id));
    expect(row).toEqual({ name: "سائق معدل", status: "on_leave", lang: "ur", acc: "عهدة – سائق معدل" });

    const user = await createDriverLogin(db, { driverId: d.id, login: "edit-driver", password: "pass-12345" });
    await resetDriverPassword(db, d.id, "new-pass-123");
    await updateDriver(db, d.id, { nameAr: "سائق معدل", status: "terminated" });
    const [u] = await db.select({ active: s.users.isActive }).from(s.users).where(eq(s.users.id, user.id));
    expect(u.active).toBe(false);
    await removeDriverLogin(db, d.id);
    expect(await driverForUser(db, user.id)).toBeNull();

    // ربط حساب موجود بسائق
    const [other] = await db.insert(s.users).values({ name: "حساب منفصل", login: "loose-driver", passwordHash: "x" }).returning({ id: s.users.id });
    await linkUserToDriver(db, other.id, d.id);
    expect((await driverForUser(db, other.id))?.id).toBe(d.id);

    // سائق بلا حركات يُحذف مع حساباته، ومن له حركة لا يُحذف
    await deleteDriver(db, d.id);
    expect(await db.select().from(s.drivers).where(eq(s.drivers.id, d.id))).toHaveLength(0);
    const busy = await db.select({ id: s.waybills.driverId }).from(s.waybills).where(sql`${s.waybills.driverId} is not null`).limit(1);
    if (busy[0]?.id) await expect(deleteDriver(db, busy[0].id)).rejects.toThrow("له حركات");
  });

  it("يسجل كل إنشاء وتعديل وحذف في سجل التعديلات مع المستخدم", async () => {
    const [admin] = await db.select({ id: s.users.id }).from(s.users).limit(1);
    const v = await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.user_id', ${String(admin.id)}, true)`);
      const [row] = await tx.insert(s.vehicleTypes).values({ nameAr: "نوع للسجل" }).returning();
      await tx.update(s.vehicleTypes).set({ nameAr: "نوع معدل" }).where(eq(s.vehicleTypes.id, row.id));
      await tx.delete(s.vehicleTypes).where(eq(s.vehicleTypes.id, row.id));
      return row;
    });
    const log = await db.select().from(s.auditLog).where(and(eq(s.auditLog.entity, "vehicle_types"), eq(s.auditLog.entityId, String(v.id)))).orderBy(s.auditLog.id);
    expect(log.map((l) => l.action)).toEqual(["create", "update", "delete"]);
    expect(log.every((l) => l.userId === admin.id)).toBe(true);
    expect(log[1].changes).toEqual({ name_ar: ["نوع للسجل", "نوع معدل"] });
    // كلمة المرور لا تُحفظ في السجل
    await db.update(s.users).set({ passwordHash: "changed" }).where(eq(s.users.id, admin.id));
    const [pw] = await db.select().from(s.auditLog).where(and(eq(s.auditLog.entity, "users"), eq(s.auditLog.action, "update"))).orderBy(desc(s.auditLog.id)).limit(1);
    expect(JSON.stringify(pw.changes)).not.toContain("changed");
  });

  it("يحفظ صور السائق، ولا يكرر العملية المرسلة مرتين بعد انقطاع الشبكة", async () => {
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const id = await saveDataUrl(db, { entity: "waybills", entityId: 999001, kind: "pod", dataUrl: png });
    expect(await saveDataUrl(db, { entity: "waybills", entityId: 999001, kind: "pod", dataUrl: "" })).toBeNull();
    await expect(saveDataUrl(db, { entity: "waybills", entityId: 999001, kind: "pod", dataUrl: `data:image/jpeg;base64,${"A".repeat(2_100_000)}` })).rejects.toThrow("كبيرة");
    const list = await listAttachments(db, "waybills", [999001]);
    expect(list.map((a) => [a.id, a.kind])).toEqual([[id, "pod"]]);
    const file = await getAttachment(db, id!);
    expect(file?.mime).toBe("image/png");
    expect(file?.data.subarray(1, 4).toString()).toBe("PNG");

    let runs = 0;
    const op = "op-test-12345678";
    await onceForOp(db, op, async () => void runs++);
    await onceForOp(db, op, async () => void runs++);
    // فشل العملية لا يسجلها، فتُعاد لاحقاً
    await expect(onceForOp(db, "op-fail-12345678", async () => { throw new Error("x"); })).rejects.toThrow("x");
    await onceForOp(db, "op-fail-12345678", async () => void runs++);
    expect(runs).toBe(2);
  });

  it("يصدّر كل البيانات إلى Excel بأسماء عربية ويستبدل المعرّفات بالأسماء، ويحسب خطوات الإعداد", async () => {
    const file = await exportAllData(db, "شركة الاختبار");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file as unknown as ArrayBuffer);
    const names = wb.worksheets.map((w) => w.name);
    expect(names[0]).toBe("الفهرس");
    expect(names).toContain("شجرة الحسابات");
    expect(names).toContain("سطور القيود");
    const users = wb.getWorksheet("المستخدمون")!;
    const head = (users.getRow(1).values as unknown[]).map(String);
    expect(head).toContain("اسم الدخول");
    expect(head.join()).not.toContain("password");
    const lines = wb.getWorksheet("سطور القيود")!;
    const lh = (lines.getRow(1).values as unknown[]).map(String);
    const accCol = lh.indexOf("الحساب");
    expect(accCol).toBeGreaterThan(0);
    if (lines.rowCount > 1) expect(String(lines.getRow(2).getCell(accCol).value)).toMatch(/^\d+ \S/);

    const steps = await setupSteps(db);
    expect(steps.map((x) => x.key)).toEqual(["company", "template", "banks", "vehicles", "drivers", "customers", "routes", "opening", "users"]);
    expect(steps.find((x) => x.key === "vehicles")!.done).toBe(true);
  });

  it("الدفعة الخامسة: التحويل بين الحسابات، مخصص الديون، بطاقات الوقود، الشراء، عروض الأسعار", async () => {
    const [admin] = await db.select({ id: s.users.id }).from(s.users).limit(1);
    await openYear(db, YEAR + 1);
    await openYear(db, YEAR + 2);
    const bal = async (code: string) => {
      const [r] = await db.execute(sql`select coalesce(sum(l.debit_base - l.credit_base), 0)::float8 as v from journal_lines l join journal_entries e on e.id = l.entry_id where e.status = 'posted' and l.account_id = ${acc[code]}`);
      return Number((r as { v: number }).v);
    };
    // تحويل بالريال مع رسوم
    const bank = await createCashAccount(db, { kind: "bank", nameAr: "بنك التحويل", bankName: "الأهلي", openingBalance: 50000, openingDate: `${YEAR + 1}-01-01` });
    const box = (await db.select().from(s.accounts).where(eq(s.accounts.code, "110101")))[0];
    const before = await bal(box.code);
    const t1 = await createTransfer(db, { date: `${YEAR + 1}-05-01`, fromAccountId: bank.id, toAccountId: box.id, amount: 1000, fee: 10, userId: admin.id });
    expect(await bal(box.code)).toBeCloseTo(before + 1000);
    const lines = await db.select().from(s.journalLines).where(eq(s.journalLines.entryId, t1.journalEntryId));
    expect(lines.find((l) => l.accountId === acc["6108"])?.debit).toBe("10.000");
    // من ريال إلى صندوق بالدينار: السعر الضمني من المبلغين
    const kwd = (await db.select().from(s.accounts).where(eq(s.accounts.currencyCode, "KWD")))[0];
    if (kwd) {
      const t2 = await createTransfer(db, { date: `${YEAR + 1}-05-02`, fromAccountId: bank.id, toAccountId: kwd.id, amount: 1225, receivedAmount: 100 });
      const l2 = await db.select().from(s.journalLines).where(eq(s.journalLines.entryId, t2.journalEntryId));
      expect(l2.find((l) => l.accountId === kwd.id)).toMatchObject({ debit: "100.000", exchangeRate: "12.250000", debitBase: "1225.000" });
      await expect(createTransfer(db, { date: `${YEAR + 1}-05-02`, fromAccountId: bank.id, toAccountId: kwd.id, amount: 100 })).rejects.toThrow("المبلغ المستلم");
    }
    await deleteTransfer(db, t1.id);
    expect(await bal(box.code)).toBeCloseTo(before);
    await expect(createTransfer(db, { date: `${YEAR + 1}-05-01`, fromAccountId: bank.id, toAccountId: acc["5101"], amount: 5 })).rejects.toThrow("بنكاً أو صندوقاً");

    // مخصص الخسائر الائتمانية: يطابق المطلوب، ولا يتكرر في نفس التاريخ
    const asOf = `${YEAR + 2}-12-31`;
    const { required, customers } = eclCompute(await eclAging(db, asOf), DEFAULT_ECL_RATES);
    if (required > 0) {
      expect(customers.length).toBeGreaterThan(0);
      const e = await postEcl(db, asOf, DEFAULT_ECL_RATES, admin.id);
      expect(await provisionBalance(db, asOf)).toBeCloseTo(required);
      await expect(postEcl(db, asOf, DEFAULT_ECL_RATES)).rejects.toThrow();
      await deleteEcl(db, e.id);
      expect(await provisionBalance(db, asOf)).toBeCloseTo(0);
    }

    // كشف بطاقات الوقود: سطر غير مسجل يُقيد ديزلاً على المركبة من رصيد البطاقات
    const st = await createStatement(db, { periodFrom: `${YEAR + 1}-06-01`, periodTo: `${YEAR + 1}-06-30`, closingBalance: 0, lines: [{ date: `${YEAR + 1}-06-05`, plate: "أب ج1234", amount: 115, liters: 50, station: "الدريس" }], userId: admin.id });
    let d = await statementDetail(db, st.id);
    expect(d.lines[0].vehicle).toBe("أ ب ج 1234");
    expect(d.summary.unresolved).toBe(1);
    await expect(setStatementStatus(db, st.id, "reconciled")).rejects.toThrow("غير مطابق");
    const fe = await postLineAsExpense(db, d.lines[0].l.id, admin.id);
    const fl = await db.select().from(s.journalLines).where(eq(s.journalLines.entryId, fe.id));
    expect(fl.find((l) => l.accountId === acc["5101"])).toMatchObject({ debit: "100.000", costCenterId: vehicleCc });
    expect(fl.find((l) => l.accountId === acc["1106"])?.credit).toBe("115.000");
    d = await statementDetail(db, st.id);
    expect(d.summary.unresolved).toBe(0);
    await setStatementStatus(db, st.id, "reconciled");

    // طلب شراء ← أمر شراء ← فاتورة مورد مسودة
    const supplier = await createParty(db, { nameAr: "مورد قطع الغيار", roles: ["supplier"] });
    const [veh] = await db.select().from(s.vehicles).where(eq(s.vehicles.costCenterId, vehicleCc));
    const pr = await createPurchaseRequest(db, { date: `${YEAR + 1}-07-01`, vehicleId: veh.id, notes: "إطارات", lines: [{ description: "إطار 315/80", quantity: 4, estimatedPrice: 900 }], userId: admin.id });
    await expect(createPurchaseOrder(db, { date: `${YEAR + 1}-07-02`, supplierId: supplier.id, requestId: pr.id, lines: [] })).rejects.toThrow();
    await decideRequest(db, pr.id, "approve", { userId: admin.id });
    const oLines = (await requestToOrderLines(db, pr.id)).map((l) => ({ ...l, accountId: acc["5108"] }));
    const po = await createPurchaseOrder(db, { date: `${YEAR + 1}-07-02`, supplierId: supplier.id, requestId: pr.id, lines: oLines, userId: admin.id });
    expect((await db.select().from(s.purchaseRequests).where(eq(s.purchaseRequests.id, pr.id)))[0].status).toBe("ordered");
    await expect(orderToInvoice(db, po.id, { supplierInvoiceNo: "S-1", invoiceDate: `${YEAR + 1}-07-05` })).rejects.toThrow("اعتمد");
    await setOrderStatus(db, po.id, "approved", admin.id);
    const pinv = await orderToInvoice(db, po.id, { supplierInvoiceNo: "S-1", invoiceDate: `${YEAR + 1}-07-05`, userId: admin.id });
    expect(Number(pinv.total)).toBeCloseTo(4 * 900 * 1.15);
    expect((await db.select().from(s.purchaseOrders).where(eq(s.purchaseOrders.id, po.id)))[0].status).toBe("invoiced");

    // عرض سعر ← فاتورة مبيعات مسودة بنفس السطور
    const customer = await createParty(db, { nameAr: "عميل عرض السعر", roles: ["customer"] });
    const q = await createQuotation(db, { date: `${YEAR + 1}-08-01`, validUntil: `${YEAR + 1}-08-15`, customerId: customer.id, lines: [{ description: "نقل حاوية الدمام ← الرياض", quantity: 3, unitPrice: 1500, vatRate: 15 }, { description: "نقل للكويت", quantity: 1, unitPrice: 6000, vatRate: 0 }], userId: admin.id });
    expect(Number(q.total)).toBeCloseTo(4500 * 1.15 + 6000);
    const sinv = await quotationToInvoice(db, q.id, { invoiceDate: `${YEAR + 1}-08-03`, userId: admin.id });
    const [si] = await db.select().from(s.salesInvoices).where(eq(s.salesInvoices.id, sinv.id));
    expect(Number(si.total)).toBeCloseTo(Number(q.total));
    expect(si.status).toBe("draft");
    await expect(quotationToInvoice(db, q.id, { invoiceDate: `${YEAR + 1}-08-03` })).rejects.toThrow("مسبقاً");
  });

  it("الفوترة الإلكترونية: الاعتماد يسلسل العداد والبصمة، والرفض يتقدم بالسلسلة، وخطأ الخادم والانقطاع لا يغيّرانها", async () => {
    const [admin] = await db.select().from(s.users).limit(1);
    await db.update(s.companyProfile).set({ vatNumber: "310123456700003", crNumber: "2050197412", street: "طريق الملك فهد", buildingNo: "6701", district: "الفيصلية", city: "الدمام", postalCode: "32263" });
    const customer = await createParty(db, { nameAr: "عميل الفوترة الإلكترونية", vatNumber: "300000000000003", roles: ["customer"] });
    const q = await createQuotation(db, { date: `${YEAR + 1}-09-01`, validUntil: `${YEAR + 1}-09-15`, customerId: customer.id, lines: [{ description: "نقل الدمام ← الرياض", quantity: 2, unitPrice: 500, vatRate: 15 }, { description: "نقل للكويت", quantity: 1, unitPrice: 3000, vatRate: 0 }], userId: admin.id });
    const inv = await quotationToInvoice(db, q.id, { invoiceDate: `${YEAR + 1}-09-01`, userId: admin.id });
    await issueInvoice(db, inv.id);

    await expect(submitDocument(db, { invoiceId: inv.id })).rejects.toThrow("أكمل بيانات العميل");
    await db.update(s.parties).set({ street: "الصناعية", buildingNo: "1234", district: "السلي", city: "الرياض", postalCode: "12211" }).where(eq(s.parties.id, customer.id));
    await expect(submitDocument(db, { invoiceId: inv.id })).rejects.toThrow("غير مربوط");

    const key = newKeyPair();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zatca-"));
    fs.writeFileSync(path.join(dir, "k.pem"), key);
    execFileSync("openssl", ["req", "-new", "-x509", "-key", "k.pem", "-out", "c.pem", "-days", "1", "-subj", "/CN=TEST"], { cwd: dir });
    await db.insert(s.zatcaSettings).values({ id: 1, environment: "simulation", privateKey: key, certificate: fs.readFileSync(path.join(dir, "c.pem"), "utf8"), token: "t", secret: "s" });

    const reply = (status: number, body: object) => vi.fn(async (_url: string, init: RequestInit) => new Response(JSON.stringify(typeof body === "function" ? (body as (b: unknown) => object)(JSON.parse(String(init.body))) : body), { status }));
    const settings = async () => (await db.select().from(s.zatcaSettings))[0];

    vi.stubGlobal("fetch", reply(200, ((b: { invoice: string }) => ({ clearanceStatus: "CLEARED", clearedInvoice: b.invoice, validationResults: { status: "PASS" } })) as unknown as object));
    const first = await submitDocument(db, { invoiceId: inv.id }, admin.id);
    expect(first).toMatchObject({ status: "cleared", icv: 1 });
    expect(first.xml).toContain("<cbc:UUID>");
    expect((await settings()).lastHash).toBe(first.invoiceHash);
    expect((await db.select().from(s.salesInvoices).where(eq(s.salesInvoices.id, inv.id)))[0].zatcaStatus).toBe("accepted");
    expect(await clearedQr(db, inv.id)).toBeTruthy();
    await expect(submitDocument(db, { invoiceId: inv.id })).rejects.toThrow("مسبقاً");
    await expect(revertInvoice(db, inv.id)).rejects.toThrow();

    const note = await createNote(db, { kind: "sales_credit", noteDate: `${YEAR + 1}-09-02`, partyId: customer.id, invoiceId: inv.id, reason: "خصم تجاري", lines: [{ description: "خصم", accountId: acc["4101"], amount: 100, vatRate: 15 }], post: true });
    vi.stubGlobal("fetch", reply(400, { clearanceStatus: "NOT_CLEARED", validationResults: { status: "ERROR", errorMessages: [{ code: "BR-KSA-01", message: "خطأ تجريبي" }] } }));
    const rejected = await submitDocument(db, { noteId: note.id });
    expect(rejected).toMatchObject({ status: "rejected", icv: 2, previousHash: first.invoiceHash });
    expect(rejected.xml).toContain("<cbc:InvoiceTypeCode name=\"0100000\">381</cbc:InvoiceTypeCode>");
    expect(rejected.errors).toEqual(["BR-KSA-01: خطأ تجريبي"]);

    vi.stubGlobal("fetch", reply(500, {}));
    expect((await submitDocument(db, { noteId: note.id })).status).toBe("error");
    expect((await settings()).lastIcv).toBe(2);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    await expect(submitDocument(db, { noteId: note.id })).rejects.toThrow("تعذر الاتصال");
    expect((await settings()).lastIcv).toBe(2);

    vi.stubGlobal("fetch", reply(200, { clearanceStatus: "CLEARED", validationResults: { status: "WARNING", warningMessages: [{ code: "W1", message: "تنبيه" }] } }));
    const ok = await submitDocument(db, { noteId: note.id });
    expect(ok).toMatchObject({ status: "cleared_warnings", icv: 3, previousHash: rejected.invoiceHash, warnings: ["W1: تنبيه"] });
    await expect(revertNote(db, note.id)).rejects.toThrow("اعتمدته");
    vi.unstubAllGlobals();
  });
});
