import { CLINIC } from "./clinic-info";

/** 預約業務錯誤：code 供程式判斷、userMessage 為可直接顯示給使用者的繁中訊息 */
export type BookingErrorCode =
  | "DATE_NOT_OPEN"          // 未開放的日期（過去或超過滾動開放範圍）
  | "SLOT_UNAVAILABLE"       // 時段不存在/已休診/已封鎖/已過期
  | "SLOT_FULL"              // 名額已滿
  | "DUPLICATE_SAME_DAY"     // 同日已有有效預約
  | "WEEKLY_LIMIT"           // 7 天內超過上限
  | "RESTRICTED"             // 預約限制名單
  | "CUTOFF_PASSED"          // 已過取消/改期截止時間
  | "NOT_FOUND"              // 查無資料（對外一律中性訊息）
  | "INVALID_STATUS"         // 狀態不允許此操作
  | "IDENTITY_MISMATCH"      // 證件與生日不符（對外中性訊息）
  | "VALIDATION"             // 輸入驗證失敗
  | "CLINIC_TYPE_CLOSED"     // 門診類型未開放
  | "AGE_NOT_ELIGIBLE"       // 年齡不符門診限制
  | "FORBIDDEN";             // 權限不足

export class BookingError extends Error {
  code: BookingErrorCode;
  userMessage: string;

  constructor(code: BookingErrorCode, userMessage: string) {
    super(`${code}: ${userMessage}`);
    this.code = code;
    this.userMessage = userMessage;
  }
}

export const MSG = {
  duplicateSameDay:
    "您當天已有預約，無法重複預約其他門診或時段。如需更改，請先取消原預約或聯絡立欣診所。",
  weeklyLimit: (days: number, max: number) =>
    `為維護預約公平性，每位病人在 ${days} 天內最多預約 ${max} 個時段。如有特殊需求，請致電立欣診所。`,
  restricted: "目前無法使用線上預約，請致電立欣診所，由櫃檯人員協助。",
  slotFull: "此時段名額已滿，請選擇其他時段。",
  slotUnavailable: "此時段目前無法預約，請重新選擇時段。",
  dateNotOpen: "此日期尚未開放預約，請選擇開放範圍內的日期。",
  cutoffPassed: `已超過線上取消／改期的截止時間，如需協助請致電立欣診所 ${CLINIC.phone}。`,
  notFound: "查無符合的預約資料，請確認輸入內容。",
  identityMismatch: "查無符合的預約資料，請確認輸入內容。", // 與 notFound 相同,避免身分探測
  clinicTypeClosed: "此門診目前未開放線上預約，請致電立欣診所詢問。",
} as const;
