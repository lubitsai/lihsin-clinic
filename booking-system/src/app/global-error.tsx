"use client";

import "./globals.css";
import { ErrorScreen } from "@/components/error-screen";
import { CLINIC } from "@/lib/clinic-info";

/**
 * 連最外層版型（layout.tsx）都載入失敗時的備援畫面，文字與 error.tsx 相同。
 * 這時 layout 不存在，必須自己帶 <html>／<body>；字型改用系統預設。
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="zh-Hant-TW">
      <body className="min-h-screen bg-gradient-to-b from-white to-sage-50">
        <ErrorScreen
          title="頁面暫時無法顯示"
          onRetry={reset}
          homeHref="/"
          homeLabel="回預約首頁"
          digest={error.digest}
        >
          <p>
            系統忙碌中，請稍後再試，或致電立欣診所
            <a href={CLINIC.phoneHref} className="text-sage-600 font-bold underline underline-offset-2 ml-1">
              {CLINIC.phone}
            </a>
            。
          </p>
        </ErrorScreen>
      </body>
    </html>
  );
}
