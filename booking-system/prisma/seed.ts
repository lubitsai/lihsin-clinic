/**
 * Seed：預設醫師、四種門診類型、需求書預設營業時間、角色與測試帳號。
 * 正式環境請改用 scripts/create-admin.ts 建立管理員，並在後台調整班表。
 */
import { PrismaClient, type SessionPeriod } from "@prisma/client";
import bcrypt from "bcryptjs";
// 權限矩陣單一來源：authz.ts（此檔與 create-admin 腳本皆由此匯入，避免三份副本漂移）
import { ROLE_PERMISSIONS } from "../src/lib/auth/authz";

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
      description: "兒童發展評估與篩檢（需櫃檯確認）",
      // 施測規則（健保卡＋手冊、一時段一位、矯正年齡）同樣由 clinic-notes.ts 固定顯示
      notice: "送出後需櫃檯確認才成立。",
      requiresReview: true,
      // 施測時間改由下方 windows 表達（逐日不同），故粗篩留空
      allowedWeekdays: [] as number[], allowedSessions: [] as SessionPeriod[],
      maxAgeMonths: 84,
      // 官網公告：兒童發展篩檢每個時段只安排 1 位兒童施測，故不適用家庭代表預約
      allowCompanions: false,
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
      description: "體重管理特別門診（需櫃檯確認）",
      notice: "初診請預留較長看診時間；送出後需櫃檯確認才成立。",
      // 院長 2026-08-05：蔡醫師有開診的時段皆開放 → 不另設星期／診別，
      // 可預約時段直接跟著蔡醫師的班表走（門診醫師名單已限定只有蔡醫師）
      requiresReview: true, allowedWeekdays: [] as number[], allowedSessions: [] as SessionPeriod[],
    },
    {
      code: "ALLERGY", name: "過敏特別門診", color: "#3d7a4e", icon: "allergy", displayOrder: 4,
      doctorIds: [drTsai.id], // 僅蔡醫師
      description: "兒童過敏、氣喘評估與檢測（需櫃檯確認）",
      notice: "如需過敏原檢測，請先電話詢問空腹等注意事項；送出後需櫃檯確認才成立。",
      // 同減重：跟著蔡醫師的班表走
      requiresReview: true, allowedWeekdays: [] as number[], allowedSessions: [] as SessionPeriod[],
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

  // 現行門診時間表（與官網 index.html 門診時間表一致，院長 2026-08-05 提供）
  // 多數診次為單診；雙診只有兩處：週一晚診、週日早診（蔡／李同時看診）。
  const WEEKLY: Record<
    number,
    { session: SessionPeriod; start: string; end: string; doctors: string[] }[]
  > = {
    // 週日：早診雙診、午診休診、晚診至 21:00
    0: [
      { session: "MORNING", start: "08:00", end: "11:30", doctors: [drTsai.id, drLee.id] },
      { session: "EVENING", start: "18:30", end: "21:00", doctors: [drTsai.id] },
    ],
    // 週一：晚診雙診
    1: [
      { session: "MORNING", start: "08:00", end: "12:00", doctors: [drTsai.id] },
      { session: "AFTERNOON", start: "14:30", end: "18:00", doctors: [drTsai.id] },
      { session: "EVENING", start: "18:30", end: "21:30", doctors: [drTsai.id, drLee.id] },
    ],
    2: [
      { session: "MORNING", start: "08:00", end: "12:00", doctors: [drTsai.id] },
      { session: "AFTERNOON", start: "14:30", end: "18:00", doctors: [drTsai.id] },
      { session: "EVENING", start: "18:30", end: "21:30", doctors: [drTsai.id] },
    ],
    // 週三晚診＝李醫師
    3: [
      { session: "MORNING", start: "08:00", end: "12:00", doctors: [drTsai.id] },
      { session: "AFTERNOON", start: "14:30", end: "18:00", doctors: [drTsai.id] },
      { session: "EVENING", start: "18:30", end: "21:30", doctors: [drLee.id] },
    ],
    // 週四早診＝李醫師
    4: [
      { session: "MORNING", start: "08:00", end: "12:00", doctors: [drLee.id] },
      { session: "AFTERNOON", start: "14:30", end: "18:00", doctors: [drTsai.id] },
      { session: "EVENING", start: "18:30", end: "21:30", doctors: [drTsai.id] },
    ],
    // 週五午診＝李醫師
    5: [
      { session: "MORNING", start: "08:00", end: "12:00", doctors: [drTsai.id] },
      { session: "AFTERNOON", start: "14:30", end: "18:00", doctors: [drLee.id] },
      { session: "EVENING", start: "18:30", end: "21:30", doctors: [drTsai.id] },
    ],
    // 週六：早診至 11:30、午診＝李醫師、無晚診
    6: [
      { session: "MORNING", start: "08:00", end: "11:30", doctors: [drTsai.id] },
      { session: "AFTERNOON", start: "14:30", end: "18:00", doctors: [drLee.id] },
    ],
  };
  for (const [weekdayStr, list] of Object.entries(WEEKLY)) {
    const weekday = Number(weekdayStr);
    for (const s of list) {
      for (const doctorId of s.doctors) {
        await prisma.weeklyScheduleTemplate.upsert({
          where: { weekday_session_doctorId: { weekday, session: s.session, doctorId } },
          create: {
            weekday, session: s.session, startTime: s.start, endTime: s.end,
            doctorId, slotCapacity: 1, allowOnline: true,
          },
          update: { startTime: s.start, endTime: s.end },
        });
      }
    }
    // 該星期沒排到的（醫師, 診次）組合要移除，否則重跑 seed 只會愈加愈多。
    // 例：早期版本把兩位醫師排滿每一診，不刪會變成整週都是雙診。
    const keep = list.flatMap((s) => s.doctors.map((d) => `${s.session}|${d}`));
    const rows = await prisma.weeklyScheduleTemplate.findMany({ where: { weekday } });
    const stale = rows.filter((r) => !keep.includes(`${r.session}|${r.doctorId}`));
    if (stale.length > 0) {
      await prisma.weeklyScheduleTemplate.deleteMany({
        where: { id: { in: stale.map((r) => r.id) } },
      });
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
