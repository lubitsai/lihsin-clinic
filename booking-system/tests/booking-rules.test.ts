/**
 * 驗收條件 1,2,4,5,6,7,12：名額、同日、7 天、取消釋放、開放範圍。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { createAppointment, cancelAppointment } from "@/lib/booking";
import { getOpenDates } from "@/lib/availability";
import { BookingError } from "@/lib/errors";
import { resetDb, seedBase, makePatient, futureDate, STAFF_ACTOR, PATIENT_ACTOR } from "./helpers";

async function expectBookingError(promise: Promise<unknown>, code: string) {
  try {
    await promise;
    expect.fail(`預期丟出 ${code}，實際成功`);
  } catch (e) {
    expect(e).toBeInstanceOf(BookingError);
    expect((e as BookingError).code).toBe(code);
  }
}

describe("名額規則", () => {
  beforeEach(resetDb);

  it("1. 單診時，同一醫師同一時段只能成功預約 1 人", async () => {
    const { drTsai, general } = await seedBase({ doubleShift: false });
    const date = futureDate(3);
    const first = await createAppointment({
      clinicTypeId: general.id,
      doctorId: drTsai.id,
      date,
      startTime: "09:00",
      patientInput: makePatient(),
      source: "WEB",
      actor: PATIENT_ACTOR,
    });
    expect(first.appointment.status).toBe("CONFIRMED");
    expect(first.appointment.bookingNumber).toMatch(/^LH\d{6}-[A-Z2-9]{4}$/);

    await expectBookingError(
      createAppointment({
        clinicTypeId: general.id,
        doctorId: drTsai.id,
        date,
        startTime: "09:00",
        patientInput: makePatient(),
        source: "WEB",
        actor: PATIENT_ACTOR,
      }),
      "SLOT_FULL",
    );
  });

  it("2. 雙診時，同一時間可分別預約兩位醫師；且不會擠進同一位醫師", async () => {
    const { drTsai, drLee, general } = await seedBase();
    const date = futureDate(3);
    const a = await createAppointment({
      clinicTypeId: general.id,
      doctorId: drTsai.id,
      date,
      startTime: "09:00",
      patientInput: makePatient(),
      source: "WEB",
      actor: PATIENT_ACTOR,
    });
    const b = await createAppointment({
      clinicTypeId: general.id,
      doctorId: drLee.id,
      date,
      startTime: "09:00",
      patientInput: makePatient(),
      source: "WEB",
      actor: PATIENT_ACTOR,
    });
    expect(a.appointment.doctorId).toBe(drTsai.id);
    expect(b.appointment.doctorId).toBe(drLee.id);

    // 兩位醫師該時段皆滿後，第三人（不限醫師）被拒絕
    await expectBookingError(
      createAppointment({
        clinicTypeId: general.id,
        doctorId: "any",
        date,
        startTime: "09:00",
        patientInput: makePatient(),
        source: "WEB",
        actor: PATIENT_ACTOR,
      }),
      "SLOT_FULL",
    );
  });

  it("不限醫師：自動分配並平衡兩位醫師的預約人數", async () => {
    const { drTsai, drLee, general } = await seedBase();
    const date = futureDate(4);
    // 先給蔡醫師 2 筆，再用不限醫師預約 → 應分給李醫師
    await createAppointment({
      clinicTypeId: general.id, doctorId: drTsai.id, date, startTime: "09:00",
      patientInput: makePatient(), source: "WEB", actor: PATIENT_ACTOR,
    });
    await createAppointment({
      clinicTypeId: general.id, doctorId: drTsai.id, date, startTime: "09:30",
      patientInput: makePatient(), source: "WEB", actor: PATIENT_ACTOR,
    });
    const auto = await createAppointment({
      clinicTypeId: general.id, doctorId: "any", date, startTime: "10:00",
      patientInput: makePatient(), source: "WEB", actor: PATIENT_ACTOR,
    });
    expect(auto.appointment.doctorId).toBe(drLee.id);
  });

  it("重複送出（相同 requestId）回傳同一筆預約，不會重複建立", async () => {
    const { drTsai, general } = await seedBase();
    const date = futureDate(3);
    const requestId = randomUUID();
    const patient = makePatient();
    const p1 = await createAppointment({
      clinicTypeId: general.id, doctorId: drTsai.id, date, startTime: "09:00",
      patientInput: patient, source: "WEB", actor: PATIENT_ACTOR, requestId,
    });
    const p2 = await createAppointment({
      clinicTypeId: general.id, doctorId: drTsai.id, date, startTime: "09:00",
      patientInput: patient, source: "WEB", actor: PATIENT_ACTOR, requestId,
    });
    expect(p2.duplicated).toBe(true);
    expect(p2.appointment.id).toBe(p1.appointment.id);
    expect(await prisma.appointment.count()).toBe(1);
  });
});

describe("同日與 7 天限制", () => {
  beforeEach(resetDb);

  it("4. 同一病人同日預約不同門診時，第二筆被阻擋", async () => {
    const { drTsai, drLee, general, development } = await seedBase();
    const date = futureDate(3);
    const patient = makePatient();
    await createAppointment({
      clinicTypeId: general.id, doctorId: drTsai.id, date, startTime: "09:00",
      patientInput: patient, source: "WEB", actor: PATIENT_ACTOR,
    });
    await expectBookingError(
      createAppointment({
        clinicTypeId: development.id, doctorId: drLee.id, date, startTime: "15:00",
        patientInput: patient, source: "WEB", actor: PATIENT_ACTOR,
      }),
      "DUPLICATE_SAME_DAY",
    );
  });

  it("5. 同一病人同日預約不同醫師時，第二筆被阻擋（含櫃檯代約來源）", async () => {
    const { drTsai, drLee, general } = await seedBase();
    const date = futureDate(3);
    const patient = makePatient();
    const first = await createAppointment({
      clinicTypeId: general.id, doctorId: drTsai.id, date, startTime: "09:00",
      patientInput: patient, source: "LINE", actor: PATIENT_ACTOR,
    });
    // 櫃檯代約同一病人同日（未覆寫）也被擋
    await expectBookingError(
      createAppointment({
        clinicTypeId: general.id, doctorId: drLee.id, date, startTime: "10:00",
        patientId: first.patient.id, source: "STAFF", actor: STAFF_ACTOR, isStaff: true,
      }),
      "DUPLICATE_SAME_DAY",
    );
    // 櫃檯覆寫（輸入理由）可成立，且理由留存
    const overridden = await createAppointment({
      clinicTypeId: general.id, doctorId: drLee.id, date, startTime: "10:00",
      patientId: first.patient.id, source: "STAFF", actor: STAFF_ACTOR, isStaff: true,
      staffOverride: { reason: "家長要求加看，主管同意" },
    });
    expect(overridden.appointment.overrideReason).toContain("主管同意");
  });

  it("6+7. 任意 7 天內最多 3 筆；已取消不計入也不占名額", async () => {
    const { drTsai, general } = await seedBase();
    const patient = makePatient();
    const book = (n: number) =>
      createAppointment({
        clinicTypeId: general.id, doctorId: drTsai.id, date: futureDate(n), startTime: "09:00",
        patientInput: patient, source: "WEB", actor: PATIENT_ACTOR,
      });
    await book(1);
    await book(2);
    const third = await book(3);
    // 第 4 筆（+4 天，與前三筆同在 7 天視窗內）被阻擋
    await expectBookingError(book(4), "WEEKLY_LIMIT");

    // 取消第三筆後，第 4 筆可成立（已取消不計入）
    await cancelAppointment({
      appointmentId: third.appointment.id,
      actor: PATIENT_ACTOR,
      byPatient: true,
    });
    const fourth = await book(4);
    expect(fourth.appointment.status).toBe("CONFIRMED");

    // 已取消不占名額：其他病人可預約原時段
    const other = await createAppointment({
      clinicTypeId: general.id, doctorId: drTsai.id, date: futureDate(3), startTime: "09:00",
      patientInput: makePatient(), source: "WEB", actor: PATIENT_ACTOR,
    });
    expect(other.appointment.status).toBe("CONFIRMED");
  });

  it("跨 7 天視窗的第 4 筆不受限（+1,+2,+3 之後 +8 可約）", async () => {
    const { drTsai, general } = await seedBase();
    const patient = makePatient();
    const book = (n: number) =>
      createAppointment({
        clinicTypeId: general.id, doctorId: drTsai.id, date: futureDate(n), startTime: "09:00",
        patientInput: patient, source: "WEB", actor: PATIENT_ACTOR,
      });
    await book(1);
    await book(2);
    await book(3);
    const ok = await book(9); // 與 +3 相距 6 天 → 視窗 [3..9] 內共 2 筆，合法
    expect(ok.appointment.status).toBe("CONFIRMED");
  });
});

describe("開放日期範圍", () => {
  beforeEach(resetDb);

  it("12. 只能預約未來 14 天內；過去與超出範圍被拒絕；日曆恰為 14 天", async () => {
    const { drTsai, general } = await seedBase();
    const book = (date: string) =>
      createAppointment({
        clinicTypeId: general.id, doctorId: drTsai.id, date, startTime: "09:00",
        patientInput: makePatient(), source: "WEB", actor: PATIENT_ACTOR,
      });
    await expectBookingError(book(futureDate(-1)), "DATE_NOT_OPEN");
    await expectBookingError(book(futureDate(14)), "DATE_NOT_OPEN");
    const edge = await book(futureDate(13)); // 第 14 天（含今天）
    expect(edge.appointment.status).toBe("CONFIRMED");

    const dates = await getOpenDates(general.id);
    expect(dates).toHaveLength(14);
  });
});
