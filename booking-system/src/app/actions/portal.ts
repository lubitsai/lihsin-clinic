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
import { getPortalContext, destroyPortalSession, PORTAL_COOKIE } from "@/lib/auth/portal";
import { hashToken, hashIdNumber, randomBindingCode } from "@/lib/crypto";
import { resolveMergedPatient } from "@/lib/patients";
import { BINDING_CODE_TTL_MS } from "@/lib/line-binding";
import type { IdType } from "@prisma/client";
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

    /*
     * 既有病歷但尚未綁定此 LINE 帳號 → 擋下，請櫃檯核對後綁定
     * （院長 2026-08-15 裁示）。放行的話會產生一種半殘狀態：預約成立、
     * 但通知發不出去也不會出現在「查詢我的預約」，家長只會以為系統壞了；
     * 而若順手綁定，就等於讓知道證件號與生日的人冒用證件綁走病歷身分。
     */
    const link = await lookupLinkState(
      portal.lineAccountId,
      parsed.patient.idType,
      parsed.patient.idNumber,
    );
    if (link && !link.linked) {
      return {
        ok: false,
        message:
          "這位看診者的病歷已在本院建檔，但尚未與您的 LINE 綁定。" +
          `為保護病人資料，請攜帶健保卡到櫃檯完成綁定，或致電立欣診所 ${CLINIC.phone} 由櫃檯協助。`,
      };
    }

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
     * 自動綁定只認「這次交易新建的病歷」——沒有既有紀錄可外洩，綁定是安全的。
     * 同行家人也一併綁：那些病歷同樣是這個帳號剛建立的，不綁的話下次單獨替
     * 該位家人預約會被上面的檢查擋下，等於系統自己挖坑給家長跳。
     * 用引擎回傳的旗標而非事前查詢，是因為兩者之間可能被別的交易插隊建立同一筆。
     */
    for (const patientId of result.createdPatientIds) {
      await prisma.linePatientLink.create({
        data: { lineAccountId: portal.lineAccountId, patientId, verifiedAt: new Date() },
      });
    }
    const linked =
      !!link?.linked || result.createdPatientIds.includes(result.patient.id);

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

/**
 * 這個證件對應的病歷是否已綁定此 LINE 帳號。
 * 回傳 null＝本院查無此病歷（＝這次預約會新建，可自動綁定）。
 * 病歷若已被合併，以保留的那筆為準——否則舊證件號會被判定成「查無」而繞過檢查。
 */
async function lookupLinkState(
  lineAccountId: string,
  idType: IdType,
  idNumber: string,
): Promise<{ patientId: string; linked: boolean } | null> {
  const found = await prisma.patient.findUnique({
    where: { uniq_patient_identity: { idType, idNumberHash: hashIdNumber(idNumber) } },
  });
  if (!found) return null;
  const patient = await resolveMergedPatient(prisma, found);
  const link = await prisma.linePatientLink.findUnique({
    where: { lineAccountId_patientId: { lineAccountId, patientId: patient.id } },
  });
  return { patientId: patient.id, linked: !!link };
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

/**
 * 產生櫃檯綁定代碼（30 分鐘、一次性）。
 *
 * 民眾自己**不能**綁定既有病歷（院長 2026-08-15 裁示）——綁定等於取得該病人
 * 全部預約紀錄的讀取權，只憑填得出證件號、生日、手機就給，等於讓知道這三項的人
 * 冒用證件綁走病歷身分。這裡只發一組代碼，真正的關卡是櫃檯當面核對健保卡。
 *
 * 重新產生會作廢先前未使用的代碼：家長手上永遠只有一組有效的，
 * 唸錯或櫃檯輸錯時不會有兩組同時能用。
 */
export async function issueBindingCode(): Promise<
  ActionResult<{ code: string; expiresAt: string }>
> {
  try {
    const portal = await getPortalContext();
    if (!portal) return { ok: false, message: "請先以 LINE 登入" };
    if (!rateLimit(`bindcode:${portal.lineAccountId}`, 5, 10 * 60_000))
      return { ok: false, message: "產生次數過多，請稍後再試" };

    const code = randomBindingCode();
    const expiresAt = new Date(Date.now() + BINDING_CODE_TTL_MS);
    await prisma.$transaction([
      prisma.lineBindingCode.updateMany({
        where: { lineAccountId: portal.lineAccountId, consumedAt: null },
        data: { consumedAt: new Date() },
      }),
      prisma.lineBindingCode.create({
        data: { codeHash: hashToken(code), lineAccountId: portal.lineAccountId, expiresAt },
      }),
    ]);
    return { ok: true, data: { code, expiresAt: expiresAt.toISOString() } };
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
