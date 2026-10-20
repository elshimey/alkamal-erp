import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["postgres", "exceljs"],
  // ملفات الاستيراد من Excel قد تتجاوز الحد الافتراضي (1MB)
  experimental: { serverActions: { bodySizeLimit: "12mb" } },
};

export default nextConfig;
