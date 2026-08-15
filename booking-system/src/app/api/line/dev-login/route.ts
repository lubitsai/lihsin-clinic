import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isLineDevLoginEnabled } from "@/lib/line";
import { createPortalSession, PORTAL_COOKIE } from "@/lib/auth/portal";
import { redirectTo } from "@/lib/redirect";
import { randomToken } from "@/lib/crypto";

/**
 * 開發／示範／E2E 專用的 LINE 登入替身：跳過 OAuth，直接開一個 portal session。
 *
 * **正式環境不存在這條路**——isLineDevLoginEnabled() 同時要求 NODE_ENV 非 production
 * 且明寫 LINE_LOGIN_DEV_STUB=1，兩者缺一即回 404（連路由存在都不透露）。
 * 之所以需要它：前台身分只剩 LINE Login，本機與 CI 連不到 LINE，
 * 沒有替身就完全無法測「家長點得動嗎」。
 *
 * ?as=xxx 指定固定的假 LINE 使用者（重複登入同一帳號，用於驗額度上限）；
 * 不帶則每次都是新帳號，測試之間不會互相影響。
 */
export async function GET(req: NextRequest) {
  if (!isLineDevLoginEnabled()) {
    return new NextResponse("Not found", { status: 404 });
  }
  const next = req.nextUrl.searchParams.get("next") ?? "/my";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/my";
  const as = req.nextUrl.searchParams.get("as");
  const lineUserId = `Udev-${as ?? randomToken(8)}`;

  const account = await prisma.lineAccount.upsert({
    where: { lineUserId },
    create: {
      lineUserId,
      displayName: `測試家長 ${as ?? lineUserId.slice(-6)}`,
      isFollowing: true,
      lastLoginAt: new Date(),
    },
    update: { lastLoginAt: new Date() },
  });
  const token = await createPortalSession({ lineAccountId: account.id });
  const res = redirectTo(safeNext);
  res.cookies.set(PORTAL_COOKIE, token, {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    path: "/",
    maxAge: 2 * 3600,
  });
  return res;
}
