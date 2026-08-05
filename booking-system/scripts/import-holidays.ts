/**
 * 匯入國定假日行事曆。
 *
 * 主要來源：行政院人事行政總處「政府行政機關辦公日曆表」
 * （政府資料開放平臺可下載 CSV，每年約 6 月公布次年版本）。
 * 官方 CSV 欄位：`西元日期,星期,是否放假,備註`
 *   - 是否放假：0＝上班、2＝放假
 *   - 備註：假日名稱（一般週末為空白）
 * 只收「放假且備註非空」的日子——週末不必入表，週末本來就沒有篩檢時段。
 *
 * 也接受手動維護的簡易格式，每行 `YYYY-MM-DD,假日名稱`（可用 # 開頭寫註解）。
 *
 *     npx tsx scripts/import-holidays.ts <檔案路徑> [--source dgpa-115] [--replace-year 2026]
 *     npx tsx scripts/import-holidays.ts --list
 *
 * `--replace-year` 會先清掉該年度既有資料再匯入，用於官方修訂假期時重來一次。
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";

const prisma = new PrismaClient();

interface Row {
  date: string;
  name: string;
}

/** 官方 CSV 的日期可能是 20260101 或 2026/1/1 或 2026-01-01 */
function normaliseDate(raw: string): string | null {
  const v = raw.trim().replace(/^"|"$/g, "");
  let m = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = v.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return null;
}

function parse(text: string): Row[] {
  const rows: Row[] = [];
  // 官方檔常帶 BOM，不去掉會讓第一欄比對失敗
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  let skippedWorkdays = 0;
  let skippedWeekends = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const cols = trimmed.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const date = normaliseDate(cols[0]);
    if (!date) continue; // 標題列或空行

    if (cols.length >= 4) {
      // 官方格式：西元日期,星期,是否放假,備註
      const isHoliday = cols[2] === "2";
      const name = cols[3];
      if (!isHoliday) {
        skippedWorkdays++;
        continue;
      }
      if (!name) {
        skippedWeekends++; // 放假但沒有假日名稱＝一般週末
        continue;
      }
      rows.push({ date, name });
    } else if (cols.length >= 2 && cols[1]) {
      // 簡易格式：YYYY-MM-DD,假日名稱
      rows.push({ date, name: cols[1] });
    }
  }

  console.log(
    `解析完成：假日 ${rows.length} 天` +
      (skippedWorkdays ? `，略過上班日 ${skippedWorkdays} 天` : "") +
      (skippedWeekends ? `，略過一般週末 ${skippedWeekends} 天` : ""),
  );
  return rows;
}

async function list() {
  const rows = await prisma.publicHoliday.findMany({ orderBy: { date: "asc" } });
  if (rows.length === 0) {
    console.log("尚未匯入任何國定假日。");
    return;
  }
  const byYear = new Map<string, number>();
  for (const r of rows) {
    const y = r.date.toISOString().slice(0, 4);
    byYear.set(y, (byYear.get(y) ?? 0) + 1);
  }
  console.log("已匯入的國定假日：");
  for (const [year, count] of [...byYear].sort()) console.log(`  ${year} 年：${count} 天`);
  console.log(
    `  範圍：${rows[0].date.toISOString().slice(0, 10)} ～ ${rows[rows.length - 1].date
      .toISOString()
      .slice(0, 10)}`,
  );
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--list")) return list();

  const file = args.find((a) => !a.startsWith("--"));
  if (!file) {
    console.error(
      "用法：npx tsx scripts/import-holidays.ts <檔案路徑> [--source dgpa-115] [--replace-year 2026]\n" +
        "官方檔案：行政院人事行政總處「政府行政機關辦公日曆表」CSV",
    );
    process.exit(1);
  }
  const source = args[args.indexOf("--source") + 1] ?? "manual";
  const replaceYearArg = args.includes("--replace-year")
    ? args[args.indexOf("--replace-year") + 1]
    : undefined;

  const rows = parse(readFileSync(file, "utf-8"));
  if (rows.length === 0) {
    console.error("檔案裡沒有解析到任何假日，請確認格式。");
    process.exit(1);
  }

  if (replaceYearArg) {
    const removed = await prisma.publicHoliday.deleteMany({
      where: {
        date: {
          gte: new Date(`${replaceYearArg}-01-01T00:00:00.000Z`),
          lte: new Date(`${replaceYearArg}-12-31T00:00:00.000Z`),
        },
      },
    });
    console.log(`已清除 ${replaceYearArg} 年既有資料 ${removed.count} 筆`);
  }

  let created = 0;
  let updated = 0;
  for (const r of rows) {
    const date = new Date(`${r.date}T00:00:00.000Z`);
    const existing = await prisma.publicHoliday.findUnique({ where: { date } });
    if (existing) {
      if (existing.name !== r.name || existing.source !== source) {
        await prisma.publicHoliday.update({ where: { date }, data: { name: r.name, source } });
        updated++;
      }
    } else {
      await prisma.publicHoliday.create({ data: { date, name: r.name, source } });
      created++;
    }
  }
  console.log(`匯入完成：新增 ${created}、更新 ${updated}（來源標記 ${source}）`);
  await list();
  console.log(
    "\n提醒：只有標記「國定假日停開」的門診（預設為兒童發展篩檢）會受影響，" +
      "一般門診當天照常開放預約。",
  );
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
