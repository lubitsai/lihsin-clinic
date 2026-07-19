/**
 * 程式碼審查後的回歸測試：
 * 非格點時間繞過名額、SLOT_BLOCKED 引擎強制、手動加開班表外時段、
 * 撤銷未到狀態、改期重驗門診類型、通知重複發送防護。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import {
  createAppointment,
  rescheduleAppointment,
  updateAppointmentStatus,
  revokeNoShow,
} from "@/lib/booking";
import { getDaySlotAvailability } from "@/lib/availability";
import { createScheduleException, setSlotCapacity } from "@/lib/schedule-admin";
import { dispatchPendingNotifications } from "@/lib/notifications";
import { resetDb, seedBase, makePatient, futureDate, STAFF_ACTOR, PATIENT_ACTOR } from "./helpers";

describe("引擎強化（審查修復回歸）", () => {
  beforeEach(resetDb);

  it("非 30 分鐘格點的時間（09:01）不可預約，即使班表區間涵蓋", async () => {
    const { drTsai, general } = await seedBase({ doubleShift: false });
    const date = futureDate(3);
    await expect(
      createAppointment({
        clinicTypeId: general.id, doctorId: drTsai.id, date, startTime: "09:01",
        patientInput: makePatient(), source: "WEB", actor: PATIENT_ACTOR,
      }),
    ).rejects.toMatchObject({ code: "SLOT_UNAVAILABLE" });
    // 09:00 額滿後，09:01 仍不可作為後門
    await createAppointment({
      clinicTypeId: general.id, doctorId: drTsai.id, date, startTime: "09:00",
      patientInput: makePatient(), source: "WEB", actor: PATIENT_ACTOR,
    });
    await expect(
      createAppointment({
        clinicTypeId: general.id, doctorId: drTsai.id, date, startTime: "09:01",
        patientInput: makePatient(), source: "WEB", actor: PATIENT_ACTOR,
      }),
    ).rejects.toMatchObject({ code: "SLOT_UNAVAILABLE" });
  });

  it("SLOT_BLOCKED 日期例外在引擎層強制，直接送出也被拒絕", async () => {
    const { drTsai, general } = await seedBase({ doubleShift: false });
    const date = futureDate(3);
    const r = await createScheduleException(
      { date, type: "SLOT_BLOCKED", doctorId: drTsai.id, startTime: "10:00", reason: "行政保留" },
      STAFF_ACTOR,
    );
    expect(r.created).toBeDefined();
    await expect(
      createAppointment({
        clinicTypeId: general.id, doctorId: drTsai.id, date, startTime: "10:00",
        patientInput: makePatient(), source: "WEB", actor: PATIENT_ACTOR,
      }),
    ).rejects.toMatchObject({ code: "SLOT_UNAVAILABLE" });
    // 其他時段不受影響
    const ok = await createAppointment({
      clinicTypeId: general.id, doctorId: drTsai.id, date, startTime: "10:30",
      patientInput: makePatient(), source: "WEB", actor: PATIENT_ACTOR,
    });
    expect(ok.appointment.status).toBe("CONFIRMED");
  });

  it("手動加開班表外時段（12:30）：前台看得到、引擎約得到、名額受控", async () => {
    const { drTsai, general } = await seedBase({ doubleShift: false });
    const date = futureDate(3);
    await setSlotCapacity(
      { doctorId: drTsai.id, date, startTime: "12:30", capacity: 1, reason: "院長指示加開午間名額" },
      STAFF_ACTOR,
    );
    const slots = await getDaySlotAvailability(date, general.id);
    const extra = slots.find((s) => s.startTime === "12:30");
    expect(extra?.doctors[0]?.remaining).toBe(1);

    const booked = await createAppointment({
      clinicTypeId: general.id, doctorId: drTsai.id, date, startTime: "12:30",
      patientInput: makePatient(), source: "WEB", actor: PATIENT_ACTOR,
    });
    expect(booked.appointment.status).toBe("CONFIRMED");
    await expect(
      createAppointment({
        clinicTypeId: general.id, doctorId: drTsai.id, date, startTime: "12:30",
        patientInput: makePatient(), source: "WEB", actor: PATIENT_ACTOR,
      }),
    ).rejects.toMatchObject({ code: "SLOT_FULL" });
  });

  it("撤銷未到恢復為「已確認」、回沖計數，且可再次標記未到", async () => {
    const { drTsai, general } = await seedBase();
    const { appointment, patient } = await createAppointment({
      clinicTypeId: general.id, doctorId: drTsai.id, date: futureDate(2), startTime: "09:00",
      patientInput: makePatient(), source: "WEB", actor: PATIENT_ACTOR,
    });
    await updateAppointmentStatus({ appointmentId: appointment.id, toStatus: "NO_SHOW", actor: STAFF_ACTOR });
    const revoked = await revokeNoShow({
      appointmentId: appointment.id, actor: STAFF_ACTOR, reason: "誤標，病人在候診區",
    });
    expect(revoked.status).toBe("CONFIRMED");
    expect((await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } })).noShowCount).toBe(0);
    // 可再標記（同一預約的 no_show_record upsert）
    await updateAppointmentStatus({ appointmentId: appointment.id, toStatus: "NO_SHOW", actor: STAFF_ACTOR });
    expect((await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } })).noShowCount).toBe(1);
  });

  it("改期到門診類型暫停的日期被拒絕（與建立預約同一套檢查）", async () => {
    const { drTsai, general } = await seedBase();
    const { appointment } = await createAppointment({
      clinicTypeId: general.id, doctorId: drTsai.id, date: futureDate(2), startTime: "09:00",
      patientInput: makePatient(), source: "WEB", actor: PATIENT_ACTOR,
    });
    const target = futureDate(5);
    await createScheduleException(
      { date: target, type: "CLINIC_TYPE_SUSPENDED", clinicTypeId: general.id, reason: "當日僅特別門診" },
      STAFF_ACTOR,
    );
    await expect(
      rescheduleAppointment({
        appointmentId: appointment.id, newDoctorId: "any", newDate: target, newStartTime: "10:00",
        actor: PATIENT_ACTOR, byPatient: true,
      }),
    ).rejects.toMatchObject({ code: "CLINIC_TYPE_CLOSED" });
  });

  it("並發 dispatcher 不會重複發送同一則通知（原子認領）", async () => {
    const { drTsai, general } = await seedBase();
    for (let i = 1; i <= 3; i++) {
      await createAppointment({
        clinicTypeId: general.id, doctorId: drTsai.id, date: futureDate(i), startTime: "09:00",
        patientInput: makePatient(), source: "WEB", actor: PATIENT_ACTOR,
      });
    }
    const pendingBefore = await prisma.notification.count({ where: { status: "PENDING" } });
    expect(pendingBefore).toBe(3);
    const [a, b] = await Promise.all([
      dispatchPendingNotifications(),
      dispatchPendingNotifications(),
    ]);
    expect(a + b).toBe(3); // 每則恰好發送一次
    expect(await prisma.notification.count({ where: { status: "SENT" } })).toBe(3);
  });
});
