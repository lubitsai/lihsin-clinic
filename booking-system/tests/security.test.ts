/**
 * 驗收條件 13, 14, 15, 16：OTP 替代 LINE、一個 LINE 帳號多位家庭成員、
 * 病人資料隔離、櫃檯無法使用管理員功能。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { createAppointment, rescheduleAppointment, cancelAppointment } from "@/lib/booking";
import { listAppointmentsForPatients, getAppointmentForPortal } from "@/lib/portal-service";
import { requirePermission, PERMISSIONS, ROLE_PERMISSIONS } from "@/lib/auth/authz";
import { issueOtp, verifyOtp } from "@/lib/auth/portal";
import { BookingError } from "@/lib/errors";
import type { StaffContext } from "@/lib/auth/staff";
import { resetDb, seedBase, makePatient, futureDate, STAFF_ACTOR, PATIENT_ACTOR } from "./helpers";

describe("LINE 與 OTP", () => {
  beforeEach(resetDb);

  it("13. LINE 未設定／登入失敗時，手機 OTP 流程仍可完成預約", async () => {
    const { drTsai, general } = await seedBase();
    // LINE 未設定（環境變數為空）→ isLineLoginConfigured 為 false
    const { isLineLoginConfigured } = await import("@/lib/line");
    expect(isLineLoginConfigured()).toBe(false);

    // OTP 流程
    const phone = "0912345678";
    const { devCode } = await issueOtp(phone, "BOOKING");
    expect(devCode).toMatch(/^\d{6}$/);
    expect(await verifyOtp(phone, "BOOKING", "000000")).toBe(false);
    expect(await verifyOtp(phone, "BOOKING", devCode!)).toBe(true);
    // 驗證碼一次性：再驗即失敗
    expect(await verifyOtp(phone, "BOOKING", devCode!)).toBe(false);

    const booked = await createAppointment({
      clinicTypeId: general.id, doctorId: drTsai.id, date: futureDate(3), startTime: "09:00",
      patientInput: makePatient({ phone }), source: "WEB", actor: PATIENT_ACTOR,
    });
    expect(booked.appointment.status).toBe("CONFIRMED");
    // 無 LINE 綁定 → 通知走簡訊
    const notification = await prisma.notification.findFirstOrThrow({
      where: { appointmentId: booked.appointment.id },
    });
    expect(notification.channel).toBe("SMS");
  });

  it("14. 一個 LINE 帳號可替不同家庭成員預約，限制各自計算", async () => {
    const { drTsai, drLee, general } = await seedBase();
    const line = await prisma.lineAccount.create({
      data: { lineUserId: "U_test_parent", displayName: "測試家長" },
    });
    const kidA = makePatient({ name: "王大寶" });
    const kidB = makePatient({ name: "王小寶" });
    const date = futureDate(3);

    const a = await createAppointment({
      clinicTypeId: general.id, doctorId: drTsai.id, date, startTime: "09:00",
      patientInput: kidA, source: "LINE", actor: PATIENT_ACTOR,
    });
    // 同一天、同一家長，另一位小孩仍可預約（不同病人）
    const b = await createAppointment({
      clinicTypeId: general.id, doctorId: drLee.id, date, startTime: "09:00",
      patientInput: kidB, source: "LINE", actor: PATIENT_ACTOR,
    });
    await prisma.linePatientLink.createMany({
      data: [
        { lineAccountId: line.id, patientId: a.patient.id, verifiedAt: new Date() },
        { lineAccountId: line.id, patientId: b.patient.id, verifiedAt: new Date() },
      ],
    });
    const links = await prisma.linePatientLink.findMany({ where: { lineAccountId: line.id } });
    expect(links).toHaveLength(2);
    // 有 LINE 綁定後，之後的通知走 LINE（需 Messaging token；未設定則自動退回 SMS）
    const cancelled = await cancelAppointment({
      appointmentId: b.appointment.id, actor: PATIENT_ACTOR, byPatient: true,
    });
    expect(cancelled.status).toBe("CANCELLED_BY_PATIENT");
    const n = await prisma.notification.findFirstOrThrow({
      where: { appointmentId: b.appointment.id, type: "CANCELLED" },
    });
    expect(n.channel).toBe("SMS"); // token 未設定 → 退回簡訊，通知不中斷
  });
});

describe("資料隔離與權限", () => {
  beforeEach(resetDb);

  it("15. 病人無法看到其他人的預約資料", async () => {
    const { drTsai, drLee, general } = await seedBase();
    const a = await createAppointment({
      clinicTypeId: general.id, doctorId: drTsai.id, date: futureDate(3), startTime: "09:00",
      patientInput: makePatient(), source: "WEB", actor: PATIENT_ACTOR,
    });
    const b = await createAppointment({
      clinicTypeId: general.id, doctorId: drLee.id, date: futureDate(4), startTime: "10:00",
      patientInput: makePatient(), source: "WEB", actor: PATIENT_ACTOR,
    });

    const mine = await listAppointmentsForPatients([a.patient.id]);
    expect(mine).toHaveLength(1);
    expect(mine[0].id).toBe(a.appointment.id);

    // 以他人 session 取單筆 → null（不透露存在與否）
    expect(await getAppointmentForPortal(b.appointment.id, [a.patient.id])).toBeNull();
    expect(await listAppointmentsForPatients([])).toHaveLength(0);
  });

  it("16. 櫃檯人員無法使用管理員專屬功能；管理員可以", async () => {
    const staffCtx = {
      user: { id: "s1", displayName: "櫃檯" },
      permissions: new Set(ROLE_PERMISSIONS.STAFF),
    } as unknown as StaffContext;
    const adminCtx = {
      user: { id: "a1", displayName: "管理員" },
      permissions: new Set(ROLE_PERMISSIONS.ADMIN),
    } as unknown as StaffContext;

    // 櫃檯：可寫預約，但不可管理黑名單/員工/設定/稽核/合併病歷
    expect(() => requirePermission(staffCtx, PERMISSIONS.APPOINTMENTS_WRITE)).not.toThrow();
    for (const p of [
      PERMISSIONS.RESTRICTIONS_MANAGE,
      PERMISSIONS.STAFF_MANAGE,
      PERMISSIONS.SETTINGS_MANAGE,
      PERMISSIONS.AUDIT_READ,
      PERMISSIONS.PATIENTS_MERGE,
    ]) {
      expect(() => requirePermission(staffCtx, p)).toThrow(BookingError);
      expect(() => requirePermission(adminCtx, p)).not.toThrow();
    }
    // 未登入一律拒絕
    expect(() => requirePermission(null, PERMISSIONS.APPOINTMENTS_READ)).toThrow(BookingError);
  });

  it("17. 改期操作寫入稽核並以單一交易完成（新時段失敗時原預約不動）", async () => {
    const { drTsai, general } = await seedBase({ doubleShift: false });
    const first = await createAppointment({
      clinicTypeId: general.id, doctorId: drTsai.id, date: futureDate(3), startTime: "09:00",
      patientInput: makePatient(), source: "WEB", actor: PATIENT_ACTOR,
    });
    const blocker = await createAppointment({
      clinicTypeId: general.id, doctorId: drTsai.id, date: futureDate(4), startTime: "09:00",
      patientInput: makePatient(), source: "WEB", actor: PATIENT_ACTOR,
    });
    expect(blocker.appointment.status).toBe("CONFIRMED");

    // 改到已滿時段 → 失敗，原預約完全不動
    await expect(
      rescheduleAppointment({
        appointmentId: first.appointment.id, newDoctorId: drTsai.id,
        newDate: futureDate(4), newStartTime: "09:00",
        actor: PATIENT_ACTOR, byPatient: true,
      }),
    ).rejects.toMatchObject({ code: "SLOT_FULL" });
    const unchanged = await prisma.appointment.findUniqueOrThrow({
      where: { id: first.appointment.id },
    });
    expect(unchanged.status).toBe("CONFIRMED");

    // 改到有空的時段 → 成功；原單標記已改期、新單成立、稽核與通知都有
    const done = await rescheduleAppointment({
      appointmentId: first.appointment.id, newDoctorId: drTsai.id,
      newDate: futureDate(4), newStartTime: "10:00",
      actor: PATIENT_ACTOR, byPatient: true,
    });
    expect(done.oldAppointment.status).toBe("RESCHEDULED");
    expect(done.newAppointment.status).toBe("CONFIRMED");
    expect(done.newAppointment.rescheduledFromId).toBe(first.appointment.id);
    const audit = await prisma.auditLog.findFirst({ where: { action: "appointment.reschedule" } });
    expect(audit).not.toBeNull();
    const notice = await prisma.notification.findFirst({
      where: { appointmentId: done.newAppointment.id, type: "MODIFIED" },
    });
    expect(notice).not.toBeNull();
  });
});
