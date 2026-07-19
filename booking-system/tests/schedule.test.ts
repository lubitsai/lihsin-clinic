/**
 * 驗收條件 10, 11：醫師休診後不顯示時段；改班影響既有預約時先顯示名單、不可直接刪除。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { createAppointment } from "@/lib/booking";
import { getDaySlotAvailability } from "@/lib/availability";
import { createScheduleException, setSlotCapacity, setSlotBlocked } from "@/lib/schedule-admin";
import { BookingError } from "@/lib/errors";
import { resetDb, seedBase, makePatient, futureDate, STAFF_ACTOR, PATIENT_ACTOR } from "./helpers";

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
      patientInput: makePatient(), source: "WEB", actor: PATIENT_ACTOR,
    });

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
