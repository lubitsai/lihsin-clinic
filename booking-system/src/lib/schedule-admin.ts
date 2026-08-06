/**
 * 排班管理（後台）：日期例外、封鎖時段、手動加開名額。
 * 鐵律：修改的時段已有預約時，不可直接刪除預約——先回傳受影響名單，
 * 由管理員逐筆選擇改期／換醫師／診所取消（或批次診所取消＋通知）後才生效。
 */
import { randomUUID } from "node:crypto";
import type { Appointment, Patient, ScheduleException, SessionPeriod } from "@prisma/client";
import { prisma } from "./db";
import { addDays, dateToDb, dbToDate, slotEnd, weekdayOf } from "./tw-time";
import {
  applyExceptions,
  blocksFromTemplates,
  getDayScheduleBlocks,
  isSlotCovered,
  type ScheduleExceptionLike,
  type WeeklyTemplateLike,
} from "./schedule";
import { writeAudit, type AuditActor } from "./audit";
import { cancelAppointmentTx } from "./booking";
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
    if (!isSlotCovered(simulated, a.doctorId, a.startTime)) return true;
    if (
      input.type === "SLOT_BLOCKED" &&
      a.startTime === input.startTime &&
      (!input.doctorId || a.doctorId === input.doctorId)
    )
      return true;
    return false;
  });
}

export type AffectedAppointment = Appointment & { patient: Patient };

/**
 * 改「常態班表」前的受影響預約模擬（院長 2026-08-06 裁示 (a)：比照單日例外）。
 *
 * 單日例外只影響一天，週班表與官網同步會一次影響未來所有日期，所以這裡掃的是
 * 今天（含）以後所有還有效的預約，逐日以「提案後的班表」重算，挑出失去時段的那些。
 *
 * `exceptionsFor` 讓呼叫端覆寫某日的例外：官網同步會整批重建自己建立的例外，
 * 檢查時必須用重建後的那一組，否則會拿舊例外去對新班表。未提供 ＝ 沿用資料庫現況。
 */
export async function findAppointmentsOutsideSchedule(opts: {
  fromDate: string;
  templates: WeeklyTemplateLike[];
  activeDoctorIds?: ReadonlySet<string>;
  exceptionsFor?: (date: string, dbExceptions: ScheduleException[]) => ScheduleExceptionLike[];
  client?: Pick<typeof prisma, "appointment" | "scheduleException">;
}): Promise<AffectedAppointment[]> {
  const db = opts.client ?? prisma;
  const appts = await db.appointment.findMany({
    where: {
      appointmentDate: { gte: dateToDb(opts.fromDate) },
      status: { in: ["PENDING", "CONFIRMED"] },
    },
    include: { patient: true },
    orderBy: [{ appointmentDate: "asc" }, { startTime: "asc" }],
  });
  if (appts.length === 0) return [];

  const dates = [...new Set(appts.map((a) => dbToDate(a.appointmentDate)))];
  const exceptionRows = await db.scheduleException.findMany({
    where: { date: { in: dates.map(dateToDb) } },
  });

  // 逐日算一次就好——同一天可能有很多筆預約
  const blocksByDate = new Map<string, ReturnType<typeof blocksFromTemplates>>();
  for (const date of dates) {
    const dbExceptions = exceptionRows.filter((e) => dbToDate(e.date) === date);
    const exceptions = opts.exceptionsFor?.(date, dbExceptions) ?? dbExceptions;
    blocksByDate.set(
      date,
      applyExceptions(
        blocksFromTemplates(opts.templates, weekdayOf(date), opts.activeDoctorIds),
        exceptions,
      ),
    );
  }

  return appts.filter((a) => {
    const blocks = blocksByDate.get(dbToDate(a.appointmentDate)) ?? [];
    return !isSlotCovered(blocks, a.doctorId, a.startTime);
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
  if (affected.length > 0 && !opts.cancelAffected) return { affected };

  // 取消受影響預約與建立例外放在同一交易：中途失敗會整批回滾，
  // 不會留下「病人已被取消、例外卻沒建立」的半套狀態。
  const created = await prisma.$transaction(
    async (tx) => {
      for (const appt of affected) {
        await cancelAppointmentTx(tx, {
          appointmentId: appt.id,
          actor,
          byPatient: false,
          reason: opts.cancelReason ?? input.reason,
        });
      }
      return tx.scheduleException.create({
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
    },
    { timeout: 30000 },
  );
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

export interface TemplateChange {
  /** 更新／刪除既有列時給 id；新增時留空 */
  id?: string;
  /** 刪除該列 */
  remove?: boolean;
  weekday: number;
  session: SessionPeriod;
  startTime: string;
  endTime: string;
  doctorId: string;
  slotCapacity: number;
  allowOnline: boolean;
  isActive: boolean;
}

export interface ApplyTemplateResult {
  ok?: true;
  /** 未處理的受影響預約；有值時班表完全沒動 */
  affected?: AffectedAppointment[];
}

/**
 * 改常態班表（新增／修改／刪除一列），比照單日例外先檢查受影響預約。
 * 尚有受影響預約且未確認時**完全不動班表**，只回傳名單；
 * cancelAffected=true 時，取消與班表變更同一交易，全成或全不動。
 */
export async function applyTemplateChange(
  change: TemplateChange,
  actor: AuditActor,
  opts: { cancelAffected?: boolean; cancelReason?: string; today: string } = { today: "" },
): Promise<ApplyTemplateResult> {
  const [rows, activeDoctors] = await Promise.all([
    prisma.weeklyScheduleTemplate.findMany(),
    prisma.doctor.findMany({ where: { isActive: true }, select: { id: true } }),
  ]);
  const activeDoctorIds = new Set(activeDoctors.map((d) => d.id));

  // 提案後的班表＝現況套上這次的異動（先算再寫，才能在不動資料的情況下檢查）
  const proposed: WeeklyTemplateLike[] = rows
    .filter((r) => !(change.id && r.id === change.id))
    // 沒帶 id 的新增走 upsert 語意：同週幾＋同診別＋同醫師視為同一列
    .filter(
      (r) =>
        !(
          !change.id &&
          r.weekday === change.weekday &&
          r.session === change.session &&
          r.doctorId === change.doctorId
        ),
    );
  if (!change.remove) proposed.push({ ...change });

  const affected = await findAppointmentsOutsideSchedule({
    fromDate: opts.today,
    templates: proposed,
    activeDoctorIds,
  });
  if (affected.length > 0 && !opts.cancelAffected) return { affected };

  await prisma.$transaction(
    async (tx) => {
      for (const appt of affected) {
        await cancelAppointmentTx(tx, {
          appointmentId: appt.id,
          actor,
          byPatient: false,
          reason: opts.cancelReason ?? "門診時間異動",
        });
      }
      const data = {
        weekday: change.weekday,
        session: change.session,
        startTime: change.startTime,
        endTime: change.endTime,
        doctorId: change.doctorId,
        slotCapacity: change.slotCapacity,
        allowOnline: change.allowOnline,
        isActive: change.isActive,
      };
      if (change.remove) {
        if (change.id) await tx.weeklyScheduleTemplate.delete({ where: { id: change.id } });
        return;
      }
      if (change.id) {
        await tx.weeklyScheduleTemplate.update({ where: { id: change.id }, data });
        return;
      }
      await tx.weeklyScheduleTemplate.upsert({
        where: {
          weekday_session_doctorId: {
            weekday: change.weekday,
            session: change.session,
            doctorId: change.doctorId,
          },
        },
        create: data,
        update: data,
      });
    },
    { timeout: 30000 },
  );

  await writeAudit(
    actor,
    change.remove ? "schedule.template.delete" : "schedule.template.upsert",
    { type: "weekly_schedule_template", id: change.id ?? "new" },
    { ...change, cancelledAffected: affected.length },
  );
  return { ok: true };
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


