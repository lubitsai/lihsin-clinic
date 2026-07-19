/**
 * 建立（或重設）系統管理員帳號。
 * 用法：
 *   ADMIN_USERNAME=admin ADMIN_PASSWORD='安全密碼' npm run create-admin
 * 或：npm run create-admin -- <username> <password>
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { ROLE_PERMISSIONS } from "../src/lib/auth/authz";

const prisma = new PrismaClient();

const ADMIN_PERMISSIONS = ROLE_PERMISSIONS.ADMIN;

async function main() {
  const username = process.env.ADMIN_USERNAME ?? process.argv[2];
  const password = process.env.ADMIN_PASSWORD ?? process.argv[3];
  if (!username || !password) {
    console.error("用法：ADMIN_USERNAME=帳號 ADMIN_PASSWORD=密碼 npm run create-admin");
    process.exit(1);
  }
  if (password.length < 10) {
    console.error("密碼至少 10 字元");
    process.exit(1);
  }
  const role = await prisma.staffRole.upsert({
    where: { code: "ADMIN" },
    create: { code: "ADMIN", name: "系統管理員", permissions: ADMIN_PERMISSIONS },
    update: { permissions: ADMIN_PERMISSIONS },
  });
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.staffUser.upsert({
    where: { username },
    create: { username, displayName: "系統管理員", passwordHash, roleId: role.id },
    update: { passwordHash, isActive: true, failedLoginCount: 0, lockedUntil: null },
  });
  await prisma.auditLog.create({
    data: {
      actorType: "SYSTEM",
      actorName: "create-admin script",
      action: "staff.admin_bootstrap",
      targetType: "staff_user",
      targetId: user.id,
    },
  });
  console.log(`管理員「${username}」已建立/重設完成。請登入後台並立即啟用兩步驟驗證。`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
