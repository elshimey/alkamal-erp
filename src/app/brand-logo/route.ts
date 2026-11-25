import { db } from "@/db";
import { getCompany } from "@/lib/company";

/** شعار الشركة الحالية (نفس قاعدة getBrand) ملفاً يحفظه المتصفح (الرابط يحمل رقم نسخته من getBrand، فيُحفظ سنة دون إعادة طلب). */
export async function GET() {
  const logo = (await getCompany(db)).logo;
  const m = logo?.match(/^data:(image\/(?:png|jpeg|webp|svg\+xml));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return new Response("Not found", { status: 404 });
  const body = Buffer.from(m[2], "base64");
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": m[1],
      "Content-Length": String(body.length),
      "Cache-Control": "private, max-age=31536000, immutable",
      // شعار SVG يُفتح مباشرة: لا سكربت ولا مصادر خارجية
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
