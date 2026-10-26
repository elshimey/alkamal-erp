import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic, Readex_Pro } from "next/font/google";
import { RouteProgress } from "@/components/route-progress";
import { getBrand } from "@/lib/brand";
import "./globals.css";

// الخطوط تُحمَّل مع البرنامج نفسه (بلا طلبات خارجية عند الفتح)
const body = IBM_Plex_Sans_Arabic({ subsets: ["arabic", "latin"], weight: ["400", "500", "600", "700"], variable: "--font-body" });
const display = Readex_Pro({ subsets: ["arabic", "latin"], weight: ["500", "600", "700"], variable: "--font-heading" });

export async function generateMetadata(): Promise<Metadata> {
  const { name } = await getBrand(true);
  return {
    title: `${name} – نظام الإدارة`,
    description: "نظام إدارة النقل والحسابات",
    appleWebApp: { capable: true, title: name, statusBarStyle: "default" },
  };
}

export const viewport: Viewport = { themeColor: "#ffffff", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={`${body.variable} ${display.variable}`}>
      <body className="min-h-screen font-sans antialiased">
        <Suspense>
          <RouteProgress />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
