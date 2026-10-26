import type { MetadataRoute } from "next";
import { getBrand } from "@/lib/brand";

// يجعل البرنامج قابلاً للتثبيت كتطبيق بأيقونته (أندرويد وكروم)؛ تطبيق السائق له ملفه الخاص
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const { name } = await getBrand(true);
  return {
    name,
    short_name: name.slice(0, 30),
    start_url: "/",
    display: "standalone",
    dir: "rtl",
    lang: "ar",
    background_color: "#f3f1eb",
    theme_color: "#1b2126",
    icons: [192, 512].map((size) => ({ src: `/driver/app-icon/${size}`, sizes: `${size}x${size}`, type: "image/png" })),
  };
}
