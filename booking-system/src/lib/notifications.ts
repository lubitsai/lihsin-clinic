/**
 * 通知模組：預約成立/異動/取消/提醒。
 * - 交易內僅「寫入 notifications 佇列」；實際發送於交易提交後執行，
 *   避免交易回滾卻已發出通知。
 * - 病人有 LINE 綁定（且仍為好友）→ LINE 推播；否則 → 簡訊。
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
import { getSmsProvider } from "./sms";
import { getSetting } from "./settings";
import { CLINIC } from "./clinic-info";

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
  const info = `${when}｜${doctor?.name ?? ""}醫師｜${clinicType?.name ?? ""}\n預約編號：${appt.bookingNumber}`;
  switch (type) {
    case "BOOKED":
      return `${base}您在${CLINIC.name}的預約已成立。\n${info}\n提醒：到櫃檯報到才算完成掛號，時段開始後保留 ${graceMinutes} 分鐘。如需取消或改期請至預約系統操作，或致電 ${CLINIC.phone}。`;
    case "MODIFIED":
      return `${base}您在${CLINIC.name}的預約已更改為：\n${info}\n如非本人操作請致電 ${CLINIC.phone}。`;
    case "CANCELLED":
      return `${base}您在${CLINIC.name}的預約（編號 ${appt.bookingNumber}）已取消。如需重新預約歡迎使用線上預約，或致電 ${CLINIC.phone}。`;
    case "REMINDER_DAY_BEFORE":
      // 目前是唯一一次提醒（當日提醒已關閉），故報到規則寫在這裡
      return (
        `${base}提醒您明天在${CLINIC.name}有預約。\n${info}\n` +
        `請於時段開始後 ${graceMinutes} 分鐘內到櫃檯報到並主動告知您有預約，逾時需重新抽現場號。\n` +
        `如無法前來，請提前線上取消或致電 ${CLINIC.phone}，以免影響後續預約權益。`
      );
    case "REMINDER_SAME_DAY":
      // 官網公告：時段開始後保留 N 分鐘，報到時要主動告知櫃檯（系統不會自動跳通知）
      return `${base}提醒您今天在${CLINIC.name}有預約。\n${info}\n請於時段開始後 ${graceMinutes} 分鐘內到櫃檯報到並主動告知您有預約，逾時需重新抽現場號。`;
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

  const viaLine = lineLink && isLineMessagingConfigured();
  await tx.notification.create({
    data: {
      patientId: patient.id,
      appointmentId: appt.id,
      channel: viaLine ? "LINE" : "SMS",
      type,
      recipient: viaLine ? lineLink.lineAccount.lineUserId : patient.phone,
      payload: { message: buildMessage(type, appt, patient.name, doctor, clinicType, grace) },
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
      if (n.channel === "LINE") {
        if (!isLineMessagingConfigured()) throw new Error("LINE Messaging 未設定");
        await pushLineMessage(n.recipient, message);
      } else {
        await getSmsProvider().send(n.recipient, message);
      }
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
    .map((a) => {
      const lineUserId = lineReady ? lineMap.get(a.patientId) : undefined;
      return {
        patientId: a.patientId,
        appointmentId: a.id,
        channel: (lineUserId ? "LINE" : "SMS") as NotificationChannel,
        type,
        recipient: lineUserId ?? a.patient.phone,
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
      };
    });
  if (rows.length === 0) return 0;
  await prisma.notification.createMany({ data: rows });
  return rows.length;
}
