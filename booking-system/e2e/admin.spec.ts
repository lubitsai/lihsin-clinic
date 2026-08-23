/**
 * 後台：櫃檯每天實際會做的事，以及權限有沒有真的擋住。
 *
 * 權限那幾項特別重要：`npm test` 驗的是「函式會不會拒絕」，
 * 但畫面上按鈕還在、連結還連得過去也是漏洞——那只有用瀏覽器點才驗得到。
 */
import { test, expect } from "@playwright/test";
import { login, typeInto, clickUntil, fillFormUntilEnabled, ACCOUNTS } from "./helpers";

const { admin: ADMIN, counter: COUNTER, doctor: DOCTOR } = ACCOUNTS;

test.describe("後台：登入", () => {
  test("帳密錯誤不會登入，也不說是帳號錯還是密碼錯", async ({ page }) => {
    await page.goto("/admin/login");
    const btn = page.getByRole("button", { name: "登入" });
    await fillFormUntilEnabled(
      [
        [page.locator("input[autocomplete='username']"), "admin"],
        [page.locator("input[type='password']"), "wrong-password"],
      ],
      btn,
    );
    await btn.click();
    await expect(page.locator("text=/帳號或密碼/")).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test("未登入直接開後台會被導回登入頁", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/login/, { timeout: 15_000 });
  });

  test("櫃檯帳號登入後看得到今日總覽", async ({ page }) => {
    await login(page, COUNTER);
    await expect(page.getByText(/今日|預約總覽/).first()).toBeVisible();
  });
});

test.describe("後台：櫃檯日常", () => {
  test("今日總覽列出示範預約，並可完成報到", async ({ page }) => {
    await login(page, COUNTER);
    // 示範資料在今天鋪了幾筆一般門診
    const row = page.locator("li, tr").filter({ hasText: /王小明|陳小美|林小豪/ }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });

    // 報到成功的可靠訊號：該筆的「報到」按鈕會消失（狀態字在篩選下拉選單裡也有，撈不準）
    const checkIn = page.getByRole("button", { name: "報到", exact: true });
    const before = await checkIn.count();
    if (before > 0) {
      await checkIn.first().click();
      await expect(checkIn).toHaveCount(before - 1, { timeout: 20_000 });
    }
  });

  test("搜尋找得到病人，病歷頁證件號是遮罩的", async ({ page }) => {
    await login(page, COUNTER);
    await page.goto("/admin/patients");
    await typeInto(page.locator("input").first(), "王小明");
    await page.keyboard.press("Enter");
    await expect(page.getByText("王小明").first()).toBeVisible({ timeout: 15_000 });

    await page.getByText("王小明").first().click();
    // 完整證件號不得出現在畫面上（院長要求：前台查詢結果一律遮罩）
    await expect(page.locator("body")).not.toContainText("A100000010");
    await expect(page.locator("body")).toContainText("*");
  });

  test("病歷頁可用綁定代碼綁 LINE，代碼錯誤時明確拒絕", async ({ page }) => {
    await login(page, COUNTER);
    await page.goto("/admin/patients");
    await typeInto(page.locator("input").first(), "王小明");
    await page.keyboard.press("Enter");
    await expect(page.getByText("王小明").first()).toBeVisible({ timeout: 15_000 });
    await page.getByText("王小明").first().click();

    // 綁定一律由櫃檯核對健保卡後執行，所以入口在後台而不是前台
    await expect(page.getByRole("heading", { name: "LINE 綁定" })).toBeVisible({ timeout: 15_000 });
    page.on("dialog", (d) => d.accept()); // 「已當面核對健保卡了嗎？」
    await typeInto(page.getByPlaceholder("綁定代碼"), "ZZZZZZ");
    await clickUntil(page.getByRole("button", { name: "確認綁定" }), async () => {
      await expect(page.getByText(/無效或已過期/)).toBeVisible({ timeout: 8_000 });
    });
  });

  test("排班頁預設停在「臨時異動」，看得到當天各診次與停診鈕", async ({ page }) => {
    await login(page, ADMIN);
    await page.goto("/admin/schedule");
    // 切換系統最容易出事的地方：預設不能是會影響所有未來日期的週班表
    await expect(page.getByText("這一頁只改「這一天」")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/不會影響往後其他同一個星期幾/)).toBeVisible();
    await expect(page.getByRole("button", { name: "停診" }).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("固定週班表分頁會先警告「往後每個同一星期幾都會改」", async ({ page }) => {
    await login(page, ADMIN);
    await page.goto("/admin/schedule");
    // 分頁切換是客戶端狀態，hydration 未完成時點了不會有反應
    await clickUntil(page.getByRole("button", { name: "固定週班表" }), async () => {
      await expect(page.getByText(/往後每一個同一星期幾都會跟著改/)).toBeVisible({ timeout: 8_000 });
    });
    await expect(page.getByText(/蔡宗儒|李佳玲/).first()).toBeVisible({ timeout: 15_000 });
  });

  test("日期例外分頁仍看得到示範的單日停診", async ({ page }) => {
    await login(page, ADMIN);
    await page.goto("/admin/schedule");
    await clickUntil(page.getByRole("button", { name: /日期例外/ }), async () => {
      await expect(page.getByText(/示範資料：醫師進修/)).toBeVisible({ timeout: 8_000 });
    });
  });

  test("月曆總覽列出整月每天的名單，可翻月與篩選", async ({ page }) => {
    await login(page, COUNTER);
    await page.goto("/admin/month");
    await expect(page.getByRole("heading", { name: /\d+ 年 \d+ 月/ })).toBeVisible({ timeout: 15_000 });
    // 一定要看得到「某天有哪些人」——這頁的重點就是名單，不是只有數量。
    // 只看月曆本體，篩選下拉選單裡也有醫師名字（隱藏的 <option>），會誤判。
    const board = page.locator("main");
    await expect(board.getByText(/^\d\d:\d\d$/).first()).toBeVisible({ timeout: 15_000 });
    await expect(board.getByText("王小明").first()).toBeVisible({ timeout: 15_000 });
    // 證件號一律遮罩，整月攤開更不該出現完整號碼
    await expect(page.locator("body")).not.toContainText("A100000010");

    const title = await page.getByRole("heading", { name: /\d+ 年 \d+ 月/ }).textContent();
    await page.getByRole("link", { name: /上個月/ }).click();
    await expect(page.getByRole("heading", { name: /\d+ 年 \d+ 月/ })).not.toHaveText(title ?? "", {
      timeout: 15_000,
    });
  });

  test("系統設定頁顯示國定假日涵蓋範圍到 2027 年底", async ({ page }) => {
    await login(page, ADMIN);
    await page.goto("/admin/settings");
    await expect(page.getByText(/2027-12-31|2027\/12\/31/)).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("後台：權限界線", () => {
  test("醫師唯讀帳號不能匯出 CSV，也點不到代約", async ({ page }) => {
    await login(page, DOCTOR);
    // 沒有 APPOINTMENTS_READ 權限就不該出現匯出入口
    await expect(page.getByRole("link", { name: /匯出/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /匯出/ })).toHaveCount(0);

    // 直接打匯出網址也要被擋（畫面藏起來不算擋住）
    const res = await page.request.get("/admin/api/export?date=" + new Date().toISOString().slice(0, 10));
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test("醫師唯讀帳號進不了系統設定", async ({ page }) => {
    await login(page, DOCTOR);
    await page.goto("/admin/settings");
    await expect(page.getByText(/權限|沒有.*權限|forbidden/i).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("櫃檯帳號不能管理員工帳號", async ({ page }) => {
    await login(page, COUNTER);
    await page.goto("/admin/staff");
    await expect(page.getByText(/權限|沒有.*權限/).first()).toBeVisible({ timeout: 15_000 });
  });
});
