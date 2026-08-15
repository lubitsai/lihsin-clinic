import { NextResponse } from "next/server";

/**
 * 站內轉址（相對 Location）。
 *
 * 不要用 `NextResponse.redirect(new URL(path, req.url))`：`req.url` 會被正規化成
 * 伺服器自己的主機名（next dev 底下是 localhost），於是從 127.0.0.1 進來的請求
 * 被轉到另一個主機名，剛在同一個回應裡設好的 session cookie 是 host-only、
 * 跟著送不出去——症狀是「登入完全沒生效」，但每一步看起來都成功。
 * 相對 Location 一律留在原本的來源，沒有這個問題。
 */
export function redirectTo(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}
