/**
 * 抓蟲回合的回歸測試：
 * 前台預約不得覆寫既有病歷、查詢身分關卡、提醒批次化、例外取消原子性。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { createAppointment } from "@/lib/booking";
import { createScheduleException } from "@/lib/schedule-admin";
import { enqueueReminders } from "@/lib/notifications";
import { verifyPatientIdentity } from "@/lib/auth/portal";
import { BookingError } from "@/lib/errors";
import {
  resetDb,
  seedBase,
  makePatient,
  futureDate,
  linkLineAccount,
  STAFF_ACTOR,
  PATIENT_ACTOR,
} from "./helpers";

describe("前台預約不得覆寫既有病歷（身分接管防護）", () => {
  beforeEach(resetDb);

  it("知道證件號與生日的人，無法用自己的手機改掉病人的姓名與電話", async () => {
    const { drTsai, general } = await seedBase();
    const victim = makePatient({ name: "王小明", phone: "0911111111" });

    // 病人本人首次預約，建立病歷
    const first = await createAppointment({
      clinicTypeId: general.id, doctorId: drTsai.id, date: futureDate(2), startTime: "09:00",
      patientInput: victim, source: "WEB", actor: PATIENT_ACTOR,
    });
    expect(first.patient.phone).toBe("0911111111");

    // 他人以相同證件＋生日、但填自己的姓名與手機預約
    const attacker = { ...victim, name: "假名", phone: "0922222222" };
    await createAppointment({
      clinicTypeId: general.id, doctorId: drTsai.id, date: futureDate(4), startTime: "09:00",
      patientInput: attacker, source: "WEB", actor: PATIENT_ACTOR,
    });

    // 病歷的姓名與電話必須維持原狀
    const after = await prisma.patient.findUniqueOrThrow({ where: { id: first.patient.id } });
    expect(after.name).toBe("王小明");
    expect(after.phone).toBe("0911111111");

    // 因此無法用攻擊者的手機通過查詢驗證（證件＋生日＋手機三者需相符）
    await expect(
      verifyPatientIdentity("NATIONAL_ID", victim.idNumber, victim.birthDate, "0922222222"),
    ).rejects.toBeInstanceOf(BookingError);
    // 本人仍可正常查詢
    await expect(
      verifyPatientIdentity("NATIONAL_ID", victim.idNumber, victim.birthDate, "0911111111"),
    ).resolves.toBe(first.patient.id);

    // 不符的電話留成待確認聯絡方式，供櫃檯核對
    const pending = await prisma.patientContact.findMany({ where: { patientId: first.patient.id } });
    expect(pending).toHaveLength(1);
    expect(pending[0].value).toBe("0922222222");
    expect(pending[0].label).toContain("待櫃檯確認");
  });

  it("通知一律送到已綁定的 LINE 帳號，不會被新填的手機帶走", async () => {
    const { drTsai, general } = await seedBase();
    const patient = makePatient({ phone: "0911111111" });
    const first = await createAppointment({
      clinicTypeId: general.id, doctorId: drTsai.id, date: futureDate(2), startTime: "09:00",
      patientInput: patient, source: "LINE", actor: PATIENT_ACTOR,
    });
    const account = await linkLineAccount(first.patient.id);

    // 他人以相同證件＋生日、但填自己的手機再預約一次
    const second = await createAppointment({
      clinicTypeId: general.id, doctorId: drTsai.id, date: futureDate(4), startTime: "09:00",
      patientInput: { ...patient, phone: "0922222222" }, source: "LINE", actor: PATIENT_ACTOR,
    });
    expect(second.patient.id).toBe(first.patient.id);
    // 收件者取自病歷既有的 LINE 綁定，與這次填的手機無關——
    // 填別的號碼攔截不到通知（簡訊時代是靠「不覆寫病歷電話」達成同一件事）
    const notice = await prisma.notification.findFirstOrThrow({
      where: { appointmentId: second.appointment.id },
    });
    expect(notice.channel).toBe("LINE");
    expect(notice.recipient).toBe(account.lineUserId);
  });

  it("櫃檯代約（已確認身分）仍可更新聯絡資料", async () => {
    const { drTsai, general } = await seedBase();
    const patient = makePatient({ name: "陳小華", phone: "0911111111" });
    const first = await createAppointment({
      clinicTypeId: general.id, doctorId: drTsai.id, date: futureDate(2), startTime: "09:00",
      patientInput: patient, source: "WEB", actor: PATIENT_ACTOR,
    });
    await createAppointment({
      clinicTypeId: general.id, doctorId: drTsai.id, date: futureDate(4), startTime: "10:00",
      patientInput: { ...patient, phone: "0933333333" },
      source: "STAFF", actor: STAFF_ACTOR, isStaff: true,
    });
    const after = await prisma.patient.findUniqueOrThrow({ where: { id: first.patient.id } });
    expect(after.phone).toBe("0933333333");
  });
});

describe("病歷合併後的後續預約與查詢", () => {
  beforeEach(resetDb);

  it("合併後再上網預約，掛到保留的病歷，限制也算在同一個人身上", async () => {
    const { drTsai, drLee, general } = await seedBase();
    const oldInput = makePatient({ name: "林小美", phone: "0911111111" });
    const old = await createAppointment({
      clinicTypeId: general.id, doctorId: drTsai.id, date: futureDate(2), startTime: "09:00",
      patientInput: oldInput, source: "WEB", actor: PATIENT_ACTOR,
    });
    // 另一筆重複病歷（不同證件號），作為合併後保留的一筆
    const keep = await prisma.patient.create({
      data: {
        name: "林小美",
        birthDate: new Date(`${oldInput.birthDate}T00:00:00Z`),
        idType: "NATIONAL_ID",
        idNumberEncrypted: "x",
        idNumberHash: "keep-hash",
        idNumberMasked: "A12****999",
        phone: "0911111111",
      },
    });
    await prisma.appointment.updateMany({
      where: { patientId: old.patient.id },
      data: { patientId: keep.id },
    });
    await prisma.patient.update({
      where: { id: old.patient.id },
      data: { mergedIntoId: keep.id },
    });

    // 用舊證件號再預約 → 應掛到保留的病歷
    const again = await createAppointment({
      clinicTypeId: general.id, doctorId: drLee.id, date: futureDate(5), startTime: "09:00",
      patientInput: oldInput, source: "WEB", actor: PATIENT_ACTOR,
    });
    expect(again.patient.id).toBe(keep.id);

    // 同日唯一也要對保留的病歷生效
    await expect(
      createAppointment({
        clinicTypeId: general.id, doctorId: drTsai.id, date: futureDate(5), startTime: "10:00",
        patientInput: oldInput, source: "WEB", actor: PATIENT_ACTOR,
      }),
    ).rejects.toMatchObject({ code: "DUPLICATE_SAME_DAY" });

    // 前台查詢用舊證件號，也要導向保留的病歷
    await expect(
      verifyPatientIdentity("NATIONAL_ID", oldInput.idNumber, oldInput.birthDate, "0911111111"),
    ).resolves.toBe(keep.id);
  });
});

describe("查詢與綁定的身分關卡：證件＋生日＋手機三者全對才過", () => {
  beforeEach(resetDb);

  it("證件與生日相符、手機不同，一律回中性訊息（不透露該證件是否為本院病人）", async () => {
    const { drTsai, general } = await seedBase();
    const input = makePatient({ phone: "0911111111" });
    await createAppointment({
      clinicTypeId: general.id, doctorId: drTsai.id, date: futureDate(2), startTime: "09:00",
      patientInput: input, source: "LINE", actor: PATIENT_ACTOR,
    });

    // 三者全對 → 過
    await expect(
      verifyPatientIdentity("NATIONAL_ID", input.idNumber, input.birthDate, "0911111111"),
    ).resolves.toBeTruthy();

    // 手機不符 → 擋下。簡訊取消後這是唯一的關卡，鬆掉就等於
    // 「知道證件號與生日」即可讀到他人完整預約紀錄。
    await expect(
      verifyPatientIdentity("NATIONAL_ID", input.idNumber, input.birthDate, "0922222222"),
    ).rejects.toMatchObject({ userMessage: expect.stringContaining("查無符合的預約資料") });

    // 生日不符 → 同一句中性訊息，錯在哪一項看不出來
    await expect(
      verifyPatientIdentity("NATIONAL_ID", input.idNumber, "2001-01-01", "0911111111"),
    ).rejects.toMatchObject({ userMessage: expect.stringContaining("查無符合的預約資料") });

    // 查無此證件 → 也是同一句
    await expect(
      verifyPatientIdentity("NATIONAL_ID", "A199999999", input.birthDate, "0911111111"),
    ).rejects.toMatchObject({ userMessage: expect.stringContaining("查無符合的預約資料") });
  });
});

describe("批次作業的正確性", () => {
  beforeEach(resetDb);

  it("提醒排入不受筆數影響，且不重複排入", async () => {
    const { drTsai, drLee, general } = await seedBase();
    const date = futureDate(1);
    for (const doctorId of [drTsai.id, drLee.id]) {
      const r = await createAppointment({
        clinicTypeId: general.id, doctorId, date, startTime: "09:00",
        patientInput: makePatient(), source: "LINE", actor: PATIENT_ACTOR,
      });
      await linkLineAccount(r.patient.id); // 沒綁 LINE 就沒有管道，提醒不會排入
    }
    const queued = await enqueueReminders(date, "REMINDER_DAY_BEFORE");
    expect(queued).toBe(2);
    const rows = await prisma.notification.findMany({ where: { type: "REMINDER_DAY_BEFORE" } });
    expect(rows).toHaveLength(2);
    expect(rows[0].payload).toHaveProperty("message");
    // 只驗「有帶到看診日資訊」，不綁特定措辭（措辭要能改，規則不能）
    expect((rows[0].payload as { message: string }).message).toContain("明天");
    // 再跑一次不應重複排入
    expect(await enqueueReminders(date, "REMINDER_DAY_BEFORE")).toBe(0);
  });

  it("批次取消受影響預約與建立例外為單一交易（全成或全不動）", async () => {
    const { drTsai, general } = await seedBase({ doubleShift: false });
    const date = futureDate(3);
    const booking = await createAppointment({
      clinicTypeId: general.id, doctorId: drTsai.id, date, startTime: "09:00",
      patientInput: makePatient(), source: "LINE", actor: PATIENT_ACTOR,
    });
    await linkLineAccount(booking.patient.id); // 有 LINE 綁定才收得到取消通知
    const applied = await createScheduleException(
      { date, type: "DOCTOR_OFF", doctorId: drTsai.id, reason: "臨時休診" },
      STAFF_ACTOR,
      { cancelAffected: true, cancelReason: "醫師臨時休診" },
    );
    expect(applied.created).toBeDefined();
    const appt = await prisma.appointment.findUniqueOrThrow({
      where: { id: booking.appointment.id },
    });
    expect(appt.status).toBe("CANCELLED_BY_CLINIC");
    // 取消通知與例外同時存在
    expect(await prisma.notification.count({ where: { type: "CANCELLED" } })).toBe(1);
    expect(await prisma.scheduleException.count()).toBe(1);
  });
});
