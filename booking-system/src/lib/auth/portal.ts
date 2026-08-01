/**
 * 民眾（前台）身分驗證：
 * - LINE Login 成功 → PortalSession(lineAccountId)
 * - 手機 OTP → PortalSession(verifiedPhone) 或（證件＋生日查詢流程）PortalSession(patientId)
 * OTP：雜湊儲存、5 分鐘效期、最多 5 次嘗試、單號碼頻率限制。
 */
import { cookies } from "next/headers";
import { prisma } from "../db";
import { hashToken, randomToken, randomOtp, hashIdNumber } from "../crypto";
import { getSmsProvider } from "../sms";
import { rateLimit } from "../rate-limit";
import { BookingError, MSG } from "../errors";
import { resolveMergedPatient } from "../patients";
import type { OtpPurpose, IdType } from "@prisma/client";

export const PORTAL_COOKIE = "lihsin_portal_session";
const OTP_TTL_MS = 5 * 60_000;
const OTP_MAX_ATTEMPTS = 5;

/** 發送 OTP（回傳僅供測試環境使用的 devCode） */
export async function issueOtp(phone: string, purpose: OtpPurpose): Promise<{ devCode?: string }> {
  if (!rateLimit(`otp:${phone}`, 3, 10 * 60_000)) {
    throw new BookingError("VALIDATION", "驗證碼請求過於頻繁，請稍後再試");
  }
  const code = randomOtp();
  await prisma.otpCode.create({
    data: {
      phone,
      purpose,
      codeHash: hashToken(code),
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    },
  });
  await getSmsProvider().send(
    phone,
    `【立欣診所】您的驗證碼為 ${code}，${OTP_TTL_MS / 60000} 分鐘內有效。請勿將驗證碼告知他人。`,
  );
  return process.env.NODE_ENV === "production" ? {} : { devCode: code };
}

/**
 * 檢查 OTP 是否正確，但**不註銷**；回傳可供之後註銷的 id。
 * 用於「驗證通過後還可能失敗」的流程（如預約可能撞到額滿），
 * 避免使用者因為換一個時段重送就被迫重新索取驗證碼。
 */
export async function checkOtp(
  phone: string,
  purpose: OtpPurpose,
  code: string,
): Promise<string | null> {
  const otp = await prisma.otpCode.findFirst({
    where: { phone, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!otp) return null;
  if (otp.attempts >= OTP_MAX_ATTEMPTS) return null;
  if (otp.codeHash !== hashToken(code.trim())) {
    await prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    return null;
  }
  return otp.id;
}

/** 註銷指定 OTP（在依賴它的操作真正成功後呼叫） */
export async function consumeOtp(otpId: string): Promise<void> {
  await prisma.otpCode.updateMany({
    where: { id: otpId, consumedAt: null },
    data: { consumedAt: new Date() },
  });
}

/** 驗證 OTP；成功即註銷（用於一次成敗定案的流程：查詢登入、LINE 綁定） */
export async function verifyOtp(phone: string, purpose: OtpPurpose, code: string): Promise<boolean> {
  const otpId = await checkOtp(phone, purpose, code);
  if (!otpId) return false;
  await consumeOtp(otpId);
  return true;
}

const PORTAL_SESSION_HOURS = 2;

export async function createPortalSession(data: {
  lineAccountId?: string;
  verifiedPhone?: string;
  patientId?: string;
}): Promise<string> {
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
  lineAccountId?: string;
  verifiedPhone?: string;
  patientId?: string;
  /** 此 session 可存取的病人 id 集合 */
  patientIds: string[];
}

export async function getPortalContext(): Promise<PortalContext | null> {
  const token = (await cookies()).get(PORTAL_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.portalSession.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!session || session.expiresAt < new Date()) return null;

  const patientIds = new Set<string>();
  if (session.patientId) patientIds.add(session.patientId);
  if (session.lineAccountId) {
    const links = await prisma.linePatientLink.findMany({
      where: { lineAccountId: session.lineAccountId },
    });
    for (const l of links) patientIds.add(l.patientId);
  }
  // 註：不以「手機號碼相同」推導可存取的病人——同號碼可能因家長換號、
  // 輸入錯誤或號碼回收而對應到非本人的病歷。查詢一律走
  // verifyPatientIdentity（證件＋生日＋手機三者相符）或 LINE 綁定。
  return {
    sessionId: session.id,
    lineAccountId: session.lineAccountId ?? undefined,
    verifiedPhone: session.verifiedPhone ?? undefined,
    patientId: session.patientId ?? undefined,
    patientIds: [...patientIds],
  };
}

export async function destroyPortalSession() {
  const token = (await cookies()).get(PORTAL_COOKIE)?.value;
  if (token) await prisma.portalSession.deleteMany({ where: { tokenHash: hashToken(token) } });
}

/**
 * 證件＋生日＋OTP 查詢身分：全部驗證通過才回病人；
 * 任一不符一律回中性錯誤（避免探測證件號是否存在）。
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
