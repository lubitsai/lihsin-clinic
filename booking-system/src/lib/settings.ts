import { prisma, type Tx } from "./db";

/** 系統設定：後台可調，程式碼提供預設值 */
export const SETTING_DEFAULTS = {
  "booking.open_days": 14, // 滾動開放天數（含今天）
  "booking.same_day_cutoff_minutes": 30, // 當日時段開始前 N 分鐘停止預約
  "booking.window_days": 7, // 連續視窗天數
  "booking.window_max": 3, // 視窗內有效預約上限
  "booking.no_show_threshold": 3, // 未到累計「超過」此數（第 threshold+1 次）自動限制
  "booking.cancel_cutoff_minutes": 120, // 看診前 N 分鐘停止線上取消/改期
  "booking.default_slot_capacity": 1, // 每醫師每 30 分鐘預設線上名額
  "booking.allow_same_day": true, // 是否開放當日預約
  "notify.same_day_reminder": true,
  "notify.day_before_time": "19:00",
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
