"use client";

/**
 * 臨時門診異動：關掉某一天某一診次，關了就算了。
 *
 * 為什麼要有這一頁：BookNow 的心智模型是「關掉某天某節的個別時段」，
 * 而自建系統的「固定週班表」改下去是**對所有未來日期生效**——照搬 BookNow
 * 的操作習慣，會把往後每一個同一星期幾的診次一起關掉，而且不會有人立刻發現。
 * 所以把「只停這一天」做成預設入口，週班表退到最後一個分頁並加警語。
 *
 * 這一頁做的事等同建立 SESSION_CLOSED／EXTRA_SESSION 日期例外，只是不必先知道
 * 「例外」「診別」這些詞彙——選日期、看到當天的診次、按停診或加開，如此而已。
 *
 * **單日加開醫師（雙診）也在這裡建**（院長 2026-09-17 指示）。
 * 官網的單日公告只寫得出「哪一診次、幾點到幾點」，寫不出「這天多一位醫師」，
 * sync_schedule.py 因此同步不到雙診——不在後台另外建，預約系統那天就只會開單診的名額。
 * 反過來，常態雙診（例如週日早診固定兩位）在官網門診時間表裡就有，會自動同步，不要手建。
 */
import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  adminFetchDaySchedule,
  adminPreviewException,
  adminCreateException,
  adminDeleteException,
  type DayScheduleDto,
  type DaySessionDto,
} from "@/app/actions/admin";
import { Card, Alert } from "@/components/ui";
import { addDays, formatDateTw, todayStr } from "@/lib/tw-time";
import { SESSION_META } from "@/lib/status-labels";

/**
 * 受影響的預約。這一頁永遠只處理一天，所以不像週班表變更那樣需要帶日期
 * （型別刻意與 adminPreviewException 的回傳一致，不共用週班表那份）。
 */
interface AffectedOnDay {
  id: string;
  bookingNumber: string;
  time: string;
  patientName: string;
  phone: string;
}

/** 待確認的停診動作：已知會影響哪些預約，等櫃檯決定怎麼處理 */
interface PendingClose {
  /** 診次；null 代表整天停診 */
  session: DaySessionDto["session"] | null;
  label: string;
  affected: AffectedOnDay[];
}

export function DayOffBoard({ onError }: { onError: (message: string) => void }) {
  const [date, setDate] = useState(todayStr());
  const [day, setDay] = useState<DayScheduleDto | null>(null);
  const [pendingClose, setPendingClose] = useState<PendingClose | null>(null);
  const [message, setMessage] = useState("");
  const [reason, setReason] = useState("臨時停診");
  /** 正在挑加開醫師的診次（一次只開一個，避免畫面上同時有兩個下拉選單） */
  const [addingTo, setAddingTo] = useState<DaySessionDto["session"] | null>(null);
  const [pending, startTransition] = useTransition();

  const load = useCallback(
    (d: string) => {
      startTransition(async () => {
        const r = await adminFetchDaySchedule(d);
        if (!r.ok) return onError(r.message);
        onError("");
        setDay(r.data!);
      });
    },
    [onError],
  );

  useEffect(() => {
    load(date);
  }, [date, load]);

  const input = (session: DaySessionDto["session"] | null) => ({
    date,
    type: session ? ("SESSION_CLOSED" as const) : ("CLINIC_CLOSED_DAY" as const),
    session: session ?? undefined,
    reason: reason.trim() || "臨時停診",
  });

  /** 先看會影響誰；沒人受影響就直接停診 */
  const close = (session: DaySessionDto["session"] | null, label: string) => {
    startTransition(async () => {
      const preview = await adminPreviewException(input(session));
      if (!preview.ok) return onError(preview.message);
      const affected = preview.data?.affected ?? [];
      if (affected.length > 0) {
        setMessage("");
        return setPendingClose({ session, label, affected });
      }
      const created = await adminCreateException(input(session));
      if (!created.ok) return onError(created.message);
      onError("");
      setMessage(`${formatDateTw(date)} ${label}已停診（只影響這一天）`);
      load(date);
    });
  };

  /** 受影響的預約以「診所取消」處理並通知，然後停診 */
  const closeWithCancel = () => {
    if (!pendingClose) return;
    const { session, label, affected } = pendingClose;
    if (!window.confirm(`將以「診所取消」處理 ${affected.length} 筆預約並發送通知，確定？`)) return;
    startTransition(async () => {
      const r = await adminCreateException(input(session), {
        cancelAffected: true,
        cancelReason: reason.trim() || "臨時停診",
      });
      if (!r.ok) return onError(r.message);
      onError("");
      setPendingClose(null);
      setMessage(`${formatDateTw(date)} ${label}已停診，${affected.length} 筆預約已取消並通知家長`);
      load(date);
    });
  };

  /**
   * 單日加開一位醫師（雙診）。時間沿用該診次現有的起訖，
   * 讓櫃檯不必再輸入一次——加開的本意就是「這一診次多一位醫師」。
   */
  const addDoctor = (s: DaySessionDto, doctorId: string) => {
    const doctor = s.addableDoctors.find((d) => d.id === doctorId);
    if (!doctor) return;
    startTransition(async () => {
      const r = await adminCreateException({
        date,
        type: "EXTRA_SESSION",
        session: s.session,
        doctorId,
        startTime: s.startTime,
        endTime: s.endTime,
        reason: reason.trim() || "臨時加開雙診",
      });
      if (!r.ok) return onError(r.message);
      onError("");
      setAddingTo(null);
      setMessage(
        `${formatDateTw(date)} ${SESSION_META[s.session].label}已加開 ${doctor.name}醫師（只影響這一天）`,
      );
      load(date);
    });
  };

  const removeDoctor = (exceptionId: string, sessionLabel: string, doctorName: string) => {
    if (!window.confirm(`取消 ${formatDateTw(date)} ${sessionLabel}加開的 ${doctorName}醫師？已約在該醫師名下的預約不會自動處理。`))
      return;
    startTransition(async () => {
      const r = await adminDeleteException(exceptionId);
      if (!r.ok) return onError(r.message);
      onError("");
      setMessage(`${formatDateTw(date)} ${sessionLabel}已取消加開 ${doctorName}醫師`);
      load(date);
    });
  };

  const reopen = (exceptionId: string, label: string) => {
    if (!window.confirm(`恢復 ${formatDateTw(date)} ${label}？已取消的預約不會自動回來。`)) return;
    startTransition(async () => {
      const r = await adminDeleteException(exceptionId);
      if (!r.ok) return onError(r.message);
      onError("");
      setMessage(`${formatDateTw(date)} ${label}已恢復看診`);
      load(date);
    });
  };

  const closedAllDay = !!day?.closedAllDayExceptionId;

  return (
    <div className="space-y-4">
      <Alert tone="info">
        <p className="font-bold mb-1">這一頁只改「這一天」</p>
        <p>
          停診、加開、恢復都只作用在所選日期，
          <strong>不會影響往後其他同一個星期幾</strong>。
          要改的是每週固定的門診時間（例如以後週三都不看晚診），才用「固定週班表」。
        </p>
        <p className="mt-1">
          <strong>單日加開雙診也在這裡建</strong>——官網的單日公告只寫得出時間、寫不出醫師，
          同步不到；不在這裡加開，預約系統那天就只會開單診的名額。
        </p>
      </Alert>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setDate(addDays(date, -1))} className="btn-secondary !py-2">
            ← 前一天
          </button>
          <input
            type="date"
            className="input !w-auto"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
          />
          <button onClick={() => setDate(addDays(date, 1))} className="btn-secondary !py-2">
            後一天 →
          </button>
          <button onClick={() => setDate(todayStr())} className="btn-secondary !py-2">
            今天
          </button>
          <span className="font-bold text-sage-700 ml-1">{formatDateTw(date)}</span>
        </div>

        <label className="block">
          <span className="block text-sm font-medium text-ink-900 mb-1">
            停診原因（會寫進給家長的取消通知）
          </span>
          <input
            className="input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={60}
            placeholder="例如：醫師臨時有事、颱風停診"
          />
        </label>
      </Card>

      {message && <Alert tone="success">{message}</Alert>}

      {day && day.sessions.length === 0 && !closedAllDay && (
        <Card>
          <p className="text-ink-700">這一天本來就沒有門診（週班表當天沒有排班）。</p>
        </Card>
      )}

      {closedAllDay && (
        <Card className="border-rose-500/50 space-y-2">
          <p className="font-bold text-rose-600">這一天已設定「全日休診」</p>
          <button
            onClick={() => reopen(day!.closedAllDayExceptionId!, "全日休診")}
            disabled={pending}
            className="btn-secondary !py-2"
          >
            取消全日休診
          </button>
        </Card>
      )}

      {!closedAllDay &&
        day?.sessions.map((s) => (
          <Card key={s.session} className={s.closedExceptionId ? "border-rose-500/50" : undefined}>
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <p className="font-bold text-lg text-sage-700">
                  {SESSION_META[s.session].label}
                  {s.closedExceptionId && <span className="text-rose-600 ml-2">已停診</span>}
                </p>
                <p className="text-sm text-ink-700 font-mono">
                  {s.startTime}–{s.endTime}
                </p>
                <p className="text-sm text-ink-700">
                  {s.doctors.map((d, i) => (
                    <span key={d.id}>
                      {i > 0 && "、"}
                      {d.name}醫師
                      {d.extraExceptionId && (
                        <>
                          <span className="text-wood-700">（本日加開）</span>
                          <button
                            onClick={() =>
                              removeDoctor(
                                d.extraExceptionId!,
                                SESSION_META[s.session].label,
                                d.name,
                              )
                            }
                            disabled={pending}
                            className="text-ink-500 underline underline-offset-2 ml-1"
                          >
                            取消加開
                          </button>
                        </>
                      )}
                    </span>
                  ))}
                  {s.doctors.length > 1 && (
                    <span className="ml-1 rounded-full bg-sage-500/10 text-sage-700 px-2 py-0.5 text-xs font-bold">
                      雙診
                    </span>
                  )}
                </p>
              </div>
              <div className="ml-auto flex items-center gap-3">
                {!s.closedExceptionId && (
                  <span className="text-sm text-ink-500">
                    {s.affectedCount > 0 ? `目前有 ${s.affectedCount} 筆預約` : "目前無預約"}
                  </span>
                )}
                {!s.closedExceptionId && s.addableDoctors.length > 0 && (
                  addingTo === s.session ? (
                    <select
                      className="input !w-auto"
                      autoFocus
                      defaultValue=""
                      onChange={(e) => e.target.value && addDoctor(s, e.target.value)}
                      disabled={pending}
                    >
                      <option value="">選擇要加開的醫師…</option>
                      {s.addableDoctors.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}醫師
                        </option>
                      ))}
                    </select>
                  ) : (
                    <button
                      onClick={() => setAddingTo(s.session)}
                      disabled={pending}
                      className="btn-secondary !py-2"
                    >
                      ＋ 加開醫師（雙診）
                    </button>
                  )
                )}
                {s.closedExceptionId ? (
                  <button
                    onClick={() => reopen(s.closedExceptionId!, SESSION_META[s.session].label)}
                    disabled={pending}
                    className="btn-secondary !py-2"
                  >
                    恢復看診
                  </button>
                ) : (
                  <button
                    onClick={() => close(s.session, SESSION_META[s.session].label)}
                    disabled={pending}
                    className="btn-danger !py-2"
                  >
                    停診
                  </button>
                )}
              </div>
            </div>
          </Card>
        ))}

      {!closedAllDay && day && day.sessions.length > 0 && (
        <div>
          <button
            onClick={() => close(null, "全日")}
            disabled={pending}
            className="btn-secondary !py-2"
          >
            這一天整天停診
          </button>
        </div>
      )}

      {day && day.otherExceptions.length > 0 && (
        <Card className="space-y-1">
          <p className="font-bold text-wood-700">這一天另有的排班調整</p>
          <ul className="text-sm text-ink-700 list-disc list-inside">
            {day.otherExceptions.map((e) => (
              <li key={e.id}>
                {e.label}
                {e.reason ? `：${e.reason}` : ""}
              </li>
            ))}
          </ul>
          <p className="text-sm text-ink-500">代診、加診、特殊時間請到「日期例外」分頁調整。</p>
        </Card>
      )}

      {pendingClose && (
        <Card className="border-rose-500/50 space-y-3">
          <h3 className="font-bold text-rose-600">
            ⚠️ {formatDateTw(date)} {pendingClose.label}有 {pendingClose.affected.length} 筆預約，尚未停診
          </h3>
          <p className="text-sm text-ink-700">
            請逐筆改期，或批次以「診所取消」處理並通知家長，停診才會生效。
          </p>
          <ul className="divide-y divide-sage-200 max-h-96 overflow-y-auto">
            {pendingClose.affected.map((a) => (
              <li key={a.id} className="py-2 flex flex-wrap items-center gap-2">
                <span className="font-mono">{a.time}</span>
                <span className="font-bold">{a.patientName}</span>
                <span className="text-ink-500">{a.phone}</span>
                <span className="text-ink-300 text-sm">{a.bookingNumber}</span>
                <Link
                  href={`/admin/booking?reschedule=${a.id}`}
                  className="ml-auto qbtn bg-wood-600 text-white"
                >
                  逐筆改期
                </Link>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <button onClick={closeWithCancel} disabled={pending} className="btn-danger !py-2">
              全部以「診所取消」處理並通知
            </button>
            <button
              onClick={() => setPendingClose(null)}
              disabled={pending}
              className="btn-secondary !py-2"
            >
              先不要，我去改期
            </button>
          </div>
        </Card>
      )}
    </div>
  );
}
