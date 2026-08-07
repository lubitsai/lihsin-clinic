/**
 * 看診提醒排程腳本。
 * 現行設定（院長 2026-08-05）：**只發一次，前一日 20:00**。
 * 例（正式環境 crontab，台灣時間）：
 *   0 20 * * *  cd /app && npm run send-reminders -- day-before
 * 若日後於後台開啟「當日提醒」，再加一行 `-- same-day`（時間依系統設定）。
 * 不帶參數時兩種都檢查；當日提醒關閉時 enqueueReminders 會直接略過，
 * 且有防重複機制，不會重複發送。
 */
import { enqueueReminders, dispatchPendingNotifications } from "../src/lib/notifications";
import { todayStr, addDays } from "../src/lib/tw-time";

async function main() {
  const mode = process.argv[2]; // day-before / same-day / undefined
  let queued = 0;
  if (!mode || mode === "day-before") {
    queued += await enqueueReminders(addDays(todayStr(), 1), "REMINDER_DAY_BEFORE");
  }
  if (!mode || mode === "same-day") {
    queued += await enqueueReminders(todayStr(), "REMINDER_SAME_DAY");
  }
  const sent = await dispatchPendingNotifications(500);
  console.log(`提醒已排入 ${queued} 筆，發送 ${sent} 筆（含先前待送）。`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
