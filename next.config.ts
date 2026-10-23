import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["postgres", "exceljs"],
  // ملفات الاستيراد من Excel قد تتجاوز الحد الافتراضي (1MB)
  // ملفات الترحيل تُقرأ وقت التشغيل عند إنشاء شركة جديدة من لوحة المالك
  outputFileTracingIncludes: { "/owner": ["./drizzle/**/*"], "/settings/**": ["./drizzle/**/*"] },
  experimental: { serverActions: { bodySizeLimit: "12mb" } },
  // ترويسات حماية: لا يُعرض الموقع داخل مواقع أخرى، ولا تتسرب روابط المشاركة لمواقع خارجية
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
