/**
 * 前台：家長實際會走的路。
 * 用「畫面上看得到的字」定位，不用 CSS class——class 改了測試不該壞，
 * 但家長讀到的字改了就該壞（那本來就要有人確認過）。
 */
import { test, expect, type Page } from "@playwright/test";
import { typeInto, clickUntil, makeTaiwanId } from "./helpers";

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

/**
 * 以替身完成 LINE 登入。
 * 線上預約與線上查詢的身分只剩 LINE Login，CI 連不到 LINE，
 * 所以走 /api/line/dev-login（正式環境是 404，見 lib/line.ts isLineDevLoginEnabled）。
 * 不帶 as= 就是全新的假 LINE 帳號，測試之間不會互相吃掉同時預約上限。
 */
async function loginAsLine(page: Page, next = "/book") {
  await page.goto(`/api/line/dev-login?next=${encodeURIComponent(next)}`);
  await expect(page).toHaveURL(new RegExp(next.replace("/", "\\/")), { timeout: 15_000 });
}

type TestPatient = ReturnType<typeof newPatient>;

/**
 * 走到步驟 6「請確認預約內容」為止，不送出。
 * 抽出來是因為「送出會成功」與「送出會被擋下」兩種案例，前面六步完全一樣。
 */
async function fillWizardTo6(page: Page, p: TestPatient, clinicType = "一般門診") {
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

  return slotLabel;
}

/** 走完七步驟預約精靈（需先 LINE 登入） */
async function bookOnce(page: Page, clinicType = "一般門診") {
  const p = newPatient();
  await loginAsLine(page);
  const slotLabel = await fillWizardTo6(page, p, clinicType);

  // 步驟 6：確認送出（身分在登入時就確認過，這一步沒有額外驗證）
  await clickUntil(page.getByRole("button", { name: "確認送出預約" }), async () => {
    await expect(page.getByText("預約成功")).toBeVisible({ timeout: 15_000 });
  });

  return { patient: p, slotLabel };
}

test.describe("前台：預約流程", () => {
  test("未登入時預約頁只給 LINE 登入，並講清楚電話與現場掛號照舊", async ({ page }) => {
    await page.goto("/book");
    await expect(page.getByRole("heading", { name: "線上預約請先以 LINE 登入" })).toBeVisible();
    await expect(page.getByText("沒有使用 LINE 也能看診")).toBeVisible();
    // 未登入不該看到任何門診類型按鈕（精靈根本沒開始）
    await expect(page.getByRole("heading", { name: "請選擇門診類型" })).toHaveCount(0);
  });

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
  test("預約成立即綁定，查得到自己的預約並可自行取消", async ({ page }) => {
    // bookOnce 走完後，這個 LINE 帳號已在預約成立時自動綁定該病人
    const { patient } = await bookOnce(page);

    await page.goto("/my");
    await expect(page.getByText(patient.name).first()).toBeVisible({ timeout: 15_000 });

    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "取消預約" }).first().click();
    await expect(page.getByText(/已取消/).first()).toBeVisible({ timeout: 15_000 });
  });

  test("未登入的查詢頁只給 LINE 登入", async ({ page }) => {
    await page.goto("/my");
    await expect(page.getByText("查詢與取消預約請先以 LINE 登入")).toBeVisible();
    await expect(page.getByRole("button", { name: "取消預約" })).toHaveCount(0);
  });

  test("既有病歷未綁定時擋下預約，並指向櫃檯（不讓人冒用證件綁走病歷）", async ({ page }) => {
    // 第一個 LINE 帳號預約，病歷因此建立並綁在該帳號下
    const { patient } = await bookOnce(page);

    // 換一個 LINE 帳號、用同一組證件與生日預約 → 必須被擋下
    await page.context().clearCookies();
    await loginAsLine(page);
    await fillWizardTo6(page, patient);
    await clickUntil(page.getByRole("button", { name: "確認送出預約" }), async () => {
      await expect(page.getByText(/尚未與您的 LINE 綁定/)).toBeVisible({ timeout: 10_000 });
    });
    await expect(page.getByText("預約成功")).toHaveCount(0);
  });

  test("既有病歷可向櫃檯取得綁定代碼", async ({ page }) => {
    await loginAsLine(page, "/my");
    // 自助綁定已移除，只剩「取得代碼 → 到櫃檯核對健保卡」
    await expect(page.getByPlaceholder("證件號碼")).toHaveCount(0);
    await clickUntil(page.getByRole("button", { name: "取得櫃檯綁定代碼" }), async () => {
      await expect(page.getByText("請告知櫃檯這組代碼")).toBeVisible({ timeout: 8_000 });
    });
    await expect(page.getByText(/^[A-Z0-9]{6}$/)).toBeVisible();
  });
});
