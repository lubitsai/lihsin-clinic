import type { AppointmentStatus, SessionPeriod } from "@prisma/client";

/** 狀態顯示：顏色＋文字＋圖示（不能只靠顏色辨識） */
export const STATUS_META: Record<
  AppointmentStatus,
  { label: string; icon: string; className: string }
> = {
  PENDING: { label: "待確認", icon: "⏳", className: "bg-amber-100 text-amber-900 border-amber-300" },
  CONFIRMED: { label: "已確認", icon: "✅", className: "bg-forest-500/10 text-forest-700 border-forest-500/40" },
  CHECKED_IN: { label: "已報到", icon: "🪪", className: "bg-sky-100 text-sky-900 border-sky-300" },
  COMPLETED: { label: "已完成", icon: "🏁", className: "bg-stone-200 text-stone-700 border-stone-300" },
  CANCELLED_BY_PATIENT: { label: "病人取消", icon: "↩️", className: "bg-stone-100 text-stone-500 border-stone-300" },
  CANCELLED_BY_CLINIC: { label: "診所取消", icon: "🏥", className: "bg-purple-100 text-purple-900 border-purple-300" },
  NO_SHOW: { label: "未到", icon: "⚠️", className: "bg-persimmon-500/10 text-persimmon-600 border-persimmon-500/40" },
  RESCHEDULED: { label: "已改期", icon: "🔁", className: "bg-stone-100 text-stone-500 border-stone-300" },
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
