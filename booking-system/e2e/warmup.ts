/**
 * 測試開始前先把各頁面請求一次，逼 Next.js dev 完成編譯。
 *
 * `next dev` 是**第一次被請求才編譯該路由**，第一次開 /admin 可能要十幾秒。
 * 不先暖機的話，這段編譯時間會算進第一個測試的 timeout，於是變成
 * 「單獨跑會過、整套跑第一項會失敗」這種最難查的假失敗。
 *
 * webServer 的健康檢查只打首頁，所以其餘路由仍是冷的——這支補完剩下的。
 */
import { request } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3210);
const ROUTES = ["/", "/book", "/my", "/rules", "/admin/login", "/admin", "/api/line/dev-login"];

export default async function warmup() {
  const ctx = await request.newContext({ baseURL: `http://127.0.0.1:${PORT}` });
  process.stdout.write("[e2e] 預先編譯頁面…");
  for (const path of ROUTES) {
    const started = Date.now();
    // 編譯冷啟動可能要十幾秒，逾時就算了——真的壞掉會在測試裡明確失敗
    await ctx.get(path, { timeout: 120_000, failOnStatusCode: false }).catch(() => {});
    process.stdout.write(` ${path}(${Math.round((Date.now() - started) / 100) / 10}s)`);
  }
  process.stdout.write("\n");
  await ctx.dispose();
}
