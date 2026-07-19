/**
 * Seed：預設醫師、四種門診類型、需求書預設營業時間、角色與測試帳號。
 * 正式環境請改用 scripts/create-admin.ts 建立管理員，並在後台調整班表。
 */
import { PrismaClient, type SessionPeriod } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const ROLE_PERMISSIONS: Record<string, string[]> = {
  ADMIN: [
    "appointments:read", "appointments:write", "appointments:override",
    "schedule:write", "patients:read", "patients:write", "patients:merge",
    "restrictions:read", "restrictions:manage", "staff:manage",
    "settings:manage", "audit:read", "pii:full", "doctor:self_read",
  ],
  STAFF: [
    "appointments:read", "appointments:write", "appointments:override",
    "schedule:write", "patients:read", "patients:write", "restrictions:read",
  ],
  DOCTOR_READONLY: ["doctor:self_read"],
};

async function main() {
  // 醫師
  const drTsai = await prisma.doctor.upsert({
    where: { id: "seed-dr-tsai" },
    create: { id: "seed-dr-tsai", name: "蔡宗儒", title: "院長", displayOrder: 1, color: "#2F5D3A" },
    update: {},
  });
  const drLee = await prisma.doctor.upsert({
    where: { id: "seed-dr-lee" },
    create: { id: "seed-dr-lee", name: "李佳玲", title: "主治醫師", displayOrder: 2, color: "#8B5E3C" },
    update: {},
  });
  const doctorIds = [drTsai.id, drLee.id];

  // 門診類型（特別門診預約時段為示意設定，正式排程請於後台調整）
  const clinicTypes = [
    {
      code: "GENERAL", name: "一般門診", color: "#2F5D3A", icon: "stethoscope", displayOrder: 1,
      description: "兒科、家庭醫學一般看診與疫苗接種",
      notice: "線上預約為時段登記，非實際看診號碼，請依現場狀況候診。",
      requiresReview: false, allowedWeekdays: [] as number[], allowedSessions: [] as SessionPeriod[],
    },
    {
      code: "DEVELOPMENT", name: "兒童發展篩檢", color: "#8B5E3C", icon: "growth", displayOrder: 2,
      description: "兒童發展評估與篩檢（需櫃檯確認）",
      notice: "請攜帶兒童健康手冊；送出後需櫃檯確認才成立。",
      requiresReview: true, allowedWeekdays: [2, 4], allowedSessions: ["AFTERNOON"] as SessionPeriod[],
      maxAgeMonths: 84,
    },
    {
      code: "WEIGHT", name: "減重特別門診", color: "#E0592A", icon: "scale", displayOrder: 3,
      description: "體重管理特別門診（需櫃檯確認）",
      notice: "初診請預留較長看診時間；送出後需櫃檯確認才成立。",
      requiresReview: true, allowedWeekdays: [3, 6], allowedSessions: ["AFTERNOON"] as SessionPeriod[],
    },
    {
      code: "ALLERGY", name: "過敏特別門診", color: "#3d7a4e", icon: "allergy", displayOrder: 4,
      description: "兒童過敏、氣喘評估與檢測（需櫃檯確認）",
      notice: "如需過敏原檢測，請先電話詢問空腹等注意事項；送出後需櫃檯確認才成立。",
      requiresReview: true, allowedWeekdays: [1, 5], allowedSessions: ["EVENING"] as SessionPeriod[],
    },
  ];
  for (const t of clinicTypes) {
    const created = await prisma.clinicType.upsert({
      where: { code: t.code },
      create: { ...t },
      update: {},
    });
    for (const doctorId of doctorIds) {
      await prisma.clinicTypeDoctor.upsert({
        where: { clinicTypeId_doctorId: { clinicTypeId: created.id, doctorId } },
        create: { clinicTypeId: created.id, doctorId },
        update: {},
      });
    }
  }

  // 預設營業時間（需求書）：兩位醫師皆排班（雙診），實際單/雙診請於後台調整
  const sessions: Record<number, { session: SessionPeriod; start: string; end: string }[]> = {
    1: [
      { session: "MORNING", start: "08:00", end: "12:00" },
      { session: "AFTERNOON", start: "14:30", end: "18:00" },
      { session: "EVENING", start: "18:30", end: "21:30" },
    ],
    6: [
      { session: "MORNING", start: "08:00", end: "11:30" },
      { session: "AFTERNOON", start: "14:30", end: "18:00" },
    ],
    0: [
      { session: "MORNING", start: "08:00", end: "11:30" },
      { session: "EVENING", start: "18:30", end: "21:00" },
    ],
  };
  for (let weekday = 0; weekday <= 6; weekday++) {
    const list = weekday >= 1 && weekday <= 5 ? sessions[1] : sessions[weekday === 6 ? 6 : 0];
    for (const s of list) {
      for (const doctorId of doctorIds) {
        await prisma.weeklyScheduleTemplate.upsert({
          where: { weekday_session_doctorId: { weekday, session: s.session, doctorId } },
          create: {
            weekday, session: s.session, startTime: s.start, endTime: s.end,
            doctorId, slotCapacity: 1, allowOnline: true,
          },
          update: {},
        });
      }
    }
  }

  // 角色與測試帳號（正式環境務必改密碼或改用 create-admin 腳本）
  for (const [code, permissions] of Object.entries(ROLE_PERMISSIONS)) {
    await prisma.staffRole.upsert({
      where: { code },
      create: {
        code,
        name: code === "ADMIN" ? "系統管理員" : code === "STAFF" ? "櫃檯人員" : "醫師唯讀",
        permissions,
      },
      update: { permissions },
    });
  }
  const adminRole = await prisma.staffRole.findUniqueOrThrow({ where: { code: "ADMIN" } });
  const staffRole = await prisma.staffRole.findUniqueOrThrow({ where: { code: "STAFF" } });
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "lihsin-admin-2026";
  const staffPassword = process.env.SEED_STAFF_PASSWORD ?? "lihsin-staff-2026";
  await prisma.staffUser.upsert({
    where: { username: "admin" },
    create: {
      username: "admin",
      displayName: "系統管理員",
      passwordHash: await bcrypt.hash(adminPassword, 12),
      roleId: adminRole.id,
    },
    update: {},
  });
  await prisma.staffUser.upsert({
    where: { username: "counter1" },
    create: {
      username: "counter1",
      displayName: "櫃檯一號",
      passwordHash: await bcrypt.hash(staffPassword, 12),
      roleId: staffRole.id,
    },
    update: {},
  });

  console.log("Seed 完成：");
  console.log(`  管理員帳號 admin / ${adminPassword}`);
  console.log(`  櫃檯帳號 counter1 / ${staffPassword}`);
  console.log("  ⚠️ 正式環境請立即修改密碼並為管理員啟用兩步驟驗證。");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
