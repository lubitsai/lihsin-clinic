/**
 * 員工驗證：帳密（bcrypt）＋管理員 TOTP 2FA＋DB session（閒置逾時、絕對逾時）。
 * 登入失敗次數限制與帳號鎖定防暴力破解。
 */
import bcrypt from "bcryptjs";
import { authenticator } from "otplib";
import { cookies } from "next/headers";
import { prisma } from "../db";
import { hashToken, randomToken } from "../crypto";
import { encryptPii, decryptPii } from "../crypto";
import { getSetting } from "../settings";
import { writeAudit } from "../audit";
import type { StaffRole, StaffUser } from "@prisma/client";

export const STAFF_COOKIE = "lihsin_staff_session";

export type StaffLoginResult =
  | { ok: true; needsTotp: false; user: StaffUser }
  | { ok: true; needsTotp: true; pendingUserId: string }
  | { ok: false; message: string };

export async function verifyStaffPassword(
  username: string,
  password: string,
  ip?: string,
): Promise<StaffLoginResult> {
  const genericFail = { ok: false as const, message: "帳號或密碼錯誤" };
  const user = await prisma.staffUser.findUnique({ where: { username } });
  if (!user || !user.isActive) return genericFail;

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return { ok: false, message: "登入失敗次數過多，帳號暫時鎖定，請稍後再試" };
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    const maxFailures = await getSetting("security.login_max_failures");
    const lockMinutes = await getSetting("security.login_lock_minutes");
    const failed = user.failedLoginCount + 1;
    await prisma.staffUser.update({
      where: { id: user.id },
      data: {
        failedLoginCount: failed,
        lockedUntil:
          failed >= maxFailures ? new Date(Date.now() + lockMinutes * 60000) : undefined,
      },
    });
    await writeAudit(
      { type: "SYSTEM", name: "auth" },
      "staff.login_failed",
      { type: "staff_user", id: user.id },
      { ip, failed },
    );
    return genericFail;
  }

  await prisma.staffUser.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null },
  });

  if (user.totpEnabled) return { ok: true, needsTotp: true, pendingUserId: user.id };
  return { ok: true, needsTotp: false, user };
}

export async function verifyStaffTotp(userId: string, code: string): Promise<StaffUser | null> {
  const user = await prisma.staffUser.findUnique({ where: { id: userId } });
  if (!user?.totpSecret) return null;
  const secret = decryptPii(user.totpSecret);
  return authenticator.verify({ token: code.replaceAll(" ", ""), secret }) ? user : null;
}

/** 產生 TOTP 秘鑰（設定畫面顯示 QR 用；確認一組正確碼後才 enable） */
export function generateTotpSecret(username: string) {
  const secret = authenticator.generateSecret();
  const otpauth = authenticator.keyuri(username, "立欣診所預約系統", secret);
  return { secret, otpauth, encrypted: encryptPii(secret) };
}

export async function createStaffSession(user: StaffUser, ip?: string): Promise<string> {
  const token = randomToken();
  const hours = await getSetting("security.staff_session_hours");
  await prisma.staffSession.create({
    data: {
      tokenHash: hashToken(token),
      staffUserId: user.id,
      ip,
      expiresAt: new Date(Date.now() + hours * 3600000),
    },
  });
  await prisma.staffUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await writeAudit(
    { type: "STAFF", id: user.id, name: user.displayName, ip },
    "staff.login",
    { type: "staff_user", id: user.id },
  );
  return token;
}

export interface StaffContext {
  user: StaffUser & { role: StaffRole };
  permissions: Set<string>;
}

/** 取得目前登入員工（含閒置逾時檢查）；未登入回 null */
export async function getStaffContext(): Promise<StaffContext | null> {
  const token = (await cookies()).get(STAFF_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.staffSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { staffUser: { include: { role: true } } },
  });
  if (!session || session.expiresAt < new Date() || !session.staffUser.isActive) return null;

  const idleMinutes = await getSetting("security.staff_idle_minutes");
  if (Date.now() - session.lastSeenAt.getTime() > idleMinutes * 60000) {
    await prisma.staffSession.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  // 更新活動時間（每分鐘最多一次，減少寫入）
  if (Date.now() - session.lastSeenAt.getTime() > 60000) {
    await prisma.staffSession.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date() },
    });
  }
  return {
    user: session.staffUser,
    permissions: new Set(session.staffUser.role.permissions),
  };
}

export async function destroyStaffSession() {
  const token = (await cookies()).get(STAFF_COOKIE)?.value;
  if (token) {
    await prisma.staffSession.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
}
