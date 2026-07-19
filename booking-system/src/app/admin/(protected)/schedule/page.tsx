import { prisma } from "@/lib/db";
import { getStaffContext } from "@/lib/auth/staff";
import { PERMISSIONS, requirePermission } from "@/lib/auth/authz";
import { dbToDate, todayStr } from "@/lib/tw-time";
import { ScheduleManager } from "./schedule-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "排班管理" };

export default async function SchedulePage() {
  requirePermission(await getStaffContext(), PERMISSIONS.SCHEDULE_WRITE);
  const [templates, exceptions, doctors, clinicTypes] = await Promise.all([
    prisma.weeklyScheduleTemplate.findMany({
      orderBy: [{ weekday: "asc" }, { startTime: "asc" }],
      include: { doctor: true },
    }),
    prisma.scheduleException.findMany({
      where: { date: { gte: new Date(`${todayStr()}T00:00:00Z`) } },
      orderBy: { date: "asc" },
    }),
    prisma.doctor.findMany({ where: { isActive: true }, orderBy: { displayOrder: "asc" } }),
    prisma.clinicType.findMany({ orderBy: { displayOrder: "asc" } }),
  ]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-forest-700">排班管理</h1>
      <ScheduleManager
        templates={templates.map((t) => ({
          id: t.id,
          weekday: t.weekday,
          session: t.session,
          startTime: t.startTime,
          endTime: t.endTime,
          doctorId: t.doctorId,
          doctorName: t.doctor.name,
          slotCapacity: t.slotCapacity,
          allowOnline: t.allowOnline,
          isActive: t.isActive,
        }))}
        exceptions={exceptions.map((e) => ({
          id: e.id,
          date: dbToDate(e.date),
          type: e.type,
          session: e.session,
          doctorId: e.doctorId,
          substituteDoctorId: e.substituteDoctorId,
          startTime: e.startTime,
          endTime: e.endTime,
          reason: e.reason,
        }))}
        doctors={doctors.map((d) => ({ id: d.id, name: d.name }))}
        clinicTypes={clinicTypes.map((t) => ({ id: t.id, name: t.name }))}
      />
    </div>
  );
}
