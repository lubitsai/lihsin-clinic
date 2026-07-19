/**
 * 驗收條件 3：多人同時搶同一時段時只能 1 人成功（交易 + FOR UPDATE + partial unique index）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { createAppointment } from "@/lib/booking";
import { resetDb, seedBase, makePatient, futureDate, PATIENT_ACTOR } from "./helpers";

describe("高併發防超賣", () => {
  beforeEach(resetDb);

  it("3. 5 人同時搶單診同一時段，只有 1 人成功", async () => {
    const { drTsai, general } = await seedBase({ doubleShift: false });
    const date = futureDate(5);
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        createAppointment({
          clinicTypeId: general.id,
          doctorId: drTsai.id,
          date,
          startTime: "10:00",
          patientInput: makePatient(),
          source: "WEB",
          actor: PATIENT_ACTOR,
        }),
      ),
    );
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok).toHaveLength(1);
    expect(await prisma.appointment.count({ where: { status: "CONFIRMED" } })).toBe(1);
  });

  it("雙診同一時段 6 人併發（不限醫師），恰好 2 人成功且分屬不同醫師", async () => {
    const { general } = await seedBase();
    const date = futureDate(5);
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        createAppointment({
          clinicTypeId: general.id,
          doctorId: "any",
          date,
          startTime: "10:00",
          patientInput: makePatient(),
          source: "WEB",
          actor: PATIENT_ACTOR,
        }),
      ),
    );
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok).toHaveLength(2);
    const appts = await prisma.appointment.findMany({ where: { status: "CONFIRMED" } });
    expect(new Set(appts.map((a) => a.doctorId)).size).toBe(2);
  });

  it("同一病人併發送出兩個不同時段，同日限制仍只允許 1 筆", async () => {
    const { drTsai, general } = await seedBase({ doubleShift: false });
    const date = futureDate(5);
    const patient = makePatient();
    const results = await Promise.allSettled([
      createAppointment({
        clinicTypeId: general.id, doctorId: drTsai.id, date, startTime: "09:00",
        patientInput: patient, source: "WEB", actor: PATIENT_ACTOR,
      }),
      createAppointment({
        clinicTypeId: general.id, doctorId: drTsai.id, date, startTime: "10:30",
        patientInput: patient, source: "WEB", actor: PATIENT_ACTOR,
      }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok).toHaveLength(1);
  });
});
