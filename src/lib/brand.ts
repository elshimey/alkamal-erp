import "server-only";
import { createHash } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { db } from "@/db";
import { tenantFromCookies } from "@/db/tenant";
import { getCompany } from "@/lib/company";

// هوية الشركة الحالية (اسمها وشعارها من بيانات المنشأة) لتظهر في القائمة والدخول وتطبيق السائق.
// قبل أن يُعرف أي شركة (جهاز جديد في صفحة الدخول) يظهر اسم البرنامج العام.
export const PRODUCT_NAME = "نظام إدارة النقل والحسابات";

/**
 * رابط الشعار بدل نصه المضمّن (نحو 90 كيلوبايت كانت تُرسل مع كل صفحة): يُحمَّل من /brand-logo مرة
 * ويبقى في المتصفح، ورقم النسخة يتغير مع تغيير الشعار فيظهر الجديد فوراً.
 * المستندات المطبوعة والروابط العامة تبقى بالنص المضمّن (getCompany) لأنها تُفتح دون دخول.
 */
export function logoUrl(logo: string | null): string | null {
  return logo ? `/brand-logo?v=${createHash("sha1").update(logo).digest("hex").slice(0, 12)}` : null;
}

export interface Brand {
  name: string;
  logo: string | null;
  known: boolean;
}

export const getBrand = cache(async (anonymous = false): Promise<Brand> => {
  if (anonymous && !tenantFromCookies(await cookies())) return { name: PRODUCT_NAME, logo: null, known: false };
  try {
    const c = await getCompany(db);
    return { name: c.nameAr, logo: logoUrl(c.logo), known: true };
  } catch {
    return { name: PRODUCT_NAME, logo: null, known: false };
  }
});
