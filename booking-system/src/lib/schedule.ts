/**
 * 排班運算：固定週班表 + 日期例外 → 當日各醫師的實際看診區間與 30 分鐘時段。
 * 此為「醫師何時看診」的唯一事實來源；可預約性再疊加名額與門診類型條件。
 */
import { prisma, type Tx } from "./db";
import { dateToDb, slotTimes, slotEnd, weekdayOf } from "./tw-time";
import type { ExceptionType, SessionPeriod } from "@prisma/client";

export interface WorkingBlock {
  doctorId: string;
  session: SessionPeriod;
  startTime: string;
  endTime: string;
  slotCapacity: number;
  allowOnline: boolean;
}

/** 例外套用所需欄位（Prisma 列與後台輸入皆相容） */
export interface ScheduleExceptionLike {
  type: ExceptionType;
  session?: SessionPeriod | null;
  doctorId?: string | null;
  substituteDoctorId?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  slotCapacity?: number | null;
}

export const SESSION_LABEL: Record<SessionPeriod, string> = {
  MORNING: "早診",
  AFTERNOON: "午診",
  EVENING: "晚診",
};

/** 依時間判斷屬於哪個診別（供顯示與篩選） */
export function sessionOfTime(time: string): SessionPeriod {
  if (time < "13:00") return "MORNING";
  if (time < "18:00") return "AFTERNOON";
  return "EVENING";
}

/**
 * 將日期例外套用到看診區間。
 * 唯一實作：實際班表（getDayScheduleBlocks）與後台「受影響預約」模擬共用，
 * 避免兩套邏輯漂移導致模擬結果與實際不符。
 * 套用順序：全日休 → 診別休 → 醫師休 → 代診 → 特殊時間 → 加診 → 去重。
 */
export function applyExceptions(
  input: WorkingBlock[],
  exceptions: ScheduleExceptionLike[],
): WorkingBlock[] {
  if (exceptions.some((e) => e.type === "CLINIC_CLOSED_DAY")) return [];

  let blocks = input;
  for (const e of exceptions) {
    switch (e.type) {
      case "SESSION_CLOSED":
        blocks = blocks.filter((b) => b.session !== e.session);
        break;
      case "DOCTOR_OFF":
        blocks = blocks.filter(
          (b) => !(b.doctorId === e.doctorId && (!e.session || b.session === e.session)),
        );
        break;
      case "DOCTOR_SUBSTITUTE":
        blocks = blocks.map((b) =>
          b.doctorId === e.doctorId && (!e.session || b.session === e.session)
            ? { ...b, doctorId: e.substituteDoctorId ?? b.doctorId }
            : b,
        );
        break;
      case "SPECIAL_HOURS":
        blocks = blocks.map((b) =>
          (!e.session || b.session === e.session) && (!e.doctorId || b.doctorId === e.doctorId)
            ? {
                ...b,
                startTime: e.startTime ?? b.startTime,
                endTime: e.endTime ?? b.endTime,
              }
            : b,
        );
        break;
      default:
        break;
    }
  }

  // 加診（可能是原本沒班的醫師或時段）
  for (const e of exceptions) {
    if (e.type === "EXTRA_SESSION" && e.doctorId && e.startTime && e.endTime) {
      blocks = [
        ...blocks,
        {
          doctorId: e.doctorId,
          session: e.session ?? sessionOfTime(e.startTime),
          startTime: e.startTime,
          endTime: e.endTime,
          slotCapacity: e.slotCapacity ?? 1,
          allowOnline: true,
        },
      ];
    }
  }

  // 同一醫師同診別若同時有代診與原班造成重複，去重（保留第一筆）
  const seen = new Set<string>();
  return blocks.filter((b) => {
    const key = `${b.doctorId}|${b.session}|${b.startTime}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 計算某日期各醫師實際看診區間（已套用所有日期例外）。 */
export async function getDayScheduleBlocks(date: string, tx?: Tx): Promise<WorkingBlock[]> {
  const db = tx ?? prisma;
  const weekday = weekdayOf(date);
  const [templates, exceptions] = await Promise.all([
    db.weeklyScheduleTemplate.findMany({
      where: { weekday, isActive: true, doctor: { isActive: true } },
    }),
    db.scheduleException.findMany({ where: { date: dateToDb(date) } }),
  ]);

  const blocks: WorkingBlock[] = templates.map((t) => ({
    doctorId: t.doctorId,
    session: t.session,
    startTime: t.startTime,
    endTime: t.endTime,
    slotCapacity: t.slotCapacity,
    allowOnline: t.allowOnline,
  }));

  return applyExceptions(blocks, exceptions);
}

/**
 * 某日期各診別的開診時間（該診別最早的看診區間起點）。
 *
 * 官網公告有兩條規則以「診次」而非「時段」為單位：
 * ①「該診次開診後就不再受理該診次的預約」②「該診次開診前，都可以自行取消或改期」。
 * 診次不另建資料表——當日班表最早的 startTime 就是該診次的開診時間，
 * 且已套用停診／代診／特殊時間等例外，臨時改時間也會跟著變。
 *
 * 回傳的 Map 沒有某診別 ＝ 當日該診別無班（或全日休診）。
 */
export async function getSessionStartTimes(
  date: string,
  tx?: Tx,
): Promise<Map<SessionPeriod, string>> {
  return sessionStartsOf(await getDayScheduleBlocks(date, tx));
}

/** 由已取得的班表推算各診別開診時間（避免重複查詢） */
export function sessionStartsOf(blocks: WorkingBlock[]): Map<SessionPeriod, string> {
  const starts = new Map<SessionPeriod, string>();
  for (const b of blocks) {
    const cur = starts.get(b.session);
    if (!cur || b.startTime < cur) starts.set(b.session, b.startTime);
  }
  return starts;
}

/**
 * 該診次是否已開診（僅當日有意義；未來日期一律未開診）。
 * 查不到開診時間時回傳 false——例如櫃檯在班表外手動加開的時段，
 * 沒有診次可依附，交由時段層級的規則（預約截止分鐘數）處理。
 */
export function hasSessionStarted(
  starts: Map<SessionPeriod, string>,
  session: SessionPeriod,
  nowTime: string,
): boolean {
  const start = starts.get(session);
  return !!start && nowTime >= start;
}

/**
 * 某時段屬於哪個診次：以當日班表為準，班表查不到才退回時間判斷。
 * 班表較準——晚診 18:30 起與午診 14:30–18:00 的界線會隨當日特殊時間變動。
 */
export function sessionOfSlot(blocks: WorkingBlock[], startTime: string): SessionPeriod {
  const hit = blocks.find((b) => startTime >= b.startTime && startTime < b.endTime);
  return hit?.session ?? sessionOfTime(startTime);
}

/** 門診類型時間窗（ClinicTypeWindow 的必要欄位） */
export interface ClinicWindow {
  weekday: number;
  startTime: string;
  endTime: string;
}

/**
 * 時段起點是否落在該門診類型的可預約時間窗內。
 * 空陣列＝未設時間窗，一律通過（改由 allowedWeekdays／allowedSessions 粗篩）。
 * 區間含頭不含尾：09:00–11:30 可約到 11:00 這個時段（結束正好 11:30）。
 */
export function isWithinClinicWindows(
  windows: ClinicWindow[],
  weekday: number,
  startTime: string,
): boolean {
  if (windows.length === 0) return true;
  return windows.some(
    (w) => w.weekday === weekday && startTime >= w.startTime && startTime < w.endTime,
  );
}

/** 某日期被封鎖的時段（date-level SLOT_BLOCKED 例外，doctorId 空＝全院） */
export async function getBlockedSlotKeys(date: string, tx?: Tx): Promise<Set<string>> {
  const db = tx ?? prisma;
  const rows = await db.scheduleException.findMany({
    where: { date: dateToDb(date), type: "SLOT_BLOCKED" },
  });
  const set = new Set<string>();
  for (const r of rows) {
    if (r.startTime) set.add(`${r.doctorId ?? "*"}|${r.startTime}`);
  }
  return set;
}

/** 檢查某醫師某時間是否被 SLOT_BLOCKED 例外封鎖 */
export function isSlotKeyBlocked(blocked: Set<string>, doctorId: string, time: string): boolean {
  return blocked.has(`${doctorId}|${time}`) || blocked.has(`*|${time}`);
}

/** 某日期被暫停的門診類型 id 集合 */
export async function getSuspendedClinicTypes(date: string, tx?: Tx): Promise<Set<string>> {
  const db = tx ?? prisma;
  const rows = await db.scheduleException.findMany({
    where: { date: dateToDb(date), type: "CLINIC_TYPE_SUSPENDED" },
  });
  return new Set(rows.map((r) => r.clinicTypeId).filter((x): x is string => !!x));
}

/** 展開某日期所有（醫師 × 30 分鐘時段），含線上開放註記 */
export async function expandDaySlots(date: string, tx?: Tx) {
  const [blocks, blocked] = await Promise.all([
    getDayScheduleBlocks(date, tx),
    getBlockedSlotKeys(date, tx),
  ]);
  return blocks.flatMap((b) =>
    slotTimes(b.startTime, b.endTime).map((t) => ({
      doctorId: b.doctorId,
      session: b.session,
      startTime: t,
      endTime: slotEnd(t, b.endTime),
      capacity: b.slotCapacity,
      allowOnline: b.allowOnline && !isSlotKeyBlocked(blocked, b.doctorId, t),
    })),
  );
}
