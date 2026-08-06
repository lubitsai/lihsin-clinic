/**
 * Seed：預設醫師、四種門診類型、班表（依官網）、角色與測試帳號。
 * 班表不寫在這裡——以官網門診時間表為準，見 prisma/schedule.json 與 scripts/sync-schedule.ts。
 * 正式環境請改用 scripts/create-admin.ts 建立管理員。
 */
import { PrismaClient, type SessionPeriod } from "@prisma/client";
import bcrypt from "bcryptjs";
// 權限矩陣單一來源：authz.ts（此檔與 create-admin 腳本皆由此匯入，避免三份副本漂移）
import { ROLE_PERMISSIONS } from "../src/lib/auth/authz";
import { applySchedule, loadScheduleSource } from "../src/lib/schedule-source";
import { importBundledHolidays } from "../src/lib/holidays";
import { todayStr } from "../src/lib/tw-time";

const prisma = new PrismaClient();

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
  const bothDoctors = [drTsai.id, drLee.id];

  // 門診類型（院長 2026-08-05 定案醫師與開放時段；後台「系統設定 → 門診類型」可再調整）
  // doctorIds＝可接受該門診預約的醫師。allowedWeekdays／allowedSessions 留空
  // ＝不另設限制，可預約時段直接跟著該門診醫師的班表走。
  const clinicTypes = [
    {
      code: "GENERAL", name: "一般門診", color: "#2F5D3A", icon: "stethoscope", displayOrder: 1,
      doctorIds: bothDoctors,
      description: "兒科、家庭醫學一般看診與疫苗接種",
      // 疫苗停打時間與但書不放這裡——notice 是櫃檯可自行編輯的欄位，
      // 合規文字（00 §4-2）改由程式碼固定顯示，見 src/lib/clinic-notes.ts
      notice: "線上預約為時段登記，非實際看診號碼，請依現場狀況候診。",
      requiresReview: false, allowedWeekdays: [] as number[], allowedSessions: [] as SessionPeriod[],
    },
    {
      code: "DEVELOPMENT", name: "兒童發展篩檢", color: "#8B5E3C", icon: "growth", displayOrder: 2,
      doctorIds: bothDoctors,
      description: "兒童發展評估與篩檢",
      // 施測規則（健保卡＋手冊、一時段一位、矯正年齡）同樣由 clinic-notes.ts 固定顯示
      notice: "",
      // 院長 2026-08-05：特別門診與一般門診一樣，送出即成立、不需櫃檯確認
      requiresReview: false,
      // 施測時間改由下方 windows 表達（逐日不同），故粗篩留空
      allowedWeekdays: [] as number[], allowedSessions: [] as SessionPeriod[],
      maxAgeMonths: 84,
      // 官網公告：兒童發展篩檢每個時段只安排 1 位兒童施測，故不適用家庭代表預約
      allowCompanions: false,
      // 官網公告：國定假日不施測（診所當天照常看診，只有這一科停）
      // 假日清單需另行匯入：npx tsx scripts/import-holidays.ts <官方日曆表 CSV>
      skipOnPublicHoliday: true,
      // 官網公告：週二至週五上午 09:00–11:30、下午 14:30–16:00；週一僅下午 14:30–16:00
      windows: [
        { weekday: 1, startTime: "14:30", endTime: "16:00" },
        ...[2, 3, 4, 5].flatMap((weekday) => [
          { weekday, startTime: "09:00", endTime: "11:30" },
          { weekday, startTime: "14:30", endTime: "16:00" },
        ]),
      ],
    },
    {
      code: "WEIGHT", name: "減重特別門診", color: "#E0592A", icon: "scale", displayOrder: 3,
      doctorIds: [drTsai.id], // 僅蔡醫師
      description: "體重管理特別門診",
      notice: "初診請預留較長看診時間。",
      // 院長 2026-08-05：蔡醫師有開診的時段皆開放 → 不另設星期／診別，
      // 可預約時段直接跟著蔡醫師的班表走（門診醫師名單已限定只有蔡醫師）；
      // 同日裁示：送出即成立、不需櫃檯確認
      requiresReview: false, allowedWeekdays: [] as number[], allowedSessions: [] as SessionPeriod[],
    },
    {
      code: "ALLERGY", name: "過敏特別門診", color: "#3d7a4e", icon: "allergy", displayOrder: 4,
      doctorIds: [drTsai.id], // 僅蔡醫師
      description: "兒童過敏、氣喘評估與檢測",
      notice: "如需過敏原檢測，請先電話詢問空腹等注意事項。",
      // 同減重：跟著蔡醫師的班表走、送出即成立
      requiresReview: false, allowedWeekdays: [] as number[], allowedSessions: [] as SessionPeriod[],
    },
  ];
  for (const t of clinicTypes) {
    const { windows = [], doctorIds, ...fields } = t as typeof t & {
      windows?: { weekday: number; startTime: string; endTime: string }[];
    };
    const created = await prisma.clinicType.upsert({
      where: { code: fields.code },
      create: { ...fields },
      update: {},
    });
    for (const w of windows) {
      await prisma.clinicTypeWindow.upsert({
        where: {
          clinicTypeId_weekday_startTime: {
            clinicTypeId: created.id,
            weekday: w.weekday,
            startTime: w.startTime,
          },
        },
        create: { clinicTypeId: created.id, ...w },
        update: { endTime: w.endTime },
      });
    }
    for (const doctorId of doctorIds) {
      await prisma.clinicTypeDoctor.upsert({
        where: { clinicTypeId_doctorId: { clinicTypeId: created.id, doctorId } },
        create: { clinicTypeId: created.id, doctorId },
        update: {},
      });
    }
    // 移除不再開放的醫師（重跑 seed 時才會用到；後台的手動調整不受影響——
    // 後台改的是同一張表，seed 只在這裡把名單校正回指定值）
    await prisma.clinicTypeDoctor.deleteMany({
      where: { clinicTypeId: created.id, doctorId: { notIn: doctorIds } },
    });
  }

  // 班表：以官網門診時間表為準，讀 prisma/schedule.json
  // （該檔由 internal/tools/sync_schedule.py 從 index.html 產生，勿手改）。
  // 與 scripts/sync-schedule.ts 共用同一段套用邏輯，避免初次建置與日後同步不一致。
  const applied = await applySchedule(prisma, loadScheduleSource(), todayStr());
  console.log(
    `班表已依官網同步：新增 ${applied.created}、更新 ${applied.updated}、移除 ${applied.removed}、` +
      `單日例外 ${applied.exceptionsApplied} 筆`,
  );
  for (const w of applied.warnings) console.log(`  ⚠️ ${w}`);

  // 國定假日：匯入隨程式碼附帶的日曆表（prisma/holidays/*.csv），新部署即內建
  const hol = await importBundledHolidays();
  console.log(
    `國定假日已匯入 ${hol.files} 個年度檔：新增 ${hol.created}、更新 ${hol.updated}`,
  );

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

  // 醫師唯讀帳號（院長 2026-08-05 裁示啟用）：只能看自己的預約，不能代約／改期／取消
  const doctorRole = await prisma.staffRole.findUniqueOrThrow({
    where: { code: "DOCTOR_READONLY" },
  });
  const doctorPassword = process.env.SEED_DOCTOR_PASSWORD ?? "lihsin-doctor-2026";
  const doctorAccounts = [
    { username: "dr-tsai", displayName: "蔡宗儒醫師", doctorId: drTsai.id },
    { username: "dr-lee", displayName: "李佳玲醫師", doctorId: drLee.id },
  ];
  for (const a of doctorAccounts) {
    await prisma.staffUser.upsert({
      where: { username: a.username },
      create: {
        username: a.username,
        displayName: a.displayName,
        passwordHash: await bcrypt.hash(doctorPassword, 12),
        roleId: doctorRole.id,
        doctorId: a.doctorId,
      },
      update: {},
    });
  }

  console.log("Seed 完成：");
  console.log(`  管理員帳號 admin / ${adminPassword}`);
  console.log(`  櫃檯帳號 counter1 / ${staffPassword}`);
  for (const a of doctorAccounts) {
    console.log(`  醫師唯讀帳號 ${a.username}（${a.displayName}）/ ${doctorPassword}`);
  }
  console.log("  ⚠️ 正式環境請立即修改密碼並為管理員啟用兩步驟驗證。");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
