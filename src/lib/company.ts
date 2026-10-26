import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import * as s from "@/db/schema";
import { normalizeTemplate, validateTemplate, type InvoiceTemplate } from "@/lib/invoice-template";

export type CompanyProfile = typeof s.companyProfile.$inferSelect;
export const DEFAULT_COMPANY_NAME = "الكمال للنقليات";
export const LOGO_MAX_BYTES = 300 * 1024;

/** بيانات المنشأة؛ قبل حفظها أول مرة يُعاد الاسم الافتراضي فقط. */
export async function getCompany(db: Db): Promise<CompanyProfile> {
  const [row] = await db.select().from(s.companyProfile).where(eq(s.companyProfile.id, 1));
  return (
    row ?? {
      id: 1,
      nameAr: DEFAULT_COMPANY_NAME,
      nameEn: null,
      vatNumber: null,
      crNumber: null,
      buildingNo: null,
      street: null,
      district: null,
      city: null,
      postalCode: null,
      additionalNo: null,
      country: "SA",
      phone: null,
      email: null,
      website: null,
      logo: null,
      updatedBy: null,
      updatedAt: new Date(0),
    }
  );
}

export type CompanyInput = Omit<CompanyProfile, "id" | "updatedBy" | "updatedAt" | "country" | "transportLicenseNo" | "establishmentNo"> &
  Partial<Pick<CompanyProfile, "transportLicenseNo" | "establishmentNo">>;

const digits = (v: string | null, n: number, label: string) => {
  if (v && !new RegExp(`^\\d{${n}}$`).test(v)) throw new Error(`${label} يجب أن يكون ${n} أرقام`);
};

/** تحقق بقواعد هيئة الزكاة: الرقم الضريبي 15 رقماً يبدأ وينتهي بـ 3، والعنوان الوطني بأرقامه. */
export function validateCompany(i: CompanyInput) {
  if (!i.nameAr.trim()) throw new Error("اسم المنشأة إلزامي");
  if (i.vatNumber && !/^3\d{13}3$/.test(i.vatNumber)) throw new Error("الرقم الضريبي 15 رقماً يبدأ بـ 3 وينتهي بـ 3");
  digits(i.crNumber, 10, "السجل التجاري");
  digits(i.buildingNo, 4, "رقم المبنى");
  digits(i.postalCode, 5, "الرمز البريدي");
  digits(i.additionalNo, 4, "الرقم الإضافي");
  if (i.establishmentNo && !/^7\d{9}$/.test(i.establishmentNo)) throw new Error("الرقم الموحد للمنشأة 10 أرقام يبدأ بـ 7");
  if (i.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(i.email)) throw new Error("البريد الإلكتروني غير صحيح");
  if (i.logo) {
    const m = i.logo.match(/^data:image\/(png|jpeg|webp|svg\+xml);base64,([A-Za-z0-9+/=]+)$/);
    if (!m) throw new Error("الشعار يجب أن يكون صورة PNG أو JPG أو WebP أو SVG");
    if ((m[2].length * 3) / 4 > LOGO_MAX_BYTES) throw new Error("حجم الشعار أكبر من 300 كيلوبايت");
  }
}

export async function saveCompany(db: Db, input: CompanyInput, userId?: number) {
  validateCompany(input);
  const values = { ...input, nameAr: input.nameAr.trim(), updatedBy: userId ?? null, updatedAt: new Date() };
  const [row] = await db
    .insert(s.companyProfile)
    .values({ id: 1, ...values })
    .onConflictDoUpdate({ target: s.companyProfile.id, set: values })
    .returning();
  return row;
}

/** نسبة اكتمال البيانات التي تحتاجها الفاتورة الضريبية. */
export function invoiceReadiness(c: CompanyProfile) {
  const need: [string, unknown][] = [
    ["الرقم الضريبي", c.vatNumber],
    ["السجل التجاري", c.crNumber],
    ["رقم المبنى", c.buildingNo],
    ["الشارع", c.street],
    ["الحي", c.district],
    ["المدينة", c.city],
    ["الرمز البريدي", c.postalCode],
    ["الشعار", c.logo],
  ];
  const missing = need.filter(([, v]) => !v).map(([k]) => k);
  return { missing, percent: Math.round(((need.length - missing.length) / need.length) * 100) };
}

export async function getInvoiceTemplate(db: Db): Promise<InvoiceTemplate> {
  const [row] = await db.select().from(s.invoiceTemplate).where(eq(s.invoiceTemplate.id, 1));
  return normalizeTemplate(row?.options);
}

export async function saveInvoiceTemplate(db: Db, raw: unknown, userId?: number) {
  const options = normalizeTemplate(raw);
  validateTemplate(options);
  const values = { options, updatedBy: userId ?? null, updatedAt: new Date() };
  await db.insert(s.invoiceTemplate).values({ id: 1, ...values }).onConflictDoUpdate({ target: s.invoiceTemplate.id, set: values });
  return options;
}
