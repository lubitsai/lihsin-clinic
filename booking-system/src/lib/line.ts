/**
 * LINE 整合（官方 OAuth 2.0 流程；絕不接觸使用者 LINE 密碼）。
 * - LINE Login：線上預約與線上查詢的唯一身分來源
 *   （https://developers.line.biz/en/services/line-login/）
 * - Messaging API：預約通知推播
 *
 * 院長 2026-08-13 裁示取消簡訊後，**這兩項都是上線的必要條件**：
 * 未設定 Login 就沒有人能線上預約，未設定 Messaging 就沒有任何通知發得出去。
 * 兩者的檢測結果顯示在後台「系統設定 → LINE 串接」。
 */
import { createHmac } from "node:crypto";

const LINE_AUTH_URL = "https://access.line.me/oauth2/v2.1/authorize";
const LINE_TOKEN_URL = "https://api.line.me/oauth2/v2.1/token";
const LINE_PROFILE_URL = "https://api.line.me/v2/profile";
const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";

export function isLineLoginConfigured(): boolean {
  return !!(process.env.LINE_LOGIN_CHANNEL_ID && process.env.LINE_LOGIN_CHANNEL_SECRET);
}

/**
 * 開發／示範／測試用：推播只印到終端機、不真的呼叫 LINE。
 * 取代原本的 SMS_PROVIDER=console——沒有這個，示範環境每送一筆預約
 * 都會對 api.line.me 發一次注定失敗的請求，通知全部變成 FAILED。
 */
export function isLineMessagingDryRun(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.LINE_MESSAGING_DRY_RUN === "1";
}

export function isLineMessagingConfigured(): boolean {
  return !!process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN || isLineMessagingDryRun();
}

/**
 * 開發／示範／自動化測試用的 LINE 登入替身是否啟用。
 *
 * 前台唯一的身分來源是 LINE Login，本機與 CI 連不到 LINE，
 * 沒有替身就沒有任何辦法驗「家長點得動」。因此保留一條**只在非正式環境**、
 * 且必須另外明寫 LINE_LOGIN_DEV_STUB=1 才開啟的捷徑（見 api/line/dev-login）。
 * 正式建置時 NODE_ENV=production，此函式恆為 false，該路由直接回 404。
 */
export function isLineDevLoginEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.LINE_LOGIN_DEV_STUB === "1";
}

/** LINE console 需填入的 callback 網址（設定畫面顯示用） */
export function lineCallbackUrl(redirectPath = "/api/line/callback"): string {
  return `${process.env.APP_BASE_URL ?? ""}${redirectPath}`;
}

/** LINE console 需填入的 webhook 網址（設定畫面顯示用） */
export function lineWebhookUrl(): string {
  return `${process.env.APP_BASE_URL ?? ""}/api/line/webhook`;
}

/**
 * 產生 LINE Login 授權導向網址（state 由呼叫端存入 cookie 防 CSRF）。
 * bot_prompt=aggressive：登入時一併詢問是否加入診所官方帳號為好友。
 * 沒有加好友就無法推播，而簡訊已取消——不加好友＝完全收不到預約通知，
 * 因此在登入當下就引導加入。使用者仍可拒絕，預約本身照樣成立。
 */
export function buildLineLoginUrl(state: string, redirectPath = "/api/line/callback"): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.LINE_LOGIN_CHANNEL_ID ?? "",
    redirect_uri: lineCallbackUrl(redirectPath),
    state,
    scope: "profile openid",
    bot_prompt: "aggressive",
  });
  return `${LINE_AUTH_URL}?${params}`;
}

export interface LineProfile {
  userId: string;
  displayName: string;
  pictureUrl?: string;
}

/** 授權碼換 access token 並取得使用者 profile */
export async function exchangeLineCode(
  code: string,
  redirectPath = "/api/line/callback",
): Promise<LineProfile> {
  const tokenRes = await fetch(LINE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${process.env.APP_BASE_URL}${redirectPath}`,
      client_id: process.env.LINE_LOGIN_CHANNEL_ID ?? "",
      client_secret: process.env.LINE_LOGIN_CHANNEL_SECRET ?? "",
    }),
  });
  if (!tokenRes.ok) throw new Error(`LINE token 交換失敗：HTTP ${tokenRes.status}`);
  const token = (await tokenRes.json()) as { access_token: string };

  const profileRes = await fetch(LINE_PROFILE_URL, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!profileRes.ok) throw new Error(`LINE profile 取得失敗：HTTP ${profileRes.status}`);
  const p = (await profileRes.json()) as LineProfile;
  return { userId: p.userId, displayName: p.displayName, pictureUrl: p.pictureUrl };
}

/** Messaging API 推播文字訊息 */
export async function pushLineMessage(lineUserId: string, text: string): Promise<void> {
  if (isLineMessagingDryRun()) {
    console.info(`[LINE dry-run] → ${lineUserId}\n${text}`);
    return;
  }
  const res = await fetch(LINE_PUSH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ to: lineUserId, messages: [{ type: "text", text }] }),
  });
  if (!res.ok) {
    throw new Error(`LINE 推播失敗：HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
}

/** 驗證 Messaging API webhook 簽章（follow/unfollow 事件維護 isFollowing） */
export function verifyLineWebhookSignature(body: string, signature: string): boolean {
  const secret = process.env.LINE_MESSAGING_CHANNEL_SECRET;
  if (!secret) return false;
  const expected = createHmac("sha256", secret).update(body).digest("base64");
  return expected === signature;
}

// ── 設定檢測（後台「LINE 串接」區塊使用）─────────────────

export interface LineCheckItem {
  ok: boolean;
  label: string;
  detail: string;
}

export interface LineSetupStatus {
  loginConfigured: boolean;
  messagingConfigured: boolean;
  callbackUrl: string;
  webhookUrl: string;
  friendUrl: string;
  checks: LineCheckItem[];
}

/**
 * 實際呼叫 LINE API 驗證設定是否正確。
 * 目的是讓診所填完金鑰後可立即確認，而不是等到有民眾預約才發現沒接上。
 * 任何一項失敗都只回報，不丟例外——設定畫面要能完整顯示每一項結果。
 */
export async function checkLineSetup(): Promise<LineSetupStatus> {
  const checks: LineCheckItem[] = [];
  const baseUrl = process.env.APP_BASE_URL ?? "";

  if (!baseUrl.startsWith("https://") && !baseUrl.startsWith("http://localhost")) {
    checks.push({
      ok: false,
      label: "對外網址 APP_BASE_URL",
      detail: `目前為「${baseUrl || "未設定"}」。LINE 只接受 https 網址，請設定為正式網域。`,
    });
  } else {
    checks.push({ ok: true, label: "對外網址 APP_BASE_URL", detail: baseUrl });
  }

  // Messaging：以 /v2/bot/info 驗證 access token
  if (!process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN) {
    checks.push({
      ok: false,
      label: "Messaging API（推播通知）",
      detail:
        "尚未設定 LINE_MESSAGING_CHANNEL_ACCESS_TOKEN。" +
        "簡訊已於 2026-08-13 取消，沒有這把金鑰就沒有任何通知發得出去（預約成立、改期、取消、看診前提醒全部停擺）。",
    });
  } else {
    try {
      const res = await fetch("https://api.line.me/v2/bot/info", {
        headers: { Authorization: `Bearer ${process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN}` },
      });
      if (res.ok) {
        const info = (await res.json()) as { displayName?: string; basicId?: string };
        checks.push({
          ok: true,
          label: "Messaging API（推播通知）",
          detail: `已連線：${info.displayName ?? "官方帳號"}${info.basicId ? `（${info.basicId}）` : ""}`,
        });
      } else {
        checks.push({
          ok: false,
          label: "Messaging API（推播通知）",
          detail: `LINE 回應 HTTP ${res.status}，請確認 Channel access token 是否正確或已失效。`,
        });
      }
    } catch (e) {
      checks.push({
        ok: false,
        label: "Messaging API（推播通知）",
        detail: `無法連線至 LINE：${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  if (!process.env.LINE_MESSAGING_CHANNEL_SECRET) {
    checks.push({
      ok: false,
      label: "Messaging Channel secret（webhook 驗章）",
      detail: "未設定，將無法驗證 LINE 送來的 webhook，好友狀態不會更新。",
    });
  } else {
    checks.push({
      ok: true,
      label: "Messaging Channel secret（webhook 驗章）",
      detail: "已設定",
    });
  }

  // Login：以 client_credentials 驗證 channel id / secret 配對
  if (!isLineLoginConfigured()) {
    checks.push({
      ok: false,
      label: "LINE Login（民眾登入）",
      detail:
        "尚未設定。LINE 登入是線上預約與線上查詢的唯一入口，未設定＝家長完全無法自行預約，" +
        "只能改走電話或現場掛號。",
    });
  } else {
    try {
      const res = await fetch(LINE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: process.env.LINE_LOGIN_CHANNEL_ID ?? "",
          client_secret: process.env.LINE_LOGIN_CHANNEL_SECRET ?? "",
        }),
      });
      checks.push(
        res.ok
          ? { ok: true, label: "LINE Login（民眾登入）", detail: "Channel ID 與 secret 配對正確" }
          : {
              ok: false,
              label: "LINE Login（民眾登入）",
              detail: `LINE 回應 HTTP ${res.status}，請確認 Channel ID 與 Channel secret。`,
            },
      );
    } catch (e) {
      checks.push({
        ok: false,
        label: "LINE Login（民眾登入）",
        detail: `無法連線至 LINE：${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  return {
    loginConfigured: isLineLoginConfigured(),
    messagingConfigured: isLineMessagingConfigured(),
    callbackUrl: lineCallbackUrl(),
    webhookUrl: lineWebhookUrl(),
    friendUrl: process.env.NEXT_PUBLIC_LINE_OA_URL ?? "",
    checks,
  };
}
