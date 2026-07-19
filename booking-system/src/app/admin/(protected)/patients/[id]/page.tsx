import Link from "next/link";
import { notFound } from "next/navigation";
import { getStaffContext } from "@/lib/auth/staff";
import { PERMISSIONS, requirePermission, hasPermission } from "@/lib/auth/authz";
import { getPatientDetail } from "@/lib/admin-service";
import { dbToDate, formatDateTw } from "@/lib/tw-time";
import { Card, StatusBadge } from "@/components/ui";
import { ID_TYPE_LABEL } from "@/lib/status-labels";
import { PatientNoteForm, RevealIdButton, RestrictionControls } from "./patient-controls";

export const dynamic = "force-dynamic";
export const metadata = { title: "病人資料" };

export default async function PatientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = requirePermission(await getStaffContext(), PERMISSIONS.PATIENTS_READ);
  const { id } = await params;
  const patient = await getPatientDetail(id);
  if (!patient) notFound();

  const today = new Date();
  const upcoming = patient.appointments.filter(
    (a) => ["PENDING", "CONFIRMED", "CHECKED_IN"].includes(a.status) && a.appointmentDate >= new Date(today.toISOString().slice(0, 10)),
  );
  const past = patient.appointments.filter((a) => !upcoming.includes(a));
  const activeRestrictions = patient.restrictions.filter((r) => ["ACTIVE", "SUSPENDED"].includes(r.status));

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-forest-700">{patient.name}</h1>
        {activeRestrictions.length > 0 && (
          <span className="rounded-full bg-red-100 text-red-800 border border-red-300 px-3 py-1 text-sm font-bold">
            ⛔ 預約限制中
          </span>
        )}
        <Link href={`/admin/booking?patient=${patient.id}`} className="ml-auto btn-primary !py-2">
          代約
        </Link>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card className="space-y-1.5">
          <h2 className="font-bold text-forest-700 mb-1">基本資料</h2>
          <p>
            {ID_TYPE_LABEL[patient.idType]}：{patient.idNumberMasked}
            {hasPermission(ctx, PERMISSIONS.PII_FULL) && <RevealIdButton patientId={patient.id} />}
          </p>
          <p>出生日期：{dbToDate(patient.birthDate)}</p>
          <p>手機：{patient.phone}</p>
          <p>
            LINE 綁定：
            {patient.lineLinks.length > 0
              ? patient.lineLinks.map((l) => l.lineAccount.displayName ?? "已綁定").join("、")
              : "未綁定"}
          </p>
          <p>
            取消 {patient.cancelCount} 次｜
            <span className={patient.noShowCount > 0 ? "text-persimmon-600 font-bold" : ""}>
              未到 {patient.noShowCount} 次
            </span>
          </p>
        </Card>

        <Card>
          <h2 className="font-bold text-forest-700 mb-2">後台備註</h2>
          <PatientNoteForm patientId={patient.id} initialNote={patient.staffNote ?? ""} />
        </Card>
      </div>

      <RestrictionControls
        patientId={patient.id}
        restrictions={patient.restrictions.map((r) => ({
          id: r.id,
          type: r.type,
          status: r.status,
          reason: r.reason,
          createdAt: r.createdAt.toISOString().slice(0, 10),
          suspendedUntil: r.suspendedUntil?.toISOString().slice(0, 10) ?? null,
          liftReason: r.liftReason,
        }))}
        noShowCount={patient.noShowCount}
        canManage={hasPermission(ctx, PERMISSIONS.RESTRICTIONS_MANAGE)}
      />

      {patient.noShowRecords.length > 0 && (
        <Card>
          <h2 className="font-bold text-forest-700 mb-2">未到紀錄</h2>
          <ul className="divide-y divide-cream-200 text-sm">
            {patient.noShowRecords.map((r) => (
              <li key={r.id} className="py-2 flex flex-wrap gap-2">
                <span>{formatDateTw(dbToDate(r.appointment.appointmentDate))} {r.appointment.startTime}</span>
                <span className="text-stone-500">{r.appointment.bookingNumber}</span>
                {r.note && <span className="text-stone-500">{r.note}</span>}
                {r.revokedAt && <span className="text-forest-600">（已撤銷：{r.revokeReason}）</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <h2 className="font-bold text-forest-700 mb-2">未來預約</h2>
        {upcoming.length === 0 && <p className="text-stone-500">無</p>}
        <ul className="divide-y divide-cream-200">
          {upcoming.map((a) => (
            <li key={a.id} className="py-2 flex flex-wrap items-center gap-2">
              <span className="font-bold">{formatDateTw(dbToDate(a.appointmentDate))} {a.startTime}</span>
              <span>{a.doctor.name}醫師｜{a.clinicType.name}</span>
              <span className="text-stone-400 text-sm">{a.bookingNumber}</span>
              <span className="ml-auto"><StatusBadge status={a.status} /></span>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2 className="font-bold text-forest-700 mb-2">歷史預約</h2>
        {past.length === 0 && <p className="text-stone-500">無</p>}
        <ul className="divide-y divide-cream-200 text-sm">
          {past.slice(0, 30).map((a) => (
            <li key={a.id} className="py-1.5 flex flex-wrap items-center gap-2">
              <span>{formatDateTw(dbToDate(a.appointmentDate))} {a.startTime}</span>
              <span className="text-stone-600">{a.doctor.name}｜{a.clinicType.name}</span>
              <span className="ml-auto"><StatusBadge status={a.status} /></span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
