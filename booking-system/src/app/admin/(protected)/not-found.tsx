import { ErrorScreen } from "@/components/error-screen";

/**
 * 後台查無資料（例：病人頁的 id 不存在）。保留後台導覽列；
 * 不設這頁的話會落到前台的「找不到這個頁面／回預約首頁」。
 */
export default function AdminNotFound() {
  return (
    <ErrorScreen title="找不到這筆資料" homeHref="/admin" homeLabel="回今日總覽">
      <p>這筆資料可能已經刪除，或網址有誤。</p>
    </ErrorScreen>
  );
}
