/**
 * 官網班表同步（applySchedule）。
 * 重點在「收斂」與「不要動到不該動的東西」：
 * 官網移除的班要真的消失，櫃檯自己輸入的例外不能被同步洗掉。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import {
  applySchedule,
  resolveDoctors,
  WEBSITE_SYNC_ACTOR,
  type ScheduleSource,
} from "@/lib/schedule-source";
import { dateToDb } from "@/lib/tw-time";
import { resetDb } from "./helpers";

async function seedDoctors() {
  const tsai = await prisma.doctor.create({ data: { name: "蔡宗儒", displayOrder: 1 } });
  const lee = await prisma.doctor.create({ data: { name: "李佳玲", displayOrder: 2 } });
  return { tsai, lee };
}

/** 週一早診蔡、午診蔡、晚診蔡＋李（其餘星期無班），比照官網結構 */
const WEEKLY_ONLY_MONDAY: ScheduleSource["weekly"] = {
  "0": [],
  "1": [
    { session: "MORNING", start: "08:00", end: "12:00", doctors: ["蔡"] },
    { session: "AFTERNOON", start: "14:30", end: "18:00", doctors: ["蔡"] },
    { session: "EVENING", start: "18:30", end: "21:30", doctors: ["蔡", "李"] },
  ],
  "2": [], "3": [], "4": [], "5": [], "6": [],
};

const TODAY = "2026-08-05";

describe("週班表以官網為準", () => {
  beforeEach(resetDb);

  it("首次套用會依官網建立班表", async () => {
    await seedDoctors();
    const r = await applySchedule(prisma, { weekly: WEEKLY_ONLY_MONDAY, exceptions: {} }, TODAY);
    expect(r.created).toBe(4); // 早1 + 午1 + 晚2
    expect(r.removed).toBe(0);

    const rows = await prisma.weeklyScheduleTemplate.findMany({ where: { weekday: 1 } });
    expect(rows).toHaveLength(4);
    expect(rows.filter((x) => x.session === "EVENING")).toHaveLength(2); // 雙診
  });

  it("官網把某位醫師從某診次撤掉後，系統的舊班會被移除（不會一直留著變雙診）", async () => {
    const { tsai, lee } = await seedDoctors();
    // 先建立「兩位醫師排滿週一」的舊狀態
    for (const session of ["MORNING", "AFTERNOON", "EVENING"] as const) {
      for (const d of [tsai, lee]) {
        await prisma.weeklyScheduleTemplate.create({
          data: {
            weekday: 1, session, startTime: "08:00", endTime: "12:00",
            doctorId: d.id, slotCapacity: 1,
          },
        });
      }
    }

    const r = await applySchedule(prisma, { weekly: WEEKLY_ONLY_MONDAY, exceptions: {} }, TODAY);
    expect(r.removed).toBe(2); // 早診李、午診李

    const rows = await prisma.weeklyScheduleTemplate.findMany({ where: { weekday: 1 } });
    expect(rows).toHaveLength(4);
    expect(rows.filter((x) => x.session === "MORNING").map((x) => x.doctorId)).toEqual([tsai.id]);
  });

  it("官網改了時間會更新既有班表", async () => {
    const { tsai } = await seedDoctors();
    await prisma.weeklyScheduleTemplate.create({
      data: {
        weekday: 1, session: "MORNING", startTime: "08:00", endTime: "11:30",
        doctorId: tsai.id, slotCapacity: 1,
      },
    });
    const r = await applySchedule(prisma, { weekly: WEEKLY_ONLY_MONDAY, exceptions: {} }, TODAY);
    expect(r.updated).toBeGreaterThanOrEqual(1);
    const row = await prisma.weeklyScheduleTemplate.findFirstOrThrow({
      where: { weekday: 1, session: "MORNING" },
    });
    expect(row.endTime).toBe("12:00"); // 官網說到 12:00
  });

  it("官網寫的醫師在系統中找不到時直接報錯，不亂猜", async () => {
    await seedDoctors();
    const weekly = {
      ...WEEKLY_ONLY_MONDAY,
      "1": [{ session: "MORNING" as const, start: "08:00", end: "12:00", doctors: ["王"] }],
    };
    await expect(applySchedule(prisma, { weekly, exceptions: {} }, TODAY)).rejects.toThrow(/找不到對應醫師/);
  });

  it("姓氏對應到多位醫師時報錯", async () => {
    await prisma.doctor.create({ data: { name: "蔡宗儒", displayOrder: 1 } });
    await prisma.doctor.create({ data: { name: "蔡小明", displayOrder: 2 } });
    const doctors = await prisma.doctor.findMany();
    expect(() => resolveDoctors(doctors, ["蔡"])).toThrow(/對應到多位醫師/);
  });
});

describe("單日特例以官網為準", () => {
  beforeEach(resetDb);

  const base = { weekly: WEEKLY_ONLY_MONDAY };
  const monday = "2026-08-10"; // 週一

  it("官網給空陣列＝整日休診", async () => {
    await seedDoctors();
    await applySchedule(prisma, { ...base, exceptions: { [monday]: [] } }, TODAY);
    const rows = await prisma.scheduleException.findMany({ where: { date: dateToDb(monday) } });
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("CLINIC_CLOSED_DAY");
  });

  it("官網當日少了某診次＝該診次停診", async () => {
    await seedDoctors();
    await applySchedule(
      prisma,
      {
        ...base,
        exceptions: {
          [monday]: [
            { session: "AFTERNOON", start: "14:30", end: "18:00" },
            { session: "EVENING", start: "18:30", end: "21:30" },
          ],
        },
      },
      TODAY,
    );
    const rows = await prisma.scheduleException.findMany({ where: { date: dateToDb(monday) } });
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("SESSION_CLOSED");
    expect(rows[0].session).toBe("MORNING"); // 早診休診
  });

  it("官網當日時間不同＝特殊時間", async () => {
    await seedDoctors();
    await applySchedule(
      prisma,
      {
        ...base,
        exceptions: {
          [monday]: [
            { session: "MORNING", start: "09:00", end: "12:00" },
            { session: "AFTERNOON", start: "14:30", end: "18:00" },
            { session: "EVENING", start: "18:30", end: "21:30" },
          ],
        },
      },
      TODAY,
    );
    const row = await prisma.scheduleException.findFirstOrThrow({
      where: { date: dateToDb(monday), type: "SPECIAL_HOURS" },
    });
    expect(row.startTime).toBe("09:00");
  });

  it("官網多開平常沒有的診次時只回報、不自動建立（公告沒寫哪位醫師）", async () => {
    await seedDoctors();
    const sunday = "2026-08-09"; // 週日在測試資料中無班
    const r = await applySchedule(
      prisma,
      { ...base, exceptions: { [sunday]: [{ session: "MORNING", start: "08:00", end: "11:30" }] } },
      TODAY,
    );
    expect(r.exceptionsApplied).toBe(0);
    expect(r.warnings.some((w) => w.includes("未自動建立"))).toBe(true);
    expect(await prisma.scheduleException.count({ where: { date: dateToDb(sunday) } })).toBe(0);
  });

  it("過期的特例不處理", async () => {
    await seedDoctors();
    const r = await applySchedule(prisma, { ...base, exceptions: { "2026-07-31": [] } }, TODAY);
    expect(r.exceptionsApplied).toBe(0);
    expect(await prisma.scheduleException.count()).toBe(0);
  });

  it("重跑只會取代自己上次建立的，櫃檯輸入的例外不動", async () => {
    await seedDoctors();
    const staffRow = await prisma.scheduleException.create({
      data: {
        date: dateToDb(monday), type: "DOCTOR_OFF", session: "AFTERNOON",
        reason: "櫃檯：醫師臨時有事", createdBy: "staff-1",
      },
    });

    await applySchedule(prisma, { ...base, exceptions: { [monday]: [] } }, TODAY);
    await applySchedule(prisma, { ...base, exceptions: { [monday]: [] } }, TODAY);

    const rows = await prisma.scheduleException.findMany({ where: { date: dateToDb(monday) } });
    // 櫃檯那筆還在，同步那筆不會因為跑兩次變兩筆
    expect(rows.filter((r) => r.id === staffRow.id)).toHaveLength(1);
    expect(rows.filter((r) => r.createdBy === WEBSITE_SYNC_ACTOR)).toHaveLength(1);
  });

  it("同診次兩位醫師不同起訖時，特例只產生一筆（不因醫師人數重複）", async () => {
    // 2026-09-01 起的週一晚診：蔡至 21:00、李至 21:30。
    // 單日特例是診所級的（沒有醫師欄位），比對前必須先收斂成一個診次一筆，
    // 否則同一個 (date, session) 會被推出兩筆 SPECIAL_HOURS。
    const { tsai, lee } = await seedDoctors();
    expect(tsai.id).not.toBe(lee.id);
    const splitEvening: ScheduleSource["weekly"] = {
      ...WEEKLY_ONLY_MONDAY,
      "1": [
        { session: "MORNING", start: "08:00", end: "12:00", doctors: ["蔡"] },
        { session: "AFTERNOON", start: "14:30", end: "18:00", doctors: ["蔡"] },
        { session: "EVENING", start: "18:30", end: "21:00", doctors: ["蔡"] },
        { session: "EVENING", start: "18:30", end: "21:30", doctors: ["李"] },
      ],
    };

    await applySchedule(
      prisma,
      {
        weekly: splitEvening,
        // 當天晚診提早到 20:30 收，診所級的聯集是 18:30–21:30 → 與 20:30 不同 → SPECIAL_HOURS
        exceptions: {
          [monday]: [
            { session: "MORNING", start: "08:00", end: "12:00" },
            { session: "AFTERNOON", start: "14:30", end: "18:00" },
            { session: "EVENING", start: "18:30", end: "20:30" },
          ],
        },
      },
      TODAY,
    );

    const rows = await prisma.scheduleException.findMany({
      where: { date: dateToDb(monday), session: "EVENING" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("SPECIAL_HOURS");
    expect(rows[0].endTime).toBe("20:30");
  });

  it("同診次兩位醫師起訖不同，但當日等於診所級聯集時不產生特例", async () => {
    await seedDoctors();
    const splitEvening: ScheduleSource["weekly"] = {
      ...WEEKLY_ONLY_MONDAY,
      "1": [
        { session: "EVENING", start: "18:30", end: "21:00", doctors: ["蔡"] },
        { session: "EVENING", start: "18:30", end: "21:30", doctors: ["李"] },
      ],
    };
    await applySchedule(
      prisma,
      {
        weekly: splitEvening,
        // 18:30–21:30 ＝ 兩位醫師的聯集，等於常態，不該被當成特例
        exceptions: { [monday]: [{ session: "EVENING", start: "18:30", end: "21:30" }] },
      },
      TODAY,
    );
    expect(await prisma.scheduleException.count({ where: { date: dateToDb(monday) } })).toBe(0);
  });

  it("官網撤掉某天的特例後，同步也會把該筆移除", async () => {
    await seedDoctors();
    await applySchedule(prisma, { ...base, exceptions: { [monday]: [] } }, TODAY);
    expect(await prisma.scheduleException.count({ where: { createdBy: WEBSITE_SYNC_ACTOR } })).toBe(1);

    await applySchedule(prisma, { ...base, exceptions: {} }, TODAY);
    expect(await prisma.scheduleException.count({ where: { createdBy: WEBSITE_SYNC_ACTOR } })).toBe(0);
  });
});
