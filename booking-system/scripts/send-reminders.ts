/**
 * 看診提醒排程腳本：由 cron 每日執行兩次（時間依系統設定）。
 * 例（正式環境 crontab，台灣時間）：
 *   0 19 * * *  cd /app && npm run send-reminders -- day-before
 *   0 8  * * *  cd /app && npm run send-reminders -- same-day
 * 不帶參數時：兩種提醒都檢查（適合每小時跑一次的簡易設定，
 * enqueueReminders 有防重複，不會重複發送）。
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
