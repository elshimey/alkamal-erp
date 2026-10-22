import type { ZatcaEnv } from "./der";

// بوابة «فاتورة»: بيئة المطورين (اختبار مفتوح برمز ثابت)، والمحاكاة، والإنتاج.
const BASE: Record<ZatcaEnv, string> = {
  sandbox: "https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal",
  simulation: "https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation",
  production: "https://gw-fatoora.zatca.gov.sa/e-invoicing/core",
};
export const SANDBOX_OTP = "123345";

export interface Credentials {
  token: string;
  secret: string;
}
export interface ValidationResults {
  status?: string;
  infoMessages?: Message[];
  warningMessages?: Message[];
  errorMessages?: Message[];
}
export interface Message {
  code?: string;
  category?: string;
  message?: string;
}
export interface SubmitResponse {
  httpStatus: number;
  validationResults?: ValidationResults;
  clearanceStatus?: string;
  reportingStatus?: string;
  clearedInvoice?: string;
  raw: string;
}

async function call(env: ZatcaEnv, path: string, body: unknown, headers: Record<string, string>) {
  let res: Response;
  try {
    // ZATCA_BASE_URL لتجربة محلية على خادم محاكٍ فقط
    res = await fetch((process.env.ZATCA_BASE_URL || BASE[env]) + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "Accept-Version": "V2", "Accept-Language": "en", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new Error(`تعذر الاتصال ببوابة فاتورة: ${(err as Error).message}`);
  }
  const raw = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    // بعض الأخطاء تعود نصاً
  }
  return { status: res.status, json, raw };
}

const basic = (c: Credentials) => ({ Authorization: `Basic ${Buffer.from(`${c.token}:${c.secret}`).toString("base64")}` });

/** الشهادة التي تعيدها الهيئة مرمزة Base64 مرتين؛ نعيدها بصيغة PEM. */
export function tokenToPem(token: string) {
  const body = Buffer.from(token, "base64").toString("utf8").replace(/\s/g, "");
  return `-----BEGIN CERTIFICATE-----\n${body.match(/.{1,64}/g)!.join("\n")}\n-----END CERTIFICATE-----\n`;
}

function csidResult(r: Awaited<ReturnType<typeof call>>, step: string) {
  const j = r.json as { requestID?: number | string; binarySecurityToken?: string; secret?: string; errors?: unknown; message?: string };
  if (r.status >= 300 || !j.binarySecurityToken || !j.secret) {
    throw new Error(`${step}: رفضت الهيئة الطلب (${r.status}) ${describeError(r.json, r.raw)}`);
  }
  return { requestId: String(j.requestID ?? ""), token: j.binarySecurityToken, secret: j.secret };
}

function describeError(json: Record<string, unknown>, raw: string) {
  const v = json.validationResults as ValidationResults | undefined;
  const msgs = [...(v?.errorMessages ?? []), ...((json.errors as Message[] | undefined) ?? [])].map((m) => m.message).filter(Boolean);
  if (msgs.length) return msgs.join(" · ");
  if (typeof json.message === "string") return json.message;
  return raw.slice(0, 300);
}

/** شهادة الامتثال المؤقتة من طلب الشهادة ورمز التفعيل (OTP) من بوابة فاتورة. */
export async function requestComplianceCsid(env: ZatcaEnv, csrPem: string, otp: string) {
  const r = await call(env, "/compliance", { csr: Buffer.from(csrPem).toString("base64") }, { OTP: otp });
  return csidResult(r, "شهادة الامتثال");
}

export async function requestProductionCsid(env: ZatcaEnv, creds: Credentials, complianceRequestId: string) {
  const r = await call(env, "/production/csids", { compliance_request_id: complianceRequestId }, basic(creds));
  return csidResult(r, "شهادة الإنتاج");
}

function submitResult(r: Awaited<ReturnType<typeof call>>): SubmitResponse {
  const j = r.json as Partial<SubmitResponse>;
  return { httpStatus: r.status, validationResults: j.validationResults, clearanceStatus: j.clearanceStatus, reportingStatus: j.reportingStatus, clearedInvoice: j.clearedInvoice, raw: r.raw.slice(0, 20000) };
}

export interface SubmitBody {
  invoiceHash: string;
  uuid: string;
  invoice: string; // XML بترميز Base64
}

/** فحص الامتثال: نماذج تُرسل قبل إصدار شهادة الإنتاج. */
export async function complianceCheck(env: ZatcaEnv, creds: Credentials, body: SubmitBody) {
  return submitResult(await call(env, "/compliance/invoices", body, basic(creds)));
}

/** اعتماد (Clearance) الفاتورة الضريبية قبل تسليمها للعميل. */
export async function clearInvoice(env: ZatcaEnv, creds: Credentials, body: SubmitBody) {
  return submitResult(await call(env, "/invoices/clearance/single", body, { ...basic(creds), "Clearance-Status": "1" }));
}

export const messages = (v: ValidationResults | undefined, kind: "errorMessages" | "warningMessages") => (v?.[kind] ?? []).map((m) => `${m.code ? `${m.code}: ` : ""}${m.message ?? ""}`);
