/**
 * 民眾（前台）身分驗證：**只有 LINE Login 一條路**。
 *
 * 院長 2026-08-13 裁示取消簡訊後，手機 OTP 沒有可送達的管道，整套一併移除
 * （原本的 issueOtp／checkOtp／verifyOtp 與 otp_codes 資料表）。
 * 線上預約與線上查詢一律先經 LINE Login OAuth 建立 PortalSession；
 * 沒有 LINE 的家長改走電話或現場掛號，由櫃檯以後台代為處理。
 *
 * 綁定既有病歷仍需知識性驗證（證件＋生日＋手機三者與病歷相符），
 * 見 verifyPatientIdentity——這是能否讀到該病人預約紀錄的唯一關卡。
 */
import { cookies } from "next/headers";
import { prisma } from "../db";
import { hashToken, randomToken, hashIdNumber } from "../crypto";
import { BookingError, MSG } from "../errors";
import { resolveMergedPatient } from "../patients";
import type { IdType } from "@prisma/client";

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
  if (!session || session.expiresAt < new Date() || !session.lineAccountId) return null;

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

/**
 * 證件＋生日＋手機三者全部與病歷相符才回傳病人；
 * 任一不符一律回中性錯誤（避免以證件號探測某人是否為本院病人）。
 *
 * 這是「這個 LINE 帳號可以看到誰的預約」的唯一判準，
 * 預約時的自動綁定（actions/portal.ts）用的也是同一把尺。
 */
export async function verifyPatientIdentity(
  idType: IdType,
  idNumber: string,
  birthDate: string,
  phone: string,
): Promise<string> {
  const patient = await prisma.patient.findUnique({
    where: { uniq_patient_identity: { idType, idNumberHash: hashIdNumber(idNumber) } },
  });
  if (!patient) throw new BookingError("NOT_FOUND", MSG.notFound);
  // 病歷若已被合併，改以保留的那筆核對與回傳，否則查不到合併後的預約
  const resolved = await resolveMergedPatient(prisma, patient);
  const birthOk = resolved.birthDate.toISOString().slice(0, 10) === birthDate;
  const phoneOk = resolved.phone === phone;
  if (!birthOk || !phoneOk) throw new BookingError("NOT_FOUND", MSG.notFound);
  return resolved.id;
}
