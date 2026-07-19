"use server";

/**
 * 前台 server actions：所有輸入以 zod 驗證、所有規則由後端交易內強制。
 * 錯誤一律轉為使用者可讀訊息，不洩漏內部細節或個資存在與否。
 */
import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/db";
import { createAppointment, cancelAppointment, rescheduleAppointment } from "@/lib/booking";
import { getOpenDates, getDaySlotAvailability } from "@/lib/availability";
import { dispatchPendingNotifications } from "@/lib/notifications";
import { BookingError } from "@/lib/errors";
import { bookingRequestSchema, phoneSchema, dateStrSchema, timeStrSchema, idTypeSchema } from "@/lib/validation";
import {
  issueOtp,
  verifyOtp,
  createPortalSession,
  getPortalContext,
  destroyPortalSession,
  verifyPatientIdentity,
  PORTAL_COOKIE,
} from "@/lib/auth/portal";
import { listAppointmentsForPatients, getAppointmentForPortal } from "@/lib/portal-service";
import { maskPhone } from "@/lib/masking";
import { dbToDate } from "@/lib/tw-time";
import { rateLimit } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import { z } from "zod";

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; message: string };

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

function toUserError(e: unknown): { ok: false; message: string } {
  if (e instanceof BookingError) return { ok: false, message: e.userMessage };
  if (e instanceof z.ZodError)
    return { ok: false, message: e.issues[0]?.message ?? "輸入資料有誤，請重新確認" };
  console.error("[portal action]", e);
  return { ok: false, message: "系統忙碌中，請稍後再試，或致電立欣診所 (06) 251-6086" };
}

// ── 預約流程資料 ──────────────────────────────────────

export async function fetchClinicTypes() {
  const types = await prisma.clinicType.findMany({
    where: { isActive: true },
    orderBy: { displayOrder: "asc" },
    include: { doctors: { include: { doctor: true } } },
  });
  return types.map((t) => ({
    id: t.id,
    code: t.code,
    name: t.name,
    description: t.description,
    notice: t.notice,
    color: t.color,
    icon: t.icon,
    requiresReview: t.requiresReview,
    doctors: t.doctors
      .filter((d) => d.doctor.isActive)
      .map((d) => ({ id: d.doctor.id, name: d.doctor.name, title: d.doctor.title })),
  }));
}

export async function fetchOpenDates(clinicTypeId: string, doctorId?: string) {
  try {
    return { ok: true as const, data: await getOpenDates(clinicTypeId, doctorId) };
  } catch (e) {
    return toUserError(e);
  }
}

export async function fetchDaySlots(clinicTypeId: string, date: string, doctorId?: string) {
  try {
    dateStrSchema.parse(date);
    return { ok: true as const, data: await getDaySlotAvailability(date, clinicTypeId, doctorId) };
  } catch (e) {
    return toUserError(e);
  }
}

// ── OTP ──────────────────────────────────────────────

export async function requestBookingOtp(phone: string): Promise<ActionResult<{ devCode?: string }>> {
  try {
    const p = phoneSchema.parse(phone);
    if (!rateLimit(`otp-ip:${await clientIp()}`, 10, 10 * 60_000))
      return { ok: false, message: "請求過於頻繁，請稍後再試" };
    const { devCode } = await issueOtp(p, "BOOKING");
    return { ok: true, data: { devCode } };
  } catch (e) {
    return toUserError(e);
  }
}

// ── 送出預約 ──────────────────────────────────────────

const submitSchema = bookingRequestSchema.extend({ otpCode: z.string().optional() });

export async function submitBooking(
  input: z.infer<typeof submitSchema>,
): Promise<ActionResult<{ bookingNumber: string; status: string }>> {
  try {
    const parsed = submitSchema.parse(input);
    if (!rateLimit(`book-ip:${await clientIp()}`, 20, 10 * 60_000))
      return { ok: false, message: "請求過於頻繁，請稍後再試" };

    // 身分確認：LINE 已綁定此病人 → 免 OTP；否則需通過手機驗證碼
    const portal = await getPortalContext();
    let viaLine = false;
    if (portal?.lineAccountId) {
      const { hashIdNumber } = await import("@/lib/crypto");
      const existing = await prisma.patient.findUnique({
        where: {
          uniq_patient_identity: {
            idType: parsed.patient.idType,
            idNumberHash: hashIdNumber(parsed.patient.idNumber),
          },
        },
        include: { lineLinks: true },
      });
      viaLine = !!existing?.lineLinks.some((l) => l.lineAccountId === portal.lineAccountId);
    }
    if (!viaLine) {
      const okOtp =
        !!parsed.otpCode && (await verifyOtp(parsed.patient.phone, "BOOKING", parsed.otpCode));
      if (!okOtp) return { ok: false, message: "手機驗證碼錯誤或已過期，請重新取得驗證碼" };
    }

    const result = await createAppointment({
      clinicTypeId: parsed.clinicTypeId,
      doctorId: parsed.doctorId,
      date: parsed.date,
      startTime: parsed.startTime,
      patientInput: parsed.patient,
      source: portal?.lineAccountId ? "LINE" : "WEB",
      requestId: parsed.requestId,
      actor: { type: "PATIENT", ip: await clientIp() },
    });

    // LINE 登入且已通過 OTP：自動綁定此病人到 LINE 帳號（之後通知走 LINE）
    if (portal?.lineAccountId && !viaLine) {
      await prisma.linePatientLink.upsert({
        where: {
          lineAccountId_patientId: {
            lineAccountId: portal.lineAccountId,
            patientId: result.patient.id,
          },
        },
        create: {
          lineAccountId: portal.lineAccountId,
          patientId: result.patient.id,
          verifiedAt: new Date(),
        },
        update: {},
      });
    }

    void dispatchPendingNotifications().catch(() => {});
    return {
      ok: true,
      data: {
        bookingNumber: result.appointment.bookingNumber,
        status: result.appointment.status,
      },
    };
  } catch (e) {
    return toUserError(e);
  }
}

// ── 查詢／登入 ────────────────────────────────────────

const identityLoginSchema = z.object({
  idType: idTypeSchema,
  idNumber: z.string().trim().min(4).max(20),
  birthDate: dateStrSchema,
  phone: phoneSchema,
  otpCode: z.string().min(4).max(8),
});

export async function requestQueryOtp(phone: string): Promise<ActionResult<{ devCode?: string }>> {
  try {
    const p = phoneSchema.parse(phone);
    if (!rateLimit(`otp-ip:${await clientIp()}`, 10, 10 * 60_000))
      return { ok: false, message: "請求過於頻繁，請稍後再試" };
    const { devCode } = await issueOtp(p, "QUERY");
    return { ok: true, data: { devCode } };
  } catch (e) {
    return toUserError(e);
  }
}

export async function identityLogin(
  input: z.infer<typeof identityLoginSchema>,
): Promise<ActionResult> {
  try {
    const parsed = identityLoginSchema.parse(input);
    if (!rateLimit(`login-ip:${await clientIp()}`, 10, 10 * 60_000))
      return { ok: false, message: "請求過於頻繁，請稍後再試" };
    const okOtp = await verifyOtp(parsed.phone, "QUERY", parsed.otpCode);
    if (!okOtp) return { ok: false, message: "手機驗證碼錯誤或已過期" };
    const patientId = await verifyPatientIdentity(
      parsed.idType,
      parsed.idNumber,
      parsed.birthDate,
      parsed.phone,
    );
    const token = await createPortalSession({ patientId });
    (await cookies()).set(PORTAL_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 2 * 3600,
    });
    await writeAudit(
      { type: "PATIENT", id: patientId, ip: await clientIp() },
      "portal.identity_login",
      { type: "patient", id: patientId },
    );
    return { ok: true };
  } catch (e) {
    return toUserError(e);
  }
}

export async function portalLogout(): Promise<ActionResult> {
  await destroyPortalSession();
  (await cookies()).delete(PORTAL_COOKIE);
  return { ok: true };
}

export interface MyAppointmentDto {
  id: string;
  bookingNumber: string;
  date: string;
  startTime: string;
  doctorName: string;
  clinicTypeName: string;
  status: string;
  patientName: string;
  patientPhoneMasked: string;
  patientIdMasked: string;
  notice?: string | null;
  canCancel: boolean;
}

export async function fetchMyAppointments(): Promise<ActionResult<MyAppointmentDto[]>> {
  const portal = await getPortalContext();
  if (!portal || portal.patientIds.length === 0)
    return { ok: false, message: "請先完成身分驗證" };
  const rows = await listAppointmentsForPatients(portal.patientIds);
  return {
    ok: true,
    data: rows.map((a) => ({
      id: a.id,
      bookingNumber: a.bookingNumber,
      date: dbToDate(a.appointmentDate),
      startTime: a.startTime,
      doctorName: a.doctor.name,
      clinicTypeName: a.clinicType.name,
      status: a.status,
      patientName: a.patient.name,
      patientPhoneMasked: maskPhone(a.patient.phone),
      patientIdMasked: a.patient.idNumberMasked,
      notice: a.clinicType.notice,
      canCancel: a.status === "PENDING" || a.status === "CONFIRMED",
    })),
  };
}

export async function cancelMyAppointment(appointmentId: string): Promise<ActionResult> {
  try {
    const portal = await getPortalContext();
    if (!portal) return { ok: false, message: "請先完成身分驗證" };
    const appt = await getAppointmentForPortal(appointmentId, portal.patientIds);
    if (!appt) return { ok: false, message: "查無符合的預約資料，請確認輸入內容。" };
    await cancelAppointment({
      appointmentId: appt.id,
      actor: { type: "PATIENT", id: appt.patientId, ip: await clientIp() },
      byPatient: true,
    });
    void dispatchPendingNotifications().catch(() => {});
    return { ok: true };
  } catch (e) {
    return toUserError(e);
  }
}

export async function rescheduleMyAppointment(input: {
  appointmentId: string;
  newDate: string;
  newStartTime: string;
  newDoctorId: string;
}): Promise<ActionResult<{ bookingNumber: string }>> {
  try {
    dateStrSchema.parse(input.newDate);
    timeStrSchema.parse(input.newStartTime);
    const portal = await getPortalContext();
    if (!portal) return { ok: false, message: "請先完成身分驗證" };
    const appt = await getAppointmentForPortal(input.appointmentId, portal.patientIds);
    if (!appt) return { ok: false, message: "查無符合的預約資料，請確認輸入內容。" };
    const { newAppointment } = await rescheduleAppointment({
      appointmentId: appt.id,
      newDoctorId: input.newDoctorId,
      newDate: input.newDate,
      newStartTime: input.newStartTime,
      actor: { type: "PATIENT", id: appt.patientId, ip: await clientIp() },
      byPatient: true,
    });
    void dispatchPendingNotifications().catch(() => {});
    return { ok: true, data: { bookingNumber: newAppointment.bookingNumber } };
  } catch (e) {
    return toUserError(e);
  }
}

/** 目前登入狀態（前台頁首顯示） */
export async function fetchPortalStatus() {
  const portal = await getPortalContext();
  if (!portal) return { loggedIn: false as const, viaLine: false };
  return {
    loggedIn: true as const,
    viaLine: !!portal.lineAccountId,
    patientCount: portal.patientIds.length,
  };
}
