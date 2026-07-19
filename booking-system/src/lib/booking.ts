/**
 * 預約引擎：建立／取消／改期／狀態變更。
 * 所有寫入皆在單一資料庫交易內完成：
 *   1. SELECT ... FOR UPDATE 鎖定病人列（序列化同一病人的規則檢查）
 *   2. INSERT ON CONFLICT + SELECT ... FOR UPDATE 鎖定時段列（序列化名額配發）
 *   3. partial unique index 為第二道防線（見 migrations）
 */
import { randomUUID } from "node:crypto";
import { Prisma, type Appointment, type AppointmentSource, type Patient } from "@prisma/client";
import { prisma, type Tx } from "./db";
import { addDays, dateToDb, dbToDate, minutesFromNow, todayStr } from "./tw-time";
import { getSetting } from "./settings";
import { BookingError, MSG } from "./errors";
import { doctorBlockAt, getDayScheduleBlocks, getSuspendedClinicTypes } from "./schedule";
import { upsertPatientForBooking, lockPatientRow } from "./patients";
import { isPatientRestricted, maybeAutoRestrict } from "./restrictions";
import { writeAudit, type AuditActor } from "./audit";
import { enqueueAppointmentNotification } from "./notifications";
import type { PatientInput } from "./validation";

/** 占用時段名額的狀態（COMPLETED/NO_SHOW 為歷史占用，過去時段不會再被預約） */
export const OCCUPYING_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "CHECKED_IN",
  "COMPLETED",
  "NO_SHOW",
] as const;

/** 「有效預約」：計入同日唯一限制（與 partial unique index 一致） */
export const ACTIVE_STATUSES = ["PENDING", "CONFIRMED", "CHECKED_IN"] as const;

/** 計入 7 天上限的狀態（僅排除病人取消/診所取消/已改期/未到） */
export const WEEKLY_COUNT_STATUSES = ["PENDING", "CONFIRMED", "CHECKED_IN", "COMPLETED"] as const;

export interface CreateAppointmentParams {
  clinicTypeId: string;
  /** 指定醫師 id，或 "any" 由系統自動分配 */
  doctorId: string;
  date: string; // YYYY-MM-DD（台灣時間）
  startTime: string; // HH:mm
  patientInput?: PatientInput; // 前台：病人資料
  patientId?: string; // 後台代約：既有病人
  source: AppointmentSource;
  requestId?: string; // 防重複送出
  actor: AuditActor;
  /** 櫃檯覆寫限制（同日/7天/黑名單），必填理由 */
  staffOverride?: { reason: string };
  /** 改期內部使用：排除原預約的同日/7天計算 */
  excludeAppointmentId?: string;
  /** 後台是否略過「線上開放」與滾動開放天數限制 */
  isStaff?: boolean;
  staffNote?: string;
}

export interface CreateAppointmentResult {
  appointment: Appointment;
  patient: Patient;
  duplicated: boolean; // requestId 重複送出時回傳既有預約
}

function genBookingNumber(date: string): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // 排除易混淆字元
  let suffix = "";
  for (let i = 0; i < 4; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
  return `LH${date.slice(2).replaceAll("-", "")}-${suffix}`;
}

/** 建立預約（含所有規則檢查）。 */
export async function createAppointment(
  params: CreateAppointmentParams,
): Promise<CreateAppointmentResult> {
  // requestId 冪等：已存在直接回傳，避免重複送出
  if (params.requestId) {
    const existing = await prisma.appointment.findUnique({
      where: { requestId: params.requestId },
      include: { patient: true },
    });
    if (existing) {
      return { appointment: existing, patient: existing.patient, duplicated: true };
    }
  }

  try {
    return await runCreateTransaction(params);
  } catch (e) {
    // 冪等第二道防線：並發重複送出撞 requestId unique
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002" &&
      params.requestId
    ) {
      const existing = await prisma.appointment.findUnique({
        where: { requestId: params.requestId },
        include: { patient: true },
      });
      if (existing) return { appointment: existing, patient: existing.patient, duplicated: true };
    }
    throw e;
  }
}

async function runCreateTransaction(
  params: CreateAppointmentParams,
): Promise<CreateAppointmentResult> {
  return prisma.$transaction(
    async (tx) => {
      const clinicType = await tx.clinicType.findUnique({
        where: { id: params.clinicTypeId },
        include: { doctors: true },
      });
      if (!clinicType) throw new BookingError("CLINIC_TYPE_CLOSED", MSG.clinicTypeClosed);
      if (!clinicType.isActive && !params.isStaff)
        throw new BookingError("CLINIC_TYPE_CLOSED", MSG.clinicTypeClosed);

      // 門診類型當日暫停
      const suspended = await getSuspendedClinicTypes(params.date, tx);
      if (suspended.has(clinicType.id) && !params.isStaff)
        throw new BookingError("CLINIC_TYPE_CLOSED", MSG.clinicTypeClosed);

      // 門診類型可預約星期／診別
      if (!params.isStaff) {
        const weekday = dateToDb(params.date).getUTCDay();
        if (clinicType.allowedWeekdays.length > 0 && !clinicType.allowedWeekdays.includes(weekday))
          throw new BookingError("SLOT_UNAVAILABLE", MSG.slotUnavailable);
      }

      // 開放日期範圍（櫃檯不受限）
      if (!params.isStaff) await assertDateOpen(tx, params.date, params.startTime);

      // 病人
      let patient: Patient;
      if (params.patientId) {
        const found = await tx.patient.findUnique({ where: { id: params.patientId } });
        if (!found) throw new BookingError("NOT_FOUND", MSG.notFound);
        patient = found;
      } else if (params.patientInput) {
        patient = await upsertPatientForBooking(tx, params.patientInput);
      } else {
        throw new BookingError("VALIDATION", "缺少病人資料");
      }
      await lockPatientRow(tx, patient.id);

      // 年齡限制
      assertAgeEligible(clinicType, patient, params.date);

      // 黑名單
      if (!params.staffOverride && (await isPatientRestricted(tx, patient.id)))
        throw new BookingError("RESTRICTED", MSG.restricted);

      // 同日唯一
      if (!params.staffOverride)
        await assertNoSameDay(tx, patient.id, params.date, params.excludeAppointmentId);

      // 7 天上限
      if (!params.staffOverride)
        await assertWeeklyLimit(tx, patient.id, params.date, params.excludeAppointmentId);

      // 醫師與名額（含「不限醫師」自動分配）
      const { doctorId, slotId, endTime, capacitySlotNo } = await allocateSlot(tx, {
        date: params.date,
        startTime: params.startTime,
        doctorId: params.doctorId,
        clinicTypeDoctorIds: clinicType.doctors.map((d) => d.doctorId),
        allowedSessions: clinicType.allowedSessions,
        isStaff: !!params.isStaff,
      });

      // 建立預約
      const status = clinicType.requiresReview && params.source !== "STAFF" ? "PENDING" : "CONFIRMED";
      let bookingNumber = genBookingNumber(params.date);
      for (let i = 0; i < 3; i++) {
        const clash = await tx.appointment.findUnique({ where: { bookingNumber } });
        if (!clash) break;
        bookingNumber = genBookingNumber(params.date);
      }

      const appointment = await tx.appointment.create({
        data: {
          bookingNumber,
          patientId: patient.id,
          doctorId,
          clinicTypeId: clinicType.id,
          slotId,
          appointmentDate: dateToDb(params.date),
          startTime: params.startTime,
          endTime,
          capacitySlotNo,
          status,
          source: params.source,
          visitType: params.patientInput?.visitType,
          patientNote: params.patientInput?.note,
          staffNote: params.staffNote,
          overrideReason: params.staffOverride?.reason,
          requestId: params.requestId,
          rescheduledFromId: params.excludeAppointmentId,
          createdBy: params.actor.type === "STAFF" ? params.actor.id : "patient",
        },
      });

      await tx.appointmentStatusHistory.create({
        data: {
          appointmentId: appointment.id,
          fromStatus: null,
          toStatus: status,
          changedByType: params.actor.type,
          changedById: params.actor.id,
          reason: params.staffOverride?.reason,
        },
      });

      await writeAudit(
        params.actor,
        "appointment.create",
        { type: "appointment", id: appointment.id },
        {
          bookingNumber,
          patientId: patient.id,
          doctorId,
          date: params.date,
          startTime: params.startTime,
          source: params.source,
          override: params.staffOverride?.reason,
        },
        tx,
      );

      await enqueueAppointmentNotification(tx, "BOOKED", appointment, patient);

      return { appointment, patient, duplicated: false };
    },
    { timeout: 15000 },
  );
}

/** 開放日期檢查：滾動開放 N 天＋當日截止 */
async function assertDateOpen(tx: Tx, date: string, startTime: string) {
  const openDays = await getSetting("booking.open_days", tx);
  const allowSameDay = await getSetting("booking.allow_same_day", tx);
  const cutoffMin = await getSetting("booking.same_day_cutoff_minutes", tx);
  const today = todayStr();
  const lastOpen = addDays(today, openDays - 1);
  if (date < today || date > lastOpen) throw new BookingError("DATE_NOT_OPEN", MSG.dateNotOpen);
  if (date === today) {
    if (!allowSameDay) throw new BookingError("DATE_NOT_OPEN", MSG.dateNotOpen);
    if (minutesFromNow(date, startTime) < cutoffMin)
      throw new BookingError("SLOT_UNAVAILABLE", MSG.slotUnavailable);
  }
}

function assertAgeEligible(
  clinicType: { minAgeMonths: number | null; maxAgeMonths: number | null; name: string },
  patient: Patient,
  date: string,
) {
  if (clinicType.minAgeMonths == null && clinicType.maxAgeMonths == null) return;
  const birth = patient.birthDate;
  const target = dateToDb(date);
  const months =
    (target.getUTCFullYear() - birth.getUTCFullYear()) * 12 +
    (target.getUTCMonth() - birth.getUTCMonth()) -
    (target.getUTCDate() < birth.getUTCDate() ? 1 : 0);
  if (
    (clinicType.minAgeMonths != null && months < clinicType.minAgeMonths) ||
    (clinicType.maxAgeMonths != null && months > clinicType.maxAgeMonths)
  ) {
    throw new BookingError(
      "AGE_NOT_ELIGIBLE",
      `「${clinicType.name}」有年齡限制，此病人年齡不符。如有疑問請致電立欣診所。`,
    );
  }
}

/** 同日唯一檢查（病人列已鎖定） */
async function assertNoSameDay(tx: Tx, patientId: string, date: string, excludeId?: string) {
  const count = await tx.appointment.count({
    where: {
      patientId,
      appointmentDate: dateToDb(date),
      status: { in: [...ACTIVE_STATUSES] },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
  if (count > 0) throw new BookingError("DUPLICATE_SAME_DAY", MSG.duplicateSameDay);
}

/** 任意連續 N 天內最多 M 筆（病人列已鎖定） */
async function assertWeeklyLimit(tx: Tx, patientId: string, date: string, excludeId?: string) {
  const windowDays = await getSetting("booking.window_days", tx);
  const max = await getSetting("booking.window_max", tx);
  const rangeStart = addDays(date, -(windowDays - 1));
  const rangeEnd = addDays(date, windowDays - 1);
  const appts = await tx.appointment.findMany({
    where: {
      patientId,
      status: { in: [...WEEKLY_COUNT_STATUSES] },
      appointmentDate: { gte: dateToDb(rangeStart), lte: dateToDb(rangeEnd) },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { appointmentDate: true },
  });
  const dates = [...appts.map((a) => dbToDate(a.appointmentDate)), date];
  for (let offset = -(windowDays - 1); offset <= 0; offset++) {
    const winStart = addDays(date, offset);
    const winEnd = addDays(winStart, windowDays - 1);
    const count = dates.filter((d) => d >= winStart && d <= winEnd).length;
    if (count > max) throw new BookingError("WEEKLY_LIMIT", MSG.weeklyLimit(windowDays, max));
  }
}

interface AllocateParams {
  date: string;
  startTime: string;
  doctorId: string; // 或 "any"
  clinicTypeDoctorIds: string[];
  allowedSessions: import("@prisma/client").SessionPeriod[];
  isStaff: boolean;
}

/**
 * 名額配發：鎖定時段列 → 找出可用序號。
 * 「不限醫師」時優先分配當日預約數較少的醫師以平衡人數。
 */
async function allocateSlot(tx: Tx, p: AllocateParams) {
  const blocks = await getDayScheduleBlocks(p.date, tx);
  const candidateBlocks = blocks.filter(
    (b) =>
      b.startTime <= p.startTime &&
      p.startTime < b.endTime &&
      (p.isStaff || b.allowOnline) &&
      (p.allowedSessions.length === 0 || p.allowedSessions.includes(b.session)) &&
      (p.clinicTypeDoctorIds.length === 0 || p.clinicTypeDoctorIds.includes(b.doctorId)) &&
      (p.doctorId === "any" || b.doctorId === p.doctorId),
  );
  if (candidateBlocks.length === 0)
    throw new BookingError("SLOT_UNAVAILABLE", MSG.slotUnavailable);

  // 平衡分配：當日各候選醫師的有效預約數（少者優先）
  let ordered = candidateBlocks;
  if (p.doctorId === "any" && candidateBlocks.length > 1) {
    const counts = await tx.appointment.groupBy({
      by: ["doctorId"],
      where: {
        appointmentDate: dateToDb(p.date),
        doctorId: { in: candidateBlocks.map((b) => b.doctorId) },
        status: { in: [...OCCUPYING_STATUSES] },
      },
      _count: { id: true },
    });
    const countMap = new Map(counts.map((c) => [c.doctorId, c._count.id]));
    const doctors = await tx.doctor.findMany({
      where: { id: { in: candidateBlocks.map((b) => b.doctorId) } },
    });
    const orderMap = new Map(doctors.map((d) => [d.id, d.displayOrder]));
    ordered = [...candidateBlocks].sort(
      (a, b) =>
        (countMap.get(a.doctorId) ?? 0) - (countMap.get(b.doctorId) ?? 0) ||
        (orderMap.get(a.doctorId) ?? 0) - (orderMap.get(b.doctorId) ?? 0),
    );
  }

  for (const block of ordered) {
    // 建立（若不存在）並鎖定時段列
    await tx.$executeRaw`
      INSERT INTO appointment_slots
        (id, doctor_id, date, start_time, end_time, capacity, is_blocked, source, created_at, updated_at)
      VALUES
        (${randomUUID()}, ${block.doctorId}, ${dateToDb(p.date)}, ${p.startTime},
         ${endOf(p.startTime, block.endTime)}, ${block.slotCapacity}, false, 'AUTO'::"SlotSource", now(), now())
      ON CONFLICT (doctor_id, date, start_time) DO NOTHING`;
    const slotRows = await tx.$queryRaw<
      { id: string; capacity: number; is_blocked: boolean; end_time: string }[]
    >`
      SELECT id, capacity, is_blocked, end_time FROM appointment_slots
      WHERE doctor_id = ${block.doctorId} AND date = ${dateToDb(p.date)} AND start_time = ${p.startTime}
      FOR UPDATE`;
    const slot = slotRows[0];
    if (!slot || slot.is_blocked) continue;

    const used = await tx.appointment.findMany({
      where: {
        doctorId: block.doctorId,
        appointmentDate: dateToDb(p.date),
        startTime: p.startTime,
        status: { in: [...OCCUPYING_STATUSES] },
      },
      select: { capacitySlotNo: true },
    });
    const usedSeqs = new Set(used.map((u) => u.capacitySlotNo));
    let seq: number | null = null;
    for (let i = 1; i <= slot.capacity; i++) {
      if (!usedSeqs.has(i)) {
        seq = i;
        break;
      }
    }
    if (seq == null) continue; // 額滿，換下一位候選醫師

    return {
      doctorId: block.doctorId,
      slotId: slot.id,
      endTime: slot.end_time,
      capacitySlotNo: seq,
    };
  }

  throw new BookingError("SLOT_FULL", MSG.slotFull);
}

function endOf(startTime: string, blockEnd: string): string {
  const [h, m] = startTime.split(":").map(Number);
  const total = h * 60 + m + 30;
  const end = `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  return end < blockEnd ? end : blockEnd;
}

// ── 取消 ────────────────────────────────────────────────

export async function cancelAppointment(opts: {
  appointmentId: string;
  actor: AuditActor;
  byPatient: boolean;
  reason?: string;
}): Promise<Appointment> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM appointments WHERE id = ${opts.appointmentId} FOR UPDATE`;
    const appt = await tx.appointment.findUnique({
      where: { id: opts.appointmentId },
      include: { patient: true },
    });
    if (!appt) throw new BookingError("NOT_FOUND", MSG.notFound);
    if (!(ACTIVE_STATUSES as readonly string[]).includes(appt.status))
      throw new BookingError("INVALID_STATUS", "此預約目前狀態無法取消。");
    if (opts.byPatient && appt.status === "CHECKED_IN")
      throw new BookingError("INVALID_STATUS", "已報到的預約無法線上取消，請洽櫃檯。");

    if (opts.byPatient) {
      const cutoff = await getSetting("booking.cancel_cutoff_minutes", tx);
      if (minutesFromNow(dbToDate(appt.appointmentDate), appt.startTime) < cutoff)
        throw new BookingError("CUTOFF_PASSED", MSG.cutoffPassed);
    }

    const toStatus = opts.byPatient ? "CANCELLED_BY_PATIENT" : "CANCELLED_BY_CLINIC";
    const updated = await tx.appointment.update({
      where: { id: appt.id },
      data: {
        status: toStatus,
        cancelledAt: new Date(),
        cancellationReason: opts.reason,
        updatedBy: opts.actor.type === "STAFF" ? opts.actor.id : "patient",
      },
    });
    if (opts.byPatient) {
      await tx.patient.update({
        where: { id: appt.patientId },
        data: { cancelCount: { increment: 1 } },
      });
    }
    await tx.appointmentStatusHistory.create({
      data: {
        appointmentId: appt.id,
        fromStatus: appt.status,
        toStatus,
        changedByType: opts.actor.type,
        changedById: opts.actor.id,
        reason: opts.reason,
      },
    });
    await writeAudit(
      opts.actor,
      opts.byPatient ? "appointment.cancel_by_patient" : "appointment.cancel_by_clinic",
      { type: "appointment", id: appt.id },
      { bookingNumber: appt.bookingNumber, reason: opts.reason },
      tx,
    );
    await enqueueAppointmentNotification(tx, "CANCELLED", updated, appt.patient);
    return updated;
  });
}

// ── 改期 ────────────────────────────────────────────────

export async function rescheduleAppointment(opts: {
  appointmentId: string;
  newDoctorId: string; // 或 "any"
  newDate: string;
  newStartTime: string;
  actor: AuditActor;
  byPatient: boolean;
  reason?: string;
  staffOverride?: { reason: string };
}): Promise<{ oldAppointment: Appointment; newAppointment: Appointment }> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM appointments WHERE id = ${opts.appointmentId} FOR UPDATE`;
      const appt = await tx.appointment.findUnique({
        where: { id: opts.appointmentId },
        include: { patient: true, clinicType: { include: { doctors: true } } },
      });
      if (!appt) throw new BookingError("NOT_FOUND", MSG.notFound);
      if (!(["PENDING", "CONFIRMED"] as string[]).includes(appt.status))
        throw new BookingError("INVALID_STATUS", "此預約目前狀態無法改期。");

      if (opts.byPatient) {
        const cutoff = await getSetting("booking.cancel_cutoff_minutes", tx);
        if (minutesFromNow(dbToDate(appt.appointmentDate), appt.startTime) < cutoff)
          throw new BookingError("CUTOFF_PASSED", MSG.cutoffPassed);
        await assertDateOpen(tx, opts.newDate, opts.newStartTime);
      }

      await lockPatientRow(tx, appt.patientId);

      // 受限病人不可線上改期（櫃檯可覆寫）
      if (!opts.staffOverride && (await isPatientRestricted(tx, appt.patientId)))
        throw new BookingError("RESTRICTED", MSG.restricted);

      if (!opts.staffOverride) {
        await assertNoSameDay(tx, appt.patientId, opts.newDate, appt.id);
        await assertWeeklyLimit(tx, appt.patientId, opts.newDate, appt.id);
      }

      const { doctorId, slotId, endTime, capacitySlotNo } = await allocateSlot(tx, {
        date: opts.newDate,
        startTime: opts.newStartTime,
        doctorId: opts.newDoctorId,
        clinicTypeDoctorIds: appt.clinicType.doctors.map((d) => d.doctorId),
        allowedSessions: appt.clinicType.allowedSessions,
        isStaff: !opts.byPatient,
      });

      let bookingNumber = genBookingNumber(opts.newDate);
      for (let i = 0; i < 3; i++) {
        const clash = await tx.appointment.findUnique({ where: { bookingNumber } });
        if (!clash) break;
        bookingNumber = genBookingNumber(opts.newDate);
      }

      const newAppointment = await tx.appointment.create({
        data: {
          bookingNumber,
          patientId: appt.patientId,
          doctorId,
          clinicTypeId: appt.clinicTypeId,
          slotId,
          appointmentDate: dateToDb(opts.newDate),
          startTime: opts.newStartTime,
          endTime,
          capacitySlotNo,
          status: appt.status, // 保留原審核狀態
          source: appt.source,
          visitType: appt.visitType,
          patientNote: appt.patientNote,
          staffNote: appt.staffNote,
          overrideReason: opts.staffOverride?.reason,
          rescheduledFromId: appt.id,
          createdBy: opts.actor.type === "STAFF" ? opts.actor.id : "patient",
        },
      });

      const oldAppointment = await tx.appointment.update({
        where: { id: appt.id },
        data: {
          status: "RESCHEDULED",
          rescheduledToId: newAppointment.id,
          updatedBy: opts.actor.type === "STAFF" ? opts.actor.id : "patient",
        },
      });

      await tx.appointmentStatusHistory.createMany({
        data: [
          {
            appointmentId: appt.id,
            fromStatus: appt.status,
            toStatus: "RESCHEDULED",
            changedByType: opts.actor.type,
            changedById: opts.actor.id,
            reason: opts.reason,
          },
          {
            appointmentId: newAppointment.id,
            fromStatus: null,
            toStatus: newAppointment.status,
            changedByType: opts.actor.type,
            changedById: opts.actor.id,
            reason: `改期自 ${appt.bookingNumber}`,
          },
        ],
      });

      await writeAudit(
        opts.actor,
        "appointment.reschedule",
        { type: "appointment", id: appt.id },
        {
          from: { date: dbToDate(appt.appointmentDate), time: appt.startTime },
          to: { date: opts.newDate, time: opts.newStartTime, bookingNumber },
          reason: opts.reason,
          override: opts.staffOverride?.reason,
        },
        tx,
      );

      await enqueueAppointmentNotification(tx, "MODIFIED", newAppointment, appt.patient);
      return { oldAppointment, newAppointment };
    },
    { timeout: 15000 },
  );
}

// ── 櫃檯狀態變更（報到／完成／未到／恢復） ─────────────────

export async function updateAppointmentStatus(opts: {
  appointmentId: string;
  toStatus: "CONFIRMED" | "CHECKED_IN" | "COMPLETED" | "NO_SHOW";
  actor: AuditActor;
  note?: string;
}): Promise<Appointment> {
  const allowed: Record<string, string[]> = {
    CONFIRMED: ["PENDING"],
    CHECKED_IN: ["PENDING", "CONFIRMED"],
    COMPLETED: ["CHECKED_IN", "CONFIRMED", "PENDING"],
    NO_SHOW: ["PENDING", "CONFIRMED"],
  };
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM appointments WHERE id = ${opts.appointmentId} FOR UPDATE`;
    const appt = await tx.appointment.findUnique({ where: { id: opts.appointmentId } });
    if (!appt) throw new BookingError("NOT_FOUND", MSG.notFound);
    if (!allowed[opts.toStatus].includes(appt.status))
      throw new BookingError(
        "INVALID_STATUS",
        `狀態「${appt.status}」無法變更為「${opts.toStatus}」。`,
      );

    const updated = await tx.appointment.update({
      where: { id: appt.id },
      data: { status: opts.toStatus, updatedBy: opts.actor.id },
    });

    if (opts.toStatus === "NO_SHOW") {
      await tx.noShowRecord.create({
        data: {
          patientId: appt.patientId,
          appointmentId: appt.id,
          markedBy: opts.actor.id ?? "unknown",
          note: opts.note,
        },
      });
      const patient = await tx.patient.update({
        where: { id: appt.patientId },
        data: { noShowCount: { increment: 1 } },
      });
      await maybeAutoRestrict(tx, appt.patientId, patient.noShowCount);
    }

    await tx.appointmentStatusHistory.create({
      data: {
        appointmentId: appt.id,
        fromStatus: appt.status,
        toStatus: opts.toStatus,
        changedByType: opts.actor.type,
        changedById: opts.actor.id,
        reason: opts.note,
      },
    });
    await writeAudit(
      opts.actor,
      `appointment.${opts.toStatus.toLowerCase()}`,
      { type: "appointment", id: appt.id },
      { bookingNumber: appt.bookingNumber, note: opts.note },
      tx,
    );
    return updated;
  });
}

/** 撤銷未到標記（誤標時使用；恢復為已確認並回沖計數） */
export async function revokeNoShow(opts: {
  appointmentId: string;
  actor: AuditActor;
  reason: string;
}): Promise<Appointment> {
  return prisma.$transaction(async (tx) => {
    const appt = await tx.appointment.findUnique({ where: { id: opts.appointmentId } });
    if (!appt || appt.status !== "NO_SHOW")
      throw new BookingError("INVALID_STATUS", "此預約不是未到狀態。");
    const record = await tx.noShowRecord.findUnique({ where: { appointmentId: appt.id } });
    if (record && !record.revokedAt) {
      await tx.noShowRecord.update({
        where: { id: record.id },
        data: { revokedAt: new Date(), revokedBy: opts.actor.id, revokeReason: opts.reason },
      });
      await tx.patient.update({
        where: { id: appt.patientId },
        data: { noShowCount: { decrement: 1 } },
      });
    }
    const updated = await tx.appointment.update({
      where: { id: appt.id },
      data: { status: "COMPLETED", updatedBy: opts.actor.id },
    });
    await tx.appointmentStatusHistory.create({
      data: {
        appointmentId: appt.id,
        fromStatus: "NO_SHOW",
        toStatus: "COMPLETED",
        changedByType: opts.actor.type,
        changedById: opts.actor.id,
        reason: opts.reason,
      },
    });
    await writeAudit(
      opts.actor,
      "appointment.no_show_revoke",
      { type: "appointment", id: appt.id },
      { reason: opts.reason },
      tx,
    );
    return updated;
  });
}
