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

const DESCRIPTION =
  "立欣診所 LI HSIN CLINIC 線上預約系統：台南北區兒科、家庭醫學、疫苗接種及特別門診。";

export const metadata: Metadata = {
  // 有 APP_BASE_URL 才給 metadataBase，og:image 才會是絕對網址（LINE 需要）
  ...(process.env.APP_BASE_URL ? { metadataBase: new URL(process.env.APP_BASE_URL) } : {}),
  title: { default: "立欣診所線上預約", template: "%s｜立欣診所線上預約" },
  description: DESCRIPTION,
  robots: { index: false }, // 預約系統不需被搜尋引擎索引，避免干擾官網 SEO
  // 家長多半是從 LINE 收到預約連結，貼上時顯示的就是這張封面圖（院長 2026-08-07 提供）。
  // robots noindex 不影響這裡——那是給搜尋引擎的，分享預覽走的是另一套。
  openGraph: {
    type: "website",
    siteName: "立欣診所 LI HSIN CLINIC",
    title: "立欣診所線上預約",
    description: DESCRIPTION,
    locale: "zh_TW",
    images: [
      {
        url: "/cover.jpg", // LINE 對 webp 支援不一，分享圖固定用 jpg
        width: 1200,
        height: 630,
        alt: "立欣診所 LI HSIN CLINIC：安心預約，溫暖照護",
      },
    ],
  },
  twitter: { card: "summary_large_image" },
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
