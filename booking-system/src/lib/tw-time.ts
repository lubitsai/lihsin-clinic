/**
 * 台灣時區 (Asia/Taipei, UTC+8, 無日光節約) 時間工具。
 * 系統內「日期」一律以 "YYYY-MM-DD" 字串、「時間」以 "HH:mm" 字串流通,
 * 僅在存取 Prisma @db.Date 欄位時轉為 UTC 午夜的 Date 物件。
 */

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 現在的台灣時間（以 UTC Date 物件平移表示，僅供取年月日時分用） */
export function nowTaipei(): Date {
  return new Date(Date.now() + TAIPEI_OFFSET_MS);
}

/** 今天（台灣時間）的 "YYYY-MM-DD" */
export function todayStr(): string {
  return nowTaipei().toISOString().slice(0, 10);
}

/** 現在（台灣時間）的 "HH:mm" */
export function nowTimeStr(): string {
  return nowTaipei().toISOString().slice(11, 16);
}

/** "YYYY-MM-DD" → Prisma @db.Date 用的 Date（UTC 午夜） */
export function dateToDb(dateStr: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) throw new Error(`invalid date: ${dateStr}`);
  return new Date(`${dateStr}T00:00:00.000Z`);
}

/** Prisma @db.Date 欄位 → "YYYY-MM-DD" */
export function dbToDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 日期字串加 n 天 */
export function addDays(dateStr: string, n: number): string {
  const d = dateToDb(dateStr);
  d.setUTCDate(d.getUTCDate() + n);
  return dbToDate(d);
}

/** 兩日期相差天數（b - a） */
export function diffDays(a: string, b: string): number {
  return Math.round((dateToDb(b).getTime() - dateToDb(a).getTime()) / 86400000);
}

/** 該日期（台灣時間）為星期幾，0=日 … 6=六 */
export function weekdayOf(dateStr: string): number {
  return dateToDb(dateStr).getUTCDay();
}

/** 指定台灣日期時間距離現在的分鐘數（未來為正） */
export function minutesFromNow(dateStr: string, timeStr: string): number {
  const target = new Date(`${dateStr}T${timeStr}:00+08:00`).getTime();
  return Math.round((target - Date.now()) / 60000);
}

/** "HH:mm" 加 n 分鐘 */
export function addMinutes(timeStr: string, n: number): string {
  const [h, m] = timeStr.split(":").map(Number);
  const total = h * 60 + m + n;
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** 產生 [start, end) 之間每 stepMinutes 一格的時間清單 */
export function slotTimes(start: string, end: string, stepMinutes = 30): string[] {
  const out: string[] = [];
  let t = start;
  while (t < end) {
    out.push(t);
    t = addMinutes(t, stepMinutes);
  }
  return out;
}

export const WEEKDAY_ZH = ["日", "一", "二", "三", "四", "五", "六"];

/** 30 分鐘時段的結束時間；給定 blockEnd 時以其為上限（班表區間尾端的短時段） */
export function slotEnd(startTime: string, blockEnd?: string): string {
  const end = addMinutes(startTime, 30);
  return blockEnd && end > blockEnd ? blockEnd : end;
}

/** 台灣常用格式：2026/07/20（一） */
export function formatDateTw(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  return `${y}/${m}/${d}（${WEEKDAY_ZH[weekdayOf(dateStr)]}）`;
}

/** 民國格式生日顯示用：2020/03/05 */
export function formatBirthTw(d: Date): string {
  return dbToDate(d).replaceAll("-", "/");
}
