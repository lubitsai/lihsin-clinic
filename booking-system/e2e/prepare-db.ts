/**
 * 重建 E2E 資料庫並灌入示範資料。
 *
 * 為什麼由 playwright.config.ts 在載入時直接呼叫，而不是用 globalSetup：
 * Playwright 會**先啟動 webServer、再跑 globalSetup**，資料庫那時還不存在，
 * 首頁會 500、健康檢查等到逾時。設定檔載入時做完，伺服器一起來就有資料。
 *
 * 每次重建而不是沿用：測試會取消預約、標記未到、改班表，跑第二次起點就不同，
 * 於是「昨天過、今天不過」而程式其實沒變。每次從同一個起點開始才有意義。
 */
import { execSync } from "node:child_process";

export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5433/lihsin_booking_e2e";

/**
 * 測試環境的應用程式設定。**灌資料的子行程與 webServer 共用同一份**——
 * 少給任何一項都會壞在很難看懂的地方：例如缺 PII_HASH_KEY 時，
 * 示範資料的每一筆預約都會被靜靜略過（seed 仍以 0 收場、不報錯），
 * 後台測試就變成「找不到王小明」，看起來像畫面壞了而不是資料沒灌進去。
 *
 * 不從 `.env` 讀：那個檔不入版控，換一台機器或重建容器就沒了，
 * 而測試不該依賴一個看不見、也不保證存在的檔案。
 */
export const E2E_APP_ENV = {
  SESSION_SECRET: "e2e-session-secret-0123456789abcdef",
  PII_ENCRYPTION_KEY: "e2e-encryption-key-0123456789abcdef0123456789",
  PII_HASH_KEY: "e2e-hash-key-0123456789abcdef",
  // 前台身分只剩 LINE Login，CI 連不到 LINE：用替身登入、推播只印不送
  LINE_LOGIN_DEV_STUB: "1",
  LINE_MESSAGING_DRY_RUN: "1",
  TZ: "Asia/Taipei",
} as const;

export function prepareE2eDatabase() {
  // Playwright 會在主行程與每個 worker 各載入一次設定檔。只重建一次，
  // 否則 worker 啟動時會把正在被測試使用的資料庫砍掉。
  // worker 是 fork 出來的，會繼承這個環境變數。
  if (process.env.E2E_DB_READY) return;
  process.env.E2E_DB_READY = "1";

  const url = new URL(E2E_DATABASE_URL);
  const dbName = url.pathname.slice(1);
  const admin = new URL(E2E_DATABASE_URL);
  admin.pathname = "/postgres";

  if (dbName.includes("prod")) {
    throw new Error(`拒絕重建 ${dbName}——這看起來像正式資料庫。`);
  }

  const psql = (sql: string) =>
    execSync(`psql "${admin.toString()}" -v ON_ERROR_STOP=1 -c "${sql}"`, { stdio: "pipe" });

  process.stdout.write(`[e2e] 重建測試資料庫 ${dbName}…\n`);
  // 上一輪留下來的 dev server 還連著就砍不掉，先請它們離線
  psql(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity ` +
      `WHERE datname = '${dbName}' AND pid <> pg_backend_pid()`,
  );
  psql(`DROP DATABASE IF EXISTS ${dbName}`);
  psql(`CREATE DATABASE ${dbName}`);

  const env = {
    ...process.env,
    ...E2E_APP_ENV,
    DATABASE_URL: E2E_DATABASE_URL,
    NODE_ENV: "development" as const,
  };
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  execSync("npx tsx prisma/seed.ts", { env, stdio: "pipe" });
  execSync("npx tsx prisma/seed-demo.ts", { env, stdio: "pipe" });
  process.stdout.write("[e2e] 資料就緒\n");
}
