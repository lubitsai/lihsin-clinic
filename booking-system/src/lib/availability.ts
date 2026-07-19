/**
 * 可預約性查詢（前台顯示用；實際成立與否仍以預約引擎交易內檢查為準）。
 */
import { prisma } from "./db";
import { addDays, dateToDb, minutesFromNow, nowTimeStr, todayStr, weekdayOf } from "./tw-time";
import { getSetting } from "./settings";
import {
  getDayScheduleBlocks,
  getBlockedSlotKeys,
  getSuspendedClinicTypes,
  isSlotKeyBlocked,
  sessionOfTime,
  type WorkingBlock,
} from "./schedule";
import { OCCUPYING_STATUSES } from "./booking";
import { slotTimes } from "./tw-time";
import type { SessionPeriod } from "@prisma/client";

export interface SlotAvailability {
  startTime: string;
  session: SessionPeriod;
  /** 每位醫師剩餘名額（0 = 額滿仍顯示但不可選） */
  doctors: { doctorId: string; doctorName: string; remaining: number }[];
}

export interface DayAvailability {
  date: string;
  open: boolean; // 是否在開放範圍且有任何時段
  hasFreeSlot: boolean;
}

/** 開放範圍內每天是否有空位（前台日曆用） */
export async function getOpenDates(clinicTypeId: string, doctorId?: string): Promise<DayAvailability[]> {
  const [openDays, openTime, allowSameDay] = await Promise.all([
    getSetting("booking.open_days"),
    getSetting("booking.open_time"),
    getSetting("booking.allow_same_day"),
  ]);
  const today = todayStr();
  // 各日期彼此獨立，平行查詢（14 天逐日序列查會拖慢每次開日曆）
  return Promise.all(
    Array.from({ length: openDays }, async (_, i): Promise<DayAvailability> => {
      const date = addDays(today, i);
      if (i === 0 && !allowSameDay) return { date, open: false, hasFreeSlot: false };
      // 最新一天於每日 open_time（預設 00:00）才開放
      if (i === openDays - 1 && nowTimeStr() < openTime)
        return { date, open: false, hasFreeSlot: false };
      const slots = await getDaySlotAvailability(date, clinicTypeId, doctorId);
      const hasFree = slots.some((s) => s.doctors.some((d) => d.remaining > 0));
      return { date, open: slots.length > 0, hasFreeSlot: hasFree };
    }),
  );
}

/** 某日某門診類型的時段與各醫師剩餘名額 */
export async function getDaySlotAvailability(
  date: string,
  clinicTypeId: string,
  doctorId?: string,
): Promise<SlotAvailability[]> {
  const clinicType = await prisma.clinicType.findUnique({
    where: { id: clinicTypeId },
    include: { doctors: true },
  });
  if (!clinicType || !clinicType.isActive) return [];

  const weekday = weekdayOf(date);
  if (clinicType.allowedWeekdays.length > 0 && !clinicType.allowedWeekdays.includes(weekday))
    return [];
  const [suspended, allBlocks, blocked] = await Promise.all([
    getSuspendedClinicTypes(date),
    getDayScheduleBlocks(date),
    getBlockedSlotKeys(date),
  ]);
  if (suspended.has(clinicType.id)) return [];

  const allowedDoctorIds = clinicType.doctors.map((d) => d.doctorId);
  const blocks = allBlocks.filter(
    (b) =>
      b.allowOnline &&
      (allowedDoctorIds.length === 0 || allowedDoctorIds.includes(b.doctorId)) &&
      (clinicType.allowedSessions.length === 0 || clinicType.allowedSessions.includes(b.session)) &&
      (!doctorId || doctorId === "any" || b.doctorId === doctorId),
  );
  // 注意：blocks 為空仍需繼續——手動加開（MANUAL）時段可能落在班表之外

  const [doctors, slotRows, counts, cutoffMin] = await Promise.all([
    prisma.doctor.findMany({ where: { isActive: true } }),
    prisma.appointmentSlot.findMany({ where: { date: dateToDb(date) } }),
    prisma.appointment.groupBy({
      by: ["doctorId", "startTime"],
      where: { appointmentDate: dateToDb(date), status: { in: [...OCCUPYING_STATUSES] } },
      _count: { id: true },
    }),
    getSetting("booking.same_day_cutoff_minutes"),
  ]);
  const doctorName = new Map(doctors.map((d) => [d.id, d.name]));
  const slotOverride = new Map(slotRows.map((s) => [`${s.doctorId}|${s.startTime}`, s]));
  const usedCount = new Map(counts.map((c) => [`${c.doctorId}|${c.startTime}`, c._count.id]));
  const isToday = date === todayStr();

  // (時間 → 各醫師) 彙整
  const byTime = new Map<string, SlotAvailability>();
  for (const b of blocks) {
    for (const t of slotTimes(b.startTime, b.endTime)) {
      if (blocked.has(`${b.doctorId}|${t}`) || blocked.has(`*|${t}`)) continue;
      if (isToday && minutesFromNow(date, t) < cutoffMin) continue;
      const key = `${b.doctorId}|${t}`;
      const override = slotOverride.get(key);
      if (override?.isBlocked) continue;
      const capacity = override?.capacity ?? b.slotCapacity;
      const remaining = Math.max(0, capacity - (usedCount.get(key) ?? 0));
      let entry = byTime.get(t);
      if (!entry) {
        entry = { startTime: t, session: b.session, doctors: [] };
        byTime.set(t, entry);
      }
      if (!entry.doctors.some((d) => d.doctorId === b.doctorId)) {
        entry.doctors.push({
          doctorId: b.doctorId,
          doctorName: doctorName.get(b.doctorId) ?? "",
          remaining,
        });
      }
    }
  }

  // 手動加開時段（MANUAL slot，可能不在班表內）；診別與封鎖規則同樣適用（與引擎一致）
  for (const s of slotRows) {
    if (s.source !== "MANUAL" || s.isBlocked) continue;
    if (doctorId && doctorId !== "any" && s.doctorId !== doctorId) continue;
    if (allowedDoctorIds.length > 0 && !allowedDoctorIds.includes(s.doctorId)) continue;
    if (
      clinicType.allowedSessions.length > 0 &&
      !clinicType.allowedSessions.includes(sessionOfTime(s.startTime))
    )
      continue;
    if (isSlotKeyBlocked(blocked, s.doctorId, s.startTime)) continue;
    if (isToday && minutesFromNow(date, s.startTime) < cutoffMin) continue;
    const key = `${s.doctorId}|${s.startTime}`;
    const remaining = Math.max(0, s.capacity - (usedCount.get(key) ?? 0));
    let entry = byTime.get(s.startTime);
    if (!entry) {
      entry = { startTime: s.startTime, session: sessionOfTime(s.startTime), doctors: [] };
      byTime.set(s.startTime, entry);
    }
    if (!entry.doctors.some((d) => d.doctorId === s.doctorId)) {
      entry.doctors.push({
        doctorId: s.doctorId,
        doctorName: doctorName.get(s.doctorId) ?? "",
        remaining,
      });
    }
  }

  return [...byTime.values()].sort((a, b) => a.startTime.localeCompare(b.startTime));
}

/** 後台：某日全部時段（含不開放線上者）與占用統計 */
export async function getStaffDayOverview(date: string) {
  const blocks = await getDayScheduleBlocks(date);
  const [doctors, counts] = await Promise.all([
    prisma.doctor.findMany({ where: { isActive: true }, orderBy: { displayOrder: "asc" } }),
    prisma.appointment.groupBy({
      by: ["doctorId"],
      where: { appointmentDate: dateToDb(date), status: { in: [...OCCUPYING_STATUSES] } },
      _count: { id: true },
    }),
  ]);
  const totalSlots = new Map<string, number>();
  for (const b of blocks) {
    const n = slotTimes(b.startTime, b.endTime).length * b.slotCapacity;
    totalSlots.set(b.doctorId, (totalSlots.get(b.doctorId) ?? 0) + n);
  }
  return doctors
    .filter((d) => blocks.some((b: WorkingBlock) => b.doctorId === d.id))
    .map((d) => ({
      doctor: d,
      booked: counts.find((c) => c.doctorId === d.id)?._count.id ?? 0,
      total: totalSlots.get(d.id) ?? 0,
    }));
}
