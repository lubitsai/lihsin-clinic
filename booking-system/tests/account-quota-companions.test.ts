/**
 * 院長 2026-08-01 裁示：
 * D7 額度以「預約帳號」計算、D8 超額時擋下（不自動取消）、D9 家庭代表預約。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { createAppointment, cancelAppointment, rescheduleAppointment } from "@/lib/booking";
import { resetDb, seedBase, makePatient, futureDate, STAFF_ACTOR, PATIENT_ACTOR } from "./helpers";

const ACCOUNT = "phone:0912345678";

describe("D7 額度以預約帳號計算", () => {
  beforeEach(resetDb);

  it("同一帳號替不同孩子預約，第 3 筆未完成預約被擋下", async () => {
    const { drTsai, drLee, general } = await seedBase();
    const book = (day: number, doctorId: string) =>
      createAppointment({
        clinicTypeId: general.id, doctorId, date: futureDate(day), startTime: "09:00",
        patientInput: makePatient(), accountKey: ACCOUNT, source: "WEB", actor: PATIENT_ACTOR,
      });
    await book(2, drTsai.id);
    await book(3, drTsai.id);
    // 第 3 筆（不同孩子、不同醫師）仍受同一帳號額度限制
    await expect(book(4, drLee.id)).rejects.toMatchObject({ code: "ACTIVE_LIMIT" });
  });

  it("不同帳號各自計算，互不影響", async () => {
    const { drTsai, general } = await seedBase();
    const bookWith = (account: string, day: number) =>
      createAppointment({
        clinicTypeId: general.id, doctorId: drTsai.id, date: futureDate(day), startTime: "09:00",
        patientInput: makePatient(), accountKey: account, source: "WEB", actor: PATIENT_ACTOR,
      });
    await bookWith(ACCOUNT, 2);
    await bookWith(ACCOUNT, 3);
    const other = await bookWith("phone:0987654321", 4);
    expect(other.appointment.status).toBe("CONFIRMED");
  });

  it("當日的預約不計入帳號額度", async () => {
    const { drTsai, drLee, general } = await seedBase();
    // 未來兩筆＝額度已滿
    for (const day of [2, 3]) {
      await createAppointment({
        clinicTypeId: general.id, doctorId: drTsai.id, date: futureDate(day), startTime: "09:00",
        patientInput: makePatient(), accountKey: ACCOUNT, source: "WEB", actor: PATIENT_ACTOR,
      });
    }
    // 當日仍可預約（公告：當日的預約不計入）
    const sameDay = await createAppointment({
      clinicTypeId: general.id, doctorId: drLee.id, date: futureDate(0), startTime: "21:00",
      patientInput: makePatient(), accountKey: ACCOUNT, source: "WEB", actor: PATIENT_ACTOR,
    });
    expect(sameDay.appointment.status).toBe("CONFIRMED");
  });

  it("櫃檯代約沒有帳號，不受帳號額度限制", async () => {
    const { drTsai, general } = await seedBase();
    for (const day of [2, 3]) {
      await createAppointment({
        clinicTypeId: general.id, doctorId: drTsai.id, date: futureDate(day), startTime: "09:00",
        patientInput: makePatient(), accountKey: ACCOUNT, source: "WEB", actor: PATIENT_ACTOR,
      });
    }
    const staffBooked = await createAppointment({
      clinicTypeId: general.id, doctorId: drTsai.id, date: futureDate(4), startTime: "09:00",
      patientInput: makePatient(), source: "STAFF", actor: STAFF_ACTOR, isStaff: true,
    });
    expect(staffBooked.appointment.status).toBe("CONFIRMED");
    expect(staffBooked.appointment.accountKey).toBeNull();
  });

  it("D8 超額時擋下且不動既有預約；取消一筆後即可再約", async () => {
    const { drTsai, general } = await seedBase();
    const first = await createAppointment({
      clinicTypeId: general.id, doctorId: drTsai.id, date: futureDate(2), startTime: "09:00",
      patientInput: makePatient(), accountKey: ACCOUNT, source: "WEB", actor: PATIENT_ACTOR,
    });
    await createAppointment({
      clinicTypeId: general.id, doctorId: drTsai.id, date: futureDate(3), startTime: "09:00",
      patientInput: makePatient(), accountKey: ACCOUNT, source: "WEB", actor: PATIENT_ACTOR,
    });
    await expect(
      createAppointment({
        clinicTypeId: general.id, doctorId: drTsai.id, date: futureDate(4), startTime: "09:00",
        patientInput: makePatient(), accountKey: ACCOUNT, source: "WEB", actor: PATIENT_ACTOR,
      }),
    ).rejects.toMatchObject({ code: "ACTIVE_LIMIT" });
    // 既有兩筆完全不受影響（不採自動取消）
    expect(await prisma.appointment.count({ where: { status: "CONFIRMED" } })).toBe(2);

    await cancelAppointment({
      appointmentId: first.appointment.id, actor: PATIENT_ACTOR, byPatient: true,
    });
    const third = await createAppointment({
      clinicTypeId: general.id, doctorId: drTsai.id, date: futureDate(4), startTime: "09:00",
      patientInput: makePatient(), accountKey: ACCOUNT, source: "WEB", actor: PATIENT_ACTOR,
    });
    expect(third.appointment.status).toBe("CONFIRMED");
  });

  it("改期沿用原預約的帳號歸屬", async () => {
    const { drTsai, general } = await seedBase();
    const booked = await createAppointment({
      clinicTypeId: general.id, doctorId: drTsai.id, date: futureDate(2), startTime: "09:00",
      patientInput: makePatient(), accountKey: ACCOUNT, source: "WEB", actor: PATIENT_ACTOR,
    });
    const { newAppointment } = await rescheduleAppointment({
      appointmentId: booked.appointment.id, newDoctorId: "any",
      newDate: futureDate(5), newStartTime: "10:00", actor: PATIENT_ACTOR, byPatient: true,
    });
    expect(newAppointment.accountKey).toBe(ACCOUNT);
  });
});

describe("D9 家庭代表預約", () => {
  beforeEach(resetDb);

  it("一個名額涵蓋多位家人，不多占名額也不多扣帳號額度", async () => {
    const { drTsai, general } = await seedBase({ doubleShift: false });
    const date = futureDate(3);
    const sibling = makePatient({ name: "王二寶" });
    const result = await createAppointment({
      clinicTypeId: general.id, doctorId: drTsai.id, date, startTime: "09:00",
      patientInput: makePatient({ name: "王大寶" }), companions: [sibling],
      accountKey: ACCOUNT, source: "WEB", actor: PATIENT_ACTOR,
    });
    expect(result.companions).toHaveLength(1);
    expect(result.companions![0].name).toBe("王二寶");
    // 只產生一筆預約、只占一個名額
    expect(await prisma.appointment.count()).toBe(1);
    const links = await prisma.appointmentCompanion.findMany();
    expect(links).toHaveLength(1);

    // 同時段（單診）已滿，他人無法再預約
    await expect(
      createAppointment({
        clinicTypeId: general.id, doctorId: drTsai.id, date, startTime: "09:00",
        patientInput: makePatient(), accountKey: "phone:0900000000",
        source: "WEB", actor: PATIENT_ACTOR,
      }),
    ).rejects.toMatchObject({ code: "SLOT_FULL" });

    // 帳號額度只算 1 筆：同帳號還可再約 1 筆
    const second = await createAppointment({
      clinicTypeId: general.id, doctorId: drTsai.id, date: futureDate(5), startTime: "09:00",
      patientInput: makePatient(), accountKey: ACCOUNT, source: "WEB", actor: PATIENT_ACTOR,
    });
    expect(second.appointment.status).toBe("CONFIRMED");
  });

  it("同行家人當天不得另有預約（雙向檢查）", async () => {
    const { drTsai, drLee, general } = await seedBase();
    const date = futureDate(3);
    const sibling = makePatient({ name: "李二寶" });
    // 同行家人先自己有一筆預約
    await createAppointment({
      clinicTypeId: general.id, doctorId: drLee.id, date, startTime: "10:00",
      patientInput: sibling, accountKey: "phone:0955555555", source: "WEB", actor: PATIENT_ACTOR,
    });
    // 再被當成同行家人 → 應被擋
    await expect(
      createAppointment({
        clinicTypeId: general.id, doctorId: drTsai.id, date, startTime: "09:00",
        patientInput: makePatient({ name: "李大寶" }), companions: [sibling],
        accountKey: ACCOUNT, source: "WEB", actor: PATIENT_ACTOR,
      }),
    ).rejects.toMatchObject({ code: "DUPLICATE_SAME_DAY" });

    // 反向：已是某筆預約的同行家人，當天不能再自己預約
    const other = makePatient({ name: "陳二寶" });
    await createAppointment({
      clinicTypeId: general.id, doctorId: drTsai.id, date: futureDate(6), startTime: "09:00",
      patientInput: makePatient({ name: "陳大寶" }), companions: [other],
      accountKey: ACCOUNT, source: "WEB", actor: PATIENT_ACTOR,
    });
    await expect(
      createAppointment({
        clinicTypeId: general.id, doctorId: drLee.id, date: futureDate(6), startTime: "11:00",
        patientInput: other, accountKey: "phone:0966666666", source: "WEB", actor: PATIENT_ACTOR,
      }),
    ).rejects.toMatchObject({ code: "DUPLICATE_SAME_DAY" });
  });

  it("兒童發展篩檢不適用家庭代表預約（每時段只 1 位施測）", async () => {
    const { drTsai, development } = await seedBase();
    await expect(
      createAppointment({
        clinicTypeId: development.id, doctorId: drTsai.id, date: futureDate(3), startTime: "09:00",
        patientInput: makePatient(), companions: [makePatient()],
        accountKey: ACCOUNT, source: "WEB", actor: PATIENT_ACTOR,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("同行家人重複或與代表人相同時擋下", async () => {
    const { drTsai, general } = await seedBase();
    const primary = makePatient({ name: "重複測試" });
    await expect(
      createAppointment({
        clinicTypeId: general.id, doctorId: drTsai.id, date: futureDate(3), startTime: "09:00",
        patientInput: primary, companions: [primary],
        accountKey: ACCOUNT, source: "WEB", actor: PATIENT_ACTOR,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("改期時同行家人一併轉到新預約", async () => {
    const { drTsai, general } = await seedBase();
    const sibling = makePatient({ name: "改期同行" });
    const booked = await createAppointment({
      clinicTypeId: general.id, doctorId: drTsai.id, date: futureDate(3), startTime: "09:00",
      patientInput: makePatient(), companions: [sibling],
      accountKey: ACCOUNT, source: "WEB", actor: PATIENT_ACTOR,
    });
    const { newAppointment } = await rescheduleAppointment({
      appointmentId: booked.appointment.id, newDoctorId: "any",
      newDate: futureDate(6), newStartTime: "10:00", actor: PATIENT_ACTOR, byPatient: true,
    });
    const moved = await prisma.appointmentCompanion.findMany({
      where: { appointmentId: newAppointment.id },
      include: { patient: true },
    });
    expect(moved).toHaveLength(1);
    expect(moved[0].patient.name).toBe("改期同行");
  });
});
