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
import { CLINIC } from "@/lib/clinic-info";
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
  return { ok: false, message: `系統忙碌中，請稍後再試，或致電立欣診所 ${CLINIC.phone}` };
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
    needsQuestionnaire: t.needsQuestionnaire,
    allowCompanions: t.allowCompanions,
    questionnaireUrl: t.questionnaireUrl,
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

// ── 送出預約 ──────────────────────────────────────────

export async function submitBooking(
  input: z.infer<typeof bookingRequestSchema>,
): Promise<ActionResult<{ bookingNumber: string; status: string; linked: boolean }>> {
  try {
    const parsed = bookingRequestSchema.parse(input);
    if (!rateLimit(`book-ip:${await clientIp()}`, 20, 10 * 60_000))
      return { ok: false, message: "請求過於頻繁，請稍後再試" };

    // 身分確認：一律要求 LINE 登入（院長 2026-08-13 裁示取消簡訊後，
    // 手機驗證碼沒有可送達的管道）。沒有 LINE 的家長改走電話或現場掛號。
    const portal = await getPortalContext();
    if (!portal) return { ok: false, message: "請先以 LINE 登入後再送出預約" };

    // 額度以「預約帳號」計（官網公告：每個預約帳號同時最多 2 筆）＝ LINE 帳號
    const result = await createAppointment({
      clinicTypeId: parsed.clinicTypeId,
      doctorId: parsed.doctorId,
      date: parsed.date,
      startTime: parsed.startTime,
      patientInput: parsed.patient,
      companions: parsed.companions,
      accountKey: `line:${portal.lineAccountId}`,
      source: "LINE",
      requestId: parsed.requestId,
      actor: { type: "PATIENT", ip: await clientIp() },
    });

    /*
     * 自動綁定的安全界線：綁定＝這個 LINE 帳號從此看得到該病人的所有預約紀錄，
     * 所以不能只因為「填得出證件號」就給。條件與 verifyPatientIdentity 同一把尺：
     * 生日與手機都要與病歷相符。
     *  - 新建立的病歷：兩者都是這次填的，必然相符，等同「沒有歷史可外洩」。
     *  - 既有病歷：生日不符在 upsertPatientForBooking 已被擋下；
     *    手機不符（例如家長換號）則此處不綁，改由櫃檯核對 patient_contacts 後處理。
     * 用交易回傳的病歷比對而非事前查詢，可一併涵蓋併發時剛被別人建立的情況。
     */
    const p = result.patient;
    const key = { lineAccountId: portal.lineAccountId, patientId: p.id };
    const alreadyLinked = !!(await prisma.linePatientLink.findUnique({
      where: { lineAccountId_patientId: key },
    }));
    const linked =
      alreadyLinked ||
      (dbToDate(p.birthDate) === parsed.patient.birthDate && p.phone === parsed.patient.phone);
    if (linked && !alreadyLinked) {
      await prisma.linePatientLink.create({ data: { ...key, verifiedAt: new Date() } });
    }

    void dispatchPendingNotifications().catch(() => {});
    return {
      ok: true,
      data: {
        bookingNumber: result.appointment.bookingNumber,
        status: result.appointment.status,
        linked,
      },
    };
  } catch (e) {
    return toUserError(e);
  }
}

// ── 登出 ──────────────────────────────────────────────

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
  if (!portal || portal.patientIds.length === 0) return { ok: false, message: "請先以 LINE 登入" };
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
    if (!portal) return { ok: false, message: "請先以 LINE 登入" };
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
    if (!portal) return { ok: false, message: "請先以 LINE 登入" };
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

// ── LINE 家庭成員綁定管理 ─────────────────────────────

export interface LineBindingDto {
  patientId: string;
  name: string;
  idNumberMasked: string;
  relation: string | null;
}

export async function fetchMyBindings(): Promise<ActionResult<LineBindingDto[]>> {
  const portal = await getPortalContext();
  if (!portal) return { ok: false, message: "請先以 LINE 登入" };
  const links = await prisma.linePatientLink.findMany({
    where: { lineAccountId: portal.lineAccountId },
    include: { patient: true },
    orderBy: { createdAt: "asc" },
  });
  return {
    ok: true,
    data: links.map((l) => ({
      patientId: l.patientId,
      name: l.patient.name,
      idNumberMasked: l.patient.idNumberMasked,
      relation: l.relation,
    })),
  };
}

const bindSchema = z.object({
  idType: idTypeSchema,
  idNumber: z.string().trim().min(4).max(20),
  birthDate: dateStrSchema,
  phone: phoneSchema,
  relation: z.string().trim().max(20).optional(),
});

/**
 * 綁定家庭成員：證件＋生日＋手機三者與病歷相符才建立。
 *
 * 綁定後這個 LINE 帳號就看得到該病人的所有預約，因此嚴格限流：
 * 同一 LINE 帳號 10 分鐘 5 次、同一 IP 10 分鐘 10 次。三項全對才算通過，
 * 任一不符一律回中性訊息（不透露該證件號是否為本院病人）。
 */
export async function bindFamilyMember(
  input: z.infer<typeof bindSchema>,
): Promise<ActionResult<LineBindingDto>> {
  try {
    const portal = await getPortalContext();
    if (!portal) return { ok: false, message: "請先以 LINE 登入" };
    const parsed = bindSchema.parse(input);
    if (
      !rateLimit(`bind:${portal.lineAccountId}`, 5, 10 * 60_000) ||
      !rateLimit(`bind-ip:${await clientIp()}`, 10, 10 * 60_000)
    )
      return { ok: false, message: "嘗試次數過多，請稍後再試" };
    const patientId = await verifyPatientIdentity(
      parsed.idType,
      parsed.idNumber,
      parsed.birthDate,
      parsed.phone,
    );
    const link = await prisma.linePatientLink.upsert({
      where: { lineAccountId_patientId: { lineAccountId: portal.lineAccountId, patientId } },
      create: {
        lineAccountId: portal.lineAccountId,
        patientId,
        relation: parsed.relation,
        verifiedAt: new Date(),
      },
      update: { relation: parsed.relation },
      include: { patient: true },
    });
    await writeAudit(
      { type: "PATIENT", id: patientId, ip: await clientIp() },
      "line.bind_patient",
      { type: "line_patient_link", id: link.id },
    );
    return {
      ok: true,
      data: {
        patientId,
        name: link.patient.name,
        idNumberMasked: link.patient.idNumberMasked,
        relation: link.relation,
      },
    };
  } catch (e) {
    return toUserError(e);
  }
}

export async function unbindFamilyMember(patientId: string): Promise<ActionResult> {
  try {
    const portal = await getPortalContext();
    if (!portal) return { ok: false, message: "請先以 LINE 登入" };
    const deleted = await prisma.linePatientLink.deleteMany({
      where: { lineAccountId: portal.lineAccountId, patientId },
    });
    if (deleted.count > 0) {
      await writeAudit(
        { type: "PATIENT", id: patientId, ip: await clientIp() },
        "line.unbind_patient",
        { type: "patient", id: patientId },
      );
    }
    return { ok: true };
  } catch (e) {
    return toUserError(e);
  }
}

/** 目前登入狀態（前台頁首顯示）；登入一律等於 LINE 登入 */
export async function fetchPortalStatus() {
  const portal = await getPortalContext();
  if (!portal) return { loggedIn: false as const, patientCount: 0 };
  return { loggedIn: true as const, patientCount: portal.patientIds.length };
}
