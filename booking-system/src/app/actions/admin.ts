"use server";

/**
 * 後台 server actions。每個 action 先取得員工 session 並檢查權限；
 * 重要操作寫入 audit_logs。
 */
import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "@/lib/db";
import {
  createAppointment,
  cancelAppointment,
  rescheduleAppointment,
  updateAppointmentStatus,
  revokeNoShow,
} from "@/lib/booking";
import {
  createScheduleException,
  deleteScheduleException,
  setSlotBlocked,
  setSlotCapacity,
  findAffectedAppointments,
  copyWeekExceptions,
  applyTemplateChange,
  type ExceptionInput,
  type TemplateChange,
} from "@/lib/schedule-admin";
import { dateToDb, dbToDate, todayStr } from "@/lib/tw-time";
import {
  liftRestriction,
  resetNoShowCount,
  createManualRestriction,
} from "@/lib/restrictions";
import {
  verifyStaffPassword,
  verifyStaffTotp,
  createStaffSession,
  destroyStaffSession,
  getStaffContext,
  generateTotpSecret,
  STAFF_COOKIE,
  type StaffContext,
} from "@/lib/auth/staff";
import { requirePermission, PERMISSIONS, ROLE_PERMISSIONS } from "@/lib/auth/authz";
import { dispatchPendingNotifications, enqueueAppointmentNotification } from "@/lib/notifications";
import { BookingError } from "@/lib/errors";
import { patientInputSchema, dateStrSchema, timeStrSchema, slotTimeSchema } from "@/lib/validation";
import { writeAudit, type AuditActor } from "@/lib/audit";
import { setSetting, SETTING_DEFAULTS, type SettingKey } from "@/lib/settings";
import { rateLimit } from "@/lib/rate-limit";
import { consumeBindingCode } from "@/lib/line-binding";
import { decryptPii } from "@/lib/crypto";

type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; message: string };

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

function toUserError(e: unknown): { ok: false; message: string } {
  if (e instanceof BookingError) return { ok: false, message: e.userMessage };
  if (e instanceof z.ZodError)
    return { ok: false, message: e.issues[0]?.message ?? "輸入資料有誤" };
  console.error("[admin action]", e);
  return { ok: false, message: "操作失敗，請稍後再試" };
}

async function actorOf(ctx: StaffContext): Promise<AuditActor> {
  return { type: "STAFF", id: ctx.user.id, name: ctx.user.displayName, ip: await clientIp() };
}

// ── 登入 ─────────────────────────────────────────────

const totpPendingSecret = () => new TextEncoder().encode(process.env.SESSION_SECRET ?? "");

export async function staffLogin(
  username: string,
  password: string,
): Promise<ActionResult<{ needsTotp: boolean; pendingToken?: string }>> {
  const ip = await clientIp();
  if (!rateLimit(`staff-login:${ip}`, 10, 10 * 60_000))
    return { ok: false, message: "嘗試次數過多，請稍後再試" };
  const result = await verifyStaffPassword(username, password, ip);
  if (!result.ok) return { ok: false, message: result.message };
  if (result.needsTotp) {
    const pendingToken = await new SignJWT({ uid: result.pendingUserId, purpose: "totp" })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("5m")
      .sign(totpPendingSecret());
    return { ok: true, data: { needsTotp: true, pendingToken } };
  }
  const token = await createStaffSession(result.user, ip);
  (await cookies()).set(STAFF_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/admin",
  });
  return { ok: true, data: { needsTotp: false } };
}

export async function staffTotpLogin(
  pendingToken: string,
  code: string,
): Promise<ActionResult> {
  try {
    const { payload } = await jwtVerify(pendingToken, totpPendingSecret());
    if (payload.purpose !== "totp" || typeof payload.uid !== "string")
      return { ok: false, message: "驗證逾時，請重新登入" };
    const user = await verifyStaffTotp(payload.uid, code);
    if (!user) return { ok: false, message: "驗證碼錯誤" };
    const token = await createStaffSession(user, await clientIp());
    (await cookies()).set(STAFF_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/admin",
    });
    return { ok: true };
  } catch {
    return { ok: false, message: "驗證逾時，請重新登入" };
  }
}

export async function staffLogout(): Promise<ActionResult> {
  await destroyStaffSession();
  (await cookies()).delete(STAFF_COOKIE);
  return { ok: true };
}

// ── 預約操作 ──────────────────────────────────────────

export async function adminMarkStatus(
  appointmentId: string,
  toStatus: "CONFIRMED" | "CHECKED_IN" | "COMPLETED" | "NO_SHOW",
  note?: string,
): Promise<ActionResult> {
  try {
    const ctx = requirePermission(await getStaffContext(), PERMISSIONS.APPOINTMENTS_WRITE);
    await updateAppointmentStatus({ appointmentId, toStatus, actor: await actorOf(ctx), note });
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return toUserError(e);
  }
}

export async function adminRevokeNoShow(appointmentId: string, reason: string): Promise<ActionResult> {
  try {
    const ctx = requirePermission(await getStaffContext(), PERMISSIONS.APPOINTMENTS_WRITE);
    if (!reason.trim()) return { ok: false, message: "請輸入撤銷原因" };
    await revokeNoShow({ appointmentId, actor: await actorOf(ctx), reason });
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return toUserError(e);
  }
}

export async function adminCancelAppointment(
  appointmentId: string,
  reason: string,
): Promise<ActionResult> {
  try {
    const ctx = requirePermission(await getStaffContext(), PERMISSIONS.APPOINTMENTS_WRITE);
    if (!reason.trim()) return { ok: false, message: "請輸入取消原因" };
    await cancelAppointment({
      appointmentId,
      actor: await actorOf(ctx),
      byPatient: false,
      reason,
    });
    void dispatchPendingNotifications().catch(() => {});
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return toUserError(e);
  }
}

const staffBookingSchema = z.object({
  clinicTypeId: z.string().min(1),
  doctorId: z.string().min(1),
  date: dateStrSchema,
  startTime: timeStrSchema,
  patientId: z.string().optional(),
  patient: patientInputSchema.optional(),
  overrideReason: z.string().trim().optional(),
  staffNote: z.string().trim().max(300).optional(),
});

export async function adminCreateBooking(
  input: z.infer<typeof staffBookingSchema>,
): Promise<ActionResult<{ bookingNumber: string; usedOverride: boolean }>> {
  try {
    const ctx = requirePermission(await getStaffContext(), PERMISSIONS.APPOINTMENTS_WRITE);
    const parsed = staffBookingSchema.parse(input);
    const actor = await actorOf(ctx);
    const base = {
      clinicTypeId: parsed.clinicTypeId,
      doctorId: parsed.doctorId,
      date: parsed.date,
      startTime: parsed.startTime,
      patientId: parsed.patientId,
      patientInput: parsed.patient,
      source: "STAFF" as const,
      actor,
      isStaff: true,
      staffNote: parsed.staffNote,
    };
    try {
      const r = await createAppointment(base);
      void dispatchPendingNotifications().catch(() => {});
      revalidatePath("/admin");
      return { ok: true, data: { bookingNumber: r.appointment.bookingNumber, usedOverride: false } };
    } catch (e) {
      // 同日／同時筆數／受限 → 若已填覆寫理由則覆寫重試（需 override 權限）
      const overridable =
        e instanceof BookingError &&
        ["DUPLICATE_SAME_DAY", "ACTIVE_LIMIT", "RESTRICTED"].includes(e.code);
      if (!overridable || !parsed.overrideReason) throw e;
      requirePermission(ctx, PERMISSIONS.APPOINTMENTS_OVERRIDE);
      const r = await createAppointment({
        ...base,
        staffOverride: { reason: parsed.overrideReason },
      });
      void dispatchPendingNotifications().catch(() => {});
      revalidatePath("/admin");
      return { ok: true, data: { bookingNumber: r.appointment.bookingNumber, usedOverride: true } };
    }
  } catch (e) {
    return toUserError(e);
  }
}

export async function adminReschedule(input: {
  appointmentId: string;
  newDoctorId: string;
  newDate: string;
  newStartTime: string;
  reason?: string;
  overrideReason?: string;
}): Promise<ActionResult<{ bookingNumber: string }>> {
  try {
    const ctx = requirePermission(await getStaffContext(), PERMISSIONS.APPOINTMENTS_WRITE);
    dateStrSchema.parse(input.newDate);
    timeStrSchema.parse(input.newStartTime);
    const { newAppointment } = await rescheduleAppointment({
      appointmentId: input.appointmentId,
      newDoctorId: input.newDoctorId,
      newDate: input.newDate,
      newStartTime: input.newStartTime,
      actor: await actorOf(ctx),
      byPatient: false,
      reason: input.reason,
      staffOverride: input.overrideReason ? { reason: input.overrideReason } : undefined,
    });
    void dispatchPendingNotifications().catch(() => {});
    revalidatePath("/admin");
    return { ok: true, data: { bookingNumber: newAppointment.bookingNumber } };
  } catch (e) {
    return toUserError(e);
  }
}

/** 重新發送／補發通知 */
export async function adminResendNotification(appointmentId: string): Promise<ActionResult> {
  try {
    const ctx = requirePermission(await getStaffContext(), PERMISSIONS.APPOINTMENTS_WRITE);
    const appt = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { patient: true },
    });
    if (!appt) return { ok: false, message: "查無此預約" };
    await prisma.$transaction(async (tx) => {
      await enqueueAppointmentNotification(tx, "CLINIC_NOTICE", appt, appt.patient);
    });
    await writeAudit(await actorOf(ctx), "notification.resend", {
      type: "appointment",
      id: appt.id,
    });
    void dispatchPendingNotifications().catch(() => {});
    return { ok: true };
  } catch (e) {
    return toUserError(e);
  }
}

/** 櫃檯搜尋病人（姓名/電話/證件末碼；byIdNumber=true 時以完整證件號雜湊查） */
export async function adminSearchPatients(
  q: string,
  byIdNumber = false,
): Promise<
  ActionResult<
    {
      id: string;
      name: string;
      birthDate: string;
      phone: string;
      idNumberMasked: string;
      noShowCount: number;
      restricted: boolean;
    }[]
  >
> {
  try {
    requirePermission(await getStaffContext(), PERMISSIONS.PATIENTS_READ);
    const { searchPatients } = await import("@/lib/admin-service");
    const rows = await searchPatients(q, byIdNumber);
    const restrictions = await prisma.bookingRestriction.findMany({
      where: { patientId: { in: rows.map((r) => r.id) }, status: { in: ["ACTIVE", "SUSPENDED"] } },
    });
    const restrictedIds = new Set(restrictions.map((r) => r.patientId));
    return {
      ok: true,
      data: rows.map((r) => ({
        id: r.id,
        name: r.name,
        birthDate: r.birthDate.toISOString().slice(0, 10),
        phone: r.phone,
        idNumberMasked: r.idNumberMasked,
        noShowCount: r.noShowCount,
        restricted: restrictedIds.has(r.id),
      })),
    };
  } catch (e) {
    return toUserError(e);
  }
}

/** 櫃檯視角的當日時段（含「不開放線上」的時段；顯示剩餘名額） */
export async function adminFetchDaySlots(
  date: string,
): Promise<
  ActionResult<
    { doctorId: string; doctorName: string; startTime: string; remaining: number; capacity: number }[]
  >
> {
  try {
    requirePermission(await getStaffContext(), PERMISSIONS.APPOINTMENTS_READ);
    dateStrSchema.parse(date);
    const { expandDaySlots } = await import("@/lib/schedule");
    const { OCCUPYING_STATUSES } = await import("@/lib/booking");
    const { dateToDb } = await import("@/lib/tw-time");
    const [slots, doctors, slotRows, counts] = await Promise.all([
      expandDaySlots(date),
      prisma.doctor.findMany({ where: { isActive: true } }),
      prisma.appointmentSlot.findMany({ where: { date: dateToDb(date) } }),
      prisma.appointment.groupBy({
        by: ["doctorId", "startTime"],
        where: { appointmentDate: dateToDb(date), status: { in: [...OCCUPYING_STATUSES] } },
        _count: { id: true },
      }),
    ]);
    const nameMap = new Map(doctors.map((d) => [d.id, d.name]));
    const overrideMap = new Map(slotRows.map((s) => [`${s.doctorId}|${s.startTime}`, s]));
    const countMap = new Map(counts.map((c) => [`${c.doctorId}|${c.startTime}`, c._count.id]));
    return {
      ok: true,
      data: slots
        .filter((s) => !overrideMap.get(`${s.doctorId}|${s.startTime}`)?.isBlocked)
        .map((s) => {
          const key = `${s.doctorId}|${s.startTime}`;
          const capacity = overrideMap.get(key)?.capacity ?? s.capacity;
          return {
            doctorId: s.doctorId,
            doctorName: nameMap.get(s.doctorId) ?? "",
            startTime: s.startTime,
            capacity,
            remaining: Math.max(0, capacity - (countMap.get(key) ?? 0)),
          };
        }),
    };
  } catch (e) {
    return toUserError(e);
  }
}

// ── 病人 ─────────────────────────────────────────────

const patientContactSchema = z.object({
  patientId: z.string().min(1),
  name: z.string().trim().min(1, "請輸入姓名").max(50),
  phone: z.string().trim().regex(/^09\d{8}$/, "手機號碼格式不正確（09 開頭共 10 碼）"),
});

/**
 * 櫃檯更新病人姓名／手機（前台預約不會自動覆寫，需人員核對身分後由此更新）。
 * 變更前後值寫入稽核；若更新後的號碼正是先前記錄的待確認聯絡方式，一併清掉該筆。
 */
export async function adminUpdatePatientContact(
  input: z.infer<typeof patientContactSchema>,
): Promise<ActionResult> {
  try {
    const ctx = requirePermission(await getStaffContext(), PERMISSIONS.PATIENTS_WRITE);
    const parsed = patientContactSchema.parse(input);
    const before = await prisma.patient.findUnique({ where: { id: parsed.patientId } });
    if (!before) return { ok: false, message: "查無此病人" };
    await prisma.$transaction(async (tx) => {
      await tx.patient.update({
        where: { id: parsed.patientId },
        data: { name: parsed.name, phone: parsed.phone },
      });
      await tx.patientContact.deleteMany({
        where: { patientId: parsed.patientId, type: "PHONE", value: parsed.phone },
      });
      await writeAudit(
        await actorOf(ctx),
        "patient.contact_update",
        { type: "patient", id: parsed.patientId },
        {
          nameChanged: before.name !== parsed.name,
          phoneChanged: before.phone !== parsed.phone,
          // 舊值遮罩後留存，稽核可追溯但不落完整號碼
          fromPhoneMasked: before.phone.slice(0, 4) + "***" + before.phone.slice(-3),
        },
        tx,
      );
    });
    revalidatePath(`/admin/patients/${parsed.patientId}`);
    return { ok: true };
  } catch (e) {
    return toUserError(e);
  }
}

// ── LINE 綁定（櫃檯核對制）─────────────────────────────

/**
 * 以綁定代碼把某個 LINE 帳號綁到這位病人。
 *
 * **前提是櫃檯已當面核對健保卡**——這道程式檢查的只有「代碼有效」，
 * 真正證明「這個人有權看這份病歷」的是櫃檯的核對動作，系統代替不了。
 * 因此操作者一律記進稽核（誰、綁了誰、什麼時候）。
 */
export async function adminBindLineAccount(input: {
  patientId: string;
  code: string;
  relation?: string;
}): Promise<ActionResult<{ displayName: string | null }>> {
  try {
    const ctx = requirePermission(await getStaffContext(), PERMISSIONS.PATIENTS_WRITE);
    // 代碼只有 6 碼，限流是防止有人拿後台帳號窮舉別人的代碼
    if (!rateLimit(`bind-staff:${ctx.user.id}`, 20, 10 * 60_000))
      return { ok: false, message: "嘗試次數過多，請稍後再試" };

    const patient = await prisma.patient.findUnique({ where: { id: input.patientId } });
    if (!patient) return { ok: false, message: "查無此病人" };

    const owner = await consumeBindingCode(input.code);
    const link = await prisma.linePatientLink.upsert({
      where: {
        lineAccountId_patientId: {
          lineAccountId: owner.lineAccountId,
          patientId: input.patientId,
        },
      },
      create: {
        lineAccountId: owner.lineAccountId,
        patientId: input.patientId,
        relation: input.relation?.trim() || null,
        verifiedAt: new Date(),
        verifiedByStaffId: ctx.user.id,
      },
      update: { relation: input.relation?.trim() || null, verifiedByStaffId: ctx.user.id },
    });
    await writeAudit(
      await actorOf(ctx),
      "line.bind_patient_by_staff",
      { type: "line_patient_link", id: link.id },
      { patientId: input.patientId, lineAccountId: owner.lineAccountId },
    );
    revalidatePath(`/admin/patients/${input.patientId}`);
    return { ok: true, data: { displayName: owner.displayName } };
  } catch (e) {
    return toUserError(e);
  }
}

/** 解除某個 LINE 帳號與這位病人的綁定（家長換手機、綁錯人、家庭成員變動） */
export async function adminUnbindLineAccount(
  patientId: string,
  lineAccountId: string,
): Promise<ActionResult> {
  try {
    const ctx = requirePermission(await getStaffContext(), PERMISSIONS.PATIENTS_WRITE);
    const deleted = await prisma.linePatientLink.deleteMany({
      where: { patientId, lineAccountId },
    });
    if (deleted.count === 0) return { ok: false, message: "查無此綁定" };
    await writeAudit(
      await actorOf(ctx),
      "line.unbind_patient_by_staff",
      { type: "patient", id: patientId },
      { lineAccountId },
    );
    revalidatePath(`/admin/patients/${patientId}`);
    return { ok: true };
  } catch (e) {
    return toUserError(e);
  }
}

/** 忽略（刪除）一筆待確認聯絡方式 */
export async function adminDismissPendingContact(contactId: string): Promise<ActionResult> {
  try {
    const ctx = requirePermission(await getStaffContext(), PERMISSIONS.PATIENTS_WRITE);
    const row = await prisma.patientContact.findUnique({ where: { id: contactId } });
    if (!row) return { ok: false, message: "查無此紀錄" };
    await prisma.patientContact.delete({ where: { id: contactId } });
    await writeAudit(await actorOf(ctx), "patient.pending_contact_dismiss", {
      type: "patient",
      id: row.patientId,
    });
    revalidatePath(`/admin/patients/${row.patientId}`);
    return { ok: true };
  } catch (e) {
    return toUserError(e);
  }
}

export async function adminUpdatePatientNote(
  patientId: string,
  staffNote: string,
): Promise<ActionResult> {
  try {
    const ctx = requirePermission(await getStaffContext(), PERMISSIONS.PATIENTS_WRITE);
    await prisma.patient.update({ where: { id: patientId }, data: { staffNote } });
    await writeAudit(await actorOf(ctx), "patient.note_update", { type: "patient", id: patientId });
    revalidatePath(`/admin/patients/${patientId}`);
    return { ok: true };
  } catch (e) {
    return toUserError(e);
  }
}

/** 查看完整證件號（需 pii:full 權限；每次查看都留稽核） */
export async function adminRevealIdNumber(patientId: string): Promise<ActionResult<{ idNumber: string }>> {
  try {
    const ctx = requirePermission(await getStaffContext(), PERMISSIONS.PII_FULL);
    const patient = await prisma.patient.findUnique({ where: { id: patientId } });
    if (!patient) return { ok: false, message: "查無此病人" };
    await writeAudit(await actorOf(ctx), "patient.pii_reveal", { type: "patient", id: patientId });
    return { ok: true, data: { idNumber: decryptPii(patient.idNumberEncrypted) } };
  } catch (e) {
    return toUserError(e);
  }
}

/** 合併重複病歷（僅管理員；保留原始資料——來源病歷標記 mergedInto，不刪除） */
export async function adminMergePatients(
  keepId: string,
  mergeId: string,
  confirmText: string,
): Promise<ActionResult> {
  try {
    const ctx = requirePermission(await getStaffContext(), PERMISSIONS.PATIENTS_MERGE);
    if (confirmText !== "合併") return { ok: false, message: "請輸入「合併」二字確認" };
    if (keepId === mergeId) return { ok: false, message: "不可合併同一筆病歷" };
    await prisma.$transaction(async (tx) => {
      // 依 id 順序鎖定兩筆病人列，避免與預約交易死鎖，並序列化合併期間的預約檢查
      for (const id of [keepId, mergeId].sort()) {
        await tx.$queryRaw`SELECT id FROM patients WHERE id = ${id} FOR UPDATE`;
      }
      const [keep, merge] = await Promise.all([
        tx.patient.findUnique({ where: { id: keepId } }),
        tx.patient.findUnique({ where: { id: mergeId } }),
      ]);
      if (!keep || !merge) throw new BookingError("NOT_FOUND", "查無病歷");

      // 兩筆病歷同一天各有有效預約時，合併會違反「同日僅一筆」不變量——先擋下請櫃檯處理
      const { ACTIVE_STATUSES } = await import("@/lib/booking");
      const { dbToDate } = await import("@/lib/tw-time");
      const active = await tx.appointment.findMany({
        where: { patientId: { in: [keepId, mergeId] }, status: { in: [...ACTIVE_STATUSES] } },
        select: { patientId: true, appointmentDate: true },
      });
      const keepDates = new Set(
        active.filter((a) => a.patientId === keepId).map((a) => dbToDate(a.appointmentDate)),
      );
      const conflict = active.find(
        (a) => a.patientId === mergeId && keepDates.has(dbToDate(a.appointmentDate)),
      );
      if (conflict) {
        throw new BookingError(
          "VALIDATION",
          `兩筆病歷在 ${dbToDate(conflict.appointmentDate)} 都有有效預約，合併後會同日重複。請先取消或改期其中一筆再合併。`,
        );
      }

      await tx.appointment.updateMany({ where: { patientId: mergeId }, data: { patientId: keepId } });
      await tx.noShowRecord.updateMany({ where: { patientId: mergeId }, data: { patientId: keepId } });
      await tx.bookingRestriction.updateMany({ where: { patientId: mergeId }, data: { patientId: keepId } });
      await tx.linePatientLink.updateMany({ where: { patientId: mergeId }, data: { patientId: keepId } });
      const mergedNoShowCount = keep.noShowCount + merge.noShowCount;
      await tx.patient.update({
        where: { id: keepId },
        data: { noShowCount: mergedNoShowCount, cancelCount: keep.cancelCount + merge.cancelCount },
      });
      await tx.patient.update({ where: { id: mergeId }, data: { mergedIntoId: keepId } });
      // 合併後未到累計可能跨過門檻，需觸發自動限制（未到標記路徑之外的另一個計數來源）
      const { maybeAutoRestrict } = await import("@/lib/restrictions");
      await maybeAutoRestrict(tx, keepId, mergedNoShowCount);
      await writeAudit(
        await actorOf(ctx),
        "patient.merge",
        { type: "patient", id: keepId },
        { mergedFrom: mergeId },
        tx,
      );
    });
    revalidatePath("/admin/patients");
    return { ok: true };
  } catch (e) {
    return toUserError(e);
  }
}

// ── 黑名單／限制 ──────────────────────────────────────

export async function adminLiftRestriction(
  restrictionId: string,
  reason: string,
  suspendedUntil?: string,
): Promise<ActionResult> {
  try {
    const ctx = requirePermission(await getStaffContext(), PERMISSIONS.RESTRICTIONS_MANAGE);
    if (!reason.trim()) return { ok: false, message: "請輸入解除原因" };
    await liftRestriction(
      restrictionId,
      await actorOf(ctx),
      reason,
      suspendedUntil ? new Date(`${suspendedUntil}T23:59:59+08:00`) : undefined,
    );
    revalidatePath("/admin/restrictions");
    return { ok: true };
  } catch (e) {
    return toUserError(e);
  }
}

export async function adminResetNoShow(patientId: string, reason: string): Promise<ActionResult> {
  try {
    const ctx = requirePermission(await getStaffContext(), PERMISSIONS.RESTRICTIONS_MANAGE);
    if (!reason.trim()) return { ok: false, message: "請輸入重設原因" };
    await resetNoShowCount(patientId, await actorOf(ctx), reason);
    revalidatePath("/admin/restrictions");
    return { ok: true };
  } catch (e) {
    return toUserError(e);
  }
}

export async function adminCreateRestriction(patientId: string, reason: string): Promise<ActionResult> {
  try {
    const ctx = requirePermission(await getStaffContext(), PERMISSIONS.RESTRICTIONS_MANAGE);
    if (!reason.trim()) return { ok: false, message: "請輸入限制原因" };
    await createManualRestriction(patientId, await actorOf(ctx), reason);
    revalidatePath("/admin/restrictions");
    return { ok: true };
  } catch (e) {
    return toUserError(e);
  }
}

// ── 排班 ─────────────────────────────────────────────

export interface DaySessionDto {
  session: "MORNING" | "AFTERNOON" | "EVENING";
  startTime: string;
  endTime: string;
  doctors: { id: string; name: string }[];
  /** 停掉這個診次會影響幾筆有效預約（與實際建立例外時的判斷同一套邏輯） */
  affectedCount: number;
  /** 已停診時帶出例外 id，供「恢復看診」用 */
  closedExceptionId: string | null;
}

export interface DayScheduleDto {
  date: string;
  closedAllDayExceptionId: string | null;
  sessions: DaySessionDto[];
  /** 當天其他既有例外（代診／加診／特殊時間等），只列出來提醒櫃檯 */
  otherExceptions: { id: string; label: string; reason: string }[];
}

const OTHER_EXCEPTION_LABEL: Record<string, string> = {
  DOCTOR_OFF: "醫師休診",
  DOCTOR_SUBSTITUTE: "醫師代診",
  SPECIAL_HOURS: "特殊營業時間",
  EXTRA_SESSION: "臨時加診",
  SLOT_BLOCKED: "封鎖單一時段",
  CLINIC_TYPE_SUSPENDED: "暫停門診類型",
};

/**
 * 某一天的診次現況（臨時異動用）。
 *
 * 從**週班表**推出當天原本有哪些診次，再對照當天的例外標記哪一個已經停診——
 * 不能直接用 getDayScheduleBlocks，那個已經把停掉的診次濾掉了，
 * 畫面上就會看不到「已停診（可恢復）」這個狀態。
 */
export async function adminFetchDaySchedule(
  date: string,
): Promise<ActionResult<DayScheduleDto>> {
  try {
    requirePermission(await getStaffContext(), PERMISSIONS.SCHEDULE_WRITE);
    const day = dateStrSchema.parse(date);
    const weekday = dateToDb(day).getUTCDay();

    const [templates, exceptions] = await Promise.all([
      prisma.weeklyScheduleTemplate.findMany({
        where: { weekday, isActive: true, doctor: { isActive: true } },
        include: { doctor: true },
        orderBy: { startTime: "asc" },
      }),
      prisma.scheduleException.findMany({ where: { date: dateToDb(day) } }),
    ]);

    const bySession = new Map<string, typeof templates>();
    for (const t of templates) {
      const list = bySession.get(t.session) ?? [];
      list.push(t);
      bySession.set(t.session, list);
    }

    const order = ["MORNING", "AFTERNOON", "EVENING"] as const;
    const sessions: DaySessionDto[] = [];
    for (const session of order) {
      const rows = bySession.get(session);
      if (!rows || rows.length === 0) continue;
      const closed = exceptions.find((e) => e.type === "SESSION_CLOSED" && e.session === session);
      // 已停診就不必再算影響人數（預約早在停診當下處理掉了）
      const affected = closed
        ? []
        : await findAffectedAppointments({ date: day, type: "SESSION_CLOSED", session, reason: "" });
      const doctorSeen = new Set<string>();
      sessions.push({
        session,
        startTime: rows.reduce((min, r) => (r.startTime < min ? r.startTime : min), rows[0].startTime),
        endTime: rows.reduce((max, r) => (r.endTime > max ? r.endTime : max), rows[0].endTime),
        doctors: rows
          .filter((r) => !doctorSeen.has(r.doctorId) && doctorSeen.add(r.doctorId))
          .map((r) => ({ id: r.doctorId, name: r.doctor.name })),
        affectedCount: affected.length,
        closedExceptionId: closed?.id ?? null,
      });
    }

    return {
      ok: true,
      data: {
        date: day,
        closedAllDayExceptionId:
          exceptions.find((e) => e.type === "CLINIC_CLOSED_DAY")?.id ?? null,
        sessions,
        otherExceptions: exceptions
          .filter((e) => OTHER_EXCEPTION_LABEL[e.type])
          .map((e) => ({
            id: e.id,
            label: OTHER_EXCEPTION_LABEL[e.type],
            reason: e.reason,
          })),
      },
    };
  } catch (e) {
    return toUserError(e);
  }
}


const exceptionSchema = z.object({
  date: dateStrSchema,
  type: z.enum([
    "CLINIC_CLOSED_DAY",
    "SESSION_CLOSED",
    "DOCTOR_OFF",
    "DOCTOR_SUBSTITUTE",
    "SPECIAL_HOURS",
    "EXTRA_SESSION",
    "SLOT_BLOCKED",
    "CLINIC_TYPE_SUSPENDED",
  ]),
  session: z.enum(["MORNING", "AFTERNOON", "EVENING"]).optional(),
  doctorId: z.string().optional(),
  substituteDoctorId: z.string().optional(),
  startTime: slotTimeSchema.optional(),
  endTime: slotTimeSchema.optional(),
  slotCapacity: z.number().int().min(1).max(10).optional(),
  clinicTypeId: z.string().optional(),
  reason: z.string().trim().min(1, "請輸入原因"),
});

export async function adminPreviewException(
  input: z.infer<typeof exceptionSchema>,
): Promise<ActionResult<{ affected: { id: string; bookingNumber: string; time: string; patientName: string; phone: string }[] }>> {
  try {
    requirePermission(await getStaffContext(), PERMISSIONS.SCHEDULE_WRITE);
    const parsed = exceptionSchema.parse(input);
    const affected = await findAffectedAppointments(parsed as ExceptionInput);
    return {
      ok: true,
      data: {
        affected: affected.map((a) => ({
          id: a.id,
          bookingNumber: a.bookingNumber,
          time: a.startTime,
          patientName: a.patient.name,
          phone: a.patient.phone,
        })),
      },
    };
  } catch (e) {
    return toUserError(e);
  }
}

export async function adminCreateException(
  input: z.infer<typeof exceptionSchema>,
  opts: { cancelAffected?: boolean; cancelReason?: string } = {},
): Promise<ActionResult<{ affectedCount: number; created: boolean }>> {
  try {
    const ctx = requirePermission(await getStaffContext(), PERMISSIONS.SCHEDULE_WRITE);
    const parsed = exceptionSchema.parse(input);
    const result = await createScheduleException(parsed as ExceptionInput, await actorOf(ctx), opts);
    if (result.affected) {
      return { ok: true, data: { created: false, affectedCount: result.affected.length } };
    }
    void dispatchPendingNotifications().catch(() => {});
    revalidatePath("/admin/schedule");
    return { ok: true, data: { created: true, affectedCount: 0 } };
  } catch (e) {
    return toUserError(e);
  }
}

/** 一鍵複製某週的例外設定到另一週（週班表本身每週自動重複，複製對象為例外） */
export async function adminCopyWeekExceptions(
  fromWeekStart: string,
  toWeekStart: string,
): Promise<ActionResult<{ copied: number }>> {
  try {
    const ctx = requirePermission(await getStaffContext(), PERMISSIONS.SCHEDULE_WRITE);
    dateStrSchema.parse(fromWeekStart);
    dateStrSchema.parse(toWeekStart);
    if (fromWeekStart === toWeekStart) return { ok: false, message: "來源週與目標週相同" };
    const copied = await copyWeekExceptions(fromWeekStart, toWeekStart, await actorOf(ctx));
    revalidatePath("/admin/schedule");
    return { ok: true, data: { copied } };
  } catch (e) {
    return toUserError(e);
  }
}

export async function adminDeleteException(id: string): Promise<ActionResult> {
  try {
    const ctx = requirePermission(await getStaffContext(), PERMISSIONS.SCHEDULE_WRITE);
    await deleteScheduleException(id, await actorOf(ctx));
    revalidatePath("/admin/schedule");
    return { ok: true };
  } catch (e) {
    return toUserError(e);
  }
}

const templateSchema = z.object({
  id: z.string().optional(),
  weekday: z.number().int().min(0).max(6),
  session: z.enum(["MORNING", "AFTERNOON", "EVENING"]),
  startTime: slotTimeSchema,
  endTime: slotTimeSchema,
  doctorId: z.string().min(1),
  slotCapacity: z.number().int().min(1).max(10),
  allowOnline: z.boolean(),
  isActive: z.boolean(),
});

/** 受影響預約的前台顯示格式（例外與週班表共用同一組欄位） */
export interface AffectedRow {
  id: string;
  bookingNumber: string;
  date: string;
  time: string;
  patientName: string;
  phone: string;
}

type TemplateResult = ActionResult<{ applied: boolean; affected: AffectedRow[] }>;

/**
 * 改常態班表：比照單日例外，先列出會失去時段的既有預約。
 * 未帶 cancelAffected 時班表完全不動，只回傳名單交由櫃檯決定。
 */
export async function adminUpsertTemplate(
  input: z.infer<typeof templateSchema>,
  opts: { cancelAffected?: boolean; cancelReason?: string } = {},
): Promise<TemplateResult> {
  try {
    const ctx = requirePermission(await getStaffContext(), PERMISSIONS.SCHEDULE_WRITE);
    const parsed = templateSchema.parse(input);
    if (parsed.endTime <= parsed.startTime)
      return { ok: false, message: "結束時間需晚於開始時間" };
    return await runTemplateChange({ ...parsed }, ctx, opts);
  } catch (e) {
    return toUserError(e);
  }
}

export async function adminDeleteTemplate(
  id: string,
  opts: { cancelAffected?: boolean; cancelReason?: string } = {},
): Promise<TemplateResult> {
  try {
    const ctx = requirePermission(await getStaffContext(), PERMISSIONS.SCHEDULE_WRITE);
    const row = await prisma.weeklyScheduleTemplate.findUnique({ where: { id } });
    if (!row) return { ok: false, message: "查無此班表列" };
    return await runTemplateChange(
      {
        id: row.id,
        remove: true,
        weekday: row.weekday,
        session: row.session,
        startTime: row.startTime,
        endTime: row.endTime,
        doctorId: row.doctorId,
        slotCapacity: row.slotCapacity,
        allowOnline: row.allowOnline,
        isActive: row.isActive,
      },
      ctx,
      opts,
    );
  } catch (e) {
    return toUserError(e);
  }
}

async function runTemplateChange(
  change: TemplateChange,
  ctx: NonNullable<Awaited<ReturnType<typeof getStaffContext>>>,
  opts: { cancelAffected?: boolean; cancelReason?: string },
): Promise<TemplateResult> {
  const result = await applyTemplateChange(change, await actorOf(ctx), {
    ...opts,
    today: todayStr(),
  });
  if (result.affected) {
    return {
      ok: true,
      data: {
        applied: false,
        affected: result.affected.map((a) => ({
          id: a.id,
          bookingNumber: a.bookingNumber,
          date: dbToDate(a.appointmentDate),
          time: a.startTime,
          patientName: a.patient.name,
          phone: a.patient.phone,
        })),
      },
    };
  }
  void dispatchPendingNotifications().catch(() => {});
  revalidatePath("/admin/schedule");
  return { ok: true, data: { applied: true, affected: [] } };
}

export async function adminSetSlotBlocked(input: {
  doctorId: string;
  date: string;
  startTime: string;
  blocked: boolean;
  reason: string;
}): Promise<ActionResult<{ affectedCount: number }>> {
  try {
    const ctx = requirePermission(await getStaffContext(), PERMISSIONS.SCHEDULE_WRITE);
    if (!input.reason.trim()) return { ok: false, message: "請輸入原因" };
    const r = await setSlotBlocked(input, await actorOf(ctx));
    if (r.affected) return { ok: true, data: { affectedCount: r.affected.length } };
    revalidatePath("/admin/schedule");
    return { ok: true, data: { affectedCount: 0 } };
  } catch (e) {
    return toUserError(e);
  }
}

const slotCapacitySchema = z.object({
  doctorId: z.string().min(1),
  date: dateStrSchema,
  startTime: slotTimeSchema,
  capacity: z.number().int().min(0).max(10),
  reason: z.string().trim().min(1, "請輸入原因（手動加開名額必留紀錄）"),
});

export async function adminSetSlotCapacity(input: {
  doctorId: string;
  date: string;
  startTime: string;
  capacity: number;
  reason: string;
}): Promise<ActionResult> {
  try {
    const ctx = requirePermission(await getStaffContext(), PERMISSIONS.SCHEDULE_WRITE);
    // 手動加開的時段同樣要落在 30 分鐘格點上，否則會出現整點半點以外的名額
    const parsed = slotCapacitySchema.parse(input);
    await setSlotCapacity(parsed, await actorOf(ctx));
    revalidatePath("/admin/schedule");
    return { ok: true };
  } catch (e) {
    return toUserError(e);
  }
}

// ── 員工帳號（僅管理員） ───────────────────────────────

const staffUserSchema = z.object({
  username: z.string().trim().min(3).max(30).regex(/^[a-zA-Z0-9_.-]+$/, "帳號僅限英數字與 _ . -"),
  displayName: z.string().trim().min(1).max(30),
  password: z.string().min(10, "密碼至少 10 字元").optional(),
  roleCode: z.enum(["ADMIN", "STAFF", "DOCTOR_READONLY"]),
  doctorId: z.string().optional(),
  isActive: z.boolean().default(true),
});

export async function adminUpsertStaffUser(
  input: z.infer<typeof staffUserSchema> & { id?: string },
): Promise<ActionResult> {
  try {
    const ctx = requirePermission(await getStaffContext(), PERMISSIONS.STAFF_MANAGE);
    const parsed = staffUserSchema.parse(input);
    const role = await prisma.staffRole.upsert({
      where: { code: parsed.roleCode },
      create: {
        code: parsed.roleCode,
        name: parsed.roleCode,
        permissions: ROLE_PERMISSIONS[parsed.roleCode] ?? [],
      },
      update: {},
    });
    if (input.id) {
      const existing = await prisma.staffUser.findUnique({ where: { id: input.id } });
      if (!existing) return { ok: false, message: "查無此帳號" };
      if (existing.id === ctx.user.id && !parsed.isActive)
        return { ok: false, message: "不可停用自己目前登入的帳號" };
      await prisma.staffUser.update({
        where: { id: input.id },
        data: {
          displayName: parsed.displayName,
          roleId: role.id,
          doctorId: parsed.roleCode === "DOCTOR_READONLY" ? parsed.doctorId : null,
          isActive: parsed.isActive,
          ...(parsed.password ? { passwordHash: await bcrypt.hash(parsed.password, 12) } : {}),
        },
      });
      await writeAudit(await actorOf(ctx), "staff.update", { type: "staff_user", id: input.id }, {
        roleCode: parsed.roleCode,
        isActive: parsed.isActive,
        passwordChanged: !!parsed.password,
      });
    } else {
      if (!parsed.password) return { ok: false, message: "新帳號需設定密碼" };
      const created = await prisma.staffUser.create({
        data: {
          username: parsed.username,
          displayName: parsed.displayName,
          passwordHash: await bcrypt.hash(parsed.password, 12),
          roleId: role.id,
          doctorId: parsed.roleCode === "DOCTOR_READONLY" ? parsed.doctorId : null,
          isActive: parsed.isActive,
        },
      });
      await writeAudit(await actorOf(ctx), "staff.create", { type: "staff_user", id: created.id }, {
        roleCode: parsed.roleCode,
      });
    }
    revalidatePath("/admin/staff");
    return { ok: true };
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2002")
      return { ok: false, message: "此帳號名稱已存在" };
    return toUserError(e);
  }
}

/** 管理員為自己啟用 TOTP 兩步驟驗證 */
export async function adminSetupTotp(): Promise<ActionResult<{ otpauth: string }>> {
  try {
    const ctx = requirePermission(await getStaffContext(), PERMISSIONS.SETTINGS_MANAGE);
    const { otpauth, encrypted } = generateTotpSecret(ctx.user.username);
    await prisma.staffUser.update({
      where: { id: ctx.user.id },
      data: { totpSecret: encrypted, totpEnabled: false },
    });
    return { ok: true, data: { otpauth } };
  } catch (e) {
    return toUserError(e);
  }
}

export async function adminConfirmTotp(code: string): Promise<ActionResult> {
  try {
    const ctx = requirePermission(await getStaffContext(), PERMISSIONS.SETTINGS_MANAGE);
    const user = await verifyStaffTotp(ctx.user.id, code);
    if (!user) return { ok: false, message: "驗證碼錯誤，請確認驗證器 App 設定" };
    await prisma.staffUser.update({ where: { id: ctx.user.id }, data: { totpEnabled: true } });
    await writeAudit(await actorOf(ctx), "staff.totp_enable", { type: "staff_user", id: ctx.user.id });
    return { ok: true };
  } catch (e) {
    return toUserError(e);
  }
}

// ── 系統設定／門診類型／醫師（僅管理員） ─────────────────

/**
 * LINE 串接檢測：實際呼叫 LINE API 驗證憑證，
 * 讓診所填完金鑰後可立即確認，而不是等民眾預約才發現沒接上。
 */
export async function adminCheckLineSetup(): Promise<
  ActionResult<import("@/lib/line").LineSetupStatus>
> {
  try {
    const ctx = requirePermission(await getStaffContext(), PERMISSIONS.SETTINGS_MANAGE);
    const { checkLineSetup } = await import("@/lib/line");
    const status = await checkLineSetup();
    await writeAudit(await actorOf(ctx), "settings.line_check", undefined, {
      allPassed: status.checks.every((c) => c.ok),
    });
    return { ok: true, data: status };
  } catch (e) {
    return toUserError(e);
  }
}

export async function adminUpdateSettings(
  entries: { key: string; value: unknown }[],
): Promise<ActionResult> {
  try {
    const ctx = requirePermission(await getStaffContext(), PERMISSIONS.SETTINGS_MANAGE);
    for (const { key, value } of entries) {
      if (!(key in SETTING_DEFAULTS)) return { ok: false, message: `未知設定：${key}` };
      await setSetting(key as SettingKey, value, ctx.user.id);
    }
    await writeAudit(await actorOf(ctx), "settings.update", undefined, {
      entries: JSON.parse(JSON.stringify(entries)),
    });
    revalidatePath("/admin/settings");
    return { ok: true };
  } catch (e) {
    return toUserError(e);
  }
}

const clinicTypeSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1),
  description: z.string().trim().optional(),
  notice: z.string().trim().optional(),
  isActive: z.boolean(),
  requiresReview: z.boolean(),
  notifyLine: z.boolean(),
  skipOnPublicHoliday: z.boolean(),
  minAgeMonths: z.number().int().min(0).nullable(),
  maxAgeMonths: z.number().int().min(0).nullable(),
  allowedWeekdays: z.array(z.number().int().min(0).max(6)),
  allowedSessions: z.array(z.enum(["MORNING", "AFTERNOON", "EVENING"])),
  /** 逐日可預約時間窗；有值時取代 allowedWeekdays／allowedSessions */
  windows: z
    .array(
      z.object({
        weekday: z.number().int().min(0).max(6),
        startTime: slotTimeSchema,
        endTime: slotTimeSchema,
      }),
    )
    .default([])
    .refine((ws) => ws.every((w) => w.startTime < w.endTime), {
      message: "時間窗的結束時間必須晚於開始時間",
    })
    .refine(
      (ws) => new Set(ws.map((w) => `${w.weekday}|${w.startTime}`)).size === ws.length,
      { message: "同一天不可有兩段開始時間相同的時間窗" },
    ),
  doctorIds: z.array(z.string()),
  color: z.string(),
  icon: z.string(),
});

export async function adminUpdateClinicType(
  input: z.infer<typeof clinicTypeSchema>,
): Promise<ActionResult> {
  try {
    const ctx = requirePermission(await getStaffContext(), PERMISSIONS.SETTINGS_MANAGE);
    const parsed = clinicTypeSchema.parse(input);
    await prisma.$transaction(async (tx) => {
      await tx.clinicType.update({
        where: { id: parsed.id },
        data: {
          name: parsed.name,
          description: parsed.description,
          notice: parsed.notice,
          isActive: parsed.isActive,
          requiresReview: parsed.requiresReview,
          notifyLine: parsed.notifyLine,
          skipOnPublicHoliday: parsed.skipOnPublicHoliday,
          minAgeMonths: parsed.minAgeMonths,
          maxAgeMonths: parsed.maxAgeMonths,
          allowedWeekdays: parsed.allowedWeekdays,
          allowedSessions: parsed.allowedSessions,
          color: parsed.color,
          icon: parsed.icon,
        },
      });
      await tx.clinicTypeDoctor.deleteMany({ where: { clinicTypeId: parsed.id } });
      await tx.clinicTypeDoctor.createMany({
        data: parsed.doctorIds.map((doctorId) => ({ clinicTypeId: parsed.id, doctorId })),
      });
      await tx.clinicTypeWindow.deleteMany({ where: { clinicTypeId: parsed.id } });
      if (parsed.windows.length > 0) {
        await tx.clinicTypeWindow.createMany({
          data: parsed.windows.map((w) => ({ clinicTypeId: parsed.id, ...w })),
        });
      }
    });
    await writeAudit(await actorOf(ctx), "clinic_type.update", { type: "clinic_type", id: parsed.id });
    revalidatePath("/admin/settings");
    return { ok: true };
  } catch (e) {
    return toUserError(e);
  }
}

export async function adminUpsertDoctor(input: {
  id?: string;
  name: string;
  title?: string;
  isActive: boolean;
  displayOrder: number;
}): Promise<ActionResult> {
  try {
    const ctx = requirePermission(await getStaffContext(), PERMISSIONS.SETTINGS_MANAGE);
    if (!input.name.trim()) return { ok: false, message: "請輸入醫師姓名" };
    const row = input.id
      ? await prisma.doctor.update({
          where: { id: input.id },
          data: {
            name: input.name,
            title: input.title,
            isActive: input.isActive,
            displayOrder: input.displayOrder,
          },
        })
      : await prisma.doctor.create({
          data: {
            name: input.name,
            title: input.title,
            isActive: input.isActive,
            displayOrder: input.displayOrder,
          },
        });
    await writeAudit(await actorOf(ctx), input.id ? "doctor.update" : "doctor.create", {
      type: "doctor",
      id: row.id,
    });
    revalidatePath("/admin/settings");
    return { ok: true };
  } catch (e) {
    return toUserError(e);
  }
}
