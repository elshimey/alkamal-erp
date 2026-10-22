import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["postgres", "exceljs"],
  // ملفات الاستيراد من Excel قد تتجاوز الحد الافتراضي (1MB)
  // ملفات الترحيل تُقرأ وقت التشغيل عند إنشاء شركة جديدة من لوحة المالك
  outputFileTracingIncludes: { "/owner": ["./drizzle/**/*"], "/settings/**": ["./drizzle/**/*"] },
  experimental: { serverActions: { bodySizeLimit: "12mb" } },
};

export default nextConfig;
