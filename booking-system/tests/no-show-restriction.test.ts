/**
 * 驗收條件 8, 9, 17：未到自動限制、解除後可預約、稽核紀錄。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { createAppointment, updateAppointmentStatus } from "@/lib/booking";
import { liftRestriction, resetNoShowCount } from "@/lib/restrictions";
import { BookingError } from "@/lib/errors";
import { resetDb, seedBase, makePatient, futureDate, STAFF_ACTOR, PATIENT_ACTOR } from "./helpers";

const ADMIN_ACTOR = { type: "STAFF" as const, id: "test-admin", name: "測試管理員" };

describe("未到與黑名單", () => {
  beforeEach(resetDb);

  async function bookAndNoShow(patientInput: ReturnType<typeof makePatient>, day: number, base: Awaited<ReturnType<typeof seedBase>>) {
    const { appointment } = await createAppointment({
      clinicTypeId: base.general.id,
      doctorId: base.drTsai.id,
      date: futureDate(day),
      startTime: "09:00",
      patientInput,
      source: "WEB",
      actor: PATIENT_ACTOR,
    });
    await updateAppointmentStatus({
      appointmentId: appointment.id,
      toStatus: "NO_SHOW",
      actor: STAFF_ACTOR,
    });
    return appointment;
  }

  it("8+9. 第 4 次未到自動限制前台預約；管理員解除後可再次預約", async () => {
    const base = await seedBase();
    const patientInput = makePatient();

    // 前 3 次未到：尚未限制
    for (let i = 1; i <= 3; i++) await bookAndNoShow(patientInput, i, base);
    let restrictions = await prisma.bookingRestriction.findMany();
    expect(restrictions).toHaveLength(0);

    // 第 4 次未到：自動限制
    await bookAndNoShow(patientInput, 4, base);
    restrictions = await prisma.bookingRestriction.findMany({ where: { status: "ACTIVE" } });
    expect(restrictions).toHaveLength(1);
    expect(restrictions[0].type).toBe("AUTO_NO_SHOW");

    // 前台預約被擋（中性訊息，不含「黑名單」字樣）
    try {
      await createAppointment({
        clinicTypeId: base.general.id, doctorId: base.drTsai.id, date: futureDate(6),
        startTime: "09:00", patientInput, source: "WEB", actor: PATIENT_ACTOR,
      });
      expect.fail("應被限制");
    } catch (e) {
      expect((e as BookingError).code).toBe("RESTRICTED");
      expect((e as BookingError).userMessage).not.toContain("黑名單");
      expect((e as BookingError).userMessage).toContain("請致電立欣診所");
    }

    // 櫃檯覆寫仍可代約（需理由）
    const patient = await prisma.patient.findFirstOrThrow();
    const staffBooking = await createAppointment({
      clinicTypeId: base.general.id, doctorId: base.drTsai.id, date: futureDate(6),
      startTime: "10:00", patientId: patient.id, source: "STAFF", actor: STAFF_ACTOR,
      isStaff: true, staffOverride: { reason: "家長來電說明前次未到原因，同意此次代約" },
    });
    expect(staffBooking.appointment.status).toBe("CONFIRMED");

    // 管理員解除限制（需原因）後，前台可再預約
    await liftRestriction(restrictions[0].id, ADMIN_ACTOR, "家長說明原因，院長同意解除");
    const rebooked = await createAppointment({
      clinicTypeId: base.general.id, doctorId: base.drTsai.id, date: futureDate(8),
      startTime: "09:00", patientInput, source: "WEB", actor: PATIENT_ACTOR,
    });
    expect(rebooked.appointment.status).toBe("CONFIRMED");
  });

  it("暫時解除（至期限）後於期限內可預約", async () => {
    const base = await seedBase();
    const patientInput = makePatient();
    for (let i = 1; i <= 4; i++) await bookAndNoShow(patientInput, i, base);
    const restriction = await prisma.bookingRestriction.findFirstOrThrow();
    await liftRestriction(
      restriction.id,
      ADMIN_ACTOR,
      "暫時開放一週",
      new Date(Date.now() + 7 * 86400000),
    );
    const ok = await createAppointment({
      clinicTypeId: base.general.id, doctorId: base.drTsai.id, date: futureDate(6),
      startTime: "09:00", patientInput, source: "WEB", actor: PATIENT_ACTOR,
    });
    expect(ok.appointment.status).toBe("CONFIRMED");
  });

  it("重設未到次數需原因並寫入稽核", async () => {
    const base = await seedBase();
    const patientInput = makePatient();
    await bookAndNoShow(patientInput, 1, base);
    const patient = await prisma.patient.findFirstOrThrow();
    expect(patient.noShowCount).toBe(1);
    await resetNoShowCount(patient.id, ADMIN_ACTOR, "誤標，經查當日有到診");
    const after = await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } });
    expect(after.noShowCount).toBe(0);
    const audit = await prisma.auditLog.findFirst({ where: { action: "patient.no_show_reset" } });
    expect(audit).not.toBeNull();
  });

  it("17. 未到、自動限制、解除均有稽核紀錄", async () => {
    const base = await seedBase();
    const patientInput = makePatient();
    for (let i = 1; i <= 4; i++) await bookAndNoShow(patientInput, i, base);
    const restriction = await prisma.bookingRestriction.findFirstOrThrow();
    await liftRestriction(restriction.id, ADMIN_ACTOR, "測試解除");

    const actions = (await prisma.auditLog.findMany()).map((a) => a.action);
    expect(actions).toContain("appointment.no_show");
    expect(actions).toContain("restriction.auto_create");
    expect(actions).toContain("restriction.lift");
  });
});
