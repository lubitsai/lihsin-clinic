import { prisma } from "@/lib/db";
import { getStaffContext } from "@/lib/auth/staff";
import { PERMISSIONS, requirePermission } from "@/lib/auth/authz";
import { dbToDate } from "@/lib/tw-time";
import { StaffBookingForm } from "./booking-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "代客預約" };

export default async function StaffBookingPage({
  searchParams,
}: {
  searchParams: Promise<{ reschedule?: string; patient?: string }>;
}) {
  requirePermission(await getStaffContext(), PERMISSIONS.APPOINTMENTS_WRITE);
  const sp = await searchParams;

  const clinicTypes = await prisma.clinicType.findMany({
    orderBy: { displayOrder: "asc" },
    include: { doctors: { include: { doctor: true } } },
  });

  // 改期模式：帶入原預約
  let reschedule = null;
  if (sp.reschedule) {
    const appt = await prisma.appointment.findUnique({
      where: { id: sp.reschedule },
      include: { patient: true, doctor: true, clinicType: true },
    });
    if (appt) {
      reschedule = {
        id: appt.id,
        bookingNumber: appt.bookingNumber,
        date: dbToDate(appt.appointmentDate),
        startTime: appt.startTime,
        doctorName: appt.doctor.name,
        clinicTypeId: appt.clinicTypeId,
        clinicTypeName: appt.clinicType.name,
        patientName: appt.patient.name,
        status: appt.status,
      };
    }
  }

  // 由病人頁帶入病人
  let presetPatient = null;
  if (sp.patient) {
    const p = await prisma.patient.findUnique({ where: { id: sp.patient } });
    if (p) {
      presetPatient = {
        id: p.id,
        name: p.name,
        phone: p.phone,
        idNumberMasked: p.idNumberMasked,
        birthDate: dbToDate(p.birthDate),
        noShowCount: p.noShowCount,
      };
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-forest-700 mb-4">
        {reschedule ? "預約改期" : "代客預約"}
      </h1>
      <StaffBookingForm
        clinicTypes={clinicTypes.map((t) => ({
          id: t.id,
          name: t.name,
          doctors: t.doctors.filter((d) => d.doctor.isActive).map((d) => ({ id: d.doctorId, name: d.doctor.name })),
        }))}
        reschedule={reschedule}
        presetPatient={presetPatient}
      />
    </div>
  );
}
