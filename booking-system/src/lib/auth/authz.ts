/**
 * 權限定義與檢查。
 * 角色 → 權限字串；後端每個操作以 requirePermission 檢查，前端僅作顯示控制。
 */
import { BookingError } from "../errors";
import type { StaffContext } from "./staff";

export const PERMISSIONS = {
  APPOINTMENTS_READ: "appointments:read",
  APPOINTMENTS_WRITE: "appointments:write", // 代約/改期/取消/報到/未到
  APPOINTMENTS_OVERRIDE: "appointments:override", // 覆寫同日/7天/受限（需理由）
  SCHEDULE_WRITE: "schedule:write", // 排班/休診/特殊時段
  PATIENTS_READ: "patients:read",
  PATIENTS_WRITE: "patients:write",
  PATIENTS_MERGE: "patients:merge", // 合併病歷（僅管理員）
  RESTRICTIONS_READ: "restrictions:read",
  RESTRICTIONS_MANAGE: "restrictions:manage", // 解除/重設（僅管理員）
  STAFF_MANAGE: "staff:manage", // 員工帳號（僅管理員）
  SETTINGS_MANAGE: "settings:manage", // 系統設定（僅管理員）
  AUDIT_READ: "audit:read", // 稽核紀錄（僅管理員）
  PII_FULL: "pii:full", // 查看完整證件號
  DOCTOR_SELF_READ: "doctor:self_read", // 醫師唯讀
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** 預設角色權限（seed 與建立角色時使用） */
export const ROLE_PERMISSIONS: Record<string, string[]> = {
  ADMIN: Object.values(PERMISSIONS),
  STAFF: [
    PERMISSIONS.APPOINTMENTS_READ,
    PERMISSIONS.APPOINTMENTS_WRITE,
    PERMISSIONS.APPOINTMENTS_OVERRIDE,
    PERMISSIONS.SCHEDULE_WRITE,
    PERMISSIONS.PATIENTS_READ,
    PERMISSIONS.PATIENTS_WRITE,
    PERMISSIONS.RESTRICTIONS_READ,
  ],
  DOCTOR_READONLY: [PERMISSIONS.DOCTOR_SELF_READ],
};

export function hasPermission(ctx: StaffContext, permission: Permission): boolean {
  return ctx.permissions.has(permission);
}

export function requirePermission(ctx: StaffContext | null, permission: Permission): StaffContext {
  if (!ctx) throw new BookingError("FORBIDDEN", "請先登入");
  if (!hasPermission(ctx, permission))
    throw new BookingError("FORBIDDEN", "您的帳號沒有執行此操作的權限");
  return ctx;
}
