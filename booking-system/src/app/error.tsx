"use client";

import { ErrorScreen } from "@/components/error-screen";
import { CLINIC } from "@/lib/clinic-info";

/**
 * 前台頁面讀取失敗（例如資料庫暫時連不上）時的畫面。
 * 送出預約、取消、改期的錯誤不會走到這裡——那些由 server action 回傳訊息、顯示在原畫面。
 * 內文沿用已核可的 5-12「系統忙碌中…」；標題與按鈕見 docs/08 §七之六 7-6-4～7-6-6。
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-sage-50">
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
    </div>
  );
}
