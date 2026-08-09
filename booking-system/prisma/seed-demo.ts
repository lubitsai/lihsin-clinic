/**
 * 測試環境示範資料（**只在測試／驗收環境使用，正式環境絕對不要跑**）。
 *
 * `prisma/seed.ts` 只建立醫師、門診、班表、假日與帳號——櫃檯總覽會是空的，
 * 看不出「當天實際運作起來長什麼樣」。這支在其上補齊逐項可驗收的情境：
 * 等待報到、已報到、報到逾時、未到累計、受限名單、同行家人、單日停診公告。
 *
 * 病人一律用假姓名與**格式正確但不屬於任何真人**的證件號（測試用區段），
 * 手機號一律 0900-000-0xx（未配發號段），不會誤發簡訊給真人。
 *
 *     npm run db:seed && npm run db:seed:demo
 */
import { PrismaClient } from "@prisma/client";
import { createAppointment, updateAppointmentStatus } from "../src/lib/booking";
import { addDays, todayStr, dateToDb, slotTimes } from "../src/lib/tw-time";
import { getDayScheduleBlocks } from "../src/lib/schedule";

const prisma = new PrismaClient();
const STAFF = { type: "STAFF" as const, id: "demo-seed", name: "示範資料" };

/**
 * 假身分證：**通過檢查碼驗證**、但不對應任何真人（測試區段號碼）。
 * 檢查碼不對的話後台代約也會被擋，示範資料就建不起來。
 */
const DEMO = [
  { name: "王小明", phone: "0900000001", birthDate: "2020-03-15", idNumber: "A100000010" },
  { name: "陳小美", phone: "0900000002", birthDate: "2019-07-02", idNumber: "A100000029" },
  { name: "林小豪", phone: "0900000003", birthDate: "2022-11-20", idNumber: "A100000038" },
  { name: "黃小妤", phone: "0900000004", birthDate: "2018-01-08", idNumber: "A100000047" },
  { name: "張小安", phone: "0900000005", birthDate: "2021-05-30", idNumber: "A100000056" },
  { name: "李小樂", phone: "0900000006", birthDate: "2023-02-14", idNumber: "A100000065" },
];

function patientInput(i: number) {
  const d = DEMO[i];
  return { ...d, idType: "NATIONAL_ID" as const };
}

async function main() {
  if (process.env.NODE_ENV === "production" && !process.env.ALLOW_DEMO_SEED) {
    throw new Error(
      "拒絕在 NODE_ENV=production 建立示範資料。確定要做請設 ALLOW_DEMO_SEED=1。",
    );
  }

  const today = todayStr();
  const general = await prisma.clinicType.findUniqueOrThrow({ where: { code: "GENERAL" } });
  const development = await prisma.clinicType.findUniqueOrThrow({ where: { code: "DEVELOPMENT" } });
  const blocks = await getDayScheduleBlocks(today);
  if (blocks.length === 0) {
    console.log("⚠️ 今天沒有門診（休診日），只建立未來日期的預約。");
  }

  // 今天各診次的前幾個時段，用來鋪出一個有內容的櫃檯總覽
  const todaySlots = blocks
    .flatMap((b) => slotTimes(b.startTime, b.endTime).map((t) => ({ time: t, doctorId: b.doctorId })))
    .sort((a, b) => a.time.localeCompare(b.time));

  let made = 0;
  const created: { id: string; label: string }[] = [];

  // ── 今天：等待報到 × 3、已報到 × 1、報到逾時 × 1 ───────────
  for (let i = 0; i < Math.min(5, todaySlots.length, DEMO.length); i++) {
    const slot = todaySlots[i];
    try {
      const r = await createAppointment({
        clinicTypeId: general.id,
        doctorId: slot.doctorId,
        date: today,
        startTime: slot.time,
        patientInput: patientInput(i),
        source: "STAFF",
        actor: STAFF,
        isStaff: true, // 櫃檯身分才不受「時段前 4 小時」限制，示範資料才鋪得出來
        // 家庭代表預約：最後一筆帶一位同行家人，總覽才看得到同行名單
        ...(i === 4
          ? {
              companions: [
                {
                  name: "王小華",
                  phone: DEMO[i].phone,
                  birthDate: "2016-09-09",
                  idType: "NATIONAL_ID" as const,
                  idNumber: "A200000012",
                },
              ],
            }
          : {}),
      });
      created.push({ id: r.appointment.id, label: `${slot.time} ${DEMO[i].name}` });
      made++;
    } catch (e) {
      console.log(`  （略過今天 ${slot.time}：${e instanceof Error ? e.message : e}）`);
    }
  }
  // 第 1 位標為已報到，讓總覽看得到兩種狀態
  if (created[0]) {
    await updateAppointmentStatus({ appointmentId: created[0].id, toStatus: "CHECKED_IN", actor: STAFF });
    console.log(`  已報到：${created[0].label}`);
  }

  // ── 未來：一般門診與兒童發展篩檢各一筆，供前台查詢／取消操作 ──
  for (let d = 2; d <= 4; d++) {
    const date = addDays(today, d);
    const b = await getDayScheduleBlocks(date);
    if (b.length === 0) continue;
    const first = b[0];
    // 篩檢有 84 個月的年齡上限，這一筆固定用最小的示範病人（2022 年出生）
    const who = d === 3 ? 2 : d % DEMO.length;
    try {
      const r = await createAppointment({
        clinicTypeId: d === 3 ? development.id : general.id,
        doctorId: first.doctorId,
        date,
        startTime: d === 3 ? "09:00" : first.startTime,
        patientInput: patientInput(who),
        source: "WEB",
        actor: { type: "PATIENT" as const },
        accountKey: `phone:${DEMO[who].phone}`,
      });
      created.push({ id: r.appointment.id, label: `${date} ${r.appointment.startTime}` });
      made++;
    } catch (e) {
      console.log(`  （略過 ${date}：${e instanceof Error ? e.message : e}）`);
    }
  }

  // ── 未到累計：讓「受限名單」頁面有東西可看 ──────────────
  const past = addDays(today, -3);
  const pastBlocks = await getDayScheduleBlocks(past);
  if (pastBlocks.length > 0) {
    for (let n = 0; n < 3; n++) {
      const r = await createAppointment({
        clinicTypeId: general.id,
        doctorId: pastBlocks[0].doctorId,
        date: addDays(today, -(3 + n)),
        startTime: pastBlocks[0].startTime,
        patientInput: patientInput(5),
        source: "WEB",
        actor: { type: "PATIENT" as const },
        isStaff: true,
      }).catch(() => null);
      if (r)
        await updateAppointmentStatus({
          appointmentId: r.appointment.id, toStatus: "NO_SHOW", actor: STAFF,
        }).catch(() => {});
    }
    console.log(`  未到 3 次並自動受限：${DEMO[5].name}`);
  }

  // ── 單日公告：前台首頁「近期門診異動」會顯示 ──────────────
  const noticeDate = addDays(today, 5);
  await prisma.scheduleException.upsert({
    where: { id: "demo-notice" },
    create: {
      id: "demo-notice",
      date: dateToDb(noticeDate),
      type: "SESSION_CLOSED",
      session: "EVENING",
      reason: "示範資料：醫師進修，晚診停診",
      createdBy: "demo-seed",
    },
    update: {},
  });

  console.log(`\n示範資料完成：共建立 ${made} 筆預約、1 筆單日停診公告（${noticeDate}）`);
  console.log("測試帳號：admin / lihsin-admin-2026、counter1 / lihsin-staff-2026");
  console.log("前台查詢可用：王小明 0900000001 A100000010 生日 2020-03-15");
  console.log("⚠️ 這些是假資料，正式上線前請用全新資料庫重跑 npm run db:seed（不要跑 db:seed:demo）。");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
