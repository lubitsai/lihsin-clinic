/**
 * 櫃檯核對制的 LINE 綁定（院長 2026-08-15 裁示）。
 *
 * 綁定＝該 LINE 帳號從此看得到這位病人的**所有**預約紀錄，所以只有兩種來源：
 *   1. 線上預約時新建的病歷——沒有既有紀錄可外洩（見 actions/portal.ts）
 *   2. 櫃檯當面核對健保卡後，以本檔的綁定代碼建立
 *
 * 民眾自助綁定既有病歷的路已經拿掉：證件號、生日、手機這三項知道的人不只本人
 * （家屬、學校、外流名單都可能有），拿來當關卡等於讓人冒用證件綁走病歷身分。
 */
import { prisma } from "./db";
import { hashToken, normalizeBindingCode } from "./crypto";
import { BookingError } from "./errors";

/** 代碼效期：夠家長從手機走到櫃檯，又不會整天有效 */
export const BINDING_CODE_TTL_MS = 30 * 60_000;

export interface BindingCodeOwner {
  lineAccountId: string;
  displayName: string | null;
}

/**
 * 核銷綁定代碼並回傳對應的 LINE 帳號。
 * 代碼一次性：核銷後同一組不能再用（櫃檯輸錯病人時要請家長重新產生一組，
 * 這是刻意的——避免一組代碼被連續綁到好幾筆病歷）。
 */
export async function consumeBindingCode(rawCode: string): Promise<BindingCodeOwner> {
  const code = normalizeBindingCode(rawCode);
  if (code.length < 4) throw new BookingError("VALIDATION", "綁定代碼格式不正確");

  const row = await prisma.lineBindingCode.findUnique({
    where: { codeHash: hashToken(code) },
    include: { lineAccount: true },
  });
  if (!row || row.consumedAt || row.expiresAt < new Date()) {
    throw new BookingError("NOT_FOUND", "綁定代碼無效或已過期，請請家長重新產生一組");
  }
  // 原子認領：兩位櫃檯同時輸入同一組時只有一位成功
  const claimed = await prisma.lineBindingCode.updateMany({
    where: { id: row.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (claimed.count === 0) {
    throw new BookingError("NOT_FOUND", "綁定代碼無效或已過期，請請家長重新產生一組");
  }
  return { lineAccountId: row.lineAccountId, displayName: row.lineAccount.displayName };
}
