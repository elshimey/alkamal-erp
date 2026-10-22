import crypto from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import * as s from "@/db/schema";
import { getCompany } from "@/lib/company";
import { buildCsr, newKeyPair, type ZatcaEnv } from "./der";
import { buildInvoiceXml, GENESIS_PIH, qrFromXml, signInvoice, type ZatcaDoc, type ZatcaLine, type ZatcaParty } from "./xml";
import { clearInvoice, complianceCheck, messages, requestComplianceCsid, requestProductionCsid, SANDBOX_OTP, tokenToPem, type Credentials, type SubmitResponse } from "./api";

// ربط النظام ببوابة «فاتورة» (المرحلة الثانية): التسجيل، والاعتماد (Clearance) للفواتير الضريبية والإشعارات.

export const ENV_LABEL: Record<ZatcaEnv, string> = { sandbox: "بيئة المطورين (تجربة)", simulation: "بيئة المحاكاة", production: "الإنتاج (الفعلي)" };
export const DOC_STATUS = {
  cleared: { label: "معتمدة من الهيئة", tone: "green" },
  cleared_warnings: { label: "معتمدة بملاحظات", tone: "amber" },
  rejected: { label: "مرفوضة من الهيئة", tone: "red" },
  error: { label: "خطأ في الإرسال", tone: "red" },
} as const;

const SOLUTION = "AlKamalERP";
const INDUSTRY = "Transportation";
// النسبة الصفرية في النقل: النقل الدولي للبضائع (المادة 34 من اللائحة)
const ZERO = { code: "VATEX-SA-34-1", reason: "The international transport of Goods" };
const OUT_OF_SCOPE = { code: "VATEX-SA-OOS", reason: "Not subject to VAT" };

export async function getSettings(db: Db) {
  const [row] = await db.select().from(s.zatcaSettings).where(eq(s.zatcaSettings.id, 1));
  return row ?? null;
}

const riyadhParts = (d: Date) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:${p.second}` };
};

// ─────────── جاهزية بيانات المنشأة ───────────

/** ما ينقص بيانات الشركة قبل الربط؛ قائمة فارغة = جاهزة. */
export function companyGaps(c: Awaited<ReturnType<typeof getCompany>>) {
  const gaps: string[] = [];
  if (!c.vatNumber || !/^3\d{13}3$/.test(c.vatNumber)) gaps.push("الرقم الضريبي (15 رقماً يبدأ وينتهي بـ 3)");
  if (!c.crNumber) gaps.push("رقم السجل التجاري");
  if (!c.street) gaps.push("اسم الشارع");
  if (!c.buildingNo || !/^\d{4}$/.test(c.buildingNo)) gaps.push("رقم المبنى (4 أرقام)");
  if (!c.district) gaps.push("الحي");
  if (!c.city) gaps.push("المدينة");
  if (!c.postalCode || !/^\d{5}$/.test(c.postalCode)) gaps.push("الرمز البريدي (5 أرقام)");
  return gaps;
}

/** ما ينقص عنوان العميل أو هويته في ملف الفاتورة (للعميل داخل المملكة). */
export function buyerGaps(p: ZatcaParty) {
  const gaps: string[] = [];
  if (p.country === "SA") {
    if (!p.street) gaps.push("الشارع");
    if (!p.buildingNo || !/^\d{4}$/.test(p.buildingNo)) gaps.push("رقم المبنى (4 أرقام)");
    if (!p.district) gaps.push("الحي");
    if (!p.city) gaps.push("المدينة");
    if (!p.postalCode || !/^\d{5}$/.test(p.postalCode)) gaps.push("الرمز البريدي (5 أرقام)");
    if (p.vatNumber && !/^3\d{13}3$/.test(p.vatNumber)) gaps.push("الرقم الضريبي غير صحيح");
    if (!p.vatNumber && !p.otherId) gaps.push("الرقم الضريبي أو السجل التجاري");
  }
  return gaps;
}

function sellerOf(c: Awaited<ReturnType<typeof getCompany>>): ZatcaParty {
  return { name: c.nameAr, vatNumber: c.vatNumber, crNumber: c.crNumber, street: c.street, buildingNo: c.buildingNo, additionalNo: c.additionalNo, district: c.district, city: c.city, postalCode: c.postalCode, country: c.country || "SA" };
}

function buyerOf(p: typeof s.parties.$inferSelect): ZatcaParty {
  return {
    name: p.nameAr,
    vatNumber: p.vatNumber?.trim() || null,
    otherId: p.crNumber ? { scheme: "CRN", value: p.crNumber } : null,
    street: p.street,
    buildingNo: p.buildingNo,
    additionalNo: p.additionalNo,
    district: p.district,
    city: p.city,
    postalCode: p.postalCode,
    country: p.country || "SA",
  };
}

function lineOf(name: string, quantity: number, net: number, vatRate: number, taxCode: string | null): ZatcaLine {
  if (vatRate > 0) return { name, quantity, net, vatRate, category: "S" };
  if (taxCode === "EXEMPT") return { name, quantity, net, vatRate: 0, category: "O", exemptionCode: OUT_OF_SCOPE.code, exemptionReason: OUT_OF_SCOPE.reason };
  return { name, quantity, net, vatRate: 0, category: "Z", exemptionCode: ZERO.code, exemptionReason: ZERO.reason };
}

type Source = { invoiceId: number } | { noteId: number };

/** بيانات المستند للملف (دون العداد والبصمة السابقة والمعرّف). */
async function sourceDoc(db: Db, src: Source) {
  const company = await getCompany(db);
  if ("invoiceId" in src) {
    const [row] = await db.select({ i: s.salesInvoices, p: s.parties }).from(s.salesInvoices).innerJoin(s.parties, eq(s.parties.id, s.salesInvoices.customerId)).where(eq(s.salesInvoices.id, src.invoiceId));
    if (!row) throw new Error("الفاتورة غير موجودة");
    if (row.i.status !== "issued") throw new Error("تُرسل الفاتورة للهيئة بعد إصدارها");
    const lines = await db
      .select({ l: s.salesInvoiceLines, code: s.taxCodes.code })
      .from(s.salesInvoiceLines)
      .leftJoin(s.taxCodes, eq(s.taxCodes.id, s.salesInvoiceLines.taxCodeId))
      .where(eq(s.salesInvoiceLines.invoiceId, src.invoiceId))
      .orderBy(asc(s.salesInvoiceLines.lineNo));
    const when = riyadhParts(row.i.issuedAt ?? new Date());
    return {
      company,
      doc: {
        kind: "invoice" as const,
        number: row.i.number,
        issueDate: row.i.invoiceDate,
        issueTime: when.time,
        supplyDate: row.i.invoiceDate,
        currency: row.i.currencyCode,
        rate: Number(row.i.exchangeRate),
        seller: sellerOf(company),
        buyer: buyerOf(row.p),
        lines: lines.map(({ l, code }) => lineOf(l.description, Number(l.quantity ?? 1) || 1, Number(l.amount), Number(l.vatRate), code)),
      },
    };
  }
  const [row] = await db
    .select({ n: s.adjustmentNotes, p: s.parties, invoice: s.salesInvoices.number })
    .from(s.adjustmentNotes)
    .innerJoin(s.parties, eq(s.parties.id, s.adjustmentNotes.partyId))
    .leftJoin(s.salesInvoices, eq(s.salesInvoices.id, s.adjustmentNotes.salesInvoiceId))
    .where(eq(s.adjustmentNotes.id, src.noteId));
  if (!row) throw new Error("الإشعار غير موجود");
  if (row.n.kind !== "sales_credit" && row.n.kind !== "sales_debit") throw new Error("تُرسل للهيئة إشعارات العملاء فقط");
  if (row.n.status !== "posted") throw new Error("يُرسل الإشعار للهيئة بعد ترحيله");
  if (!row.invoice) throw new Error("اربط الإشعار بفاتورته الأصلية؛ الهيئة تشترط رقم الفاتورة في الإشعار");
  const lines = await db.select().from(s.adjustmentNoteLines).where(eq(s.adjustmentNoteLines.noteId, src.noteId)).orderBy(asc(s.adjustmentNoteLines.lineNo));
  const when = riyadhParts(row.n.updatedAt);
  return {
    company,
    doc: {
      kind: row.n.kind === "sales_credit" ? ("credit" as const) : ("debit" as const),
      number: row.n.number,
      issueDate: row.n.noteDate,
      issueTime: when.time,
      supplyDate: row.n.noteDate,
      currency: row.n.currencyCode,
      rate: Number(row.n.exchangeRate),
      billingReference: row.invoice,
      reason: row.n.reason,
      seller: sellerOf(company),
      buyer: buyerOf(row.p),
      lines: lines.map((l) => lineOf(l.description, 1, Number(l.amount), Number(l.vatRate), null)),
    },
  };
}

type DocData = Omit<ZatcaDoc, "uuid" | "icv" | "pih">;

function signDoc(data: DocData, chain: { icv: number; pih: string }, keys: { privateKeyPem: string; certificatePem: string }) {
  const uuid = crypto.randomUUID();
  const { xml, totals } = buildInvoiceXml({ ...data, uuid, ...chain });
  const signed = signInvoice(xml, {
    ...keys,
    sellerName: data.seller.name,
    vatNumber: data.seller.vatNumber ?? "",
    timestamp: `${data.issueDate}T${data.issueTime}`,
    total: (totals.inclusive / 100).toFixed(2),
    vat: (totals.tax / 100).toFixed(2),
  });
  return { uuid, ...signed };
}

const statusOf = (r: SubmitResponse): (typeof s.zatcaDocStatus.enumValues)[number] => {
  const cleared = r.clearanceStatus === "CLEARED" || r.reportingStatus === "REPORTED";
  if (cleared) return r.validationResults?.status === "WARNING" || (r.validationResults?.warningMessages?.length ?? 0) > 0 ? "cleared_warnings" : "cleared";
  return r.httpStatus >= 500 || r.httpStatus === 401 || r.httpStatus === 429 ? "error" : "rejected";
};

// ─────────── التسجيل (Onboarding) ───────────

function sampleDocs(company: Awaited<ReturnType<typeof getCompany>>): DocData[] {
  const date = riyadhParts(new Date());
  const base = {
    issueDate: date.date,
    issueTime: date.time,
    supplyDate: date.date,
    currency: "SAR",
    rate: 1,
    seller: sellerOf(company),
    buyer: { name: "عميل تجريبي للامتثال", vatNumber: "300000000000003", street: "طريق الملك فهد", buildingNo: "1234", district: "العليا", city: "الرياض", postalCode: "12211", country: "SA" },
    lines: [lineOf("نقل بضائع الدمام ← الرياض", 1, 1000, 15, "VAT15-OUT")],
  };
  return [
    { ...base, kind: "invoice", number: "COMPLIANCE-INV-1" },
    { ...base, kind: "credit", number: "COMPLIANCE-CRN-1", billingReference: "COMPLIANCE-INV-1", reason: "خصم تجاري على الفاتورة" },
    { ...base, kind: "debit", number: "COMPLIANCE-DBN-1", billingReference: "COMPLIANCE-INV-1", reason: "رسوم انتظار إضافية" },
  ];
}

export interface OnboardStep {
  step: string;
  ok: boolean;
  detail?: string;
}

/**
 * التسجيل كاملاً: مفتاح وطلب شهادة، ثم شهادة الامتثال برمز التفعيل، ثم فحص ثلاثة نماذج
 * (فاتورة وإشعار دائن وإشعار مدين)، ثم شهادة الإنتاج. يعيد خطوات مفهومة لعرضها.
 */
async function runOnboarding(db: Db, env: ZatcaEnv, otp: string) {
  const company = await getCompany(db);
  const gaps = companyGaps(company);
  if (gaps.length) throw new Error(`أكمل بيانات الشركة أولاً: ${gaps.join("، ")}`);
  const steps: OnboardStep[] = [];
  const privateKey = newKeyPair();
  const serial = `1-${SOLUTION}|2-${process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "1.0"}|3-${crypto.randomUUID()}`;
  const csr = buildCsr(
    {
      env,
      commonName: `${env === "sandbox" ? "TST-" : env === "simulation" ? "PREZATCA-" : ""}${SOLUTION}-${company.vatNumber}`,
      orgName: company.nameAr,
      orgUnit: company.city ?? "Main",
      vatNumber: company.vatNumber!,
      serial,
      invoiceTypes: "1000",
      address: [company.buildingNo, company.street, company.district, company.city].filter(Boolean).join(" "),
      industry: INDUSTRY,
    },
    privateKey,
  );
  steps.push({ step: "إنشاء مفتاح الجهاز وطلب الشهادة", ok: true });
  const compliance = await requestComplianceCsid(env, csr, otp).catch((err: Error) => {
    steps.push({ step: "شهادة الامتثال برمز التفعيل", ok: false, detail: err.message });
    return null;
  });
  if (!compliance) return { steps, ok: false as const };
  steps.push({ step: "شهادة الامتثال برمز التفعيل", ok: true });
  const creds: Credentials = { token: compliance.token, secret: compliance.secret };
  const keys = { privateKeyPem: privateKey, certificatePem: tokenToPem(compliance.token) };
  let chain = { icv: 1, pih: GENESIS_PIH };
  let allPassed = true;
  const names = { invoice: "فاتورة ضريبية", credit: "إشعار دائن", debit: "إشعار مدين" };
  for (const d of sampleDocs(company)) {
    const signed = signDoc(d, chain, keys);
    const r = await complianceCheck(env, creds, { invoiceHash: signed.hash, uuid: signed.uuid, invoice: Buffer.from(signed.xml).toString("base64") }).catch((err: Error) => ({ httpStatus: 0, raw: err.message }) as SubmitResponse);
    const status = r.httpStatus ? statusOf(r) : "error";
    const ok = status === "cleared" || status === "cleared_warnings";
    allPassed &&= ok;
    const detail = [...messages(r.validationResults, "errorMessages"), ...messages(r.validationResults, "warningMessages")].join(" · ") || (ok ? undefined : r.raw.slice(0, 300));
    steps.push({ step: `فحص الامتثال: ${names[d.kind]}`, ok, detail });
    chain = { icv: chain.icv + 1, pih: signed.hash };
  }
  if (!allPassed) return { steps, ok: false as const };
  const production = await requestProductionCsid(env, creds, compliance.requestId).catch((err: Error) => {
    steps.push({ step: "شهادة الإنتاج", ok: false, detail: err.message });
    return null;
  });
  if (!production) return { steps, ok: false as const };
  steps.push({ step: "شهادة الإنتاج", ok: true });
  return { steps, ok: true as const, privateKey, csr, serial, compliance, production };
}

/** تجربة كاملة على بيئة المطورين برمزها الثابت؛ لا تغيّر إعداد الربط الفعلي. */
export async function sandboxTest(db: Db, userId?: number) {
  let result: { steps: OnboardStep[]; ok: boolean };
  try {
    result = await runOnboarding(db, "sandbox", SANDBOX_OTP);
  } catch (err) {
    result = { steps: [{ step: "بدء التجربة", ok: false, detail: (err as Error).message }], ok: false };
  }
  const record = { at: new Date().toISOString(), ok: result.ok, steps: result.steps };
  await db
    .insert(s.zatcaSettings)
    .values({ id: 1, sandboxTest: record, updatedBy: userId ?? null })
    .onConflictDoUpdate({ target: s.zatcaSettings.id, set: { sandboxTest: record, updatedBy: userId ?? null, updatedAt: new Date() } });
  return record;
}

/** الربط الفعلي برمز التفعيل من بوابة فاتورة. */
export async function onboard(db: Db, env: Exclude<ZatcaEnv, "sandbox">, otp: string, userId?: number) {
  if (!/^\d{6}$/.test(otp.trim())) throw new Error("رمز التفعيل 6 أرقام من بوابة فاتورة");
  const r = await runOnboarding(db, env, otp.trim());
  if (!r.ok) return { ok: false as const, steps: r.steps };
  const certificate = tokenToPem(r.production.token);
  let expires: Date | null = null;
  try {
    expires = new Date(new crypto.X509Certificate(certificate).validTo);
  } catch {
    // تُترك فارغة إن تعذرت قراءة الشهادة
  }
  const values = {
    environment: env,
    egsSerial: r.serial,
    privateKey: r.privateKey,
    csr: r.csr,
    complianceRequestId: r.compliance.requestId,
    complianceToken: r.compliance.token,
    complianceSecret: r.compliance.secret,
    token: r.production.token,
    secret: r.production.secret,
    certificate,
    certificateExpiresAt: expires,
    onboardedAt: new Date(),
    updatedBy: userId ?? null,
  };
  await db.transaction(async (tx) => {
    const [cur] = await tx.select().from(s.zatcaSettings).where(eq(s.zatcaSettings.id, 1)).for("update");
    // عند تغيير البيئة تبدأ سلسلة المستندات من جديد؛ وعند تجديد الشهادة في البيئة نفسها تستمر
    const reset = !cur || cur.environment !== env || !cur.token;
    const chain = reset ? { lastIcv: 0, lastHash: null } : {};
    await tx
      .insert(s.zatcaSettings)
      .values({ id: 1, ...values, ...chain })
      .onConflictDoUpdate({ target: s.zatcaSettings.id, set: { ...values, ...chain, updatedAt: new Date() } });
  });
  return { ok: true as const, steps: r.steps };
}

export async function disconnect(db: Db, userId?: number) {
  await db.update(s.zatcaSettings).set({ token: null, secret: null, certificate: null, privateKey: null, onboardedAt: null, updatedBy: userId ?? null, updatedAt: new Date() }).where(eq(s.zatcaSettings.id, 1));
}

export async function setAutoSend(db: Db, autoSend: boolean) {
  await db.update(s.zatcaSettings).set({ autoSend, updatedAt: new Date() }).where(eq(s.zatcaSettings.id, 1));
}

// ─────────── اعتماد المستندات ───────────

/**
 * يرسل الفاتورة أو الإشعار للاعتماد. يُقفل صف الإعداد طوال الإرسال حتى يبقى العداد والبصمة
 * السابقة متسلسلين. أي رد من الهيئة (قبول أو رفض) يُحفظ ويتقدم به التسلسل؛ وتعذر الاتصال لا يغيّر شيئاً.
 */
export async function submitDocument(db: Db, src: Source, userId?: number) {
  const { doc, company } = await sourceDoc(db, src);
  const gaps = buyerGaps(doc.buyer);
  if (gaps.length) throw new Error(`أكمل بيانات العميل «${doc.buyer.name}»: ${gaps.join("، ")}`);
  const cGaps = companyGaps(company);
  if (cGaps.length) throw new Error(`أكمل بيانات الشركة: ${cGaps.join("، ")}`);
  const ref = "invoiceId" in src ? eq(s.zatcaDocuments.salesInvoiceId, src.invoiceId) : eq(s.zatcaDocuments.noteId, src.noteId);
  return db.transaction(async (tx) => {
    const [st] = await tx.select().from(s.zatcaSettings).where(eq(s.zatcaSettings.id, 1)).for("update");
    if (!st?.token || !st.secret || !st.privateKey || !st.certificate) throw new Error("النظام غير مربوط ببوابة فاتورة بعد؛ اربطه من الإعدادات ← الفوترة الإلكترونية");
    const [done] = await tx.select({ id: s.zatcaDocuments.id }).from(s.zatcaDocuments).where(and(ref, inArray(s.zatcaDocuments.status, ["cleared", "cleared_warnings"])));
    if (done) throw new Error("المستند معتمد من الهيئة مسبقاً");
    const chain = { icv: st.lastIcv + 1, pih: st.lastHash ?? GENESIS_PIH };
    const signed = signDoc(doc, chain, { privateKeyPem: st.privateKey, certificatePem: st.certificate });
    const r = await clearInvoice(st.environment, { token: st.token, secret: st.secret }, { invoiceHash: signed.hash, uuid: signed.uuid, invoice: Buffer.from(signed.xml).toString("base64") });
    const status = statusOf(r);
    const clearedXml = r.clearedInvoice ? Buffer.from(r.clearedInvoice, "base64").toString("utf8") : null;
    const errors = messages(r.validationResults, "errorMessages");
    if (!errors.length && (status === "rejected" || status === "error")) errors.push(`رد الهيئة (${r.httpStatus}): ${r.raw.slice(0, 300)}`);
    const [row] = await tx
      .insert(s.zatcaDocuments)
      .values({
        salesInvoiceId: "invoiceId" in src ? src.invoiceId : null,
        noteId: "noteId" in src ? src.noteId : null,
        environment: st.environment,
        icv: chain.icv,
        uuid: signed.uuid,
        invoiceHash: signed.hash,
        previousHash: chain.pih,
        xml: signed.xml,
        clearedXml,
        qr: (clearedXml && qrFromXml(clearedXml)) || signed.qr,
        status,
        httpStatus: r.httpStatus,
        warnings: messages(r.validationResults, "warningMessages"),
        errors,
        submittedBy: userId ?? null,
      })
      .returning();
    // خطأ الخادم أو المصادقة يعني أن الهيئة لم تستلم المستند في السلسلة
    if (status !== "error") await tx.update(s.zatcaSettings).set({ lastIcv: chain.icv, lastHash: signed.hash }).where(eq(s.zatcaSettings.id, 1));
    if ("invoiceId" in src) {
      await tx
        .update(s.salesInvoices)
        .set({ zatcaStatus: status === "cleared" || status === "cleared_warnings" ? "accepted" : "rejected", zatcaResponse: [...errors, ...row.warnings].join("\n") || null })
        .where(eq(s.salesInvoices.id, src.invoiceId));
    }
    return row;
  });
}

/** ما يمنع إرسال المستند الآن (بيانات العميل أو الشركة)، لعرضه بجانب زر الإرسال. */
export async function sendBlocker(db: Db, src: Source) {
  try {
    const { doc, company } = await sourceDoc(db, src);
    const b = buyerGaps(doc.buyer);
    if (b.length) return `أكمل بيانات العميل «${doc.buyer.name}» قبل الإرسال: ${b.join("، ")}`;
    const c = companyGaps(company);
    return c.length ? `أكمل بيانات الشركة: ${c.join("، ")}` : null;
  } catch (err) {
    return (err as Error).message;
  }
}

/** الإرسال التلقائي بعد الإصدار أو الترحيل: لا يُفشل العملية الأصلية، ويعيد رسالة قصيرة. */
export async function autoSubmit(db: Db, src: Source, userId?: number) {
  const st = await getSettings(db);
  if (!st?.token || !st.autoSend) return null;
  try {
    const row = await submitDocument(db, src, userId);
    return row.status === "cleared" || row.status === "cleared_warnings" ? "واعتمدتها الهيئة" : "لكن رفضتها الهيئة؛ راجع الملاحظات وأعد الإرسال";
  } catch (err) {
    return `ولم تُرسل للهيئة: ${(err as Error).message}`;
  }
}

export async function latestDocument(db: Db, src: Source) {
  const ref = "invoiceId" in src ? eq(s.zatcaDocuments.salesInvoiceId, src.invoiceId) : eq(s.zatcaDocuments.noteId, src.noteId);
  const [row] = await db.select().from(s.zatcaDocuments).where(ref).orderBy(desc(s.zatcaDocuments.id)).limit(1);
  return row ?? null;
}

/** رمز QR المعتمد (المرحلة الثانية) لكل فاتورة من قائمة، إن وُجد. */
export async function clearedQrs(db: Db, invoiceIds: number[]) {
  if (!invoiceIds.length) return new Map<number, string>();
  const rows = await db
    .select({ id: s.zatcaDocuments.salesInvoiceId, qr: s.zatcaDocuments.qr })
    .from(s.zatcaDocuments)
    .where(and(inArray(s.zatcaDocuments.salesInvoiceId, invoiceIds), inArray(s.zatcaDocuments.status, ["cleared", "cleared_warnings"]), isNotNull(s.zatcaDocuments.qr)));
  return new Map(rows.map((r) => [r.id!, r.qr!]));
}

export async function clearedQr(db: Db, invoiceId: number) {
  return (await clearedQrs(db, [invoiceId])).get(invoiceId) ?? null;
}

/** رمز QR المعتمد لإشعار عميل، إن اعتمدته الهيئة. */
export async function noteQr(db: Db, noteId: number) {
  const [row] = await db
    .select({ qr: s.zatcaDocuments.qr })
    .from(s.zatcaDocuments)
    .where(and(eq(s.zatcaDocuments.noteId, noteId), inArray(s.zatcaDocuments.status, ["cleared", "cleared_warnings"])))
    .limit(1);
  return row?.qr ?? null;
}

/** المستندات الصادرة التي لم تُعتمد بعد (للإرسال الجماعي). */
export async function pendingDocuments(db: Db) {
  const invoices = await db.execute<{ id: number; number: string; status: string | null }>(sql`
    select i.id, i.number, (select d.status from zatca_documents d where d.sales_invoice_id = i.id order by d.id desc limit 1) as status
    from sales_invoices i
    where i.status = 'issued' and i.zatca_status <> 'accepted'
    order by i.invoice_date, i.id limit 500`);
  const notes = await db.execute<{ id: number; number: string; status: string | null }>(sql`
    select n.id, n.number, (select d.status from zatca_documents d where d.note_id = n.id order by d.id desc limit 1) as status
    from adjustment_notes n
    where n.status = 'posted' and n.kind in ('sales_credit', 'sales_debit')
      and not exists (select 1 from zatca_documents d where d.note_id = n.id and d.status in ('cleared', 'cleared_warnings'))
    order by n.note_date, n.id limit 500`);
  return { invoices: [...invoices], notes: [...notes] };
}

export async function recentDocuments(db: Db, limit = 30) {
  return db
    .select({ d: s.zatcaDocuments, invoice: s.salesInvoices.number, note: s.adjustmentNotes.number })
    .from(s.zatcaDocuments)
    .leftJoin(s.salesInvoices, eq(s.salesInvoices.id, s.zatcaDocuments.salesInvoiceId))
    .leftJoin(s.adjustmentNotes, eq(s.adjustmentNotes.id, s.zatcaDocuments.noteId))
    .orderBy(desc(s.zatcaDocuments.id))
    .limit(limit);
}
