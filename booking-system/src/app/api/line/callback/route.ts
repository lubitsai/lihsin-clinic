import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { exchangeLineCode } from "@/lib/line";
import { createPortalSession, PORTAL_COOKIE } from "@/lib/auth/portal";
import { writeAudit } from "@/lib/audit";

/** LINE Login OAuth callback：驗證 state → 換 token → 建立/更新 line_accounts → 開 portal session */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const savedState = req.cookies.get("lihsin_line_state")?.value;

  // 使用者取消授權或 LINE 回傳錯誤：退回手機驗證流程，不阻斷預約
  if (!code || !state || !savedState || state !== savedState) {
    return NextResponse.redirect(new URL("/my?line=failed", req.url));
  }
  const next = (() => {
    try {
      const decoded = Buffer.from(state.split(".")[1] ?? "", "base64url").toString();
      return decoded.startsWith("/") && !decoded.startsWith("//") ? decoded : "/my";
    } catch {
      return "/my";
    }
  })();

  try {
    const profile = await exchangeLineCode(code);
    const account = await prisma.lineAccount.upsert({
      where: { lineUserId: profile.userId },
      create: {
        lineUserId: profile.userId,
        displayName: profile.displayName,
        pictureUrl: profile.pictureUrl,
        lastLoginAt: new Date(),
      },
      update: {
        displayName: profile.displayName,
        pictureUrl: profile.pictureUrl,
        lastLoginAt: new Date(),
      },
    });
    const token = await createPortalSession({ lineAccountId: account.id });
    await writeAudit(
      { type: "PATIENT", id: account.id, name: "LINE 使用者" },
      "portal.line_login",
      { type: "line_account", id: account.id },
    );
    const res = NextResponse.redirect(new URL(next, req.url));
    res.cookies.set(PORTAL_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 2 * 3600,
    });
    res.cookies.delete("lihsin_line_state");
    return res;
  } catch (e) {
    console.error("[line callback]", e);
    return NextResponse.redirect(new URL("/my?line=failed", req.url));
  }
}
