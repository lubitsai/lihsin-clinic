/**
 * LINE 整合（官方 OAuth 2.0 流程；絕不接觸使用者 LINE 密碼）。
 * - LINE Login：快速登入與帳號綁定（https://developers.line.biz/en/services/line-login/）
 * - Messaging API：預約通知推播
 * 未設定環境變數時，兩者自動停用：前台隱藏 LINE 按鈕、通知退回簡訊。
 */
import { createHmac } from "node:crypto";

const LINE_AUTH_URL = "https://access.line.me/oauth2/v2.1/authorize";
const LINE_TOKEN_URL = "https://api.line.me/oauth2/v2.1/token";
const LINE_PROFILE_URL = "https://api.line.me/v2/profile";
const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";

export function isLineLoginConfigured(): boolean {
  return !!(process.env.LINE_LOGIN_CHANNEL_ID && process.env.LINE_LOGIN_CHANNEL_SECRET);
}

export function isLineMessagingConfigured(): boolean {
  return !!process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN;
}

/** 產生 LINE Login 授權導向網址（state 由呼叫端存入 cookie 防 CSRF） */
export function buildLineLoginUrl(state: string, redirectPath = "/api/line/callback"): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.LINE_LOGIN_CHANNEL_ID ?? "",
    redirect_uri: `${process.env.APP_BASE_URL}${redirectPath}`,
    state,
    scope: "profile openid",
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
