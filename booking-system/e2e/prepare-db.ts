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

  const env = { ...process.env, DATABASE_URL: E2E_DATABASE_URL, NODE_ENV: "development" as const };
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  execSync("npx tsx prisma/seed.ts", { env, stdio: "pipe" });
  execSync("npx tsx prisma/seed-demo.ts", { env, stdio: "pipe" });
  process.stdout.write("[e2e] 資料就緒\n");
}
