/**
 * 各門診類型在預約流程中固定顯示的說明。
 *
 * 為什麼不放在 `clinic_types.notice`：那個欄位櫃檯可自行編輯、也可能清空，
 * 而這裡的內容是**合規紅線與官網已公告的規則**（internal/00 §4-2 疫苗但書、
 * §4-5 非急診；2026-07-31 院長核可之預約規則公告），不能因為有人改了設定就消失。
 * 兩者會一起顯示：這裡是固定的規則，notice 是診所當期的補充。
 *
 * 文字取自官網公告原文；改動視同修改可見文字，需院長逐字核可。
 */
export interface ClinicNote {
  title: string;
  items: string[];
}

/** 以門診類型 code 對應（code 為 @unique 且不開放後台修改） */
export const CLINIC_TYPE_NOTES: Record<string, ClinicNote> = {
  GENERAL: {
    title: "要打預防針的話",
    items: [
      "每日最後一診前 1 小時停止施打疫苗（清點申報作業）。不論預約或現場，都請在週一至週五 20:30 前、週六 17:00 前、週日 20:00 前到院。",
      "實際可否接種，仍依醫師當日評估與疫苗現貨為準。",
    ],
  },
  DEVELOPMENT: {
    title: "施測前請先確認",
    items: [
      "當天請帶健保卡與兒童健康手冊，兩樣缺一即無法施測。",
      "每個時段只安排 1 位兒童施測；家中有 2 位兒童要施測，請分別預約 2 個時段。",
      "施測時間為週二至週五上午 09:00–11:30、下午 14:30–16:00；週一僅下午 14:30–16:00（國定假日不施測）。",
      "早產的孩子請依矯正年齡（不是出生後的實際月齡）挑選對應的時段；不確定可先來電由櫃檯協助。",
    ],
  },
};

export function clinicNoteOf(code: string): ClinicNote | undefined {
  return CLINIC_TYPE_NOTES[code];
}
