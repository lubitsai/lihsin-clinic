/**
 * 驗收條件 10, 11：醫師休診後不顯示時段；改班影響既有預約時先顯示名單、不可直接刪除。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { createAppointment } from "@/lib/booking";
import { getDaySlotAvailability } from "@/lib/availability";
import {
  createScheduleException,
  setSlotCapacity,
  setSlotBlocked,
  applyTemplateChange,
} from "@/lib/schedule-admin";
import { BookingError } from "@/lib/errors";
import {
  resetDb,
  seedBase,
  makePatient,
  futureDate,
  addDays,
  todayStr,
  weekdayOf,
  linkLineAccount,
  STAFF_ACTOR,
  PATIENT_ACTOR,
} from "./helpers";

describe("排班例外", () => {
  beforeEach(resetDb);

  it("10. 醫師休診後，不再顯示相關時段，預約也被拒絕", async () => {
    const { drTsai, drLee, general } = await seedBase();
    const date = futureDate(3);
    const before = await getDaySlotAvailability(date, general.id);
    expect(before.some((s) => s.doctors.some((d) => d.doctorId === drTsai.id))).toBe(true);

    const result = await createScheduleException(
      { date, type: "DOCTOR_OFF", doctorId: drTsai.id, reason: "蔡醫師公假" },
      STAFF_ACTOR,
    );
    expect(result.created).toBeDefined();

    const after = await getDaySlotAvailability(date, general.id);
    expect(after.some((s) => s.doctors.some((d) => d.doctorId === drTsai.id))).toBe(false);
    expect(after.some((s) => s.doctors.some((d) => d.doctorId === drLee.id))).toBe(true);

    await expect(
      createAppointment({
        clinicTypeId: general.id, doctorId: drTsai.id, date, startTime: "09:00",
        patientInput: makePatient(), source: "WEB", actor: PATIENT_ACTOR,
      }),
    ).rejects.toMatchObject({ code: "SLOT_UNAVAILABLE" });
  });

  it("全日休診後整天無時段", async () => {
    const { general } = await seedBase();
    const date = futureDate(3);
    await createScheduleException(
      { date, type: "CLINIC_CLOSED_DAY", reason: "颱風停診" },
      STAFF_ACTOR,
    );
    expect(await getDaySlotAvailability(date, general.id)).toHaveLength(0);
  });

  it("11. 已有預約的時段被改成休診時，先回傳受影響名單且不建立例外、不刪除預約", async () => {
    const { drTsai, general } = await seedBase();
    const date = futureDate(3);
    const booking = await createAppointment({
      clinicTypeId: general.id, doctorId: drTsai.id, date, startTime: "09:00",
      patientInput: makePatient(), source: "LINE", actor: PATIENT_ACTOR,
    });
    await linkLineAccount(booking.patient.id); // 有 LINE 綁定才收得到取消通知

    const result = await createScheduleException(
      { date, type: "DOCTOR_OFF", doctorId: drTsai.id, reason: "蔡醫師臨時休診" },
      STAFF_ACTOR,
    );
    expect(result.created).toBeUndefined();
    expect(result.affected).toHaveLength(1);
    expect(result.affected![0].id).toBe(booking.appointment.id);
    expect(await prisma.scheduleException.count()).toBe(0);
    // 預約仍在、未被刪除
    const still = await prisma.appointment.findUnique({ where: { id: booking.appointment.id } });
    expect(still?.status).toBe("CONFIRMED");

    // 批次處理：診所取消 + 建立例外 + 排入通知，預約留存為「診所取消」
    const applied = await createScheduleException(
      { date, type: "DOCTOR_OFF", doctorId: drTsai.id, reason: "蔡醫師臨時休診" },
      STAFF_ACTOR,
      { cancelAffected: true, cancelReason: "醫師臨時休診，診所取消並通知改約" },
    );
    expect(applied.created).toBeDefined();
    const cancelled = await prisma.appointment.findUnique({ where: { id: booking.appointment.id } });
    expect(cancelled?.status).toBe("CANCELLED_BY_CLINIC");
    const notice = await prisma.notification.findFirst({
      where: { appointmentId: booking.appointment.id, type: "CANCELLED" },
    });
    expect(notice).not.toBeNull();
    const audit = await prisma.auditLog.findFirst({ where: { action: "schedule.exception.create" } });
    expect(audit).not.toBeNull();
  });

  it("手動加開名額後同一醫師同時段可約 2 人；封鎖時段後不可預約", async () => {
    const { drTsai, general } = await seedBase({ doubleShift: false });
    const date = futureDate(3);
    await setSlotCapacity(
      { doctorId: drTsai.id, date, startTime: "11:00", capacity: 2, reason: "院長指示加開" },
      STAFF_ACTOR,
    );
    const a = await createAppointment({
      clinicTypeId: general.id, doctorId: drTsai.id, date, startTime: "11:00",
      patientInput: makePatient(), source: "WEB", actor: PATIENT_ACTOR,
    });
    const b = await createAppointment({
      clinicTypeId: general.id, doctorId: drTsai.id, date, startTime: "11:00",
      patientInput: makePatient(), source: "WEB", actor: PATIENT_ACTOR,
    });
    expect(a.appointment.capacitySlotNo).toBe(1);
    expect(b.appointment.capacitySlotNo).toBe(2);

    // 封鎖另一時段
    const blockRes = await setSlotBlocked(
      { doctorId: drTsai.id, date, startTime: "11:30", blocked: true, reason: "行政保留" },
      STAFF_ACTOR,
    );
    expect(blockRes.affected).toBeUndefined();
    await expect(
      createAppointment({
        clinicTypeId: general.id, doctorId: drTsai.id, date, startTime: "11:30",
        patientInput: makePatient(), source: "WEB", actor: PATIENT_ACTOR,
      }),
    ).rejects.toBeInstanceOf(BookingError);
  });

  it("代診：原醫師時段改由代診醫師承接", async () => {
    const { drTsai, drLee, general } = await seedBase({ doubleShift: false });
    const date = futureDate(3);
    await createScheduleException(
      {
        date, type: "DOCTOR_SUBSTITUTE", doctorId: drTsai.id,
        substituteDoctorId: drLee.id, reason: "蔡醫師出國，李醫師代診",
      },
      STAFF_ACTOR,
    );
    const slots = await getDaySlotAvailability(date, general.id);
    expect(slots.some((s) => s.doctors.some((d) => d.doctorId === drLee.id))).toBe(true);
    expect(slots.some((s) => s.doctors.some((d) => d.doctorId === drTsai.id))).toBe(false);
  });
});

/**
 * 單日停診 vs 改週班表——這是切換系統最容易出事的地方。
 *
 * BookNow 是「關掉某天某節，關了就算了」；自建系統的週班表改下去卻是
 * 對所有未來日期生效。櫃檯若照搬舊習慣去改週班表，會把往後每一個
 * 同一星期幾的診次一起關掉，而且畫面上不會有任何一處立刻顯示這件事。
 * 後台已把「臨時異動（只停一天）」設為預設分頁，這裡把兩者的差別釘住。
 */
describe("單日停診與週班表的作用範圍不同", () => {
  beforeEach(resetDb);

  const morningOf = async (date: string, clinicTypeId: string) =>
    (await getDaySlotAvailability(date, clinicTypeId)).filter((s) => s.session === "MORNING");

  it("單日停診只影響那一天：下週同一個星期幾照常，當天其他診次也照常", async () => {
    const { general } = await seedBase();
    const date = futureDate(3);
    const nextWeekSameWeekday = addDays(date, 7);
    expect(weekdayOf(nextWeekSameWeekday)).toBe(weekdayOf(date));

    expect((await morningOf(date, general.id)).length).toBeGreaterThan(0);
    expect((await morningOf(nextWeekSameWeekday, general.id)).length).toBeGreaterThan(0);

    await createScheduleException(
      { date, type: "SESSION_CLOSED", session: "MORNING", reason: "醫師臨時有事" },
      STAFF_ACTOR,
    );

    // 那一天的早診沒了
    expect(await morningOf(date, general.id)).toEqual([]);
    // 下週同一個星期幾照常——這正是與「改週班表」最關鍵的差別
    expect((await morningOf(nextWeekSameWeekday, general.id)).length).toBeGreaterThan(0);
    // 當天午診、晚診也不受影響
    const sameDay = await getDaySlotAvailability(date, general.id);
    expect(sameDay.some((s) => s.session === "AFTERNOON")).toBe(true);
    expect(sameDay.some((s) => s.session === "EVENING")).toBe(true);
  });

  it("對照：停用週班表那一列，往後每一個同一星期幾都跟著關掉", async () => {
    const { general, drTsai, drLee } = await seedBase({ doubleShift: false });
    const date = futureDate(3);
    const nextWeekSameWeekday = addDays(date, 7);
    expect(drLee.id).toBeTruthy();

    const row = await prisma.weeklyScheduleTemplate.findFirstOrThrow({
      where: { weekday: weekdayOf(date), session: "MORNING", doctorId: drTsai.id },
    });
    const r = await applyTemplateChange(
      {
        id: row.id,
        weekday: row.weekday,
        session: "MORNING",
        startTime: row.startTime,
        endTime: row.endTime,
        doctorId: drTsai.id,
        slotCapacity: row.slotCapacity,
        allowOnline: row.allowOnline,
        isActive: false, // 停用這一列
      },
      STAFF_ACTOR,
      { today: todayStr() },
    );
    expect(r.ok).toBe(true);

    // 兩天的早診都沒了——只是想停一天的人會在這裡踩雷
    expect(await morningOf(date, general.id)).toEqual([]);
    expect(await morningOf(nextWeekSameWeekday, general.id)).toEqual([]);
  });
});
