import crypto from "node:crypto";
import { certificateSignature } from "./der";

// فاتورة UBL 2.1 بمواصفات الهيئة (المرحلة الثانية)، مكتوبة بصيغتها القانونية (C14N) مباشرة:
// بلا مسافات بين العناصر، وكل عنصر بوسم إغلاق، والسمات مرتبة. لذلك يكفي حذف أجزاء التوقيع
// ورمز QR من النص ثم حساب SHA-256 للحصول على بصمة الفاتورة كما تحسبها الهيئة.

export const GENESIS_PIH = "NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==";

export interface ZatcaParty {
  name: string;
  vatNumber?: string | null;
  crNumber?: string | null;
  // رقم هوية بديل للمشتري بلا رقم ضريبي (سجل تجاري CRN أو هوية وطنية NAT...)
  otherId?: { scheme: string; value: string } | null;
  street?: string | null;
  buildingNo?: string | null;
  additionalNo?: string | null;
  district?: string | null;
  city?: string | null;
  postalCode?: string | null;
  country: string;
}

export interface ZatcaLine {
  name: string;
  quantity: number;
  net: number; // صافي السطر قبل الضريبة بعملة المستند
  vatRate: number;
  category: "S" | "Z" | "E" | "O";
  exemptionCode?: string;
  exemptionReason?: string;
}

export interface ZatcaDoc {
  kind: "invoice" | "credit" | "debit";
  number: string;
  uuid: string;
  icv: number;
  pih: string;
  issueDate: string;
  issueTime: string;
  supplyDate: string;
  currency: string;
  // سعر العملة مقابل الريال لإجمالي الضريبة بالريال
  rate: number;
  billingReference?: string;
  reason?: string;
  seller: ZatcaParty;
  buyer: ZatcaParty;
  lines: ZatcaLine[];
}

const NS = {
  inv: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
  cac: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
  cbc: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
  ext: "urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2",
};

// تهريب النص بقواعد C14N: لا تُهرَّب علامات الاقتباس في النص
const text = (v: string | number) =>
  String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r/g, "&#xD;");
const attr = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;").replace(/\t/g, "&#x9;").replace(/\n/g, "&#xA;").replace(/\r/g, "&#xD;");
const el = (name: string, content: string | number, attrs: Record<string, string> = {}) => {
  const a = Object.keys(attrs)
    .sort()
    .map((k) => ` ${k}="${attr(attrs[k])}"`)
    .join("");
  return `<${name}${a}>${typeof content === "number" ? text(content) : content}</${name}>`;
};
const t = (name: string, v: string | number, attrs?: Record<string, string>) => el(name, text(v), attrs);
const opt = (name: string, v: string | null | undefined) => (v ? t(name, v) : "");

// المبالغ بالهللات لتجنب أخطاء الكسور العشرية
const h = (n: number) => Math.round(n * 100 + Number.EPSILON * Math.sign(n));
const amt = (halalas: number) => (halalas / 100).toFixed(2);

export function docTotals(doc: ZatcaDoc) {
  const lines = doc.lines.map((l) => {
    const net = h(l.net);
    const vat = Math.round((net * l.vatRate) / 100);
    return { ...l, netH: net, vatH: vat };
  });
  const groups = new Map<string, { category: ZatcaLine["category"]; rate: number; code?: string; reason?: string; taxable: number }>();
  for (const l of lines) {
    const key = `${l.category}|${l.vatRate}|${l.exemptionCode ?? ""}`;
    const g = groups.get(key) ?? { category: l.category, rate: l.vatRate, code: l.exemptionCode, reason: l.exemptionReason, taxable: 0 };
    g.taxable += l.netH;
    groups.set(key, g);
  }
  const subtotals = [...groups.values()].map((g) => ({ ...g, tax: Math.round((g.taxable * g.rate) / 100) }));
  const exclusive = lines.reduce((s, l) => s + l.netH, 0);
  const tax = subtotals.reduce((s, g) => s + g.tax, 0);
  return { lines, subtotals, exclusive, tax, inclusive: exclusive + tax };
}

function party(p: ZatcaParty, seller: boolean) {
  const ids = seller
    ? p.crNumber
      ? t("cbc:ID", p.crNumber, { schemeID: "CRN" })
      : ""
    : !p.vatNumber && p.otherId
      ? t("cbc:ID", p.otherId.value, { schemeID: p.otherId.scheme })
      : "";
  const address =
    opt("cbc:StreetName", p.street) +
    opt("cbc:BuildingNumber", p.buildingNo) +
    opt("cbc:PlotIdentification", p.additionalNo) +
    opt("cbc:CitySubdivisionName", p.district) +
    opt("cbc:CityName", p.city) +
    opt("cbc:PostalZone", p.postalCode) +
    el("cac:Country", t("cbc:IdentificationCode", p.country));
  const taxScheme = el("cac:TaxScheme", t("cbc:ID", "VAT"));
  return el(
    "cac:Party",
    (ids ? el("cac:PartyIdentification", ids) : "") +
      el("cac:PostalAddress", address) +
      el("cac:PartyTaxScheme", (p.vatNumber ? t("cbc:CompanyID", p.vatNumber) : "") + taxScheme) +
      el("cac:PartyLegalEntity", t("cbc:RegistrationName", p.name)),
  );
}

const TYPE = { invoice: "388", credit: "381", debit: "383" } as const;
const QR_PLACEHOLDER = "<!--QR-->";
const SIG_PLACEHOLDER = "<!--UBL-EXTENSIONS-->";

/** نص الفاتورة قبل التوقيع؛ مكانا التوقيع ورمز QR محجوزان بتعليقين يُستبدلان عند التوقيع. */
export function buildInvoiceXml(doc: ZatcaDoc) {
  const T = docTotals(doc);
  const cur = { currencyID: doc.currency };
  const sar = { currencyID: "SAR" };
  // الفئة في ملخص الضريبة تحمل سبب الإعفاء أو النسبة الصفرية، وفي السطر بدونه
  const category = (c: { category: string; rate: number; code?: string; reason?: string }, withReason: boolean) =>
    t("cbc:ID", c.category, { schemeAgencyID: "6", schemeID: "UN/ECE 5305" }) +
    t("cbc:Percent", c.rate.toFixed(2)) +
    (withReason && c.category !== "S" && c.code ? t("cbc:TaxExemptionReasonCode", c.code) + t("cbc:TaxExemptionReason", c.reason ?? "") : "") +
    el("cac:TaxScheme", t("cbc:ID", "VAT", { schemeAgencyID: "6", schemeID: "UN/ECE 5153" }));
  const body =
    SIG_PLACEHOLDER +
    t("cbc:ProfileID", "reporting:1.0") +
    t("cbc:ID", doc.number) +
    t("cbc:UUID", doc.uuid) +
    t("cbc:IssueDate", doc.issueDate) +
    t("cbc:IssueTime", doc.issueTime) +
    t("cbc:InvoiceTypeCode", TYPE[doc.kind], { name: "0100000" }) +
    t("cbc:DocumentCurrencyCode", doc.currency) +
    t("cbc:TaxCurrencyCode", "SAR") +
    (doc.billingReference ? el("cac:BillingReference", el("cac:InvoiceDocumentReference", t("cbc:ID", doc.billingReference))) : "") +
    el("cac:AdditionalDocumentReference", t("cbc:ID", "ICV") + t("cbc:UUID", doc.icv)) +
    el("cac:AdditionalDocumentReference", t("cbc:ID", "PIH") + el("cac:Attachment", t("cbc:EmbeddedDocumentBinaryObject", doc.pih, { mimeCode: "text/plain" }))) +
    QR_PLACEHOLDER +
    el("cac:Signature", t("cbc:ID", "urn:oasis:names:specification:ubl:signature:Invoice") + t("cbc:SignatureMethod", "urn:oasis:names:specification:ubl:dsig:enveloped:xades")) +
    el("cac:AccountingSupplierParty", party(doc.seller, true)) +
    el("cac:AccountingCustomerParty", party(doc.buyer, false)) +
    el("cac:Delivery", t("cbc:ActualDeliveryDate", doc.supplyDate)) +
    el("cac:PaymentMeans", t("cbc:PaymentMeansCode", "30") + (doc.kind !== "invoice" ? t("cbc:InstructionNote", doc.reason || "تعديل الفاتورة") : "")) +
    el(
      "cac:TaxTotal",
      t("cbc:TaxAmount", amt(T.tax), cur) +
        T.subtotals.map((g) => el("cac:TaxSubtotal", t("cbc:TaxableAmount", amt(g.taxable), cur) + t("cbc:TaxAmount", amt(g.tax), cur) + el("cac:TaxCategory", category(g, true)))).join(""),
    ) +
    el("cac:TaxTotal", t("cbc:TaxAmount", amt(Math.round(T.tax * doc.rate)), sar)) +
    el(
      "cac:LegalMonetaryTotal",
      t("cbc:LineExtensionAmount", amt(T.exclusive), cur) +
        t("cbc:TaxExclusiveAmount", amt(T.exclusive), cur) +
        t("cbc:TaxInclusiveAmount", amt(T.inclusive), cur) +
        t("cbc:AllowanceTotalAmount", "0.00", cur) +
        t("cbc:PrepaidAmount", "0.00", cur) +
        t("cbc:PayableAmount", amt(T.inclusive), cur),
    ) +
    T.lines
      .map((l, i) => {
        // السعر = صافي السطر لكمية الأساس نفسها، فيتطابق الحساب دون كسور
        const qty = l.quantity > 0 ? l.quantity : 1;
        return el(
          "cac:InvoiceLine",
          t("cbc:ID", i + 1) +
            t("cbc:InvoicedQuantity", String(qty), { unitCode: "PCE" }) +
            t("cbc:LineExtensionAmount", amt(l.netH), cur) +
            el("cac:TaxTotal", t("cbc:TaxAmount", amt(l.vatH), cur) + t("cbc:RoundingAmount", amt(l.netH + l.vatH), cur)) +
            el("cac:Item", t("cbc:Name", l.name) + el("cac:ClassifiedTaxCategory", category({ category: l.category, rate: l.vatRate }, false))) +
            el("cac:Price", t("cbc:PriceAmount", amt(l.netH), cur) + t("cbc:BaseQuantity", String(qty), { unitCode: "PCE" })),
        );
      })
      .join("");
  return { xml: el("Invoice", body, { xmlns: NS.inv, "xmlns:cac": NS.cac, "xmlns:cbc": NS.cbc, "xmlns:ext": NS.ext }), totals: T };
}

/** بصمة الفاتورة: SHA-256 لنصها القانوني بدون امتدادات التوقيع وعنصر cac:Signature ورمز QR، بترميز Base64. */
export function invoiceHash(unsignedXml: string) {
  const pure = unsignedXml.replace(SIG_PLACEHOLDER, "").replace(QR_PLACEHOLDER, "").replace(/<cac:Signature>.*?<\/cac:Signature>/, "");
  return crypto.createHash("sha256").update(pure, "utf8").digest("base64");
}

// ─────────── التوقيع ───────────

const pemBody = (pem: string) => pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s/g, "");
const hexB64 = (s: string) => Buffer.from(crypto.createHash("sha256").update(s, "utf8").digest("hex"), "utf8").toString("base64");

function tlvQr(fields: (string | Buffer)[]) {
  return Buffer.concat(
    fields.map((f, i) => {
      const v = typeof f === "string" ? Buffer.from(f, "utf8") : f;
      const length = v.length < 128 ? Buffer.from([v.length]) : v.length < 256 ? Buffer.from([0x81, v.length]) : Buffer.from([0x82, v.length >> 8, v.length & 0xff]);
      return Buffer.concat([Buffer.from([i + 1]), length, v]);
    }),
  ).toString("base64");
}

export interface SignResult {
  xml: string;
  hash: string;
  qr: string;
}

/**
 * يوقّع الفاتورة: بصمة الفاتورة تُوقَّع بمفتاح الجهاز (ECDSA-SHA256)، وتُبنى خصائص التوقيع (XAdES)
 * ببصمة الشهادة والجهة المُصدرة ورقمها التسلسلي، ثم رمز QR بالحقول التسعة.
 */
export function signInvoice(unsignedXml: string, opts: { privateKeyPem: string; certificatePem: string; sellerName: string; vatNumber: string; timestamp: string; total: string; vat: string; signingTime?: Date }): SignResult {
  const hash = invoiceHash(unsignedXml);
  const certB64 = pemBody(opts.certificatePem);
  const cert = new crypto.X509Certificate(opts.certificatePem);
  const signature = crypto.sign("sha256", Buffer.from(hash, "base64"), crypto.createPrivateKey(opts.privateKeyPem)).toString("base64");
  const signingTime = (opts.signingTime ?? new Date()).toISOString().slice(0, 19);
  const issuer = cert.issuer.split("\n").reverse().join(", ");
  const serial = BigInt(`0x${cert.serialNumber}`).toString(10);
  const ds = "http://www.w3.org/2000/09/xmldsig#";
  const sha256 = "http://www.w3.org/2001/04/xmlenc#sha256";
  const xadesNs = "http://uri.etsi.org/01903/v1.3.2#";
  const props = (dsDecl: string, emptyClose: (n: string, a: string) => string) =>
    `<xades:SignedSignatureProperties><xades:SigningTime>${signingTime}</xades:SigningTime><xades:SigningCertificate><xades:Cert><xades:CertDigest>${emptyClose("ds:DigestMethod", `${dsDecl} Algorithm="${sha256}"`)}<ds:DigestValue${dsDecl}>${hexB64(certB64)}</ds:DigestValue></xades:CertDigest><xades:IssuerSerial><ds:X509IssuerName${dsDecl}>${text(issuer)}</ds:X509IssuerName><ds:X509SerialNumber${dsDecl}>${serial}</ds:X509SerialNumber></xades:IssuerSerial></xades:Cert></xades:SigningCertificate></xades:SignedSignatureProperties>`;
  // بصمة الخصائص تُحسب على الصيغة التي تحسبها أداة الهيئة: تعريف ds على كل عنصر
  const propsDigest = hexB64(`<xades:SignedProperties xmlns:xades="${xadesNs}" Id="xadesSignedProperties">${props(` xmlns:ds="${ds}"`, (n, a) => `<${n}${a}/>`)}</xades:SignedProperties>`);
  const signedProps = `<xades:SignedProperties Id="xadesSignedProperties">${props("", (n, a) => `<${n}${a}></${n}>`)}</xades:SignedProperties>`;
  const xpath = (x: string) => `<ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116"><ds:XPath>${x}</ds:XPath></ds:Transform>`;
  const signedInfo =
    `<ds:SignedInfo><ds:CanonicalizationMethod Algorithm="http://www.w3.org/2006/12/xml-c14n11"></ds:CanonicalizationMethod><ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256"></ds:SignatureMethod>` +
    `<ds:Reference Id="invoiceSignedData" URI=""><ds:Transforms>${xpath("not(//ancestor-or-self::ext:UBLExtensions)")}${xpath("not(//ancestor-or-self::cac:Signature)")}${xpath("not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])")}<ds:Transform Algorithm="http://www.w3.org/2006/12/xml-c14n11"></ds:Transform></ds:Transforms><ds:DigestMethod Algorithm="${sha256}"></ds:DigestMethod><ds:DigestValue>${hash}</ds:DigestValue></ds:Reference>` +
    `<ds:Reference Type="http://www.w3.org/2000/09/xmldsig#SignatureProperties" URI="#xadesSignedProperties"><ds:DigestMethod Algorithm="${sha256}"></ds:DigestMethod><ds:DigestValue>${propsDigest}</ds:DigestValue></ds:Reference></ds:SignedInfo>`;
  const extensions =
    `<ext:UBLExtensions><ext:UBLExtension><ext:ExtensionURI>urn:oasis:names:specification:ubl:dsig:enveloped:xades</ext:ExtensionURI><ext:ExtensionContent>` +
    `<sig:UBLDocumentSignatures xmlns:sac="urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2" xmlns:sbc="urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2" xmlns:sig="urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2"><sac:SignatureInformation><cbc:ID>urn:oasis:names:specification:ubl:signature:1</cbc:ID><sbc:ReferencedSignatureID>urn:oasis:names:specification:ubl:signature:Invoice</sbc:ReferencedSignatureID>` +
    `<ds:Signature xmlns:ds="${ds}" Id="signature">${signedInfo}<ds:SignatureValue>${signature}</ds:SignatureValue><ds:KeyInfo><ds:X509Data><ds:X509Certificate>${certB64}</ds:X509Certificate></ds:X509Data></ds:KeyInfo><ds:Object><xades:QualifyingProperties xmlns:xades="${xadesNs}" Target="signature">${signedProps}</xades:QualifyingProperties></ds:Object></ds:Signature>` +
    `</sac:SignatureInformation></sig:UBLDocumentSignatures></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions>`;
  const publicKey = cert.publicKey.export({ type: "spki", format: "der" });
  const qr = tlvQr([opts.sellerName, opts.vatNumber, opts.timestamp, opts.total, opts.vat, hash, signature, Buffer.from(publicKey), certificateSignature(Buffer.from(certB64, "base64"))]);
  const qrEl = el("cac:AdditionalDocumentReference", t("cbc:ID", "QR") + el("cac:Attachment", t("cbc:EmbeddedDocumentBinaryObject", qr, { mimeCode: "text/plain" })));
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n${unsignedXml.replace(SIG_PLACEHOLDER, extensions).replace(QR_PLACEHOLDER, qrEl)}`;
  return { xml, hash, qr };
}

/** رمز QR من فاتورة معتمدة أعادتها الهيئة (تضع رمزها هي في الفاتورة الضريبية بعد الاعتماد). */
export function qrFromXml(xml: string) {
  return xml.match(/<cbc:ID>QR<\/cbc:ID>\s*<cac:Attachment>\s*<cbc:EmbeddedDocumentBinaryObject[^>]*>([^<]+)</)?.[1] ?? null;
}
