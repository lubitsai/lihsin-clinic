/**
 * 院長 2026-08-06 裁示 (a)：改常態班表比照單日例外，
 * 先列出會失去時段的既有預約，處理完才生效。
 *
 * 涵蓋兩條路：後台改／刪週班表，以及官網門診時間異動後的 applySchedule。
 * 這兩條路先前都沒有這道檢查，預約會留在診所已經不看診的時間。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { createAppointment } from "@/lib/booking";
import { applyTemplateChange } from "@/lib/schedule-admin";
import { applySchedule, type ScheduleSource } from "@/lib/schedule-source";
import { getDayScheduleBlocks } from "@/lib/schedule";
import type { PrismaClient } from "@prisma/client";
import {
  resetDb, seedBase, makePatient, futureDate, todayStr, weekdayOf, STAFF_ACTOR, PATIENT_ACTOR,
} from "./helpers";

/** 目標日：三天後的 08:00，早診第一格 */
const TARGET_DAY = 3;

async function bookMorningEight(clinicTypeId: string, doctorId: string) {
  const date = futureDate(TARGET_DAY);
  const { appointment } = await createAppointment({
    clinicTypeId, doctorId, date, startTime: "08:00",
    patientInput: makePatient(), source: "WEB", actor: PATIENT_ACTOR,
  });
  return { appointment, date, weekday: weekdayOf(date) };
}

describe("後台改常態班表", () => {
  beforeEach(resetDb);

  it("有預約會落在新班表外時，班表完全不動，只回傳名單", async () => {
    const { general, drTsai } = await seedBase();
    const { appointment, weekday } = await bookMorningEight(general.id, drTsai.id);
    const row = await prisma.weeklyScheduleTemplate.findFirstOrThrow({
      where: { weekday, session: "MORNING", doctorId: drTsai.id },
    });

    const result = await applyTemplateChange(
      { id: row.id, weekday, session: "MORNING", startTime: "09:00", endTime: "12:00",
        doctorId: drTsai.id, slotCapacity: 1, allowOnline: true, isActive: true },
      STAFF_ACTOR,
      { today: todayStr() },
    );

    expect(result.ok).toBeUndefined();
    expect(result.affected).toHaveLength(1);
    expect(result.affected?.[0].id).toBe(appointment.id);
    // 班表與預約都必須維持原狀
    const after = await prisma.weeklyScheduleTemplate.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.startTime).toBe("08:00");
    const appt = await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    expect(appt.status).toBe("CONFIRMED");
  });

  it("確認取消後，班表變更與診所取消同時生效並排入通知", async () => {
    const { general, drTsai } = await seedBase();
    const { appointment, weekday } = await bookMorningEight(general.id, drTsai.id);
    const row = await prisma.weeklyScheduleTemplate.findFirstOrThrow({
      where: { weekday, session: "MORNING", doctorId: drTsai.id },
    });

    const result = await applyTemplateChange(
      { id: row.id, weekday, session: "MORNING", startTime: "09:00", endTime: "12:00",
        doctorId: drTsai.id, slotCapacity: 1, allowOnline: true, isActive: true },
      STAFF_ACTOR,
      { today: todayStr(), cancelAffected: true, cancelReason: "門診時間異動" },
    );

    expect(result.ok).toBe(true);
    const after = await prisma.weeklyScheduleTemplate.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.startTime).toBe("09:00");
    const appt = await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    expect(appt.status).toBe("CANCELLED_BY_CLINIC");
    expect(
      await prisma.notification.count({ where: { appointmentId: appointment.id, type: "CANCELLED" } }),
    ).toBe(1);
  });

  it("縮短時間但預約仍在區間內時，直接生效", async () => {
    const { general, drTsai } = await seedBase();
    const { appointment, weekday } = await bookMorningEight(general.id, drTsai.id);
    const row = await prisma.weeklyScheduleTemplate.findFirstOrThrow({
      where: { weekday, session: "MORNING", doctorId: drTsai.id },
    });

    // 08:00–11:00：08:00 的預約仍被涵蓋
    const result = await applyTemplateChange(
      { id: row.id, weekday, session: "MORNING", startTime: "08:00", endTime: "11:00",
        doctorId: drTsai.id, slotCapacity: 1, allowOnline: true, isActive: true },
      STAFF_ACTOR,
      { today: todayStr() },
    );
    expect(result.ok).toBe(true);
    const appt = await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    expect(appt.status).toBe("CONFIRMED");
  });

  it("刪除整列班表同樣先擋下", async () => {
    const { general, drTsai } = await seedBase();
    const { weekday } = await bookMorningEight(general.id, drTsai.id);
    const row = await prisma.weeklyScheduleTemplate.findFirstOrThrow({
      where: { weekday, session: "MORNING", doctorId: drTsai.id },
    });

    const result = await applyTemplateChange(
      { id: row.id, remove: true, weekday, session: "MORNING", startTime: row.startTime,
        endTime: row.endTime, doctorId: drTsai.id, slotCapacity: 1, allowOnline: true, isActive: true },
      STAFF_ACTOR,
      { today: todayStr() },
    );
    expect(result.affected).toHaveLength(1);
    expect(
      await prisma.weeklyScheduleTemplate.count({ where: { id: row.id } }),
    ).toBe(1);
  });
});

describe("官網門診時間異動後的同步（applySchedule）", () => {
  beforeEach(resetDb);

  /** 只描述目標日那一個星期幾，其餘星期不在 source 內＝不動 */
  function sourceWithMorningStart(weekday: number, start: string): ScheduleSource {
    return {
      weekly: {
        [String(weekday)]: [
          { session: "MORNING", start, end: "12:00", doctors: ["蔡", "李"] },
          { session: "AFTERNOON", start: "14:30", end: "18:00", doctors: ["蔡", "李"] },
          { session: "EVENING", start: "18:30", end: "21:30", doctors: ["蔡", "李"] },
        ],
      },
      exceptions: {},
    };
  }

  it("官網把早診改晚，既有 08:00 預約會被擋下，班表整批不寫入", async () => {
    const { general, drTsai } = await seedBase();
    const { appointment, weekday } = await bookMorningEight(general.id, drTsai.id);

    const r = await applySchedule(
      prisma as unknown as PrismaClient,
      sourceWithMorningStart(weekday, "09:00"),
      todayStr(),
    );

    expect(r.applied).toBe(false);
    expect(r.affected).toHaveLength(1);
    expect(r.affected[0].id).toBe(appointment.id);
    expect(r.created + r.updated + r.removed).toBe(0);
    // 班表沒被動過：當日 08:00 仍在看診區間內
    const blocks = await getDayScheduleBlocks(futureDate(TARGET_DAY));
    expect(blocks.some((b) => b.doctorId === drTsai.id && b.startTime === "08:00")).toBe(true);
  });

  it("授權取消後才套用，並把受影響預約以診所取消處理", async () => {
    const { general, drTsai } = await seedBase();
    const { appointment, weekday } = await bookMorningEight(general.id, drTsai.id);

    const r = await applySchedule(
      prisma as unknown as PrismaClient,
      sourceWithMorningStart(weekday, "09:00"),
      todayStr(),
      { cancelAffected: true, cancelReason: "門診時間異動（官網公告）" },
    );

    expect(r.applied).toBe(true);
    expect(r.affected).toHaveLength(1);
    expect(r.updated).toBeGreaterThan(0);
    const appt = await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    expect(appt.status).toBe("CANCELLED_BY_CLINIC");
    const blocks = await getDayScheduleBlocks(futureDate(TARGET_DAY));
    expect(blocks.some((b) => b.doctorId === drTsai.id && b.startTime === "09:00")).toBe(true);
  });

  it("班表沒有變動時，既有預約不受影響也不會被擋", async () => {
    const { general, drTsai } = await seedBase();
    const { appointment, weekday } = await bookMorningEight(general.id, drTsai.id);

    const r = await applySchedule(
      prisma as unknown as PrismaClient,
      sourceWithMorningStart(weekday, "08:00"),
      todayStr(),
    );

    expect(r.applied).toBe(true);
    expect(r.affected).toHaveLength(0);
    const appt = await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    expect(appt.status).toBe("CONFIRMED");
  });

  it("官網公告整日休診，該日既有預約同樣先擋下", async () => {
    const { general, drTsai } = await seedBase();
    const { appointment, weekday, date } = await bookMorningEight(general.id, drTsai.id);

    const source = sourceWithMorningStart(weekday, "08:00");
    source.exceptions[date] = []; // 空陣列＝整日休診

    const blocked = await applySchedule(
      prisma as unknown as PrismaClient, source, todayStr(),
    );
    expect(blocked.applied).toBe(false);
    expect(blocked.affected).toHaveLength(1);
    expect(blocked.exceptionsApplied).toBe(0);

    const applied = await applySchedule(
      prisma as unknown as PrismaClient, source, todayStr(), { cancelAffected: true },
    );
    expect(applied.applied).toBe(true);
    expect(applied.exceptionsApplied).toBe(1);
    const appt = await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    expect(appt.status).toBe("CANCELLED_BY_CLINIC");
  });
});
