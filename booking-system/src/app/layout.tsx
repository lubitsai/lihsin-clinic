import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "立欣診所線上預約", template: "%s｜立欣診所線上預約" },
  description:
    "立欣診所 LI HSIN CLINIC 線上預約系統：台南北區兒科、家庭醫學、疫苗接種及特別門診。",
  robots: { index: false }, // 預約系統不需被搜尋引擎索引，避免干擾官網 SEO
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant-TW">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
