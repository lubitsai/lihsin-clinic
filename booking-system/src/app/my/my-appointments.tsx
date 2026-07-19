"use client";

/** 我的預約清單：取消／改期（改期沿用可預約時段查詢，單一交易於後端完成） */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  cancelMyAppointment,
  rescheduleMyAppointment,
  fetchOpenDates,
  fetchDaySlots,
  portalLogout,
  type MyAppointmentDto,
} from "@/app/actions/portal";
import { Card, StatusBadge, Alert } from "@/components/ui";
import { formatDateTw } from "@/lib/tw-time";
import type { AppointmentStatus } from "@prisma/client";

interface ClinicTypeDto {
  id: string;
  name: string;
}

export function MyAppointments({
  initial,
  clinicTypes,
}: {
  initial: MyAppointmentDto[];
  clinicTypes: ClinicTypeDto[];
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [rescheduling, setRescheduling] = useState<MyAppointmentDto | null>(null);
  const [pending, startTransition] = useTransition();

  const cancel = (a: MyAppointmentDto) => {
    if (!window.confirm(`確定要取消 ${formatDateTw(a.date)} ${a.startTime} 的預約嗎？`)) return;
    startTransition(async () => {
      const r = await cancelMyAppointment(a.id);
      if (!r.ok) return setError(r.message);
      setMessage("預約已取消，已發送通知。");
      setError("");
      router.refresh();
    });
  };

  const upcoming = initial.filter((a) => ["PENDING", "CONFIRMED"].includes(a.status));
  const history = initial.filter((a) => !["PENDING", "CONFIRMED"].includes(a.status));

  return (
    <div className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      {message && <Alert tone="success">{message}</Alert>}

      {rescheduling ? (
        <RescheduleFlow
          appointment={rescheduling}
          clinicTypes={clinicTypes}
          onDone={(msg) => {
            setRescheduling(null);
            setMessage(msg);
            router.refresh();
          }}
          onCancel={() => setRescheduling(null)}
          onError={setError}
        />
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="font-bold text-forest-700 text-lg">即將到來的預約</h2>
            {upcoming.length === 0 && <p className="text-stone-600">目前沒有有效預約。</p>}
            {upcoming.map((a) => (
              <Card key={a.id} className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-bold text-lg text-stone-800">
                      {formatDateTw(a.date)} {a.startTime}
                    </p>
                    <p className="text-stone-700">
                      {a.doctorName}醫師｜{a.clinicTypeName}
                    </p>
                    <p className="text-sm text-stone-500 mt-1">
                      病人：{a.patientName}（{a.patientIdMasked}）
                    </p>
                    <p className="text-sm text-stone-500">預約編號：{a.bookingNumber}</p>
                  </div>
                  <StatusBadge status={a.status as AppointmentStatus} />
                </div>
                {a.notice && <p className="text-sm text-amber-800 bg-amber-50 rounded-lg px-3 py-2">{a.notice}</p>}
                {a.canCancel && (
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => setRescheduling(a)}
                      disabled={pending}
                      className="btn-secondary flex-1"
                    >
                      改期
                    </button>
                    <button onClick={() => cancel(a)} disabled={pending} className="btn-danger flex-1">
                      取消預約
                    </button>
                  </div>
                )}
              </Card>
            ))}
          </section>

          {history.length > 0 && (
            <section className="space-y-2">
              <h2 className="font-bold text-stone-500 text-lg">歷史紀錄</h2>
              {history.slice(0, 10).map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between rounded-xl bg-white/70 border border-cream-200 px-4 py-2.5 text-sm"
                >
                  <span className="text-stone-600">
                    {formatDateTw(a.date)} {a.startTime}｜{a.patientName}｜{a.clinicTypeName}
                  </span>
                  <StatusBadge status={a.status as AppointmentStatus} />
                </div>
              ))}
            </section>
          )}

          <div className="text-center pt-2">
            <button
              onClick={() =>
                startTransition(async () => {
                  await portalLogout();
                  router.refresh();
                })
              }
              className="text-sm text-stone-500 underline underline-offset-2"
            >
              登出
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function RescheduleFlow({
  appointment,
  clinicTypes,
  onDone,
  onCancel,
  onError,
}: {
  appointment: MyAppointmentDto;
  clinicTypes: ClinicTypeDto[];
  onDone: (message: string) => void;
  onCancel: () => void;
  onError: (message: string) => void;
}) {
  const clinicTypeId = clinicTypes.find((t) => t.name === appointment.clinicTypeName)?.id ?? "";
  const [dates, setDates] = useState<{ date: string; open: boolean; hasFreeSlot: boolean }[]>([]);
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<
    { startTime: string; doctors: { doctorId: string; doctorName: string; remaining: number }[] }[]
  >([]);
  const [loaded, setLoaded] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!loaded) {
    startTransition(async () => {
      const r = await fetchOpenDates(clinicTypeId, "any");
      if (r.ok) setDates(r.data ?? []);
      setLoaded(true);
    });
  }

  const pickDate = (d: string) => {
    setDate(d);
    startTransition(async () => {
      const r = await fetchDaySlots(clinicTypeId, d, "any");
      if (r.ok) setSlots(r.data ?? []);
    });
  };

  const pickSlot = (startTime: string) => {
    startTransition(async () => {
      const r = await rescheduleMyAppointment({
        appointmentId: appointment.id,
        newDate: date,
        newStartTime: startTime,
        newDoctorId: "any",
      });
      if (!r.ok) return onError(r.message);
      onDone(`改期完成，新預約編號 ${r.data?.bookingNumber}，已發送通知。`);
    });
  };

  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-forest-700 text-lg">改期</h2>
        <button onClick={onCancel} className="text-sm text-stone-500 underline underline-offset-2">
          返回
        </button>
      </div>
      <p className="text-stone-700">
        原預約：{formatDateTw(appointment.date)} {appointment.startTime}｜{appointment.doctorName}醫師
      </p>
      {!date ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {dates.map((d) => {
            const disabled = !d.open || !d.hasFreeSlot;
            return (
              <button
                key={d.date}
                disabled={disabled || pending}
                onClick={() => pickDate(d.date)}
                className={`rounded-xl border-2 px-3 py-2.5 text-center ${
                  disabled
                    ? "bg-cream-100 border-cream-200 text-stone-400"
                    : "bg-white border-cream-200 hover:border-forest-500"
                }`}
              >
                {formatDateTw(d.date)}
              </button>
            );
          })}
        </div>
      ) : (
        <>
          <p className="font-medium text-bark-600">{formatDateTw(date)}，請選擇新時段：</p>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {slots.map((s) => {
              const full = s.doctors.reduce((acc, d) => acc + d.remaining, 0) <= 0;
              return (
                <button
                  key={s.startTime}
                  disabled={full || pending}
                  onClick={() => pickSlot(s.startTime)}
                  className={`rounded-xl border-2 py-2.5 font-bold ${
                    full
                      ? "bg-cream-100 border-cream-200 text-stone-400 line-through"
                      : "bg-white border-cream-200 hover:border-forest-500 text-forest-700"
                  }`}
                >
                  {s.startTime}
                </button>
              );
            })}
          </div>
          <button onClick={() => setDate("")} className="btn-secondary">
            ← 重選日期
          </button>
        </>
      )}
    </Card>
  );
}
