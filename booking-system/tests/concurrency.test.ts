/**
 * 驗收條件 3：多人同時搶同一時段時只能 1 人成功（交易 + FOR UPDATE + partial unique index）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { createAppointment } from "@/lib/booking";
import { BookingError } from "@/lib/errors";
import { randomUUID } from "node:crypto";
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
    // 落敗的那筆要拿到「同日已有預約」，不是交易作廢後的系統錯誤（25P02）
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(failed.reason).toBeInstanceOf(BookingError);
    expect((failed.reason as BookingError).code).toBe("DUPLICATE_SAME_DAY");
  });

  it("初診病人併發預約不同天，兩筆都成立且只建一份病歷", async () => {
    const { drTsai, general } = await seedBase({ doubleShift: false });
    const patient = makePatient();
    const results = await Promise.allSettled(
      [futureDate(5), futureDate(6)].map((date) =>
        createAppointment({
          clinicTypeId: general.id, doctorId: drTsai.id, date, startTime: "09:00",
          patientInput: patient, source: "WEB", actor: PATIENT_ACTOR,
        }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    const created = results.map(
      (r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof createAppointment>>>).value,
    );
    // 只有真正建立病歷的那筆可以宣稱 created（LINE 自動綁定只認這個）
    expect(created.flatMap((c) => c.createdPatientIds)).toHaveLength(1);
    expect(await prisma.patient.count()).toBe(1);
  });

  it("同一 requestId 併發重複送出，回傳同一筆預約", async () => {
    const { drTsai, general } = await seedBase({ doubleShift: false });
    const patient = makePatient();
    const requestId = randomUUID();
    const results = await Promise.all(
      [0, 1].map(() =>
        createAppointment({
          clinicTypeId: general.id, doctorId: drTsai.id, date: futureDate(5), startTime: "09:00",
          patientInput: patient, source: "WEB", actor: PATIENT_ACTOR, requestId,
        }),
      ),
    );
    expect(results[0].appointment.id).toBe(results[1].appointment.id);
    expect(await prisma.appointment.count()).toBe(1);
  });
});
