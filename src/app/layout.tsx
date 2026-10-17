import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "الكمال للنقليات – نظام الإدارة",
  description: "نظام ERP لشركة الكمال للنقليات",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
