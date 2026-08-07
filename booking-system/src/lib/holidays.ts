/**
 * 放假日行事曆（依行政院人事行政總處「政府行政機關辦公日曆表」）。
 *
 * 收錄日曆表上**所有放假日**（含一般例假日），院長 2026-08-05 指示：
 * 放假日一律不做兒童發展篩檢。診所當天多半照常看診，只有這一科停
 * （官網公告：「週一僅下午 14:30–16:00（國定假日不施測）」），
 * 因此不是「整間休診」，而是掛在門診類型上的 `skipOnPublicHoliday`。
 * 假日若連門診時間都異動，走官網公告的單日例外（見 schedule-source.ts），與本檔無關。
 *
 * 資料由 `scripts/import-holidays.ts` 匯入官方日曆表，每年公布次年版本後更新一次。
 * 沒有資料的年度＝系統不知道那年的假日，後台「系統設定」會顯示涵蓋範圍與提醒。
 */
import { prisma, type Tx } from "./db";
import { dateToDb, dbToDate } from "./tw-time";
import { readdirSync, readFileSync } from "node:fs";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

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

// ── 匯入 ────────────────────────────────────────────────

export interface HolidayRow {
  date: string;
  name: string;
}

export interface ParseResult {
  rows: HolidayRow[];
  skippedWorkdays: number;
  /** 其中屬一般例假日（官方檔備註空白）的天數，僅供匯入時顯示 */
  skippedWeekends: number;
}

/** 官方檔的日期可能是 20260101 / 2026/1/1 / 2026-01-01 */
function normaliseDate(raw: string): string | null {
  const v = raw.trim().replace(/^"|"$/g, "");
  let m = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = v.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return null;
}

/**
 * 解析假日檔。支援兩種格式：
 *  1. 人事行政總處原始 CSV：`西元日期,星期,是否放假,備註`（是否放假 0＝上班、2＝放假）
 *  2. 簡易格式：`YYYY-MM-DD,名稱`（# 開頭為註解）
 * **所有放假日都收**，備註空白者（一般例假日）記為「例假日」；上班日略過。
 * 補行上班的週六在官方檔為 0，會被正確排除。
 */
export function parseHolidayFile(text: string): ParseResult {
  const rows: HolidayRow[] = [];
  let skippedWorkdays = 0;
  let skippedWeekends = 0;
  // 官方檔常帶 BOM，不去掉會讓第一欄比對失敗
  for (const line of text.replace(/^\ufeff/, "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const cols = trimmed.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const date = normaliseDate(cols[0]);
    if (!date) continue; // 標題列

    if (cols.length >= 4) {
      if (cols[2] !== "2") {
        skippedWorkdays++; // 上班日（含補行上班的週六）
        continue;
      }
      if (!cols[3]) skippedWeekends++; // 統計用：備註空白＝一般例假日
      rows.push({ date, name: cols[3] || "例假日" });
    } else if (cols.length >= 2 && cols[1]) {
      rows.push({ date, name: cols[1] });
    }
  }
  return { rows, skippedWorkdays, skippedWeekends };
}

export async function upsertHolidays(
  rows: HolidayRow[],
  source: string,
): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;
  for (const r of rows) {
    const date = dateToDb(r.date);
    const existing = await prisma.publicHoliday.findUnique({ where: { date } });
    if (!existing) {
      await prisma.publicHoliday.create({ data: { date, name: r.name, source } });
      created++;
    } else if (existing.name !== r.name || existing.source !== source) {
      await prisma.publicHoliday.update({ where: { date }, data: { name: r.name, source } });
      updated++;
    }
  }
  return { created, updated };
}

/**
 * 匯入隨程式碼附帶的假日檔（`prisma/holidays/*.csv`）。
 * 目的是「內建」——新部署跑完 seed 就有假日資料，不必額外操作。
 * 已存在的日期會更新名稱，不會重複建立；診所自行匯入的其他年度不受影響。
 */
export async function importBundledHolidays(
  dir = join(process.cwd(), "prisma", "holidays"),
): Promise<{ files: number; created: number; updated: number }> {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return { files: 0, created: 0, updated: 0 };
  let files = 0;
  let created = 0;
  let updated = 0;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".csv")).sort()) {
    const { rows } = parseHolidayFile(readFileSync(join(dir, file), "utf-8"));
    if (rows.length === 0) continue;
    const r = await upsertHolidays(rows, `bundled-${file.replace(/\.csv$/, "")}`);
    files++;
    created += r.created;
    updated += r.updated;
  }
  return { files, created, updated };
}
