import type { AppointmentStatus, SessionPeriod } from "@prisma/client";

/** 狀態顯示：顏色＋文字＋圖示（不能只靠顏色辨識） */
export const STATUS_META: Record<
  AppointmentStatus,
  { label: string; icon: string; className: string }
> = {
  PENDING: { label: "待確認", icon: "⏳", className: "bg-wood-100 text-wood-700 border-wood-400" },
  CONFIRMED: { label: "已確認", icon: "✅", className: "bg-sage-100 text-sage-800 border-sage-300" },
  CHECKED_IN: { label: "已報到", icon: "🪪", className: "bg-sage-200 text-sage-800 border-sage-500" },
  COMPLETED: { label: "已完成", icon: "🏁", className: "bg-ink-300/20 text-ink-700 border-ink-300" },
  CANCELLED_BY_PATIENT: { label: "病人取消", icon: "↩️", className: "bg-white text-ink-500 border-ink-300" },
  CANCELLED_BY_CLINIC: { label: "診所取消", icon: "🏥", className: "bg-rose-100 text-rose-600 border-rose-300" },
  NO_SHOW: { label: "未到", icon: "⚠️", className: "bg-rose-200 text-rose-600 border-rose-500" },
  RESCHEDULED: { label: "已改期", icon: "🔁", className: "bg-white text-ink-500 border-ink-300" },
};

export const SESSION_META: Record<SessionPeriod, { label: string }> = {
  MORNING: { label: "早診" },
  AFTERNOON: { label: "午診" },
  EVENING: { label: "晚診" },
};

export const SOURCE_LABEL: Record<string, string> = {
  WEB: "網頁",
  LINE: "LINE",
  STAFF: "櫃檯",
};

export const VISIT_TYPE_LABEL: Record<string, string> = {
  FIRST_VISIT: "初診",
  RETURN_VISIT: "複診",
};

export const ID_TYPE_LABEL: Record<string, string> = {
  NATIONAL_ID: "身分證",
  RESIDENT_CERT: "居留證",
  PASSPORT: "護照",
};
