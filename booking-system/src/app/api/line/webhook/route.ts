import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyLineWebhookSignature } from "@/lib/line";

/** LINE Messaging API webhook：維護好友狀態（封鎖者停止推播、改走簡訊） */
export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("x-line-signature") ?? "";
  if (!verifyLineWebhookSignature(body, signature)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 403 });
  }
  const payload = JSON.parse(body) as {
    events?: { type: string; source?: { userId?: string } }[];
  };
  for (const event of payload.events ?? []) {
    const userId = event.source?.userId;
    if (!userId) continue;
    if (event.type === "follow") {
      await prisma.lineAccount.updateMany({
        where: { lineUserId: userId },
        data: { isFollowing: true },
      });
    } else if (event.type === "unfollow") {
      await prisma.lineAccount.updateMany({
        where: { lineUserId: userId },
        data: { isFollowing: false },
      });
    }
  }
  return NextResponse.json({ ok: true });
}
