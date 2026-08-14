"use client";

/**
 * 今日預約總覽：桌面＝時間×醫師欄位表；手機＝卡片列表。
 * 快速操作：報到／完成／未到／取消／改期／編輯／撥打／補發通知。
 */
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  adminMarkStatus,
  adminCancelAppointment,
  adminRevokeNoShow,
  adminResendNotification,
} from "@/app/actions/admin";
import { StatusBadge, Alert } from "@/components/ui";
import { VISIT_TYPE_LABEL, SOURCE_LABEL } from "@/lib/status-labels";
import { addMinutes, nowTimeStr, todayStr } from "@/lib/tw-time";
import type { AppointmentStatus } from "@prisma/client";

interface ApptDto {
  id: string;
  bookingNumber: string;
  startTime: string;
  status: AppointmentStatus;
  source: string;
  visitType: string | null;
  patientNote: string | null;
  staffNote: string | null;
  doctorId: string;
  doctor: { name: string };
  clinicType: { name: string; color: string };
  /** 家庭代表預約的同行看診家人（不另占名額） */
  companions: { id: string; name: string }[];
  patient: {
    id: string;
    name: string;
    phone: string;
    idNumberMasked: string;
    noShowCount: number;
    staffNote: string | null;
    restrictions: { id: string }[];
  };
}

interface Props {
  date: string;
  appointments: ApptDto[];
  doctors: { id: string; name: string }[];
  clinicTypes: { id: string; name: string; color: string }[];
  filters: { session: string; doctor: string; type: string; status: string; q: string };
  canWrite: boolean;
  /** 是否可匯出／列印整日名單（APPOINTMENTS_READ）；醫師唯讀帳號沒有 */
  canExport: boolean;
  doctorLocked: boolean;
  /** 報到保留分鐘數（booking.checkin_grace_minutes），逾時即標記提醒 */
  graceMinutes: number;
}

export function DayBoard({
  date,
  appointments,
  doctors,
  clinicTypes,
  filters,
  canWrite,
  canExport,
  doctorLocked,
  graceMinutes,
}: Props) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  // 報到逾時標記（官網公告：時段開始後保留 N 分鐘）。
  // 系統不自動取消——櫃檯可能正忙、家長也可能人已在現場，
  // 這裡只把「該處理了」標出來，實際要記未到或補報到仍由櫃檯按鈕決定。
  // 於 effect 內取時間避免伺服器與瀏覽器算出不同結果；每 30 秒重算一次。
  const [nowTime, setNowTime] = useState<string | null>(null);
  useEffect(() => {
    if (date !== todayStr()) return;
    const tick = () => setNowTime(nowTimeStr());
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [date]);
  const isOverdue = (a: ApptDto) =>
    !!nowTime &&
    (a.status === "PENDING" || a.status === "CONFIRMED") &&
    nowTime >= addMinutes(a.startTime, graceMinutes);

  const act = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) setError(r.message ?? "操作失敗");
      else setError("");
      router.refresh();
    });

  const mark = (id: string, to: "CONFIRMED" | "CHECKED_IN" | "COMPLETED" | "NO_SHOW") => {
    if (to === "NO_SHOW" && !window.confirm("確定標記為「未到」？將累計未到次數。")) return;
    act(() => adminMarkStatus(id, to));
  };
  const cancel = (id: string) => {
    const reason = window.prompt("請輸入取消原因（將通知病人）：");
    if (!reason?.trim()) return;
    act(() => adminCancelAppointment(id, reason));
  };
  const revoke = (id: string) => {
    const reason = window.prompt("撤銷未到標記的原因：");
    if (!reason?.trim()) return;
    act(() => adminRevokeNoShow(id, reason));
  };

  const activeDoctors = useMemo(
    () => doctors.filter((d) => appointments.some((a) => a.doctorId === d.id)),
    [doctors, appointments],
  );
  const times = useMemo(
    () => [...new Set(appointments.map((a) => a.startTime))].sort(),
    [appointments],
  );

  const exportUrl = `/admin/api/export?date=${date}`;

  return (
    <div className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}

      {/* 篩選列 */}
      <form action="/admin" method="get" className="flex flex-wrap gap-2 items-center no-print">
        <input type="hidden" name="date" value={date} />
        <select name="session" defaultValue={filters.session} className="input !w-auto !py-2">
          <option value="">全部診別</option>
          <option value="MORNING">早診</option>
          <option value="AFTERNOON">午診</option>
          <option value="EVENING">晚診</option>
        </select>
        {!doctorLocked && (
          <select name="doctor" defaultValue={filters.doctor} className="input !w-auto !py-2">
            <option value="">全部醫師</option>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        )}
        <select name="type" defaultValue={filters.type} className="input !w-auto !py-2">
          <option value="">全部門診</option>
          {clinicTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={filters.status} className="input !w-auto !py-2">
          <option value="">全部狀態</option>
          <option value="PENDING">待確認</option>
          <option value="CONFIRMED">已確認</option>
          <option value="CHECKED_IN">已報到</option>
          <option value="COMPLETED">已完成</option>
          <option value="NO_SHOW">未到</option>
          <option value="CANCELLED_BY_PATIENT">病人取消</option>
          <option value="CANCELLED_BY_CLINIC">診所取消</option>
          <option value="RESCHEDULED">已改期</option>
        </select>
        <input
          name="q"
          defaultValue={filters.q}
          placeholder="姓名／電話／證件末碼／編號"
          className="input !w-52 !py-2"
        />
        <button className="btn-secondary !px-3 !py-2">篩選</button>
        <span className="flex-1" />
        {/* 匯出與列印都是「整日完整名單」，醫師唯讀帳號無此權限。
            後端本來就會擋（export route 回 401），但按鈕留著只會讓人按了得到錯誤。 */}
        {canExport && (
          <>
            <button
              type="button"
              onClick={() => window.print()}
              className="btn-secondary !px-3 !py-2"
            >
              🖨️ 列印
            </button>
            <a href={exportUrl} className="btn-secondary !px-3 !py-2" download>
              ⬇️ 匯出 CSV
            </a>
          </>
        )}
      </form>

      {appointments.length === 0 && (
        <p className="text-center text-ink-500 py-8">此條件下沒有預約。</p>
      )}

      {/* 桌面：時間 × 醫師欄 */}
      {appointments.length > 0 && (
        <div className="hidden lg:block overflow-x-auto">
          <table className="w-full border-separate border-spacing-1">
            <thead>
              <tr>
                <th className="text-left text-ink-500 font-medium px-2 w-20">時間</th>
                {activeDoctors.map((d) => (
                  <th key={d.id} className="text-left text-sage-700 font-bold px-2">
                    {d.name}醫師
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {times.map((t) => (
                <tr key={t} className="align-top">
                  <td className="px-2 py-2 font-mono font-bold text-ink-900">{t}</td>
                  {activeDoctors.map((d) => (
                    <td key={d.id} className="px-1 py-1">
                      {appointments
                        .filter((a) => a.startTime === t && a.doctorId === d.id)
                        .map((a) => (
                          <ApptCard
                            key={a.id}
                            a={a}
                            canWrite={canWrite}
                            pending={pending}
                            onMark={mark}
                            onCancel={cancel}
                            onRevoke={revoke}
                            onResend={(id) => act(() => adminResendNotification(id))}
                            date={date}
                            overdue={isOverdue(a)}
                          />
                        ))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 手機/平板：卡片列表 */}
      <div className="lg:hidden space-y-2">
        {appointments.map((a) => (
          <ApptCard
            key={a.id}
            a={a}
            canWrite={canWrite}
            pending={pending}
            onMark={mark}
            onCancel={cancel}
            onRevoke={revoke}
            onResend={(id) => act(() => adminResendNotification(id))}
            date={date}
            overdue={isOverdue(a)}
            showTime
          />
        ))}
      </div>
    </div>
  );
}

function ApptCard({
  a,
  canWrite,
  pending,
  onMark,
  onCancel,
  onRevoke,
  onResend,
  date,
  overdue = false,
  showTime = false,
}: {
  a: ApptDto;
  canWrite: boolean;
  pending: boolean;
  onMark: (id: string, to: "CONFIRMED" | "CHECKED_IN" | "COMPLETED" | "NO_SHOW") => void;
  onCancel: (id: string) => void;
  onRevoke: (id: string) => void;
  onResend: (id: string) => void;
  date: string;
  /** 已過報到保留時間，尚未報到 */
  overdue?: boolean;
  showTime?: boolean;
}) {
  const active = ["PENDING", "CONFIRMED", "CHECKED_IN"].includes(a.status);
  return (
    <div
      className={`rounded-xl border bg-white p-3 space-y-1.5 shadow-sm ${
        overdue ? "border-rose-500 ring-1 ring-rose-500/30" : "border-sage-200"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="font-bold text-ink-900">
          {showTime && <span className="font-mono mr-2">{a.startTime}</span>}
          {a.patient.name}
          <span className="ml-2 text-sm font-normal text-ink-500">{a.patient.idNumberMasked}</span>
          {a.companions.length > 0 && (
            <span className="ml-2 rounded bg-wood-600/15 text-wood-700 px-1.5 py-0.5 text-xs font-medium">
              👨‍👩‍👧 同行 {a.companions.length} 位
            </span>
          )}
        </p>
        <div className="flex items-center gap-1.5 shrink-0">
          {overdue && (
            <span className="rounded bg-rose-100 text-rose-600 px-1.5 py-0.5 text-xs font-bold whitespace-nowrap">
              報到逾時
            </span>
          )}
          <StatusBadge status={a.status} />
        </div>
      </div>
      <p className="text-sm text-ink-700">
        <span className="rounded px-1.5 py-0.5 text-white text-xs mr-1" style={{ backgroundColor: a.clinicType.color }}>
          {a.clinicType.name}
        </span>
        {showTime && <>{a.doctor.name}醫師｜</>}
        {a.visitType ? VISIT_TYPE_LABEL[a.visitType] : "初/複診未填"}｜{SOURCE_LABEL[a.source] ?? a.source}
        ｜{a.bookingNumber}
      </p>
      <p className="text-sm text-ink-700">
        📱 <a href={`tel:${a.patient.phone}`} className="underline underline-offset-2">{a.patient.phone}</a>
        {a.patient.noShowCount > 0 && (
          <span className="ml-2 text-rose-600 font-medium">⚠️ 未到 {a.patient.noShowCount} 次</span>
        )}
        {a.patient.restrictions.length > 0 && (
          <span className="ml-2 text-rose-600 font-medium">⛔ 預約限制中</span>
        )}
      </p>
      {a.companions.length > 0 && (
        <p className="text-sm text-wood-700 bg-wood-400/10 rounded px-2 py-1">
          同行看診：{a.companions.map((c) => c.name).join("、")}（共 {a.companions.length + 1} 位）
        </p>
      )}
      {(a.patientNote || a.staffNote || a.patient.staffNote) && (
        <p className="text-sm text-wood-700 bg-wood-100 rounded px-2 py-1">
          {a.patientNote && <>病人備註：{a.patientNote} </>}
          {a.staffNote && <>｜櫃檯：{a.staffNote}</>}
          {a.patient.staffNote && <>｜病歷註記：{a.patient.staffNote}</>}
        </p>
      )}
      {canWrite && (
        <div className="flex flex-wrap gap-1.5 pt-1 no-print">
          {a.status === "PENDING" && (
            <button disabled={pending} onClick={() => onMark(a.id, "CONFIRMED")} className="qbtn bg-sage-600 text-white">
              確認
            </button>
          )}
          {active && a.status !== "CHECKED_IN" && (
            <button disabled={pending} onClick={() => onMark(a.id, "CHECKED_IN")} className="qbtn bg-sage-500 text-white">
              報到
            </button>
          )}
          {active && (
            <button disabled={pending} onClick={() => onMark(a.id, "COMPLETED")} className="qbtn bg-ink-500 text-white">
              完成
            </button>
          )}
          {(a.status === "PENDING" || a.status === "CONFIRMED") && (
            <>
              <button disabled={pending} onClick={() => onMark(a.id, "NO_SHOW")} className="qbtn bg-rose-500 text-white">
                未到
              </button>
              <button disabled={pending} onClick={() => onCancel(a.id)} className="qbtn bg-rose-600 text-white">
                取消
              </button>
              <Link href={`/admin/booking?reschedule=${a.id}&date=${date}`} className="qbtn bg-wood-600 text-white">
                改期
              </Link>
            </>
          )}
          {a.status === "NO_SHOW" && (
            <button disabled={pending} onClick={() => onRevoke(a.id)} className="qbtn bg-ink-500 text-white">
              撤銷未到
            </button>
          )}
          <Link href={`/admin/patients/${a.patient.id}`} className="qbtn bg-white border border-sage-200 text-ink-900">
            編輯/病歷
          </Link>
          <button disabled={pending} onClick={() => onResend(a.id)} className="qbtn bg-white border border-sage-200 text-ink-900">
            傳送通知
          </button>
        </div>
      )}
    </div>
  );
}
