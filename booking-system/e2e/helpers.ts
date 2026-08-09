/**
 * E2E 共用工具。
 *
 * 最重要的一件事：**等 React 真的接手之後再操作**。
 * Next.js dev 模式下頁面會先送出 HTML、稍後才 hydrate；在那之前 `fill()` 只會改到
 * DOM 的 value、`click()` 也不會觸發任何 handler，React 的 state 完全沒動。
 * 症狀是「欄位明明填好了，送出按鈕卻一直 disabled」「點了門診類型卻停在步驟 1」——
 * 看起來像程式壞了，其實只是測試搶快。
 *
 * 解法是重試整個「操作 → 確認有反應」的區塊（Playwright 的 expect().toPass()）：
 * hydrate 完成後第二次就會成功，而真的壞掉時仍然會失敗。
 */
import { expect, type Locator, type Page } from "@playwright/test";

const HYDRATE_TIMEOUT = 30_000;

/** 填入文字，並確認 React 收到了（以欄位值為準，值被 state 蓋回去就重填） */
export async function typeInto(loc: Locator, value: string) {
  await expect(loc).toBeVisible();
  await expect(async () => {
    await loc.fill(value);
    expect(await loc.inputValue()).toBe(value);
  }).toPass({ timeout: HYDRATE_TIMEOUT });
}

/** 點下去，並確認畫面真的有反應；沒反應就再點一次（hydration 未完成時會發生） */
export async function clickUntil(loc: Locator, expectation: () => Promise<void>) {
  await expect(loc).toBeVisible();
  await expect(async () => {
    await loc.click({ timeout: 5_000 });
    await expectation();
  }).toPass({ timeout: HYDRATE_TIMEOUT });
}

/** 填完整組欄位後，等某個元素變成可用（例：登入鈕由 disabled 變 enabled） */
export async function fillFormUntilEnabled(
  fields: [Locator, string][],
  submit: Locator,
) {
  await expect(fields[0][0]).toBeVisible();
  await expect(async () => {
    for (const [loc, value] of fields) await loc.fill(value);
    await expect(submit).toBeEnabled({ timeout: 1_000 });
  }).toPass({ timeout: HYDRATE_TIMEOUT });
}

export const ACCOUNTS = {
  admin: { username: "admin", password: "lihsin-admin-2026" },
  counter: { username: "counter1", password: "lihsin-staff-2026" },
  doctor: { username: "dr-tsai", password: "lihsin-doctor-2026" },
};

/** 後台登入（會等到真的離開登入頁才回來） */
export async function login(page: Page, who: { username: string; password: string }) {
  await page.goto("/admin/login");
  const user = page.locator("input[autocomplete='username']");
  const pass = page.locator("input[type='password']");
  const btn = page.getByRole("button", { name: "登入" });
  await fillFormUntilEnabled([[user, who.username], [pass, who.password]], btn);
  await btn.click();
  // App Router 是客戶端導向，不一定觸發 "load"；直接等網址離開登入頁即可
  await expect(page).not.toHaveURL(/\/admin\/login/, { timeout: 30_000 });
}

/**
 * 產生通過檢查碼的身分證字號（測試用）。
 *
 * 系統會驗身分證檢查碼，隨便湊的號碼會在步驟 6 被擋下（訊息是
 * 「身分證字號格式或檢查碼不正確」）。測試要走完流程就得產合法號碼。
 * 用 A（台北市）開頭、性別碼 1、後面帶時間戳，避免每次跑撞號。
 */
export function makeTaiwanId(seed = Date.now()): string {
  const LETTER = "A";
  const letterCode = 10; // A=10
  const body = `1${String(seed % 10_000_000).padStart(7, "0")}`; // 性別碼 1 ＋ 7 碼
  const weights = [8, 7, 6, 5, 4, 3, 2, 1];
  let sum = Math.floor(letterCode / 10) + (letterCode % 10) * 9;
  for (let i = 0; i < 8; i++) sum += Number(body[i]) * weights[i];
  const check = (10 - (sum % 10)) % 10;
  return `${LETTER}${body}${check}`;
}
