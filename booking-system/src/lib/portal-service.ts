/**
 * 前台（民眾）資料查詢服務。
 * 重要：一律以「session 可存取的病人 id 清單」過濾，病人永遠看不到他人的預約。
 */
import { prisma } from "./db";

export async function listAppointmentsForPatients(patientIds: string[]) {
  if (patientIds.length === 0) return [];
  return prisma.appointment.findMany({
    where: { patientId: { in: patientIds } },
    include: { doctor: true, clinicType: true, patient: true },
    orderBy: [{ appointmentDate: "desc" }, { startTime: "desc" }],
    take: 50,
  });
}

/** 取得單筆預約——必須同時屬於此 session 的病人，否則回 null（不透露存在與否） */
export async function getAppointmentForPortal(appointmentId: string, patientIds: string[]) {
  if (patientIds.length === 0) return null;
  return prisma.appointment.findFirst({
    where: { id: appointmentId, patientId: { in: patientIds } },
    include: { doctor: true, clinicType: true, patient: true },
  });
}
