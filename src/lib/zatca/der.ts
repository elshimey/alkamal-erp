import crypto from "node:crypto";

// ترميز وقراءة ASN.1 DER بالحد الأدنى اللازم لطلب الشهادة (CSR) وقراءة شهادة الهيئة.

const len = (n: number) => {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
};
export const tlv = (tag: number, ...content: Buffer[]) => {
  const body = Buffer.concat(content);
  return Buffer.concat([Buffer.from([tag]), len(body.length), body]);
};
export const seq = (...c: Buffer[]) => tlv(0x30, ...c);
export const set = (...c: Buffer[]) => tlv(0x31, ...c);
export const utf8 = (s: string) => tlv(0x0c, Buffer.from(s, "utf8"));
export const printable = (s: string) => tlv(0x13, Buffer.from(s, "ascii"));
export const octets = (b: Buffer) => tlv(0x04, b);
export const bitString = (b: Buffer) => tlv(0x03, Buffer.from([0]), b);
export const int0 = () => tlv(0x02, Buffer.from([0]));

export function oid(dotted: string) {
  const parts = dotted.split(".").map(Number);
  const out = [parts[0] * 40 + parts[1]];
  for (const p of parts.slice(2)) {
    const chunk: number[] = [p & 0x7f];
    for (let v = p >> 7; v > 0; v >>= 7) chunk.unshift((v & 0x7f) | 0x80);
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
}

interface Node {
  tag: number;
  start: number;
  header: number;
  length: number;
  end: number;
}
function read(buf: Buffer, at: number): Node {
  const tag = buf[at];
  let length = buf[at + 1];
  let header = 2;
  if (length & 0x80) {
    const n = length & 0x7f;
    length = 0;
    for (let i = 0; i < n; i++) length = (length << 8) | buf[at + 2 + i];
    header += n;
  }
  return { tag, start: at, header, length, end: at + header + length };
}
function children(buf: Buffer, node: Node) {
  const out: Node[] = [];
  for (let at = node.start + node.header; at < node.end; ) {
    const c = read(buf, at);
    out.push(c);
    at = c.end;
  }
  return out;
}

/** توقيع الجهة المُصدرة داخل الشهادة (بلا بايت البتات غير المستخدمة): الحقل 9 في رمز المرحلة الثانية. */
export function certificateSignature(certDer: Buffer) {
  const [, , sig] = children(certDer, read(certDer, 0));
  return certDer.subarray(sig.start + sig.header + 1, sig.end);
}

// ─────────── طلب الشهادة (CSR) بمواصفات الهيئة ───────────

export type ZatcaEnv = "sandbox" | "simulation" | "production";
const TEMPLATE: Record<ZatcaEnv, string> = { sandbox: "TSTZATCA-Code-Signing", simulation: "PREZATCA-Code-Signing", production: "ZATCA-Code-Signing" };

export interface CsrInput {
  env: ZatcaEnv;
  commonName: string;
  orgName: string;
  orgUnit: string;
  vatNumber: string;
  serial: string; // 1-الحل|2-الإصدار|3-الرقم
  invoiceTypes: string; // 1000 = فواتير ضريبية فقط، 1100 = ومبسطة
  address: string;
  industry: string;
}

/** مفتاح secp256k1 جديد بصيغة PEM (كما تشترط الهيئة). */
export function newKeyPair() {
  const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "secp256k1" });
  return privateKey.export({ type: "sec1", format: "pem" }).toString();
}

export function buildCsr(input: CsrInput, privateKeyPem: string) {
  const key = crypto.createPrivateKey(privateKeyPem);
  const spki = crypto.createPublicKey(key).export({ type: "spki", format: "der" });
  const rdn = (o: string, v: Buffer) => set(seq(oid(o), v));
  const subject = seq(rdn("2.5.4.6", printable("SA")), rdn("2.5.4.11", utf8(input.orgUnit)), rdn("2.5.4.10", utf8(input.orgName)), rdn("2.5.4.3", utf8(input.commonName)));
  const dirName = seq(
    rdn("2.5.4.4", utf8(input.serial)),
    rdn("0.9.2342.19200300.100.1.1", utf8(input.vatNumber)),
    rdn("2.5.4.12", utf8(input.invoiceTypes)),
    rdn("2.5.4.26", utf8(input.address)),
    rdn("2.5.4.15", utf8(input.industry)),
  );
  const extensions = seq(
    seq(oid("1.3.6.1.4.1.311.20.2"), octets(utf8(TEMPLATE[input.env]))),
    seq(oid("2.5.29.17"), octets(seq(tlv(0xa4, dirName)))),
  );
  const attributes = tlv(0xa0, seq(oid("1.2.840.113549.1.9.14"), set(extensions)));
  const info = seq(int0(), subject, Buffer.from(spki), attributes);
  const signature = crypto.sign("sha256", info, key);
  const der = seq(info, seq(oid("1.2.840.10045.4.3.2")), bitString(signature));
  return `-----BEGIN CERTIFICATE REQUEST-----\n${der.toString("base64").match(/.{1,64}/g)!.join("\n")}\n-----END CERTIFICATE REQUEST-----\n`;
}
