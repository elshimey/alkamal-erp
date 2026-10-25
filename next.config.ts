import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["postgres", "exceljs"],
  // ملفات الاستيراد من Excel قد تتجاوز الحد الافتراضي (1MB)
  // ملفات الترحيل تُقرأ وقت التشغيل عند إنشاء شركة جديدة من لوحة المالك
  outputFileTracingIncludes: { "/owner": ["./drizzle/**/*"], "/settings/**": ["./drizzle/**/*"] },
  experimental: { serverActions: { bodySizeLimit: "12mb" } },
  // ترويسات حماية: لا يُعرض الموقع داخل مواقع أخرى (يُسمح بالموقع نفسه لنوافذ الإضافة المضمّنة في المستندات)، ولا تتسرب روابط المشاركة لمواقع خارجية
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
