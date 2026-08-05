/**
 * 國定假日（依行政院人事行政總處「政府行政機關辦公日曆表」）。
 *
 * 診所在國定假日多半照常看診，只有兒童發展篩檢不施測
 * （官網公告：「週一僅下午 14:30–16:00（國定假日不施測）」）。
 * 因此假日不是「整間休診」，而是掛在門診類型上的 `skipOnPublicHoliday`。
 * 假日若連門診時間都異動，走官網公告的單日例外（見 schedule-source.ts），與本檔無關。
 *
 * 資料由 `scripts/import-holidays.ts` 匯入官方日曆表，每年公布次年版本後更新一次。
 * 沒有資料的年度＝系統不知道那年的假日，後台「系統設定」會顯示涵蓋範圍與提醒。
 */
import { prisma, type Tx } from "./db";
import { dateToDb, dbToDate } from "./tw-time";

/** 某日是否為國定假日；回傳假日名稱，非假日回傳 null */
export async function getHolidayName(date: string, tx?: Tx): Promise<string | null> {
  const db = tx ?? prisma;
  const row = await db.publicHoliday.findUnique({ where: { date: dateToDb(date) } });
  return row?.name ?? null;
}

/** 一段日期範圍內的假日（前台日曆一次查完，避免逐日查詢） */
export async function getHolidaysBetween(
  from: string,
  to: string,
  tx?: Tx,
): Promise<Map<string, string>> {
  const db = tx ?? prisma;
  const rows = await db.publicHoliday.findMany({
    where: { date: { gte: dateToDb(from), lte: dateToDb(to) } },
  });
  return new Map(rows.map((r) => [dbToDate(r.date), r.name]));
}

export interface HolidayCoverage {
  count: number;
  /** 已匯入的最早／最晚日期（無資料時為 null） */
  from: string | null;
  to: string | null;
  sources: string[];
}

export async function getHolidayCoverage(): Promise<HolidayCoverage> {
  const [count, first, last, grouped] = await Promise.all([
    prisma.publicHoliday.count(),
    prisma.publicHoliday.findFirst({ orderBy: { date: "asc" } }),
    prisma.publicHoliday.findFirst({ orderBy: { date: "desc" } }),
    prisma.publicHoliday.groupBy({ by: ["source"] }),
  ]);
  return {
    count,
    from: first ? dbToDate(first.date) : null,
    to: last ? dbToDate(last.date) : null,
    sources: grouped.map((g) => g.source).sort(),
  };
}

/**
 * 開放預約的範圍是否已被假日資料涵蓋。
 * 未涵蓋時「篩檢照常開放」——寧可讓櫃檯發現後補匯入，也不能因為缺資料就把整段時間關掉。
 * 後台會顯示警告，提醒匯入次年度日曆表。
 */
export function isCoverageSufficient(coverage: HolidayCoverage, lastOpenDate: string): boolean {
  return coverage.to !== null && coverage.to >= lastOpenDate;
}
