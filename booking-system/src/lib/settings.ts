import { prisma, type Tx } from "./db";

/** 系統設定：後台可調，程式碼提供預設值 */
export const SETTING_DEFAULTS = {
  "booking.open_days": 14, // 滾動開放天數（含今天）
  "booking.open_time": "00:00", // 每日開放「第 N 天」時段的時間（台灣時間）
  // 官網公告：網路預約請在該時段開始的 4 小時前完成
  "booking.same_day_cutoff_minutes": 240, // 時段開始前 N 分鐘停止預約
  // 官網公告：每個預約帳號同時最多保留 2 筆尚未完成的預約（當日的預約不計入）
  "booking.active_max": 2, // 每個預約帳號的同時未完成預約上限
  "booking.max_companions": 3, // 家庭代表預約可帶的同行家人上限
  // 官網公告：累計 3 次未到暫停網路預約 3 個月，期滿累計歸零
  "booking.no_show_threshold": 3, // 未到累計「達」此數即自動限制
  "booking.no_show_suspension_days": 90, // 自動限制的天數；到期自動恢復並歸零未到次數
  // 官網公告：該診次開診前都可自行取消或改期。開診時間取自當日班表，
  // 只有查不到診次（櫃檯在班表外手動加開的時段）時才退回這個分鐘數。
  "booking.cancel_cutoff_minutes": 120, // 查無診次時的備援：看診前 N 分鐘停止線上取消/改期
  // 官網公告：請於預約時段開始後 10 分鐘內完成報到，逾時該筆預約即取消、需重新抽現場號。
  // 系統不自動取消——櫃檯總覽以「報到逾時」標記提醒，由櫃檯確認現場狀況後處理。
  "booking.checkin_grace_minutes": 10, // 報到保留分鐘數（櫃檯總覽逾時標記用）
  "booking.default_slot_capacity": 1, // 每醫師每 30 分鐘預設線上名額
  "booking.allow_same_day": true, // 是否開放當日預約
  // 院長 2026-08-05 裁示：提醒只發一次，於前一日 20:00
  "notify.same_day_reminder": false, // 當日提醒（關閉；開啟後於 same_day_time 發送）
  "notify.day_before_time": "20:00",
  "notify.same_day_time": "08:00",
  "security.staff_idle_minutes": 30,
  "security.staff_session_hours": 12,
  "security.login_max_failures": 5,
  "security.login_lock_minutes": 15,
  "privacy.retention_years": 3,
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;
type SettingValue<K extends SettingKey> = (typeof SETTING_DEFAULTS)[K];

const cache = new Map<string, { value: unknown; at: number }>();
const CACHE_MS = 10_000;

export async function getSetting<K extends SettingKey>(
  key: K,
  tx?: Tx,
): Promise<SettingValue<K>> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as SettingValue<K>;
  const db = tx ?? prisma;
  const row = await db.systemSetting.findUnique({ where: { key } });
  const value = (row ? (row.value as SettingValue<K>) : SETTING_DEFAULTS[key]);
  cache.set(key, { value, at: Date.now() });
  return value;
}

export async function setSetting(key: SettingKey, value: unknown, updatedBy: string) {
  await prisma.systemSetting.upsert({
    where: { key },
    create: { key, value: value as never, updatedBy },
    update: { value: value as never, updatedBy },
  });
  cache.delete(key);
}

export function clearSettingsCache() {
  cache.clear();
}
