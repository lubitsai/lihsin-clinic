import Link from "next/link";
import { getStaffContext } from "@/lib/auth/staff";
import { PERMISSIONS } from "@/lib/auth/authz";
import { getDayAppointments, type DayBoardFilters } from "@/lib/admin-service";
import { getStaffDayOverview } from "@/lib/availability";
import { prisma } from "@/lib/db";
import { todayStr, addDays, formatDateTw } from "@/lib/tw-time";
import { Card } from "@/components/ui";
import { DayBoard } from "./day-board";
import type { AppointmentStatus, SessionPeriod } from "@prisma/client";

export const dynamic = "force-dynamic";

interface SearchParams {
  date?: string;
  session?: string;
  doctor?: string;
  type?: string;
  status?: string;
  q?: string;
}

export default async function AdminDashboard({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = (await getStaffContext())!;
  const sp = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : todayStr();

  // 醫師唯讀帳號：僅能看自己的預約、無操作權
  const isDoctorReadonly =
    ctx.permissions.has(PERMISSIONS.DOCTOR_SELF_READ) &&
    !ctx.permissions.has(PERMISSIONS.APPOINTMENTS_WRITE);
  const forcedDoctorId = isDoctorReadonly ? (ctx.user.doctorId ?? "none") : undefined;

  const filters: DayBoardFilters = {
    session: (["MORNING", "AFTERNOON", "EVENING"] as const).includes(sp.session as SessionPeriod)
      ? (sp.session as SessionPeriod)
      : undefined,
    doctorId: forcedDoctorId ?? (sp.doctor || undefined),
    clinicTypeId: sp.type || undefined,
    status: (sp.status as AppointmentStatus) || undefined,
    q: sp.q || undefined,
  };

  const [appointments, overview, doctors, clinicTypes] = await Promise.all([
    getDayAppointments(date, filters),
    getStaffDayOverview(date),
    prisma.doctor.findMany({ where: { isActive: true }, orderBy: { displayOrder: "asc" } }),
    prisma.clinicType.findMany({ orderBy: { displayOrder: "asc" } }),
  ]);

  const qs = (patch: Record<string, string>) => {
    const params = new URLSearchParams({ ...(sp as Record<string, string>), ...patch });
    for (const [k, v] of [...params.entries()]) if (!v) params.delete(k);
    return `/admin?${params.toString()}`;
  };

  return (
    <div className="space-y-4">
      {/* 日期導覽與統計 */}
      <div className="flex flex-wrap items-center gap-3 no-print">
        <div className="flex items-center gap-1">
          <Link href={qs({ date: addDays(date, -1) })} className="btn-secondary !px-3 !py-2">
            ← 前一天
          </Link>
          <Link href={qs({ date: todayStr() })} className="btn-secondary !px-3 !py-2">
            今天
          </Link>
          <Link href={qs({ date: addDays(date, 1) })} className="btn-secondary !px-3 !py-2">
            下一天 →
          </Link>
        </div>
        <form className="flex items-center gap-1" action="/admin" method="get">
          <input type="date" name="date" defaultValue={date} className="input !w-auto !py-2" />
          <button className="btn-secondary !px-3 !py-2">前往</button>
        </form>
        <h1 className="text-xl font-bold text-forest-700 ml-auto">{formatDateTw(date)}</h1>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 no-print">
        {overview.map((o) => (
          <Card key={o.doctor.id} className="!p-3 text-center">
            <p className="font-bold text-forest-700">{o.doctor.name}醫師</p>
            <p className="text-2xl font-bold text-stone-800">
              {o.booked}
              <span className="text-base font-normal text-stone-500">／{o.total} 名</span>
            </p>
            <p className="text-sm text-stone-500">剩餘 {Math.max(0, o.total - o.booked)}</p>
          </Card>
        ))}
        {overview.length === 0 && (
          <Card className="!p-3 col-span-2 text-center text-stone-500">本日休診或未排班</Card>
        )}
      </div>

      <DayBoard
        date={date}
        appointments={appointments.map((a) => ({
          // 僅送出畫面需要的欄位——完整病人列（含證件密文/雜湊）不得進入 RSC payload
          id: a.id,
          bookingNumber: a.bookingNumber,
          startTime: a.startTime,
          status: a.status,
          source: a.source,
          visitType: a.visitType,
          patientNote: a.patientNote,
          staffNote: a.staffNote,
          doctorId: a.doctorId,
          doctor: { name: a.doctor.name },
          clinicType: { name: a.clinicType.name, color: a.clinicType.color },
          patient: {
            id: a.patient.id,
            name: a.patient.name,
            phone: a.patient.phone,
            idNumberMasked: a.patient.idNumberMasked,
            noShowCount: a.patient.noShowCount,
            staffNote: a.patient.staffNote,
            restrictions: a.patient.restrictions.map((r) => ({ id: r.id })),
          },
        }))}
        doctors={doctors.map((d) => ({ id: d.id, name: d.name }))}
        clinicTypes={clinicTypes.map((t) => ({ id: t.id, name: t.name, color: t.color }))}
        filters={{
          session: sp.session ?? "",
          doctor: forcedDoctorId ?? (sp.doctor ?? ""),
          type: sp.type ?? "",
          status: sp.status ?? "",
          q: sp.q ?? "",
        }}
        canWrite={ctx.permissions.has(PERMISSIONS.APPOINTMENTS_WRITE)}
        doctorLocked={isDoctorReadonly}
      />
    </div>
  );
}
