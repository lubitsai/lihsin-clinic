/**
 * 民眾（前台）身分驗證：**只有 LINE Login 一條路**。
 *
 * 院長 2026-08-13 裁示取消簡訊後，手機 OTP 沒有可送達的管道，整套一併移除
 * （原本的 issueOtp／checkOtp／verifyOtp 與 otp_codes 資料表）。
 * 線上預約與線上查詢一律先經 LINE Login OAuth 建立 PortalSession；
 * 沒有 LINE 的家長改走電話或現場掛號，由櫃檯以後台代為處理。
 *
 * 這個 session 看得到誰的預約，完全取決於 LinePatientLink。
 * 綁定既有病歷需櫃檯當面核對（院長 2026-08-15 裁示，見 lib/line-binding.ts）——
 * 原本的「證件＋生日＋手機三者相符」自助綁定已移除：這三項知道的人不只本人。
 */
import { cookies } from "next/headers";
import { prisma } from "../db";
import { hashToken, randomToken } from "../crypto";

export const PORTAL_COOKIE = "lihsin_portal_session";
const PORTAL_SESSION_HOURS = 2;

export async function createPortalSession(data: { lineAccountId: string }): Promise<string> {
  const token = randomToken();
  await prisma.portalSession.create({
    data: {
      tokenHash: hashToken(token),
      ...data,
      expiresAt: new Date(Date.now() + PORTAL_SESSION_HOURS * 3600000),
    },
  });
  return token;
}

export interface PortalContext {
  sessionId: string;
  lineAccountId: string;
  /** 此 session 可存取的病人 id 集合（＝該 LINE 帳號已綁定的家庭成員） */
  patientIds: string[];
}

export async function getPortalContext(): Promise<PortalContext | null> {
  const token = (await cookies()).get(PORTAL_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.portalSession.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!session || session.expiresAt < new Date()) return null;

  const links = await prisma.linePatientLink.findMany({
    where: { lineAccountId: session.lineAccountId },
  });
  // 註：不以「手機號碼相同」推導可存取的病人——同號碼可能因家長換號、
  // 輸入錯誤或號碼回收而對應到非本人的病歷。一律以明確建立的綁定為準。
  return {
    sessionId: session.id,
    lineAccountId: session.lineAccountId,
    patientIds: links.map((l) => l.patientId),
  };
}

export async function destroyPortalSession() {
  const token = (await cookies()).get(PORTAL_COOKIE)?.value;
  if (token) await prisma.portalSession.deleteMany({ where: { tokenHash: hashToken(token) } });
}
