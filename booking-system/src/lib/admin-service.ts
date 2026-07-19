/** 後台查詢服務（server component 直接呼叫；權限檢查在頁面/action 層） */
import { prisma } from "./db";
import { dateToDb } from "./tw-time";
import type { AppointmentStatus, Prisma, SessionPeriod } from "@prisma/client";
import { hashIdNumber } from "./crypto";

export interface DayBoardFilters {
  session?: SessionPeriod;
  doctorId?: string;
  clinicTypeId?: string;
  status?: AppointmentStatus;
  q?: string; // 姓名/電話/證件末碼/預約編號
}

export async function getDayAppointments(date: string, filters: DayBoardFilters = {}) {
  const where: Prisma.AppointmentWhereInput = {
    appointmentDate: dateToDb(date),
    ...(filters.doctorId ? { doctorId: filters.doctorId } : {}),
    ...(filters.clinicTypeId ? { clinicTypeId: filters.clinicTypeId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
  };
  if (filters.session) {
    const range =
      filters.session === "MORNING"
        ? { lt: "13:00" }
        : filters.session === "AFTERNOON"
          ? { gte: "13:00", lt: "18:00" }
          : { gte: "18:00" };
    where.startTime = range;
  }
  if (filters.q) {
    const q = filters.q.trim();
    where.OR = [
      { patient: { name: { contains: q } } },
      { patient: { phone: { contains: q } } },
      { patient: { idNumberMasked: { endsWith: q } } },
      { bookingNumber: { contains: q.toUpperCase() } },
    ];
  }
  return prisma.appointment.findMany({
    where,
    include: {
      patient: {
        include: { restrictions: { where: { status: { in: ["ACTIVE", "SUSPENDED"] } } } },
      },
      doctor: true,
      clinicType: true,
    },
    orderBy: [{ startTime: "asc" }, { doctorId: "asc" }],
  });
}

export async function searchPatients(q: string, byIdNumber = false) {
  const query = q.trim();
  if (!query) return [];
  if (byIdNumber) {
    // 完整證件號查詢：以雜湊比對，不掃描明文
    return prisma.patient.findMany({
      where: { idNumberHash: hashIdNumber(query) },
      take: 20,
    });
  }
  return prisma.patient.findMany({
    where: {
      OR: [
        { name: { contains: query } },
        { phone: { contains: query } },
        { idNumberMasked: { endsWith: query } },
      ],
      mergedIntoId: null,
    },
    orderBy: { updatedAt: "desc" },
    take: 30,
  });
}

export async function getPatientDetail(patientId: string) {
  return prisma.patient.findUnique({
    where: { id: patientId },
    include: {
      appointments: {
        include: { doctor: true, clinicType: true },
        orderBy: [{ appointmentDate: "desc" }, { startTime: "desc" }],
        take: 50,
      },
      noShowRecords: { orderBy: { createdAt: "desc" }, include: { appointment: true } },
      restrictions: { orderBy: { createdAt: "desc" } },
      lineLinks: { include: { lineAccount: true } },
      contacts: true,
    },
  });
}

/** 可能重複的病歷：同姓名＋同生日，或同電話＋同生日（不同證件號） */
export async function findPossibleDuplicates() {
  const rows = await prisma.$queryRaw<{ id_a: string; id_b: string; reason: string }[]>`
    SELECT a.id AS id_a, b.id AS id_b, 'same_name_birth' AS reason
    FROM patients a JOIN patients b
      ON a.id < b.id AND a.name = b.name AND a.birth_date = b.birth_date
    WHERE a.merged_into_id IS NULL AND b.merged_into_id IS NULL
    UNION
    SELECT a.id, b.id, 'same_phone_birth'
    FROM patients a JOIN patients b
      ON a.id < b.id AND a.phone = b.phone AND a.birth_date = b.birth_date
         AND a.id_number_hash <> b.id_number_hash
    WHERE a.merged_into_id IS NULL AND b.merged_into_id IS NULL
    LIMIT 50`;
  if (rows.length === 0) return [];
  const ids = [...new Set(rows.flatMap((r) => [r.id_a, r.id_b]))];
  const patients = await prisma.patient.findMany({ where: { id: { in: ids } } });
  const map = new Map(patients.map((p) => [p.id, p]));
  return rows
    .map((r) => ({ a: map.get(r.id_a), b: map.get(r.id_b), reason: r.reason }))
    .filter((r) => r.a && r.b) as { a: (typeof patients)[0]; b: (typeof patients)[0]; reason: string }[];
}

export async function listRestrictions() {
  return prisma.bookingRestriction.findMany({
    include: { patient: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function listStaffUsers() {
  return prisma.staffUser.findMany({
    include: { role: true, doctor: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function listAuditLogs(opts: { page?: number; action?: string } = {}) {
  const page = opts.page ?? 1;
  const pageSize = 50;
  return prisma.auditLog.findMany({
    where: opts.action ? { action: { contains: opts.action } } : {},
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
  });
}

export async function listNotifications(appointmentId?: string) {
  return prisma.notification.findMany({
    where: appointmentId ? { appointmentId } : {},
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}
