/**
 * 排班管理（後台）：日期例外、封鎖時段、手動加開名額。
 * 鐵律：修改的時段已有預約時，不可直接刪除預約——先回傳受影響名單，
 * 由管理員逐筆選擇改期／換醫師／診所取消（或批次診所取消＋通知）後才生效。
 */
import { randomUUID } from "node:crypto";
import type { Appointment, Patient, ScheduleException } from "@prisma/client";
import { prisma } from "./db";
import { addDays, dateToDb, dbToDate, slotEnd } from "./tw-time";
import { applyExceptions, getDayScheduleBlocks } from "./schedule";
import { writeAudit, type AuditActor } from "./audit";
import { cancelAppointment } from "./booking";
import { BookingError } from "./errors";

export interface ExceptionInput {
  date: string;
  type: ScheduleException["type"];
  session?: ScheduleException["session"];
  doctorId?: string;
  substituteDoctorId?: string;
  startTime?: string;
  endTime?: string;
  slotCapacity?: number;
  clinicTypeId?: string;
  reason: string;
}

/** 模擬套用例外後，哪些有效預約會失去時段（受影響名單） */
export async function findAffectedAppointments(
  input: ExceptionInput,
): Promise<(Appointment & { patient: Patient })[]> {
  const appts = await prisma.appointment.findMany({
    where: {
      appointmentDate: dateToDb(input.date),
      status: { in: ["PENDING", "CONFIRMED"] },
      ...(input.clinicTypeId ? { clinicTypeId: input.clinicTypeId } : {}),
    },
    include: { patient: true },
  });
  if (appts.length === 0) return [];
  if (input.type === "CLINIC_TYPE_SUSPENDED") return appts;

  // 現況與套用例外後的班表比對（與 getDayScheduleBlocks 共用同一套例外邏輯，避免模擬結果漂移）
  const current = await getDayScheduleBlocks(input.date);
  const simulated = applyExceptions(current, [input]);
  return appts.filter((a) => {
    const stillCovered = simulated.some(
      (b) => b.doctorId === a.doctorId && b.startTime <= a.startTime && a.startTime < b.endTime,
    );
    if (!stillCovered) return true;
    if (
      input.type === "SLOT_BLOCKED" &&
      a.startTime === input.startTime &&
      (!input.doctorId || a.doctorId === input.doctorId)
    )
      return true;
    return false;
  });
}

export interface CreateExceptionResult {
  created?: ScheduleException;
  /** 未處理的受影響預約；有值時未建立例外 */
  affected?: (Appointment & { patient: Patient })[];
}

/**
 * 建立日期例外。
 * 尚有受影響的有效預約時不建立（回傳名單）；
 * cancelAffected=true 時以「診所取消」批次處理並排入通知後建立。
 */
export async function createScheduleException(
  input: ExceptionInput,
  actor: AuditActor,
  opts: { cancelAffected?: boolean; cancelReason?: string } = {},
): Promise<CreateExceptionResult> {
  const affected = await findAffectedAppointments(input);
  if (affected.length > 0) {
    if (!opts.cancelAffected) return { affected };
    for (const appt of affected) {
      await cancelAppointment({
        appointmentId: appt.id,
        actor,
        byPatient: false,
        reason: opts.cancelReason ?? input.reason,
      });
    }
  }

  const created = await prisma.scheduleException.create({
    data: {
      date: dateToDb(input.date),
      type: input.type,
      session: input.session,
      doctorId: input.doctorId,
      substituteDoctorId: input.substituteDoctorId,
      startTime: input.startTime,
      endTime: input.endTime,
      slotCapacity: input.slotCapacity,
      clinicTypeId: input.clinicTypeId,
      reason: input.reason,
      createdBy: actor.id ?? "unknown",
    },
  });
  await writeAudit(
    actor,
    "schedule.exception.create",
    { type: "schedule_exception", id: created.id },
    {
      date: input.date,
      type: input.type,
      reason: input.reason,
      cancelledAffected: opts.cancelAffected ? affected.length : 0,
    },
  );
  return { created };
}

export async function deleteScheduleException(id: string, actor: AuditActor) {
  const row = await prisma.scheduleException.delete({ where: { id } });
  await writeAudit(
    actor,
    "schedule.exception.delete",
    { type: "schedule_exception", id },
    { date: dbToDate(row.date), type: row.type },
  );
}

/** 封鎖／解封單一時段（不影響既有預約，僅阻擋新預約；有預約時先要求處理） */
export async function setSlotBlocked(
  opts: {
    doctorId: string;
    date: string;
    startTime: string;
    blocked: boolean;
    reason: string;
  },
  actor: AuditActor,
) {
  if (opts.blocked) {
    const affected = await findAffectedAppointments({
      date: opts.date,
      type: "SLOT_BLOCKED",
      doctorId: opts.doctorId,
      startTime: opts.startTime,
      reason: opts.reason,
    });
    if (affected.length > 0) return { affected };
  }
  const endTime = slotEnd(opts.startTime);
  await prisma.$executeRaw`
    INSERT INTO appointment_slots
      (id, doctor_id, date, start_time, end_time, capacity, is_blocked, source, reason, created_by, created_at, updated_at)
    VALUES
      (${randomUUID()}, ${opts.doctorId}, ${dateToDb(opts.date)}, ${opts.startTime}, ${endTime},
       1, ${opts.blocked}, 'MANUAL'::"SlotSource", ${opts.reason}, ${actor.id ?? null}, now(), now())
    ON CONFLICT (doctor_id, date, start_time)
    DO UPDATE SET is_blocked = ${opts.blocked}, reason = ${opts.reason}, updated_at = now()`;
  await writeAudit(actor, opts.blocked ? "slot.block" : "slot.unblock", undefined, {
    doctorId: opts.doctorId,
    date: opts.date,
    startTime: opts.startTime,
    reason: opts.reason,
  });
  return {};
}

/** 手動調整單一時段名額（加開特殊名額；必留操作者/時間/原因） */
export async function setSlotCapacity(
  opts: { doctorId: string; date: string; startTime: string; capacity: number; reason: string },
  actor: AuditActor,
) {
  if (opts.capacity < 1 || opts.capacity > 10)
    throw new BookingError("VALIDATION", "名額需在 1–10 之間");
  const endTime = slotEnd(opts.startTime);
  await prisma.$executeRaw`
    INSERT INTO appointment_slots
      (id, doctor_id, date, start_time, end_time, capacity, is_blocked, source, reason, created_by, created_at, updated_at)
    VALUES
      (${randomUUID()}, ${opts.doctorId}, ${dateToDb(opts.date)}, ${opts.startTime}, ${endTime},
       ${opts.capacity}, false, 'MANUAL'::"SlotSource", ${opts.reason}, ${actor.id ?? null}, now(), now())
    ON CONFLICT (doctor_id, date, start_time)
    DO UPDATE SET capacity = ${opts.capacity}, reason = ${opts.reason}, updated_at = now()`;
  await writeAudit(actor, "slot.set_capacity", undefined, {
    doctorId: opts.doctorId,
    date: opts.date,
    startTime: opts.startTime,
    capacity: opts.capacity,
    reason: opts.reason,
  });
}

/** 複製上週固定班表到指定週（週班表為每週重複，此功能用於「以某週例外為範本」時的批次建立；固定班表本身毋需複製） */
export async function copyWeekExceptions(fromWeekStart: string, toWeekStart: string, actor: AuditActor) {
  const from = dateToDb(fromWeekStart);
  const rows = await prisma.scheduleException.findMany({
    where: { date: { gte: from, lte: dateToDb(addDays(fromWeekStart, 6)) } },
  });
  for (const r of rows) {
    const offset = Math.round((r.date.getTime() - from.getTime()) / 86400000);
    await prisma.scheduleException.create({
      data: {
        date: dateToDb(addDays(toWeekStart, offset)),
        type: r.type,
        session: r.session,
        doctorId: r.doctorId,
        substituteDoctorId: r.substituteDoctorId,
        startTime: r.startTime,
        endTime: r.endTime,
        slotCapacity: r.slotCapacity,
        clinicTypeId: r.clinicTypeId,
        reason: `（複製自 ${dbToDate(r.date)}）${r.reason}`,
        createdBy: actor.id ?? "unknown",
      },
    });
  }
  await writeAudit(actor, "schedule.copy_week", undefined, { fromWeekStart, toWeekStart, count: rows.length });
  return rows.length;
}


