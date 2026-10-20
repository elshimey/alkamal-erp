import QRCode from "qrcode";

// رمز الاستجابة السريعة للفاتورة الضريبية (المرحلة الأولى من الفوترة الإلكترونية):
// حقول TLV بالترتيب: اسم البائع، رقمه الضريبي، وقت الفاتورة، الإجمالي شامل الضريبة، الضريبة؛ ثم Base64.
export interface ZatcaQrInput {
  sellerName: string;
  vatNumber: string;
  timestamp: string;
  total: number;
  vatTotal: number;
}

export function zatcaTlv(input: ZatcaQrInput) {
  const fields = [input.sellerName, input.vatNumber, input.timestamp, input.total.toFixed(2), input.vatTotal.toFixed(2)];
  const parts = fields.map((v, i) => {
    const value = Buffer.from(v, "utf8");
    if (value.length > 255) throw new Error("حقل رمز الفاتورة أطول من المسموح");
    return Buffer.concat([Buffer.from([i + 1, value.length]), value]);
  });
  return Buffer.concat(parts).toString("base64");
}

/** الرمز كـ SVG جاهز للعرض والطباعة. */
export async function zatcaQrSvg(input: ZatcaQrInput) {
  return QRCode.toString(zatcaTlv(input), { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#1b2126", light: "#ffffff" } });
}

/** رمز الفاتورة من بيانات المنشأة والفاتورة؛ لا رمز بلا رقم ضريبي. المبالغ بالريال دائماً. */
export async function invoiceQrSvg(
  company: { nameAr: string; vatNumber: string | null },
  i: { issuedAt: Date | null; invoiceDate: string; total: string; vatTotal: string; exchangeRate: string },
) {
  if (!company.vatNumber) return null;
  const rate = Number(i.exchangeRate);
  return zatcaQrSvg({
    sellerName: company.nameAr,
    vatNumber: company.vatNumber,
    timestamp: (i.issuedAt ?? new Date(`${i.invoiceDate}T00:00:00+03:00`)).toISOString(),
    total: Math.round(Number(i.total) * rate * 100) / 100,
    vatTotal: Math.round(Number(i.vatTotal) * rate * 100) / 100,
  });
}
