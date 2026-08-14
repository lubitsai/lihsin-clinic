/**
 * 前台：家長實際會走的路。
 * 用「畫面上看得到的字」定位，不用 CSS class——class 改了測試不該壞，
 * 但家長讀到的字改了就該壞（那本來就要有人確認過）。
 */
import { test, expect, type Page } from "@playwright/test";
import { typeInto, clickUntil, submitUntil, makeTaiwanId } from "./helpers";

/** 每次跑都用新的假病人，避免撞到同日唯一與帳號額度上限 */
function newPatient() {
  const n = Date.now() % 100_000_000;
  return {
    name: `測試家長${n % 1000}`,
    phone: `09${String(n).padStart(8, "0").slice(0, 8)}`,
    birthDate: "2021-06-15",
    idNumber: makeTaiwanId(n),
  };
}

/** 走完七步驟預約精靈 */
async function bookOnce(page: Page, clinicType = "一般門診") {
  const p = newPatient();
  await page.goto("/book");

  // 步驟 1：門診類型
  await clickUntil(page.getByRole("button", { name: new RegExp(clinicType) }), async () => {
    await expect(page.getByRole("heading", { name: "請選擇醫師" })).toBeVisible({ timeout: 5_000 });
  });

  // 步驟 2：醫師（只有一位醫師的門診沒有「不限醫師」）
  const anyDoctor = page.getByRole("button", { name: "不限醫師" });
  const pick = (await anyDoctor.count()) > 0 ? anyDoctor : page.getByRole("button", { name: /醫師$/ }).first();
  await clickUntil(pick, async () => {
    await expect(page.getByRole("heading", { name: "請選擇日期" })).toBeVisible({ timeout: 8_000 });
  });

  // 步驟 3：日期——挑第一個標示「可預約」的（休診與已額滿的按鈕是 disabled）
  const day = page.locator("button:not([disabled])").filter({ hasText: "可預約" }).first();
  await clickUntil(day, async () => {
    await expect(page.getByRole("heading", { name: /請選擇時段/ })).toBeVisible({ timeout: 8_000 });
  });

  // 步驟 4：時段
  const slot = page.locator("button:not([disabled])").filter({ hasText: /^\d\d:\d\d$/ }).first();
  const slotLabel = (await slot.textContent())?.trim() ?? "";
  await clickUntil(slot, async () => {
    await expect(page.getByPlaceholder("09xxxxxxxx")).toBeVisible({ timeout: 8_000 });
  });

  // 步驟 5：病人資料
  await typeInto(page.getByPlaceholder("09xxxxxxxx"), p.phone);
  await typeInto(page.locator("input.input").first(), p.name);
  await typeInto(page.locator('input[type="date"]').first(), p.birthDate);
  await typeInto(page.locator('input[autocomplete="off"]').first(), p.idNumber);
  // 必須勾選個資告知同意，否則步驟 5 會擋下（這是規則，不是測試的權宜）
  const consent = page.getByRole("checkbox", { name: /同意預約規則與個人資料告知/ });
  await expect(async () => {
    await consent.check();
    expect(await consent.isChecked()).toBe(true);
  }).toPass({ timeout: 30_000 });
  await clickUntil(page.getByRole("button", { name: "下一步：確認預約內容" }), async () => {
    await expect(page.getByRole("heading", { name: "請確認預約內容" })).toBeVisible({ timeout: 8_000 });
  });

  // 步驟 6：手機驗證（開發模式會把驗證碼自動帶入欄位）
  const sendOtp = page.getByRole("button", { name: /傳送驗證碼/ });
  if ((await sendOtp.count()) > 0) {
    await clickUntil(sendOtp, async () => {
      await expect(page.getByPlaceholder("6 位數驗證碼")).not.toHaveValue("", { timeout: 8_000 });
    });
  }
  await clickUntil(page.getByRole("button", { name: "確認送出預約" }), async () => {
    await expect(page.getByText("預約成功")).toBeVisible({ timeout: 15_000 });
  });

  return { patient: p, slotLabel };
}

test.describe("前台：預約流程", () => {
  test("家長可以從首頁一路完成預約", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /立欣診所線上預約/ })).toBeVisible();
    await clickUntil(page.getByRole("link", { name: /立即預約/ }), async () => {
      await expect(page).toHaveURL(/\/book/, { timeout: 8_000 });
    });

    const { patient } = await bookOnce(page);

    // 完成頁必須把「還要到櫃檯報到」講清楚——官網公告的重點
    await expect(page.getByText(/報到/).first()).toBeVisible();
    expect(patient.name).toBeTruthy();
  });

  test("首頁顯示今日門診、現場掛號時間與規則連結", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("今日門診")).toBeVisible();
    await expect(page.getByRole("heading", { name: /各診次現場掛號開始時間/ })).toBeVisible();
    await expect(page.getByText("早診 08:00｜午診 14:30｜晚診 18:00")).toBeVisible();
    await expect(page.getByRole("link", { name: "預約規則與個資告知" })).toBeVisible();
  });

  test("規則頁的合規段落都在", async ({ page }) => {
    await page.goto("/rules");
    await expect(page.getByRole("heading", { name: "預約規則與個人資料告知" })).toBeVisible();
    // 合規紅線（internal/00 §4-5 非急診與 119、§4-2 疫苗但書）不能被誤刪
    await expect(page.getByText("119")).toBeVisible();
    await expect(page.getByText(/依醫師當日評估與疫苗現貨為準/)).toBeVisible();
    await expect(page.getByText(/兩樣缺一即無法施測/)).toBeVisible();
    await expect(page.getByText(/個人資料蒐集告知/)).toBeVisible();
  });
});

test.describe("前台：查詢與取消", () => {
  test("查得到自己的預約，並可自行取消", async ({ page }) => {
    const { patient } = await bookOnce(page);

    await page.goto("/my");
    await typeInto(page.locator('input[type="text"]').first(), patient.idNumber);
    await typeInto(page.locator('input[type="date"]').first(), patient.birthDate);
    await typeInto(page.getByPlaceholder("09xxxxxxxx"), patient.phone);
    await clickUntil(page.getByRole("button", { name: /傳送驗證碼/ }), async () => {
      await expect(page.getByPlaceholder("6 位數驗證碼")).not.toHaveValue("", { timeout: 8_000 });
    });
    await submitUntil(page.getByRole("button", { name: "查詢我的預約" }), async () => {
      await expect(page.getByText(patient.name).first()).toBeVisible({ timeout: 8_000 });
    });

    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "取消預約" }).first().click();
    await expect(page.getByText(/已取消/).first()).toBeVisible({ timeout: 15_000 });
  });

  test("查無資料時的訊息不透露該證件號是否存在", async ({ page }) => {
    await page.goto("/my");
    await typeInto(page.locator('input[type="text"]').first(), makeTaiwanId(99_999_99));
    await typeInto(page.locator('input[type="date"]').first(), "2000-01-01");
    await typeInto(page.getByPlaceholder("09xxxxxxxx"), "0900999999");
    await clickUntil(page.getByRole("button", { name: /傳送驗證碼/ }), async () => {
      await expect(page.getByPlaceholder("6 位數驗證碼")).not.toHaveValue("", { timeout: 8_000 });
    });
    const query = page.getByRole("button", { name: "查詢我的預約" });
    await expect(query).toBeEnabled({ timeout: 15_000 });
    await query.click();
    // 一律中性訊息，不能出現「查無此人」這類可用來探查病人是否存在的字眼
    await expect(page.getByText("查無符合的預約資料，請確認輸入內容。")).toBeVisible({
      timeout: 15_000,
    });
  });
});
