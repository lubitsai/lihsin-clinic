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
import {
  addDays,
  dateToDb,
  dbToDate,
  minutesFromNow,
  nowTimeStr,
  slotEnd,
  slotTimes,
  todayStr,
} from "./tw-time";
import { getSetting } from "./settings";
import { BookingError, MSG } from "./errors";
import {
  getBlockedSlotKeys,
  getDayScheduleBlocks,
  getSuspendedClinicTypes,
  hasSessionStarted,
  isSlotKeyBlocked,
  isWithinClinicWindows,
  sessionOfSlot,
  sessionOfTime,
  sessionStartsOf,
  type ClinicWindow,
} from "./schedule";
import { getHolidayName } from "./holidays";
import { upsertPatientForBooking, lockPatientRow, resolveMergedPatient } from "./patients";
import { isPatientRestricted, maybeAutoRestrict, applyRestrictionExpiry } from "./restrictions";
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

/** 計入「同時未完成預約」上限的狀態（已完成/未到/取消/已改期都不算未完成） */
export const ACTIVE_LIMIT_STATUSES = ["PENDING", "CONFIRMED", "CHECKED_IN"] as const;

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
  /** 櫃檯覆寫限制（同日／同時筆數／黑名單），必填理由 */
  staffOverride?: { reason: string };
  /** 改期內部使用：排除原預約的同日／同時筆數計算 */
  excludeAppointmentId?: string;
  /** 後台是否略過「線上開放」與滾動開放天數限制 */
  isStaff?: boolean;
  staffNote?: string;
  /** 預約帳號識別（額度以此計算）：line:<id> 或 phone:<已驗證手機>；櫃檯代約留空 */
  accountKey?: string;
  /** 家庭代表預約：同診次一起看診的其他家人（不另占名額、不另計帳號額度） */
  companions?: PatientInput[];
}

export interface CreateAppointmentResult {
  appointment: Appointment;
  patient: Patient;
  duplicated: boolean; // requestId 重複送出時回傳既有預約
  companions?: Patient[];
  /**
   * 這次交易**新建立**的病歷 id（預約人與同行家人都算）。
   * 前台據此決定能不能自動綁定 LINE：新建的病歷沒有既有紀錄可外洩，
   * 既有病歷一律要櫃檯核對（院長 2026-08-15 裁示）。requestId 重送時為空陣列。
   */
  createdPatientIds: string[];
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
      return {
        appointment: existing,
        patient: existing.patient,
        duplicated: true,
        createdPatientIds: [],
      };
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
      if (existing)
        return {
          appointment: existing,
          patient: existing.patient,
          duplicated: true,
          createdPatientIds: [],
        };
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
        include: { doctors: true, windows: true },
      });
      if (!clinicType) throw new BookingError("CLINIC_TYPE_CLOSED", MSG.clinicTypeClosed);
      // 門診類型：停用／當日暫停／可預約星期（改期路徑共用同一檢查）
      await assertClinicTypeBookable(tx, clinicType, params.date, !!params.isStaff);

      // 開放日期範圍（櫃檯不受限）
      if (!params.isStaff) await assertDateOpen(tx, params.date, params.startTime);

      // 病人
      let patient: Patient;
      const createdPatientIds: string[] = [];
      if (params.patientId) {
        const found = await tx.patient.findUnique({ where: { id: params.patientId } });
        if (!found) throw new BookingError("NOT_FOUND", MSG.notFound);
        // 舊病歷若已被合併，預約要記到保留的那筆，限制才會算在同一個人身上
        patient = await resolveMergedPatient(tx, found);
      } else if (params.patientInput) {
        // 僅櫃檯代約可更新既有病歷的姓名／電話（人員已確認身分）；前台預約不覆寫
        const upserted = await upsertPatientForBooking(tx, params.patientInput, {
          trusted: !!params.isStaff,
        });
        patient = upserted.patient;
        if (upserted.created) createdPatientIds.push(patient.id);
      } else {
        throw new BookingError("VALIDATION", "缺少病人資料");
      }
      await lockPatientRow(tx, patient.id);

      // 年齡限制
      assertAgeEligible(clinicType, patient, params.date);

      // 暫停期滿者先自動恢復（病人列已鎖定），再判斷是否仍受限
      await applyRestrictionExpiry(tx, patient.id);
      if (!params.staffOverride && (await isPatientRestricted(tx, patient.id)))
        throw new BookingError("RESTRICTED", MSG.restricted);

      // 同日唯一
      if (!params.staffOverride)
        await assertNoSameDay(tx, patient.id, params.date, params.excludeAppointmentId);

      // 同時未完成預約上限（以預約帳號計、當日不計入）
      if (!params.staffOverride)
        await assertActiveLimit(tx, params.accountKey, params.date, params.excludeAppointmentId);

      // 家庭代表預約：同行家人各自建立／取回病歷並檢查，但不另占名額
      const companionPatients = await prepareCompanions(tx, params, clinicType, patient.id);
      for (const c of companionPatients) if (c.created) createdPatientIds.push(c.patient.id);

      // 醫師與名額（含「不限醫師」自動分配）
      const { doctorId, slotId, endTime, capacitySlotNo } = await allocateSlot(tx, {
        date: params.date,
        startTime: params.startTime,
        doctorId: params.doctorId,
        clinicTypeDoctorIds: clinicType.doctors.map((d) => d.doctorId),
        allowedSessions: clinicType.allowedSessions,
        windows: clinicType.windows,
        isStaff: !!params.isStaff,
      });

      // 建立預約
      const status = clinicType.requiresReview && params.source !== "STAFF" ? "PENDING" : "CONFIRMED";
      const bookingNumber = await issueBookingNumber(tx, params.date);

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
          accountKey: params.accountKey,
          requestId: params.requestId,
          rescheduledFromId: params.excludeAppointmentId,
          createdBy: params.actor.type === "STAFF" ? params.actor.id : "patient",
        },
      });

      if (companionPatients.length > 0) {
        await tx.appointmentCompanion.createMany({
          data: companionPatients.map((c) => ({
            appointmentId: appointment.id,
            patientId: c.patient.id,
          })),
        });
      }

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
          companionCount: companionPatients.length,
        },
        tx,
      );

      await enqueueAppointmentNotification(tx, "BOOKED", appointment, patient);

      return {
        appointment,
        patient,
        duplicated: false,
        companions: companionPatients.map((c) => c.patient),
        createdPatientIds,
      };
    },
    { timeout: 15000 },
  );
}

/**
 * 家庭代表預約：處理同行看診的家人。
 * 同行者不另占時段名額、不另計帳號額度（這正是此功能的用意），
 * 但仍逐一檢查：門診是否允許、是否與代表人重複、是否受預約限制、同日是否已有預約。
 */
async function prepareCompanions(
  tx: Tx,
  params: CreateAppointmentParams,
  clinicType: { allowCompanions: boolean; name: string; minAgeMonths: number | null; maxAgeMonths: number | null },
  primaryPatientId: string,
): Promise<{ patient: Patient; created: boolean }[]> {
  const inputs = params.companions ?? [];
  if (inputs.length === 0) return [];
  if (!clinicType.allowCompanions) {
    throw new BookingError(
      "VALIDATION",
      `「${clinicType.name}」每個時段只安排 1 位看診，無法加入同行家人，請分別預約時段。`,
    );
  }
  const max = await getSetting("booking.max_companions", tx);
  if (inputs.length > max) {
    throw new BookingError("VALIDATION", `同行家人最多 ${max} 位，超過請另外預約時段。`);
  }

  const out: { patient: Patient; created: boolean }[] = [];
  for (const input of inputs) {
    const { patient: companion, created } = await upsertPatientForBooking(tx, input, {
      trusted: !!params.isStaff,
    });
    if (companion.id === primaryPatientId)
      throw new BookingError("VALIDATION", "同行家人與預約人重複，請確認填寫內容。");
    if (out.some((p) => p.patient.id === companion.id))
      throw new BookingError("VALIDATION", "同行家人重複填寫，請確認填寫內容。");

    await lockPatientRow(tx, companion.id);
    assertAgeEligible(clinicType, companion, params.date);
    await applyRestrictionExpiry(tx, companion.id);
    if (!params.staffOverride && (await isPatientRestricted(tx, companion.id)))
      throw new BookingError(
        "RESTRICTED",
        `同行家人「${companion.name}」目前無法使用線上預約，請致電立欣診所，由櫃檯人員協助。`,
      );
    // 同行者同日不得另有預約（含身為別筆預約的同行者）
    if (!params.staffOverride) {
      await assertNoSameDay(tx, companion.id, params.date, params.excludeAppointmentId);
      const alsoCompanion = await tx.appointmentCompanion.count({
        where: {
          patientId: companion.id,
          appointment: {
            appointmentDate: dateToDb(params.date),
            status: { in: [...ACTIVE_STATUSES] },
            ...(params.excludeAppointmentId ? { id: { not: params.excludeAppointmentId } } : {}),
          },
        },
      });
      if (alsoCompanion > 0)
        throw new BookingError(
          "DUPLICATE_SAME_DAY",
          `同行家人「${companion.name}」當天已有預約，無法重複預約。`,
        );
    }
    out.push({ patient: companion, created });
  }
  return out;
}

/** 產生不重複的預約編號（含碰撞重試；建立與改期共用） */
async function issueBookingNumber(tx: Tx, date: string): Promise<string> {
  let bookingNumber = genBookingNumber(date);
  for (let i = 0; i < 3; i++) {
    const clash = await tx.appointment.findUnique({ where: { bookingNumber } });
    if (!clash) break;
    bookingNumber = genBookingNumber(date);
  }
  return bookingNumber;
}

/** 門診類型是否可於該日期預約：停用／當日暫停／可預約星期或時間窗（櫃檯不受限） */
async function assertClinicTypeBookable(
  tx: Tx,
  clinicType: {
    id: string;
    name: string;
    isActive: boolean;
    allowedWeekdays: number[];
    windows?: ClinicWindow[];
    skipOnPublicHoliday?: boolean;
  },
  date: string,
  isStaff: boolean,
) {
  if (isStaff) return;
  if (!clinicType.isActive) throw new BookingError("CLINIC_TYPE_CLOSED", MSG.clinicTypeClosed);
  // 國定假日停開的門診（兒童發展篩檢）；其他門診照常
  if (clinicType.skipOnPublicHoliday) {
    const holiday = await getHolidayName(date, tx);
    if (holiday)
      throw new BookingError("CLINIC_TYPE_CLOSED", MSG.holidayClosed(clinicType.name, holiday));
  }
  const suspended = await getSuspendedClinicTypes(date, tx);
  if (suspended.has(clinicType.id))
    throw new BookingError("CLINIC_TYPE_CLOSED", MSG.clinicTypeClosed);
  const weekday = dateToDb(date).getUTCDay();
  // 有設時間窗時只看時間窗（見 schema 註解），星期粗篩不再套用
  const windows = clinicType.windows ?? [];
  if (windows.length > 0) {
    if (!windows.some((w) => w.weekday === weekday))
      throw new BookingError("SLOT_UNAVAILABLE", MSG.slotUnavailable);
  } else if (clinicType.allowedWeekdays.length > 0 && !clinicType.allowedWeekdays.includes(weekday)) {
    throw new BookingError("SLOT_UNAVAILABLE", MSG.slotUnavailable);
  }
}

/**
 * 民眾自行取消／改期的截止時間（官網公告：該診次開診前都可以，開診後就不行）。
 * 未來日期一律還沒開診；查不到診次開診時間（例如班表外手動加開的時段）時，
 * 退回設定的 booking.cancel_cutoff_minutes 分鐘數，避免完全沒有截止。
 *
 * 截止一律以**診次**為單位（院長 2026-08-06 確認）：診次開始後就停止取消該診次的預約，
 * 不看個別時段的時間。曾短暫加過一道「時段開始就擋」的底線，已依裁示移除——班表改動後
 * 落在區間外的預約（例如早診由 08:00 改為 09:00，既有的 08:00 預約）診所當下根本沒在
 * 看診，擋住家長取消只會把他推向未到記點。理由見 docs/09 D11。
 */
async function assertCancelCutoff(tx: Tx, date: string, startTime: string) {
  const today = todayStr();
  if (date > today) return;
  if (date < today) throw new BookingError("CUTOFF_PASSED", MSG.cutoffPassed);

  const blocks = await getDayScheduleBlocks(date, tx);
  const sessionStart = sessionStartsOf(blocks).get(sessionOfSlot(blocks, startTime));
  if (sessionStart) {
    if (nowTimeStr() >= sessionStart) throw new BookingError("CUTOFF_PASSED", MSG.cutoffPassed);
    return;
  }
  const cutoff = await getSetting("booking.cancel_cutoff_minutes", tx);
  if (minutesFromNow(date, startTime) < cutoff)
    throw new BookingError("CUTOFF_PASSED", MSG.cutoffPassed);
}

/** 開放日期檢查：滾動開放 N 天（最新一天於 open_time 才開放）＋當日截止 */
async function assertDateOpen(tx: Tx, date: string, startTime: string) {
  const [openDays, openTime, allowSameDay, cutoffMin] = await Promise.all([
    getSetting("booking.open_days", tx),
    getSetting("booking.open_time", tx),
    getSetting("booking.allow_same_day", tx),
    getSetting("booking.same_day_cutoff_minutes", tx),
  ]);
  const today = todayStr();
  const lastOpen = addDays(today, openDays - 1);
  if (date < today || date > lastOpen) throw new BookingError("DATE_NOT_OPEN", MSG.dateNotOpen);
  if (date === lastOpen && nowTimeStr() < openTime)
    throw new BookingError("DATE_NOT_OPEN", MSG.dateNotOpen);
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

/**
 * 同日唯一檢查（病人列已鎖定）。
 * 同時檢查「本人是別筆預約的同行家人」，否則家庭代表預約會成為同日重複的破口。
 */
async function assertNoSameDay(tx: Tx, patientId: string, date: string, excludeId?: string) {
  const where = {
    appointmentDate: dateToDb(date),
    status: { in: [...ACTIVE_STATUSES] },
    ...(excludeId ? { id: { not: excludeId } } : {}),
  };
  const [own, asCompanion] = await Promise.all([
    tx.appointment.count({ where: { patientId, ...where } }),
    tx.appointmentCompanion.count({ where: { patientId, appointment: where } }),
  ]);
  if (own + asCompanion > 0) throw new BookingError("DUPLICATE_SAME_DAY", MSG.duplicateSameDay);
}

/**
 * 同時最多 N 筆尚未完成的預約（病人列已鎖定）。
 * 與官網公告一致：**當日的預約不計入**——今天的預約既不占用額度，也不受額度阻擋。
 */
/**
 * 同時未完成預約上限（官網公告：每個預約帳號同時最多 2 筆，當日的預約不計入）。
 * 額度以「預約帳號」為單位（院長 2026-08-01 裁示）：
 *   LINE 登入＝該 LINE 帳號、手機驗證＝該已驗證手機。
 * 櫃檯代約沒有帳號（accountKey 為 null），不占任何帳號額度、也不受此限。
 * 超過上限時擋下並說明，不採「自動取消較新的預約」。
 */
async function assertActiveLimit(
  tx: Tx,
  accountKey: string | null | undefined,
  date: string,
  excludeId?: string,
) {
  if (!accountKey) return; // 櫃檯代約
  const today = todayStr();
  if (date <= today) return; // 當日（或更早，理論上不會發生）不計入、也不受限
  const max = await getSetting("booking.active_max", tx);
  const count = await tx.appointment.count({
    where: {
      accountKey,
      status: { in: [...ACTIVE_LIMIT_STATUSES] },
      appointmentDate: { gt: dateToDb(today) },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
  if (count >= max) throw new BookingError("ACTIVE_LIMIT", MSG.activeLimit(max));
}

interface AllocateParams {
  date: string;
  startTime: string;
  doctorId: string; // 或 "any"
  clinicTypeDoctorIds: string[];
  allowedSessions: import("@prisma/client").SessionPeriod[];
  /** 門診類型時間窗；有值時取代 allowedSessions 的診別粗篩 */
  windows: ClinicWindow[];
  isStaff: boolean;
}

interface SlotCandidate {
  doctorId: string;
  capacity: number;
  endTime: string;
}

/**
 * 名額配發：班表候選（須落在 30 分鐘格點上）＋手動加開時段 → 鎖定時段列 → 配發序號。
 * - SLOT_BLOCKED 日期例外在此層強制（不只前台隱藏）
 * - 手動加開的 MANUAL 時段即使落在班表區間外也可預約（與前台顯示一致）
 * - 「不限醫師」時優先分配當日預約數較少的醫師以平衡人數
 */
async function allocateSlot(tx: Tx, p: AllocateParams) {
  const [blocks, blocked] = await Promise.all([
    getDayScheduleBlocks(p.date, tx),
    getBlockedSlotKeys(p.date, tx),
  ]);

  const allowedDoctor = (id: string) =>
    (p.clinicTypeDoctorIds.length === 0 || p.clinicTypeDoctorIds.includes(id)) &&
    (p.doctorId === "any" || id === p.doctorId);
  const sessionAllowed = (s: import("@prisma/client").SessionPeriod) =>
    p.windows.length > 0 || p.allowedSessions.length === 0 || p.allowedSessions.includes(s);

  // 門診類型時間窗（例：兒童發展篩檢週一僅下午 14:30–16:00）；櫃檯代約不受限
  if (
    !p.isStaff &&
    !isWithinClinicWindows(p.windows, dateToDb(p.date).getUTCDay(), p.startTime)
  ) {
    throw new BookingError("SLOT_UNAVAILABLE", MSG.slotUnavailable);
  }

  // 官網公告：該診次開診後就不再受理該診次的預約（櫃檯代約仍可，比照現場加號）
  const sessionStarts = sessionStartsOf(blocks);
  const nowTime = nowTimeStr();
  const sessionOpen = (s: import("@prisma/client").SessionPeriod) =>
    p.isStaff || p.date !== todayStr() || !hasSessionStarted(sessionStarts, s, nowTime);
  if (!sessionOpen(sessionOfSlot(blocks, p.startTime)))
    throw new BookingError("SLOT_UNAVAILABLE", MSG.sessionStarted);

  // 班表候選：slotTimes 產生的格點才有效，防止自創時間（如 09:01）繞過名額上限
  const candidates: SlotCandidate[] = blocks
    .filter(
      (b) =>
        slotTimes(b.startTime, b.endTime).includes(p.startTime) &&
        (p.isStaff || b.allowOnline) &&
        sessionAllowed(b.session) &&
        sessionOpen(b.session) &&
        allowedDoctor(b.doctorId) &&
        !isSlotKeyBlocked(blocked, b.doctorId, p.startTime),
    )
    .map((b) => ({
      doctorId: b.doctorId,
      capacity: b.slotCapacity,
      endTime: slotEnd(p.startTime, b.endTime),
    }));

  // 手動加開時段（可能在班表區間外）；門診類型與封鎖規則同樣適用
  const manualRows = await tx.appointmentSlot.findMany({
    where: {
      date: dateToDb(p.date),
      startTime: p.startTime,
      source: "MANUAL",
      isBlocked: false,
    },
  });
  for (const row of manualRows) {
    if (!allowedDoctor(row.doctorId)) continue;
    if (!sessionAllowed(sessionOfTime(row.startTime))) continue;
    if (!sessionOpen(sessionOfTime(row.startTime))) continue;
    if (isSlotKeyBlocked(blocked, row.doctorId, p.startTime)) continue;
    if (candidates.some((c) => c.doctorId === row.doctorId)) continue; // 班表候選已涵蓋
    candidates.push({ doctorId: row.doctorId, capacity: row.capacity, endTime: row.endTime });
  }

  if (candidates.length === 0)
    throw new BookingError("SLOT_UNAVAILABLE", MSG.slotUnavailable);

  // 平衡分配：當日各候選醫師的預約數（少者優先），平手依顯示順序
  let ordered = candidates;
  if (p.doctorId === "any" && candidates.length > 1) {
    const doctorIds = candidates.map((c) => c.doctorId);
    const [counts, doctors] = await Promise.all([
      tx.appointment.groupBy({
        by: ["doctorId"],
        where: {
          appointmentDate: dateToDb(p.date),
          doctorId: { in: doctorIds },
          status: { in: [...OCCUPYING_STATUSES] },
        },
        _count: { id: true },
      }),
      tx.doctor.findMany({ where: { id: { in: doctorIds } } }),
    ]);
    const countMap = new Map(counts.map((c) => [c.doctorId, c._count.id]));
    const orderMap = new Map(doctors.map((d) => [d.id, d.displayOrder]));
    ordered = [...candidates].sort(
      (a, b) =>
        (countMap.get(a.doctorId) ?? 0) - (countMap.get(b.doctorId) ?? 0) ||
        (orderMap.get(a.doctorId) ?? 0) - (orderMap.get(b.doctorId) ?? 0),
    );
  }

  for (const candidate of ordered) {
    const allocated = await tryAllocateSeq(tx, p.date, p.startTime, candidate);
    if (allocated) return allocated;
  }

  throw new BookingError("SLOT_FULL", MSG.slotFull);
}

/** 建立（若不存在）並鎖定時段列，配發最小可用序號；額滿回 null */
async function tryAllocateSeq(tx: Tx, date: string, startTime: string, c: SlotCandidate) {
  await tx.$executeRaw`
    INSERT INTO appointment_slots
      (id, doctor_id, date, start_time, end_time, capacity, is_blocked, source, created_at, updated_at)
    VALUES
      (${randomUUID()}, ${c.doctorId}, ${dateToDb(date)}, ${startTime},
       ${c.endTime}, ${c.capacity}, false, 'AUTO'::"SlotSource", now(), now())
    ON CONFLICT (doctor_id, date, start_time) DO NOTHING`;
  const slotRows = await tx.$queryRaw<
    { id: string; capacity: number; is_blocked: boolean; end_time: string }[]
  >`
    SELECT id, capacity, is_blocked, end_time FROM appointment_slots
    WHERE doctor_id = ${c.doctorId} AND date = ${dateToDb(date)} AND start_time = ${startTime}
    FOR UPDATE`;
  const slot = slotRows[0];
  if (!slot || slot.is_blocked) return null;

  const used = await tx.appointment.findMany({
    where: {
      doctorId: c.doctorId,
      appointmentDate: dateToDb(date),
      startTime,
      status: { in: [...OCCUPYING_STATUSES] },
    },
    select: { capacitySlotNo: true },
  });
  const usedSeqs = new Set(used.map((u) => u.capacitySlotNo));
  for (let i = 1; i <= slot.capacity; i++) {
    if (!usedSeqs.has(i)) {
      return { doctorId: c.doctorId, slotId: slot.id, endTime: slot.end_time, capacitySlotNo: i };
    }
  }
  return null; // 額滿，換下一位候選醫師
}

// ── 取消 ────────────────────────────────────────────────

export interface CancelOptions {
  appointmentId: string;
  actor: AuditActor;
  byPatient: boolean;
  reason?: string;
}

/**
 * 取消預約（交易內核心）。供 cancelAppointment 使用，
 * 也供「排班例外批次取消受影響預約」在同一交易內逐筆呼叫，
 * 讓取消與例外建立同生共死，不會出現「病人被取消但例外沒建立」。
 */
export async function cancelAppointmentTx(tx: Tx, opts: CancelOptions): Promise<Appointment> {
  return cancelCore(tx, opts);
}

export async function cancelAppointment(opts: CancelOptions): Promise<Appointment> {
  return prisma.$transaction(async (tx) => cancelCore(tx, opts));
}

async function cancelCore(tx: Tx, opts: CancelOptions): Promise<Appointment> {
  {
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

    if (opts.byPatient)
      await assertCancelCutoff(tx, dbToDate(appt.appointmentDate), appt.startTime);

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
  }
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
        include: { patient: true, clinicType: { include: { doctors: true, windows: true } } },
      });
      if (!appt) throw new BookingError("NOT_FOUND", MSG.notFound);
      if (!(["PENDING", "CONFIRMED"] as string[]).includes(appt.status))
        throw new BookingError("INVALID_STATUS", "此預約目前狀態無法改期。");

      if (opts.byPatient) {
        await assertCancelCutoff(tx, dbToDate(appt.appointmentDate), appt.startTime);
        await assertDateOpen(tx, opts.newDate, opts.newStartTime);
      }

      // 新日期需重新通過門診類型檢查（停用／暫停／可預約星期），與建立預約一致
      await assertClinicTypeBookable(tx, appt.clinicType, opts.newDate, !opts.byPatient);

      await lockPatientRow(tx, appt.patientId);

      // 受限病人不可線上改期（櫃檯可覆寫）；暫停期滿者先自動恢復
      await applyRestrictionExpiry(tx, appt.patientId);
      if (!opts.staffOverride && (await isPatientRestricted(tx, appt.patientId)))
        throw new BookingError("RESTRICTED", MSG.restricted);

      if (!opts.staffOverride) {
        await assertNoSameDay(tx, appt.patientId, opts.newDate, appt.id);
        // 沿用原預約的帳號額度歸屬
        await assertActiveLimit(tx, appt.accountKey, opts.newDate, appt.id);
      }

      const { doctorId, slotId, endTime, capacitySlotNo } = await allocateSlot(tx, {
        date: opts.newDate,
        startTime: opts.newStartTime,
        doctorId: opts.newDoctorId,
        clinicTypeDoctorIds: appt.clinicType.doctors.map((d) => d.doctorId),
        allowedSessions: appt.clinicType.allowedSessions,
        windows: appt.clinicType.windows,
        isStaff: !opts.byPatient,
      });

      const bookingNumber = await issueBookingNumber(tx, opts.newDate);

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
          accountKey: appt.accountKey,
          rescheduledFromId: appt.id,
          createdBy: opts.actor.type === "STAFF" ? opts.actor.id : "patient",
        },
      });

      // 同行家人隨改期一併轉到新預約（原預約標記已改期後即不再生效）
      const companions = await tx.appointmentCompanion.findMany({
        where: { appointmentId: appt.id },
      });
      if (companions.length > 0) {
        await tx.appointmentCompanion.createMany({
          data: companions.map((c) => ({
            appointmentId: newAppointment.id,
            patientId: c.patientId,
          })),
        });
      }

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
      // upsert：曾誤標後撤銷的預約可再次標記（unique on appointmentId）
      await tx.noShowRecord.upsert({
        where: { appointmentId: appt.id },
        create: {
          patientId: appt.patientId,
          appointmentId: appt.id,
          markedBy: opts.actor.id ?? "unknown",
          note: opts.note,
        },
        update: {
          markedBy: opts.actor.id ?? "unknown",
          note: opts.note,
          revokedAt: null,
          revokedBy: null,
          revokeReason: null,
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
      data: { status: "CONFIRMED", updatedBy: opts.actor.id },
    });
    await tx.appointmentStatusHistory.create({
      data: {
        appointmentId: appt.id,
        fromStatus: "NO_SHOW",
        toStatus: "CONFIRMED",
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
