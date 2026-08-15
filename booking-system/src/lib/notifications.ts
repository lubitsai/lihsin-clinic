/**
 * 通知模組：預約成立/異動/取消/提醒。
 * - 交易內僅「寫入 notifications 佇列」；實際發送於交易提交後執行，
 *   避免交易回滾卻已發出通知。
 * - 一律走 LINE 推播（院長 2026-08-13 裁示：取消簡訊、全部改 LINE）。
 *   沒有 LINE 綁定的病人（例如櫃檯電話代約）**不排入通知**——沒有可送達的管道，
 *   排進去只會變成一筆永遠失敗的紀錄。這種預約由櫃檯當場口頭告知。
 * - 內容一律不含完整證件號與敏感醫療資訊。
 */
import type {
  Appointment,
  ClinicType,
  Doctor,
  NotificationChannel,
  NotificationType,
  Patient,
} from "@prisma/client";
import { prisma, type Tx } from "./db";
import { dbToDate, formatDateTw } from "./tw-time";
import { pushLineMessage, isLineMessagingConfigured } from "./line";
import { getSetting } from "./settings";

import { CLINIC } from "./clinic-info";

/**
 * 組通知內容（LINE 推播）。
 *
 * 院長 2026-08-13 裁示取消簡訊後，這裡不再有「壓在 70 字內」的簡訊版本——
 * 那是為了簡訊按字計費（中文每則 70 字）才做的取捨。LINE 推播不按字計費，
 * 一律給完整版：醫師、門診別、報到規則與取消方式都寫清楚。
 */
function buildMessage(
  type: NotificationType,
  appt: Appointment,
  patientName: string,
  doctor: Doctor | null,
  clinicType: ClinicType | null,
  graceMinutes: number,
): string {
  const when = `${formatDateTw(dbToDate(appt.appointmentDate))} ${appt.startTime}`;
  const base = `${patientName} 您好，`;
  // 院長 2026-08-05：通知不放預約編號（家長用證件號＋生日查詢即可；編號僅供櫃檯內部使用）
  const info = `${when}｜${doctor?.name ?? ""}醫師｜${clinicType?.name ?? ""}`;
  const checkIn = `請於時段開始後 ${graceMinutes} 分鐘內到櫃檯報到並主動告知您有預約，逾時需重新抽現場號。`;

  switch (type) {
    case "BOOKED":
      return (
        `${base}您在${CLINIC.name}的預約已成立。\n${info}\n` +
        `提醒：到櫃檯報到才算完成掛號，時段開始後保留 ${graceMinutes} 分鐘。` +
        `如需取消或改期請至預約系統操作，或致電 ${CLINIC.phone}。`
      );
    case "MODIFIED":
      return `${base}您在${CLINIC.name}的預約已更改為：\n${info}\n如非本人操作請致電 ${CLINIC.phone}。`;
    case "CANCELLED":
      // 原本以預約編號指稱，改以日期時間——家長更容易對得起來
      return (
        `${base}您在${CLINIC.name} ${when} 的預約已取消。` +
        `如需重新預約歡迎使用線上預約，或致電 ${CLINIC.phone}。`
      );
    case "REMINDER_DAY_BEFORE":
      // 目前是唯一一次提醒（當日提醒已關閉），故報到規則寫在這裡
      return (
        `${base}提醒您明天在${CLINIC.name}有預約。\n${info}\n` +
        `${checkIn}\n如無法前來，請提前線上取消或致電 ${CLINIC.phone}，以免影響後續預約權益。`
      );
    case "REMINDER_SAME_DAY":
      return `${base}提醒您今天在${CLINIC.name}有預約。\n${info}\n${checkIn}`;
    case "CLINIC_NOTICE":
      return `${base}${CLINIC.name}門診異動通知，請留意您的預約。如有疑問請致電 ${CLINIC.phone}。`;
  }
}

/** 交易內排入通知佇列（doctor/clinicType/LINE 綁定一次平行查詢，縮短鎖持有時間） */
export async function enqueueAppointmentNotification(
  tx: Tx,
  type: NotificationType,
  appt: Appointment,
  patient: Patient,
) {
  const [doctor, clinicType, lineLink, grace] = await Promise.all([
    tx.doctor.findUnique({ where: { id: appt.doctorId } }),
    tx.clinicType.findUnique({ where: { id: appt.clinicTypeId } }),
    tx.linePatientLink.findFirst({
      where: { patientId: patient.id, lineAccount: { isFollowing: true } },
      include: { lineAccount: true },
      orderBy: { createdAt: "desc" },
    }),
    getSetting("booking.checkin_grace_minutes", tx),
  ]);
  if (clinicType && !clinicType.notifyLine && type !== "CANCELLED") return;

  // 沒有 LINE 綁定（或 LINE 未設定）就沒有送得出去的管道，直接不排入。
  // 線上預約一律經 LINE 登入、成立時即綁定，所以這裡會落空的多半是櫃檯代約。
  if (!lineLink || !isLineMessagingConfigured()) return;

  await tx.notification.create({
    data: {
      patientId: patient.id,
      appointmentId: appt.id,
      channel: "LINE",
      type,
      recipient: lineLink.lineAccount.lineUserId,
      payload: {
        message: buildMessage(type, appt, patient.name, doctor, clinicType, grace),
      },
    },
  });
}

/**
 * 交易外發送所有待送通知（server action 於交易提交後呼叫；亦可由排程呼叫）。
 * 發送前以 updateMany(PENDING→SENT) 原子認領該列，
 * 避免多個並發 dispatcher 重複發送同一則通知。
 */
export async function dispatchPendingNotifications(limit = 50): Promise<number> {
  const pending = await prisma.notification.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  let sent = 0;
  for (const n of pending) {
    const claimed = await prisma.notification.updateMany({
      where: { id: n.id, status: "PENDING" },
      data: { status: "SENT", sentAt: new Date() },
    });
    if (claimed.count === 0) continue; // 已被其他 dispatcher 認領

    const message = (n.payload as { message?: string })?.message ?? "";
    try {
      if (n.type === "REMINDER_SAME_DAY" && !(await getSetting("notify.same_day_reminder"))) {
        await prisma.notification.update({
          where: { id: n.id },
          data: { status: "SKIPPED", sentAt: null },
        });
        continue;
      }
      if (!isLineMessagingConfigured()) throw new Error("LINE Messaging 未設定");
      await pushLineMessage(n.recipient, message);
      sent++;
    } catch (e) {
      await prisma.notification.update({
        where: { id: n.id },
        data: { status: "FAILED", sentAt: null, error: e instanceof Error ? e.message : String(e) },
      });
    }
  }
  return sent;
}

/**
 * 提醒排程（scripts/send-reminders.ts 每日呼叫）：為指定日期的有效預約排入提醒。
 * 以批次查詢＋createMany 完成：查詢次數與預約筆數無關，
 * 避免忙日（上百筆預約）在單一交易內累積數百次查詢而撞上交易逾時、整批提醒不送。
 */
export async function enqueueReminders(
  forDate: string,
  type: "REMINDER_DAY_BEFORE" | "REMINDER_SAME_DAY",
) {
  if (type === "REMINDER_SAME_DAY") {
    const on = await getSetting("notify.same_day_reminder");
    if (!on) return 0;
  }
  const appts = await prisma.appointment.findMany({
    where: {
      appointmentDate: new Date(`${forDate}T00:00:00Z`),
      status: { in: ["PENDING", "CONFIRMED"] },
      notifications: { none: { type } }, // 避免重複排入
    },
    include: { patient: true },
  });
  if (appts.length === 0) return 0;

  const [doctors, clinicTypes, lineLinks, grace] = await Promise.all([
    prisma.doctor.findMany(),
    prisma.clinicType.findMany(),
    prisma.linePatientLink.findMany({
      where: {
        patientId: { in: [...new Set(appts.map((a) => a.patientId))] },
        lineAccount: { isFollowing: true },
      },
      include: { lineAccount: true },
      orderBy: { createdAt: "desc" },
    }),
    getSetting("booking.checkin_grace_minutes"),
  ]);
  const doctorMap = new Map(doctors.map((d) => [d.id, d]));
  const clinicTypeMap = new Map(clinicTypes.map((c) => [c.id, c]));
  const lineMap = new Map<string, string>();
  for (const l of lineLinks) {
    if (!lineMap.has(l.patientId)) lineMap.set(l.patientId, l.lineAccount.lineUserId);
  }
  const lineReady = isLineMessagingConfigured();

  const rows = appts
    .filter((a) => clinicTypeMap.get(a.clinicTypeId)?.notifyLine !== false)
    .map((a) => ({ appt: a, lineUserId: lineReady ? lineMap.get(a.patientId) : undefined }))
    // 沒有 LINE 綁定就送不出去（多為櫃檯代約），不排入佇列
    .filter((x): x is { appt: (typeof appts)[number]; lineUserId: string } => !!x.lineUserId)
    .map(({ appt: a, lineUserId }) => ({
      patientId: a.patientId,
      appointmentId: a.id,
      channel: "LINE" as NotificationChannel,
      type,
      recipient: lineUserId,
      payload: {
        message: buildMessage(
          type,
          a,
          a.patient.name,
          doctorMap.get(a.doctorId) ?? null,
          clinicTypeMap.get(a.clinicTypeId) ?? null,
          grace,
        ),
      },
    }));
  if (rows.length === 0) return 0;
  await prisma.notification.createMany({ data: rows });
  return rows.length;
}
