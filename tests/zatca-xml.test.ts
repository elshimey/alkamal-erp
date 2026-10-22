import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DOMParser } from "@xmldom/xmldom";
import { XmlCanonicalizer } from "xmldsigjs";
import { buildCsr, certificateSignature, newKeyPair } from "@/lib/zatca/der";
import { buildInvoiceXml, docTotals, GENESIS_PIH, invoiceHash, signInvoice, type ZatcaDoc } from "@/lib/zatca/xml";

const doc: ZatcaDoc = {
  kind: "invoice",
  number: "INV-2026-000001",
  uuid: "3cf5ee18-ee25-44ea-a444-2c37ba7f28be",
  icv: 1,
  pih: GENESIS_PIH,
  issueDate: "2026-10-22",
  issueTime: "14:30:00",
  supplyDate: "2026-10-22",
  currency: "SAR",
  rate: 1,
  seller: { name: "شركة الكمال للنقليات & الشحن", vatNumber: "399999999900003", crNumber: "2050197412", street: "طريق الملك فهد", buildingNo: "6701", additionalNo: "3345", district: "الفيصلية", city: "الدمام", postalCode: "32263", country: "SA" },
  buyer: { name: 'شركة "المراعي"', vatNumber: "300000000000003", street: "الصناعية", buildingNo: "1234", district: "السلي", city: "الرياض", postalCode: "12211", country: "SA" },
  lines: [
    { name: "نقل الدمام ← الرياض <40 قدم>", quantity: 2, net: 3500, vatRate: 15, category: "S" },
    { name: "نقل إلى الكويت", quantity: 1, net: 1234.56, vatRate: 0, category: "Z", exemptionCode: "VATEX-SA-34-1", exemptionReason: "The international transport of Goods" },
  ],
};

// الصيغة القانونية كما تحسبها مكتبة C14N مستقلة بعد حذف التوقيع ورمز QR
function c14nHash(xml: string) {
  const d = new DOMParser().parseFromString(xml, "text/xml");
  for (const [ns, name] of [
    ["urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2", "UBLExtensions"],
    ["urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2", "Signature"],
  ]) {
    const nodes = d.getElementsByTagNameNS(ns, name);
    for (let i = nodes.length - 1; i >= 0; i--) nodes[i].parentNode!.removeChild(nodes[i]);
  }
  const refs = d.getElementsByTagNameNS("urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2", "AdditionalDocumentReference");
  for (let i = refs.length - 1; i >= 0; i--) if (refs[i].getElementsByTagNameNS("urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2", "ID")[0]?.textContent === "QR") refs[i].parentNode!.removeChild(refs[i]);
  const canonical = new XmlCanonicalizer(false, false).Canonicalize(d as unknown as Document);
  return crypto.createHash("sha256").update(canonical, "utf8").digest("base64");
}

function selfSignedCert(keyPem: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zatca-"));
  fs.writeFileSync(path.join(dir, "k.pem"), keyPem);
  execFileSync("openssl", ["req", "-new", "-x509", "-key", "k.pem", "-out", "c.pem", "-days", "1", "-subj", "/CN=TSZEINVOICE-SubCA-1/DC=extgazt/DC=gov/DC=local"], { cwd: dir });
  return fs.readFileSync(path.join(dir, "c.pem"), "utf8");
}

describe("الفوترة الإلكترونية: ملف XML", () => {
  it("يحسب الإجماليات من صافي السطور", () => {
    const t = docTotals(doc);
    expect(t.exclusive).toBe(473456);
    expect(t.tax).toBe(52500);
    expect(t.inclusive).toBe(525956);
  });

  it("نص الفاتورة قانوني (C14N) وبصمته مطابقة لما تحسبه الهيئة", () => {
    const { xml } = buildInvoiceXml(doc);
    expect(invoiceHash(xml)).toBe(c14nHash(xml.replace("<!--UBL-EXTENSIONS-->", "").replace("<!--QR-->", "")));
  });

  it("يوقّع الفاتورة: البصمة لا تتغير بعد التوقيع، والتوقيع ورمز QR صحيحان", () => {
    const key = newKeyPair();
    const cert = selfSignedCert(key);
    const { xml } = buildInvoiceXml(doc);
    const signed = signInvoice(xml, { privateKeyPem: key, certificatePem: cert, sellerName: doc.seller.name, vatNumber: doc.seller.vatNumber!, timestamp: "2026-10-22T14:30:00", total: "5259.56", vat: "525.00" });
    expect(signed.xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<Invoice')).toBe(true);
    expect(new DOMParser().parseFromString(signed.xml, "text/xml").documentElement!.nodeName).toBe("Invoice");
    expect(c14nHash(signed.xml)).toBe(signed.hash);
    const sig = signed.xml.match(/<ds:SignatureValue>([^<]+)</)![1];
    expect(crypto.verify("sha256", Buffer.from(signed.hash, "base64"), new crypto.X509Certificate(cert).publicKey, Buffer.from(sig, "base64"))).toBe(true);
    // حقول QR التسعة بالترتيب
    const qr = Buffer.from(signed.qr, "base64");
    const tags: number[] = [];
    for (let i = 0; i < qr.length; ) {
      tags.push(qr[i]);
      let n = qr[i + 1];
      let skip = 2;
      if (n === 0x81) [n, skip] = [qr[i + 2], 3];
      else if (n === 0x82) [n, skip] = [(qr[i + 2] << 8) | qr[i + 3], 4];
      i += skip + n;
    }
    expect(tags).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(certificateSignature(Buffer.from(cert.replace(/-----[A-Z ]+-----|\s/g, ""), "base64")).length).toBeGreaterThan(60);
  });

  it("إشعار دائن يحمل رقم الفاتورة الأصلية والسبب", () => {
    const { xml } = buildInvoiceXml({ ...doc, kind: "credit", billingReference: "INV-2026-000001", reason: "خصم تجاري" });
    expect(xml).toContain('<cbc:InvoiceTypeCode name="0100000">381</cbc:InvoiceTypeCode>');
    expect(xml).toContain("<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>INV-2026-000001</cbc:ID>");
    expect(xml).toContain("<cbc:InstructionNote>خصم تجاري</cbc:InstructionNote>");
  });

  it("طلب الشهادة صحيح ويحمل قالب بيئة الاختبار", () => {
    const key = newKeyPair();
    const csr = buildCsr({ env: "sandbox", commonName: "TST-1", orgName: "الكمال", orgUnit: "الدمام", vatNumber: "399999999900003", serial: "1-A|2-B|3-C", invoiceTypes: "1000", address: "الدمام", industry: "Transport" }, key);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "csr-"));
    fs.writeFileSync(path.join(dir, "r.csr"), csr);
    const out = execFileSync("openssl", ["req", "-in", "r.csr", "-noout", "-verify", "-text"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    expect(out).toContain("TSTZATCA-Code-Signing");
    expect(out).toContain("UID=399999999900003");
  });
});
