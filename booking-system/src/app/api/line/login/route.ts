import { NextRequest, NextResponse } from "next/server";
import { buildLineLoginUrl, isLineLoginConfigured } from "@/lib/line";
import { randomToken } from "@/lib/crypto";

/** 導向 LINE Login 授權頁；state 存 cookie 防 CSRF，next 為登入後返回路徑 */
export async function GET(req: NextRequest) {
  if (!isLineLoginConfigured()) {
    // LINE 未設定或故障：導回查詢頁改用手機驗證（驗收條件 13）
    return NextResponse.redirect(new URL("/my?line=unavailable", req.url));
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
