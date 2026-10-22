import type { Metadata, Viewport } from "next";
import { getBrand } from "@/lib/brand";

// هوية تطبيق السائق (تشمل صفحة الدخول)؛ الواجهة نفسها في (app)/layout
export async function generateMetadata(): Promise<Metadata> {
  const { name } = await getBrand(true);
  return {
    title: `${name} – السائق`,
    manifest: "/driver/manifest.webmanifest",
    appleWebApp: { capable: true, title: `${name} – السائق`, statusBarStyle: "black-translucent" },
    icons: { apple: "/driver/app-icon/180" },
  };
}

export const viewport: Viewport = { themeColor: "#1b2126", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function DriverRootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
