/**
 * 一鍵開一個「可以直接點」的測試環境（給院長與櫃檯驗收用）。
 *
 *     npm run demo
 *
 * 做四件事：重建測試資料庫 → 建表 → 基礎資料 → 示範資料，最後印出網址與帳號。
 * 用的是獨立的資料庫（預設 lihsin_booking_demo），**不會動到開發或正式資料**。
 * 跑完再開 `npm run dev` 即可；想換資料重來，重跑這支就好。
 */
import { execSync } from "node:child_process";

const DATABASE_URL =
  process.env.DEMO_DATABASE_URL ??
  "postgresql://postgres@127.0.0.1:5433/lihsin_booking_demo";

function run(cmd: string, env: Record<string, string> = {}) {
  execSync(cmd, { stdio: "inherit", env: { ...process.env, DATABASE_URL, ...env } });
}

const url = new URL(DATABASE_URL);
const dbName = url.pathname.slice(1);
const admin = new URL(DATABASE_URL);
admin.pathname = "/postgres";

if (dbName.includes("prod") || process.env.NODE_ENV === "production") {
  console.error(`拒絕在 ${dbName} 建立示範環境——這看起來像正式資料庫。`);
  process.exit(1);
}

console.log(`\n重建示範資料庫 ${dbName}…`);
execSync(`psql "${admin.toString()}" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS ${dbName}"`, { stdio: "pipe" });
execSync(`psql "${admin.toString()}" -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${dbName}"`, { stdio: "pipe" });

run("npx prisma migrate deploy");
run("npx tsx prisma/seed.ts");
run("npx tsx prisma/seed-demo.ts");

console.log(`
────────────────────────────────────────────────────
示範環境已就緒。接著執行：

    DATABASE_URL="${DATABASE_URL}" npm run dev

然後用瀏覽器開：

  前台（家長看到的）   http://localhost:3000
  後台（櫃檯用的）     http://localhost:3000/admin

帳號：
  管理員   admin    / lihsin-admin-2026
  櫃檯     counter1 / lihsin-staff-2026
  醫師唯讀 dr-tsai  / lihsin-doctor-2026

前台查詢預約可用這組示範病人：
  證件號 A100000010　生日 2020-03-15　手機 0900000001
  （驗證碼不會真的發簡訊，會直接顯示在畫面上；伺服器終端機也印得到）

驗收項目逐條見 docs/10-測試與驗收.md。
────────────────────────────────────────────────────
`);
