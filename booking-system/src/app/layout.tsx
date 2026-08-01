import type { Metadata, Viewport } from "next";
import { Noto_Sans_TC, Poppins } from "next/font/google";
import "./globals.css";

// 與官網相同的字體組合；next/font 於建置時自帶字檔，
// 不會對外部字型服務發出請求（符合本站 CSP 的 default-src 'self'）
const notoSansTC = Noto_Sans_TC({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-noto-sans-tc",
  display: "swap",
});
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-poppins",
  display: "swap",
});

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
    <html lang="zh-Hant-TW" className={`${notoSansTC.variable} ${poppins.variable}`}>
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
