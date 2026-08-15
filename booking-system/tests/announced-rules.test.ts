/**
 * 官網公告（院長 2026-07-31 核可，visit-guide.html#booking-rules）逐條對照：
 *  - 該診次開診後不再受理該診次的預約
 *  - 該診次開診前都可自行取消或改期，開診後不行
 *  - 門診類型可預約時間窗（兒童發展篩檢逐日不同）
 * 這三條在 docs/09 分別是 D2／D4／發展篩檢施測時間。
 * 另加院長 2026-08-06 確認的「取消截止一律以診次為單位」（docs/09 D11）。
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { prisma } from "@/lib/db";
import { createAppointment, cancelAppointment, rescheduleAppointment } from "@/lib/booking";
import { getDaySlotAvailability } from "@/lib/availability";
import { enqueueReminders } from "@/lib/notifications";
import { setSetting, clearSettingsCache } from "@/lib/settings";
import { dateToDb } from "@/lib/tw-time";
import {
  resetDb,
  seedBase,
  makePatient,
  futureDate,
  todayStr,
  linkLineAccount,
  STAFF_ACTOR,
  PATIENT_ACTOR,
} from "./helpers";

/** 把系統時間固定在台灣時間某日某時（tw-time 全部以 UTC+8 平移計算） */
function freezeTaipei(date: string, time: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${date}T${time}:00.000+08:00`));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("該診次開診後不再受理該診次的預約（D2）", () => {
  beforeEach(resetDb);

  it("早診 08:00 開診後，同診次較晚的時段也不再顯示、也不能預約", async () => {
    const { general, drTsai } = await seedBase();
    const today = todayStr();
    // 截止分鐘數調小，確保擋下來的原因是「開診」而不是「時段前 4 小時」
    await setSetting("booking.same_day_cutoff_minutes", 10, "test");

    // 開診前 07:00：早診時段仍可預約
    freezeTaipei(today, "07:00");
    clearSettingsCache();
    const before = await getDaySlotAvailability(today, general.id);
    expect(before.some((s) => s.startTime === "11:00")).toBe(true);

    // 開診後 08:05：整個早診都不再受理
    freezeTaipei(today, "08:05");
    clearSettingsCache();
    const after = await getDaySlotAvailability(today, general.id);
    expect(after.some((s) => s.startTime < "12:00")).toBe(false);
    // 其他診次不受影響
    expect(after.some((s) => s.startTime >= "14:30")).toBe(true);

    await expect(
      createAppointment({
        clinicTypeId: general.id, doctorId: drTsai.id, date: today, startTime: "11:00",
        patientInput: makePatient(), source: "WEB", actor: PATIENT_ACTOR,
      }),
    ).rejects.toMatchObject({ code: "SLOT_UNAVAILABLE" });
  });

  it("櫃檯代約不受開診限制（等同現場加號）", async () => {
    const { general, drTsai } = await seedBase();
    const today = todayStr();
    freezeTaipei(today, "08:05");
    clearSettingsCache();

    const r = await createAppointment({
      clinicTypeId: general.id, doctorId: drTsai.id, date: today, startTime: "11:00",
      patientInput: makePatient(), source: "STAFF", actor: STAFF_ACTOR, isStaff: true,
    });
    expect(r.appointment.status).toBe("CONFIRMED");
  });
});

describe("取消／改期以該診次開診時間為準（D4）", () => {
  beforeEach(resetDb);

  it("開診前可自行取消，開診後不行", async () => {
    const { general, drTsai } = await seedBase();
    const today = todayStr();
    // 先在櫃檯身分建立今天晚診的預約（避開建立時的當日截止規則）
    const { appointment } = await createAppointment({
      clinicTypeId: general.id, doctorId: drTsai.id, date: today, startTime: "19:00",
      patientInput: makePatient(), source: "STAFF", actor: STAFF_ACTOR, isStaff: true,
    });

    // 晚診 18:30 開診：18:00 仍可取消（雖然距離看診只剩 1 小時，比舊的 2 小時規則寬）
    freezeTaipei(today, "18:00");
    clearSettingsCache();
    await expect(
      rescheduleAppointment({
        appointmentId: appointment.id, newDoctorId: drTsai.id,
        newDate: futureDate(2), newStartTime: "09:00",
        actor: PATIENT_ACTOR, byPatient: true,
      }),
    ).resolves.toBeTruthy();

    // 改期後的新預約在未來，先建立另一筆今天的預約來測開診後
    const { appointment: second } = await createAppointment({
      clinicTypeId: general.id, doctorId: drTsai.id, date: today, startTime: "20:00",
      patientInput: makePatient(), source: "STAFF", actor: STAFF_ACTOR, isStaff: true,
    });
    freezeTaipei(today, "18:35");
    clearSettingsCache();
    await expect(
      cancelAppointment({ appointmentId: second.id, actor: PATIENT_ACTOR, byPatient: true }),
    ).rejects.toMatchObject({ code: "CUTOFF_PASSED" });
  });

  it("櫃檯不受開診限制，仍可代為取消", async () => {
    const { general, drTsai } = await seedBase();
    const today = todayStr();
    const { appointment } = await createAppointment({
      clinicTypeId: general.id, doctorId: drTsai.id, date: today, startTime: "20:00",
      patientInput: makePatient(), source: "STAFF", actor: STAFF_ACTOR, isStaff: true,
    });
    freezeTaipei(today, "18:35");
    clearSettingsCache();
    const r = await cancelAppointment({
      appointmentId: appointment.id, actor: STAFF_ACTOR, byPatient: false, reason: "家長來電",
    });
    expect(r.status).toBe("CANCELLED_BY_CLINIC");
  });
});

/**
 * 院長 2026-08-06 確認：截止一律以**診次**為單位，不看個別時段的時間。
 * 這裡釘住最容易被「順手修掉」的一種情形——班表改動後落在區間外的預約：
 * 早診原本 08:00 開始、之後改成 09:00（官網門診時間異動後跑 sync_schedule 就會這樣改），
 * 已成立的 08:00 預約落在所有班表區間之外，判斷診次時粗分回早診，而早診 09:00 才開診。
 * 08:30 時「時段已過、診次未開」——依裁示**仍可取消**：診所當下根本沒在看診，
 * 擋住家長只會把他推向未到記點。
 */
describe("取消截止一律以診次為單位（院長 2026-08-06 確認）", () => {
  beforeEach(resetDb);

  /** 於 08:00 成立一筆預約（此時早診仍是 08:00 開始，所以約得到） */
  async function bookAtEight(doctorId: string, clinicTypeId: string, today: string) {
    freezeTaipei(today, "07:00");
    clearSettingsCache();
    const { appointment } = await createAppointment({
      clinicTypeId, doctorId, date: today, startTime: "08:00",
      patientInput: makePatient(), source: "STAFF", actor: STAFF_ACTOR, isStaff: true,
    });
    return appointment;
  }

  /** 事後把早診改成 09:00 開始——既有的 08:00 預約就落在班表區間之外了 */
  async function moveMorningTo0900() {
    await prisma.weeklyScheduleTemplate.updateMany({
      where: { session: "MORNING" },
      data: { startTime: "09:00" },
    });
  }

  it("班表改動後落在區間外的預約：診次未開診就仍可取消，開診後才擋", async () => {
    const { general, drTsai, drLee } = await seedBase();
    const today = todayStr();
    // 每位醫師每時段 1 名，兩筆分掛兩位醫師
    const first = await bookAtEight(drTsai.id, general.id, today);
    const second = await bookAtEight(drLee.id, general.id, today);
    await moveMorningTo0900();

    // 08:30：時段時間已過，但早診（已改為 09:00）還沒開診 → 依裁示仍可自行取消
    freezeTaipei(today, "08:30");
    clearSettingsCache();
    await expect(
      cancelAppointment({ appointmentId: first.id, actor: PATIENT_ACTOR, byPatient: true }),
    ).resolves.toBeTruthy();

    // 09:30：早診已開診 → 擋下
    freezeTaipei(today, "09:30");
    clearSettingsCache();
    await expect(
      cancelAppointment({ appointmentId: second.id, actor: PATIENT_ACTOR, byPatient: true }),
    ).rejects.toMatchObject({ code: "CUTOFF_PASSED" });
  });

  it("櫃檯不受此限，診次開診後仍可代為取消", async () => {
    const { general, drTsai } = await seedBase();
    const today = todayStr();
    const appointment = await bookAtEight(drTsai.id, general.id, today);
    await moveMorningTo0900();
    freezeTaipei(today, "09:30");
    clearSettingsCache();
    const r = await cancelAppointment({
      appointmentId: appointment.id, actor: STAFF_ACTOR, byPatient: false, reason: "家長來電",
    });
    expect(r.status).toBe("CANCELLED_BY_CLINIC");
  });
});

describe("門診類型可預約時間窗（兒童發展篩檢施測時間）", () => {
  beforeEach(resetDb);

  /** 找出未來第 n 週內符合指定星期的日期 */
  async function setScreeningWindows(clinicTypeId: string) {
    // 官網公告：週二至週五上午 09:00–11:30、下午 14:30–16:00；週一僅下午 14:30–16:00
    await prisma.clinicTypeWindow.createMany({
      data: [
        { clinicTypeId, weekday: 1, startTime: "14:30", endTime: "16:00" },
        ...[2, 3, 4, 5].flatMap((weekday) => [
          { clinicTypeId, weekday, startTime: "09:00", endTime: "11:30" },
          { clinicTypeId, weekday, startTime: "14:30", endTime: "16:00" },
        ]),
      ],
    });
  }

  /** 未來 14 天內第一個符合該星期的日期 */
  function nextWeekday(weekday: number): string {
    for (let i = 1; i <= 14; i++) {
      const d = futureDate(i);
      if (new Date(`${d}T00:00:00.000Z`).getUTCDay() === weekday) return d;
    }
    throw new Error("找不到日期");
  }

  it("只開放時間窗內的時段，窗外一律不顯示", async () => {
    const { development } = await seedBase();
    await setScreeningWindows(development.id);

    const tuesday = nextWeekday(2);
    const slots = await getDaySlotAvailability(tuesday, development.id);
    const times = slots.map((s) => s.startTime);

    expect(times).toContain("09:00");
    expect(times).toContain("11:00"); // 含頭不含尾：11:00 的時段結束於 11:30
    expect(times).toContain("14:30");
    expect(times).toContain("15:30");
    expect(times).not.toContain("08:00"); // 早診有班但在窗外
    expect(times).not.toContain("11:30"); // 窗的結束時刻
    expect(times).not.toContain("16:00");
    expect(times.some((t) => t >= "18:30")).toBe(false); // 晚診整段窗外
  });

  it("週一僅下午開放，上午不開放", async () => {
    const { development } = await seedBase();
    await setScreeningWindows(development.id);

    const monday = nextWeekday(1);
    const times = (await getDaySlotAvailability(monday, development.id)).map((s) => s.startTime);
    expect(times.some((t) => t < "12:00")).toBe(false);
    expect(times).toContain("14:30");
  });

  it("窗外時段直接送出預約也會被引擎擋下", async () => {
    const { development, drTsai } = await seedBase();
    await setScreeningWindows(development.id);
    const monday = nextWeekday(1);

    await expect(
      createAppointment({
        clinicTypeId: development.id, doctorId: drTsai.id, date: monday, startTime: "09:00",
        patientInput: makePatient(), source: "WEB", actor: PATIENT_ACTOR,
      }),
    ).rejects.toMatchObject({ code: "SLOT_UNAVAILABLE" });
  });

  it("完全沒有時間窗的星期（週六、週日）不開放", async () => {
    const { development } = await seedBase();
    await setScreeningWindows(development.id);
    for (const weekday of [0, 6]) {
      const date = nextWeekday(weekday);
      expect(await getDaySlotAvailability(date, development.id)).toEqual([]);
    }
  });
});

describe("一位醫師同一時段只會有一位病人（跨門診共用名額）", () => {
  beforeEach(resetDb);

  it("某門診占用後，同一醫師同時段在其他門診也不再有名額", async () => {
    const { general, development, drTsai, drLee } = await seedBase();
    const date = futureDate(3);

    // 先以「兒童發展篩檢」占用蔡醫師 14:30
    await createAppointment({
      clinicTypeId: development.id, doctorId: drTsai.id, date, startTime: "14:30",
      patientInput: makePatient(), source: "WEB", actor: PATIENT_ACTOR,
    });

    // 一般門診看同一時段：蔡醫師已無名額，李醫師不受影響
    const slot = (await getDaySlotAvailability(date, general.id)).find((s) => s.startTime === "14:30");
    expect(slot).toBeDefined();
    expect(slot!.doctors.find((d) => d.doctorId === drTsai.id)?.remaining).toBe(0);
    expect(slot!.doctors.find((d) => d.doctorId === drLee.id)?.remaining).toBe(1);

    // 硬送出一般門診也會被擋（前台隱藏不是唯一防線）
    await expect(
      createAppointment({
        clinicTypeId: general.id, doctorId: drTsai.id, date, startTime: "14:30",
        patientInput: makePatient(), source: "WEB", actor: PATIENT_ACTOR,
      }),
    ).rejects.toMatchObject({ code: "SLOT_FULL" });
  });

  it("「不限醫師」會避開已被其他門診占用的醫師，改分配另一位", async () => {
    const { general, development, drTsai } = await seedBase();
    const date = futureDate(4);

    await createAppointment({
      clinicTypeId: development.id, doctorId: drTsai.id, date, startTime: "10:00",
      patientInput: makePatient(), source: "WEB", actor: PATIENT_ACTOR,
    });

    const { appointment } = await createAppointment({
      clinicTypeId: general.id, doctorId: "any", date, startTime: "10:00",
      patientInput: makePatient(), source: "WEB", actor: PATIENT_ACTOR,
    });
    expect(appointment.doctorId).not.toBe(drTsai.id);
  });

  it("該時段兩位醫師都被其他門診占滿後，一般門診就沒有這個時段可選", async () => {
    const { general, development, drTsai, drLee } = await seedBase();
    const date = futureDate(5);

    for (const doctorId of [drTsai.id, drLee.id]) {
      await createAppointment({
        clinicTypeId: development.id, doctorId, date, startTime: "19:00",
        patientInput: makePatient(), source: "WEB", actor: PATIENT_ACTOR,
      });
    }

    const slot = (await getDaySlotAvailability(date, general.id)).find((s) => s.startTime === "19:00");
    expect(slot!.doctors.every((d) => d.remaining === 0)).toBe(true);

    await expect(
      createAppointment({
        clinicTypeId: general.id, doctorId: "any", date, startTime: "19:00",
        patientInput: makePatient(), source: "WEB", actor: PATIENT_ACTOR,
      }),
    ).rejects.toMatchObject({ code: "SLOT_FULL" });
  });
});

describe("國定假日不施測（兒童發展篩檢）", () => {
  beforeEach(resetDb);

  /** 未來 14 天內第一個週三（篩檢有早上與下午時段） */
  function nextWednesday(): string {
    for (let i = 1; i <= 14; i++) {
      const d = futureDate(i);
      if (new Date(`${d}T00:00:00.000Z`).getUTCDay() === 3) return d;
    }
    throw new Error("找不到日期");
  }

  async function setupScreening(clinicTypeId: string) {
    await prisma.clinicType.update({
      where: { id: clinicTypeId },
      data: { skipOnPublicHoliday: true },
    });
    await prisma.clinicTypeWindow.createMany({
      data: [2, 3, 4, 5].flatMap((weekday) => [
        { clinicTypeId, weekday, startTime: "09:00", endTime: "11:30" },
        { clinicTypeId, weekday, startTime: "14:30", endTime: "16:00" },
      ]),
    });
  }

  it("國定假日當天篩檢沒有時段，一般門診照常", async () => {
    const { general, development } = await seedBase();
    await setupScreening(development.id);
    const date = nextWednesday();

    // 假日前：篩檢有時段
    expect((await getDaySlotAvailability(date, development.id)).length).toBeGreaterThan(0);

    await prisma.publicHoliday.create({
      data: { date: dateToDb(date), name: "國慶日", source: "test" },
    });

    expect(await getDaySlotAvailability(date, development.id)).toEqual([]);
    // 一般門診不受影響——診所照常看診
    expect((await getDaySlotAvailability(date, general.id)).length).toBeGreaterThan(0);
  });

  it("國定假日送出篩檢預約會被擋下，訊息說明當天一般門診照常", async () => {
    const { development, drTsai } = await seedBase();
    await setupScreening(development.id);
    const date = nextWednesday();
    await prisma.publicHoliday.create({
      data: { date: dateToDb(date), name: "國慶日", source: "test" },
    });

    await expect(
      createAppointment({
        clinicTypeId: development.id, doctorId: drTsai.id, date, startTime: "09:00",
        patientInput: makePatient(), source: "WEB", actor: PATIENT_ACTOR,
      }),
    ).rejects.toMatchObject({ code: "CLINIC_TYPE_CLOSED" });

    await expect(
      createAppointment({
        clinicTypeId: development.id, doctorId: drTsai.id, date, startTime: "09:00",
        patientInput: makePatient(), source: "WEB", actor: PATIENT_ACTOR,
      }),
    ).rejects.toThrow(/國慶日.*不施測/);
  });

  it("未標記「國定假日停開」的門診不受假日影響", async () => {
    const { general } = await seedBase();
    const date = nextWednesday();
    await prisma.publicHoliday.create({
      data: { date: dateToDb(date), name: "國慶日", source: "test" },
    });
    expect((await getDaySlotAvailability(date, general.id)).length).toBeGreaterThan(0);
  });

  it("櫃檯代約不受假日限制（現場仍可安排）", async () => {
    const { development, drTsai } = await seedBase();
    await setupScreening(development.id);
    const date = nextWednesday();
    await prisma.publicHoliday.create({
      data: { date: dateToDb(date), name: "國慶日", source: "test" },
    });

    const r = await createAppointment({
      clinicTypeId: development.id, doctorId: drTsai.id, date, startTime: "09:00",
      patientInput: makePatient(), source: "STAFF", actor: STAFF_ACTOR, isStaff: true,
    });
    expect(r.appointment.id).toBeTruthy();
  });
});

describe("通知內容（一律 LINE 推播）", () => {
  beforeEach(resetDb);

  /** 排一則看診前一天的提醒，回傳實際會送出去的那則訊息 */
  async function reminderFor(name: string) {
    const { general, drTsai } = await seedBase();
    const date = futureDate(1);
    const { appointment, patient } = await createAppointment({
      clinicTypeId: general.id, doctorId: drTsai.id, date, startTime: "09:00",
      patientInput: makePatient({ name }), source: "LINE", actor: PATIENT_ACTOR,
    });
    await linkLineAccount(patient.id);
    await prisma.notification.deleteMany({ where: { appointmentId: appointment.id } });
    await enqueueReminders(date, "REMINDER_DAY_BEFORE");
    const n = await prisma.notification.findFirstOrThrow({
      where: { appointmentId: appointment.id, type: "REMINDER_DAY_BEFORE" },
    });
    return { channel: n.channel, message: (n.payload as { message: string }).message };
  }

  it("提醒帶到姓名、醫師、門診別、報到規則與取消方式，且不含預約編號", async () => {
    const r = await reminderFor("王小明");
    expect(r.channel).toBe("LINE");
    expect(r.message).toContain("王小明");
    expect(r.message).toContain("蔡宗儒醫師");
    expect(r.message).toContain("一般門診");
    expect(r.message).toContain("10 分鐘內到櫃檯報到");
    expect(r.message).toContain("請提前線上取消");
    // 院長 2026-08-05：通知不放預約編號（家長用不到，編號只給櫃檯內部使用）
    expect(r.message).not.toMatch(/預約編號|LH\d{6}-/);
  });

  it("預約成立、更改、取消三則都送得出去，且都不含預約編號", async () => {
    const { general, drTsai } = await seedBase();
    const input = makePatient({ name: "歐陽承翰" });
    // 先建一次病歷並綁 LINE——沒有綁定就不會排入通知，這裡驗的是有綁定時的內容
    const seeded = await createAppointment({
      clinicTypeId: general.id, doctorId: drTsai.id, date: futureDate(2), startTime: "09:00",
      patientInput: input, source: "LINE", actor: PATIENT_ACTOR,
    });
    await linkLineAccount(seeded.patient.id);
    await cancelAppointment({
      appointmentId: seeded.appointment.id, actor: PATIENT_ACTOR, byPatient: true,
    });
    await prisma.notification.deleteMany({});

    const { appointment } = await createAppointment({
      clinicTypeId: general.id, doctorId: drTsai.id, date: futureDate(3), startTime: "09:00",
      patientInput: input, source: "LINE", actor: PATIENT_ACTOR,
    });
    await rescheduleAppointment({
      appointmentId: appointment.id, newDoctorId: drTsai.id,
      newDate: futureDate(4), newStartTime: "10:00",
      actor: PATIENT_ACTOR, byPatient: true,
    }).then((r) =>
      cancelAppointment({ appointmentId: r.newAppointment.id, actor: PATIENT_ACTOR, byPatient: true }),
    );

    const rows = await prisma.notification.findMany({ orderBy: { createdAt: "asc" } });
    const types = rows.map((r) => r.type);
    expect(types).toContain("BOOKED");
    expect(types).toContain("MODIFIED");
    expect(types).toContain("CANCELLED");
    for (const r of rows) {
      const msg = (r.payload as { message: string }).message;
      expect(r.channel).toBe("LINE");
      expect(msg, `${r.type} 仍含預約編號`).not.toMatch(/預約編號|LH\d{6}-/);
      expect(msg).toContain("歐陽承翰");
    }
  });

  it("沒有 LINE 綁定的病人（櫃檯電話代約）不排入通知", async () => {
    const { general, drTsai } = await seedBase();
    const { appointment } = await createAppointment({
      clinicTypeId: general.id, doctorId: drTsai.id, date: futureDate(3), startTime: "09:00",
      patientInput: makePatient(), source: "STAFF", actor: STAFF_ACTOR, isStaff: true,
    });
    // 沒有可送達的管道，排進去只會變成一筆永遠失敗的紀錄；由櫃檯當場口頭告知
    const rows = await prisma.notification.findMany({ where: { appointmentId: appointment.id } });
    expect(rows).toHaveLength(0);
  });
});
