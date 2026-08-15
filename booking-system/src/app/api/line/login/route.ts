import { NextRequest, NextResponse } from "next/server";
import { buildLineLoginUrl, isLineLoginConfigured } from "@/lib/line";
import { randomToken } from "@/lib/crypto";
import { redirectTo } from "@/lib/redirect";

/** 導向 LINE Login 授權頁；state 存 cookie 防 CSRF，next 為登入後返回路徑 */
export async function GET(req: NextRequest) {
  if (!isLineLoginConfigured()) {
    // LINE 未設定或故障：前台沒有替代身分（簡訊已取消），導回查詢頁說明改走電話
    return redirectTo("/my?line=unavailable");
  }
  const next = req.nextUrl.searchParams.get("next") ?? "/my";
  const state = `${randomToken(16)}.${Buffer.from(next).toString("base64url")}`;
  const res = NextResponse.redirect(buildLineLoginUrl(state));
  res.cookies.set("lihsin_line_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return res;
}
