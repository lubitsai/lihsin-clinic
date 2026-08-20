/**
 * 端對端測試（前台＋後台，用真的瀏覽器點）。
 *
 * 與 `npm test`（vitest）分工：
 *   vitest 驗「規則引擎算得對不對」——直接呼叫函式、跑得快，104 項。
 *   這裡驗「家長與櫃檯實際點得到、看得到嗎」——會抓到只有渲染層才會壞的東西
 *   （按鈕失效、狀態沒更新、權限沒擋住畫面）。
 *
 *     npm run test:e2e            # 全部
 *     npm run test:e2e -- --ui    # 有畫面可逐步看
 *
 * 資料庫：用 E2E_DATABASE_URL（預設 lihsin_booking_e2e），每次執行前重建並灌入
 * 示範資料，測試之間不互相污染，也不會動到開發或正式資料庫。
 */
import { defineConfig, devices } from "@playwright/test";
import { prepareE2eDatabase, E2E_DATABASE_URL, E2E_APP_ENV } from "./e2e/prepare-db";

// 在設定檔載入時就把資料庫準備好——Playwright 會先啟動 webServer 再跑 globalSetup，
// 放在 globalSetup 會來不及，首頁一開始就會因為沒有資料庫而 500。
if (!process.env.E2E_SKIP_DB_RESET) prepareE2eDatabase();

const PORT = Number(process.env.E2E_PORT ?? 3210);
export const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // 先把每個路由請求一次逼 next dev 編譯完，否則冷啟動時間會算進第一個測試的 timeout
  globalSetup: "./e2e/warmup.ts",
  // 共用同一個資料庫與同一份示範資料，平行跑會互相改到對方的預約
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? "list" : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    locale: "zh-TW",
    timezoneId: "Asia/Taipei",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // 環境已內建 Chromium，不要另外下載（PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD）
    launchOptions: { executablePath: process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium" },
  },
  projects: [
    // 家長幾乎都用手機約，前台在手機尺寸下必須完整走得完
    {
      name: "手機（家長）",
      testMatch: /front-.*\.spec\.ts/,
      use: { ...devices["Pixel 7"] },
    },
    // 櫃檯用桌機；後台只在桌機跑一次——兩個 project 共用同一份示範資料，
    // 同一組後台測試跑兩次會互相把對方的預約報到掉、改掉。
    {
      name: "桌機（櫃檯後台＋前台）",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // 用 dev server：LINE 登入替身與推播 dry-run 只在 NODE_ENV !== production 才生效
    command: `next dev -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // 與灌資料的子行程共用同一份設定（見 e2e/prepare-db.ts E2E_APP_ENV）
    env: { DATABASE_URL: E2E_DATABASE_URL, ...E2E_APP_ENV },
  },
});
