/**
 * 通知模組：預約成立/異動/取消/提醒。
 * - 交易內僅「寫入 notifications 佇列」；實際發送於交易提交後執行，
 *   避免交易回滾卻已發出通知。
 * - 病人有 LINE 綁定（且仍為好友）→ LINE 推播；否則 → 簡訊。
 * - 內容一律不含完整證件號與敏感醫療資訊。
 */
import type { Appointment, NotificationType, Patient } from "@prisma/client";
import { prisma, type Tx } from "./db";
import { dbToDate, formatDateTw } from "./tw-time";
import { pushLineMessage, isLineMessagingConfigured } from "./line";
import { getSmsProvider } from "./sms";
import { getSetting } from "./settings";

const CLINIC_NAME = "立欣診所";
const CLINIC_PHONE = "(06) 251-6086";

async function buildMessage(
  tx: Tx,
  type: NotificationType,
  appt: Appointment,
  patientName: string,
): Promise<string> {
  const [doctor, clinicType] = await Promise.all([
    tx.doctor.findUnique({ where: { id: appt.doctorId } }),
    tx.clinicType.findUnique({ where: { id: appt.clinicTypeId } }),
  ]);
  const when = `${formatDateTw(dbToDate(appt.appointmentDate))} ${appt.startTime}`;
  const base = `${patientName} 您好，`;
  const info = `${when}｜${doctor?.name ?? ""}醫師｜${clinicType?.name ?? ""}\n預約編號：${appt.bookingNumber}`;
  switch (type) {
    case "BOOKED":
      return `${base}您在${CLINIC_NAME}的預約已成立。\n${info}\n提醒：線上預約不等於實際看診號碼，請依現場狀況候診。如需取消或改期請至預約系統操作，或致電 ${CLINIC_PHONE}。`;
    case "MODIFIED":
      return `${base}您在${CLINIC_NAME}的預約已更改為：\n${info}\n如非本人操作請致電 ${CLINIC_PHONE}。`;
    case "CANCELLED":
      return `${base}您在${CLINIC_NAME}的預約（編號 ${appt.bookingNumber}）已取消。如需重新預約歡迎使用線上預約，或致電 ${CLINIC_PHONE}。`;
    case "REMINDER_DAY_BEFORE":
      return `${base}提醒您明天在${CLINIC_NAME}有預約。\n${info}\n如無法前來，請提前線上取消或致電 ${CLINIC_PHONE}，以免影響後續預約權益。`;
    case "REMINDER_SAME_DAY":
      return `${base}提醒您今天在${CLINIC_NAME}有預約。\n${info}\n請提早報到，依現場狀況候診。`;
    case "CLINIC_NOTICE":
      return `${base}${CLINIC_NAME}門診異動通知，請留意您的預約。如有疑問請致電 ${CLINIC_PHONE}。`;
  }
}

/** 找出病人偏好的通知管道：LINE（已綁定且好友）優先，否則簡訊 */
async function resolveChannel(
  tx: Tx,
  patientId: string,
  phone: string,
): Promise<{ channel: "LINE" | "SMS"; recipient: string }> {
  const link = await tx.linePatientLink.findFirst({
    where: { patientId, lineAccount: { isFollowing: true } },
    include: { lineAccount: true },
    orderBy: { createdAt: "desc" },
  });
  if (link && isLineMessagingConfigured()) {
    return { channel: "LINE", recipient: link.lineAccount.lineUserId };
  }
  return { channel: "SMS", recipient: phone };
}

/** 交易內排入通知佇列 */
export async function enqueueAppointmentNotification(
  tx: Tx,
  type: NotificationType,
  appt: Appointment,
  patient: Patient,
) {
  const clinicType = await tx.clinicType.findUnique({ where: { id: appt.clinicTypeId } });
  if (clinicType && !clinicType.notifyLine && type !== "CANCELLED") return;
  const { channel, recipient } = await resolveChannel(tx, patient.id, patient.phone);
  const message = await buildMessage(tx, type, appt, patient.name);
  await tx.notification.create({
    data: {
      patientId: patient.id,
      appointmentId: appt.id,
      channel,
      type,
      recipient,
      payload: { message },
    },
  });
}

/** 交易外發送所有待送通知（server action 於交易提交後呼叫；亦可由排程呼叫） */
export async function dispatchPendingNotifications(limit = 50): Promise<number> {
  const pending = await prisma.notification.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  let sent = 0;
  for (const n of pending) {
    const message = (n.payload as { message?: string })?.message ?? "";
    try {
      if (n.channel === "LINE") {
        if (!isLineMessagingConfigured()) throw new Error("LINE Messaging 未設定");
        await pushLineMessage(n.recipient, message);
      } else {
        const sameDayOn = await getSetting("notify.same_day_reminder");
        if (n.type === "REMINDER_SAME_DAY" && !sameDayOn) {
          await prisma.notification.update({
            where: { id: n.id },
            data: { status: "SKIPPED" },
          });
          continue;
        }
        await getSmsProvider().send(n.recipient, message);
      }
      await prisma.notification.update({
        where: { id: n.id },
        data: { status: "SENT", sentAt: new Date() },
      });
      sent++;
    } catch (e) {
      await prisma.notification.update({
        where: { id: n.id },
        data: { status: "FAILED", error: e instanceof Error ? e.message : String(e) },
      });
    }
  }
  return sent;
}

/** 提醒排程（scripts/send-reminders.ts 每日呼叫）：為指定日期的有效預約排入提醒 */
export async function enqueueReminders(forDate: string, type: "REMINDER_DAY_BEFORE" | "REMINDER_SAME_DAY") {
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
  let count = 0;
  await prisma.$transaction(async (tx) => {
    for (const appt of appts) {
      await enqueueAppointmentNotification(tx, type, appt, appt.patient);
      count++;
    }
  });
  return count;
}
