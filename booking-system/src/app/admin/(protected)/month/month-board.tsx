"use client";

/**
 * 月曆總覽的畫面。
 *
 * 兩種版型，都能「一目瞭然看到每天的名單」（院長 2026-08-09 指定）：
 *   桌機：7 欄月曆格，一格是一天，格內直接列出當天每一筆（時間／姓名／門診／醫師）。
 *   手機：改成一天一張卡片往下捲——手機寬度塞不下 7 欄，硬塞會變成每格兩個字。
 *
 * 每天的清單超過格高時格內自己捲動，不會把整個月曆撐長。
 */
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { STATUS_META } from "@/lib/status-labels";
import type { AppointmentStatus } from "@prisma/client";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

export interface DayCell {
  date: string;
  weekday: number;
  appointments: {
    id: string;
    startTime: string;
    status: AppointmentStatus;
    patientName: string;
    idMasked: string;
    doctorName: string;
    doctorColor: string;
    clinicTypeName: string;
    clinicTypeColor: string;
    companions: number;
  }[];
}

export function MonthBoard({ days, today }: { days: DayCell[]; today: string }) {
  const [compact, setCompact] = useState(false);
  const todayRef = useRef<HTMLDivElement>(null);

  // 月初的空格：讓 1 號對到正確的星期欄
  const leading = useMemo(() => (days[0] ? days[0].weekday : 0), [days]);

  return (
    <>
      <div className="flex items-center gap-2 no-print">
        <label className="flex items-center gap-1.5 text-sm text-ink-700">
          <input
            type="checkbox"
            checked={compact}
            onChange={(e) => setCompact(e.target.checked)}
            className="size-4 accent-sage-500"
          />
          精簡模式（只顯示時間與姓名）
        </label>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => todayRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })}
          className="btn-secondary !px-3 !py-1.5 text-sm"
        >
          跳到今天
        </button>
      </div>

      {/* ── 桌機：7 欄月曆 ───────────────────────────── */}
      <div className="hidden md:block">
        <div className="grid grid-cols-7 gap-px bg-sage-200 rounded-card overflow-hidden border border-sage-200">
          {WEEKDAYS.map((w, i) => (
            <div
              key={w}
              className={`bg-sage-100 py-1.5 text-center text-sm font-bold ${
                i === 0 || i === 6 ? "text-wood-700" : "text-sage-700"
              }`}
            >
              週{w}
            </div>
          ))}
          {Array.from({ length: leading }, (_, i) => (
            <div key={`pad-${i}`} className="bg-white/50 min-h-40" />
          ))}
          {days.map((d) => (
            <DayCellView key={d.date} day={d} today={today} compact={compact} todayRef={todayRef} />
          ))}
        </div>
      </div>

      {/* ── 手機：一天一張卡片往下捲 ─────────────────── */}
      <div className="md:hidden space-y-2">
        {days.map((d) => (
          <DayCardView key={d.date} day={d} today={today} compact={compact} todayRef={todayRef} />
        ))}
      </div>
    </>
  );
}

function dayNumber(date: string) {
  return Number(date.slice(8));
}

/** 狀態點：已取消／未到的用刪除線與灰字，避免櫃檯誤讀成還要看診 */
function statusClass(status: AppointmentStatus) {
  if (status === "CANCELLED_BY_PATIENT" || status === "CANCELLED_BY_CLINIC" || status === "RESCHEDULED")
    return "line-through text-ink-300";
  if (status === "NO_SHOW") return "line-through text-rose-400";
  if (status === "CHECKED_IN" || status === "COMPLETED") return "text-sage-600";
  return "text-ink-900";
}

function DayCellView({
  day,
  today,
  compact,
  todayRef,
}: {
  day: DayCell;
  today: string;
  compact: boolean;
  todayRef: React.RefObject<HTMLDivElement | null>;
}) {
  const isToday = day.date === today;
  const isWeekend = day.weekday === 0 || day.weekday === 6;
  return (
    <div
      ref={isToday ? todayRef : undefined}
      className={`bg-white min-h-40 max-h-72 overflow-y-auto p-1.5 ${
        isToday ? "ring-2 ring-inset ring-sage-500" : ""
      }`}
    >
      <div className="flex items-baseline justify-between mb-1 sticky top-0 bg-white">
        <Link
          href={`/admin?date=${day.date}`}
          className={`font-bold text-sm hover:underline ${
            isToday ? "text-sage-700" : isWeekend ? "text-wood-700" : "text-ink-700"
          }`}
        >
          {dayNumber(day.date)}
          {isToday && <span className="ml-1 text-xs">今天</span>}
        </Link>
        {day.appointments.length > 0 && (
          <span className="text-xs text-ink-500">{day.appointments.length}</span>
        )}
      </div>
      <ul className="space-y-1">
        {day.appointments.map((a) => (
          <li key={a.id} className="text-xs leading-tight">
            <AppointmentLine a={a} compact={compact} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function DayCardView({
  day,
  today,
  compact,
  todayRef,
}: {
  day: DayCell;
  today: string;
  compact: boolean;
  todayRef: React.RefObject<HTMLDivElement | null>;
}) {
  const isToday = day.date === today;
  // 手機版只列出有預約的日子，休診日整片空白往下捲很難找
  if (day.appointments.length === 0 && !isToday) return null;
  return (
    <div
      ref={isToday ? todayRef : undefined}
      className={`rounded-card bg-white border p-3 ${
        isToday ? "border-sage-500 border-2" : "border-sage-200"
      }`}
    >
      <div className="flex items-baseline gap-2 mb-1.5">
        <Link href={`/admin?date=${day.date}`} className="font-bold text-sage-700 hover:underline">
          {dayNumber(day.date)} 日（{WEEKDAYS[day.weekday]}）
        </Link>
        {isToday && (
          <span className="rounded-full bg-sage-500 text-white text-xs px-2 py-0.5">今天</span>
        )}
        <span className="flex-1" />
        <span className="text-sm text-ink-500">{day.appointments.length} 筆</span>
      </div>
      {day.appointments.length === 0 ? (
        <p className="text-sm text-ink-500">今日尚無預約。</p>
      ) : (
        <ul className="divide-y divide-sage-100">
          {day.appointments.map((a) => (
            <li key={a.id} className="py-1.5 text-sm">
              <AppointmentLine a={a} compact={compact} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AppointmentLine({ a, compact }: { a: DayCell["appointments"][number]; compact: boolean }) {
  return (
    <div className={statusClass(a.status)}>
      <div className="flex items-baseline gap-1.5 flex-wrap">
        <span className="font-mono font-bold">{a.startTime}</span>
        <span className="font-medium">{a.patientName}</span>
        {a.companions > 0 && <span className="text-ink-500">＋{a.companions}</span>}
        {a.status !== "CONFIRMED" && (
          <span className="text-[0.7em] text-ink-500">{STATUS_META[a.status]?.label}</span>
        )}
      </div>
      {!compact && (
        <div className="flex items-baseline gap-1.5 flex-wrap text-ink-500">
          <span
            className="rounded px-1"
            style={{ backgroundColor: `${a.clinicTypeColor}22`, color: a.clinicTypeColor }}
          >
            {a.clinicTypeName}
          </span>
          <span style={{ color: a.doctorColor }}>{a.doctorName}</span>
          <span className="font-mono">{a.idMasked}</span>
        </div>
      )}
    </div>
  );
}
