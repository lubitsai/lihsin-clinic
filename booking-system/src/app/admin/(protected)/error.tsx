"use client";

import { ErrorScreen } from "@/components/error-screen";

/**
 * 後台頁面出錯（最常見：帳號沒有該頁權限，例如醫師帳號開系統設定）。
 * 放在 (protected) 這一層，畫面仍保留後台導覽列，櫃檯不必重新找路。
 * 沒有這一頁時，後台錯誤會被前台的 app/error.tsx 接走，顯示給家長看的文字。
 *
 * 正式環境的 error.message 會被遮蔽，分不出是權限不足還是系統出錯，
 * 所以兩種可能一起講。
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorScreen
      title="這個頁面無法開啟"
      onRetry={reset}
      homeHref="/admin"
      homeLabel="回今日總覽"
      digest={error.digest}
    >
      <p>可能是您的帳號沒有這項權限，或系統暫時出錯。需要權限請洽管理員。</p>
    </ErrorScreen>
  );
}
