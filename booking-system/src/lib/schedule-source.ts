/**
 * 官網班表的套用邏輯（官網為主，系統跟隨）。
 *
 * 資料來源＝`prisma/schedule.json`，由 `internal/tools/sync_schedule.py` 從官網
 * `index.html` 的門診時間表產生，**不可手改**。seed 與 `scripts/sync-schedule.ts`
 * 共用本檔，避免「初次建置」與「日後同步」兩套邏輯漂移。
 *
 * 醫師以姓氏標籤（蔡／李）對應，不是資料庫 id——官網表格寫的就是姓氏，
 * 新增醫師時只要 doctors.name 對得起來即可，不必改 Python 工具。
 */
import type { PrismaClient, SessionPeriod } from "@prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface ScheduleSlot {
  session: SessionPeriod;
  start: string;
  end: string;
  doctors: string[];
}
export interface ScheduleException {
  session: SessionPeriod;
  start: string;
  end: string;
}
export interface ScheduleSource {
  weekly: Record<string, ScheduleSlot[]>;
  exceptions: Record<string, ScheduleException[]>;
}

/** 由官網同步而來的日期例外，統一標記於此欄位；櫃檯自行輸入的例外不會被動到 */
export const WEBSITE_SYNC_ACTOR = "website-sync";

export function loadScheduleSource(dir = join(process.cwd(), "prisma")): ScheduleSource {
  const raw = readFileSync(join(dir, "schedule.json"), "utf-8");
  return JSON.parse(raw) as ScheduleSource;
}

/** 姓氏標籤 → 醫師 id；對不到或對到多位都要立刻停下來，不能猜 */
export function resolveDoctors(
  doctors: { id: string; name: string }[],
  labels: string[],
): string[] {
  return labels.map((label) => {
    const hits = doctors.filter((d) => d.name.startsWith(label));
    if (hits.length === 0) {
      throw new Error(
        `官網班表寫的「${label}醫師」在系統中找不到對應醫師（現有：${doctors.map((d) => d.name).join("、") || "無"}）。` +
          `請先在後台建立該醫師，或確認姓氏是否一致。`,
      );
    }
    if (hits.length > 1) {
      throw new Error(
        `官網班表寫的「${label}醫師」對應到多位醫師（${hits.map((d) => d.name).join("、")}），無法判斷是哪一位。`,
      );
    }
    return hits[0].id;
  });
}

export interface ApplyResult {
  created: number;
  updated: number;
  removed: number;
  exceptionsApplied: number;
  warnings: string[];
}

/**
 * 把官網班表套用到週班表與日期例外。
 *
 * 週班表：官網有的建立／更新，官網沒有的刪除——刪除這一步不能省，
 * 否則醫師從某診次撤掉後舊資料會留著，該診次就一直是雙診。
 *
 * 日期例外：官網 EXCEPTIONS 的值是「當日完整時段表」，因此
 *   - 空陣列          → 整日休診
 *   - 當日少了某診次   → 該診次停診
 *   - 時間與平常不同   → 該診次特殊時間
 *   - 多出平常沒有的診次 → **不自動建立**（官網沒寫由哪位醫師看，猜錯比不做更糟），只回報
 * 只處理今天以後的日期；過期條目官網說可留著，這裡略過。
 */
export async function applySchedule(
  prisma: PrismaClient,
  source: ScheduleSource,
  today: string,
): Promise<ApplyResult> {
  const result: ApplyResult = {
    created: 0,
    updated: 0,
    removed: 0,
    exceptionsApplied: 0,
    warnings: [],
  };
  const doctors = await prisma.doctor.findMany({ where: { isActive: true } });

  // ── 週班表 ──────────────────────────────────────────
  for (const [weekdayStr, slots] of Object.entries(source.weekly)) {
    const weekday = Number(weekdayStr);
    const keep = new Set<string>();
    for (const slot of slots) {
      for (const doctorId of resolveDoctors(doctors, slot.doctors)) {
        keep.add(`${slot.session}|${doctorId}`);
        const existing = await prisma.weeklyScheduleTemplate.findUnique({
          where: { weekday_session_doctorId: { weekday, session: slot.session, doctorId } },
        });
        if (!existing) {
          await prisma.weeklyScheduleTemplate.create({
            data: {
              weekday,
              session: slot.session,
              startTime: slot.start,
              endTime: slot.end,
              doctorId,
              slotCapacity: 1,
              allowOnline: true,
            },
          });
          result.created++;
        } else if (
          existing.startTime !== slot.start ||
          existing.endTime !== slot.end ||
          !existing.isActive
        ) {
          await prisma.weeklyScheduleTemplate.update({
            where: { id: existing.id },
            data: { startTime: slot.start, endTime: slot.end, isActive: true },
          });
          result.updated++;
        }
      }
    }
    const rows = await prisma.weeklyScheduleTemplate.findMany({ where: { weekday } });
    const stale = rows.filter((r) => !keep.has(`${r.session}|${r.doctorId}`));
    if (stale.length > 0) {
      await prisma.weeklyScheduleTemplate.deleteMany({
        where: { id: { in: stale.map((r) => r.id) } },
      });
      result.removed += stale.length;
    }
  }

  // ── 單日特例 ────────────────────────────────────────
  const dates = Object.keys(source.exceptions).filter((d) => d >= today);
  // 先清掉上一次同步建立的（只清自己建的，櫃檯輸入的不動），再依現況重建
  await prisma.scheduleException.deleteMany({
    where: { createdBy: WEBSITE_SYNC_ACTOR, date: { gte: new Date(`${today}T00:00:00.000Z`) } },
  });

  for (const date of dates) {
    const dayOfWeek = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    const baseline = source.weekly[String(dayOfWeek)] ?? [];
    const actual = source.exceptions[date];
    const reason = "官網門診異動公告（自動同步）";
    const dateValue = new Date(`${date}T00:00:00.000Z`);

    if (actual.length === 0) {
      await prisma.scheduleException.create({
        data: { date: dateValue, type: "CLINIC_CLOSED_DAY", reason, createdBy: WEBSITE_SYNC_ACTOR },
      });
      result.exceptionsApplied++;
      continue;
    }

    for (const base of baseline) {
      const match = actual.find((a) => a.session === base.session);
      if (!match) {
        await prisma.scheduleException.create({
          data: {
            date: dateValue,
            type: "SESSION_CLOSED",
            session: base.session,
            reason,
            createdBy: WEBSITE_SYNC_ACTOR,
          },
        });
        result.exceptionsApplied++;
      } else if (match.start !== base.start || match.end !== base.end) {
        await prisma.scheduleException.create({
          data: {
            date: dateValue,
            type: "SPECIAL_HOURS",
            session: base.session,
            startTime: match.start,
            endTime: match.end,
            reason,
            createdBy: WEBSITE_SYNC_ACTOR,
          },
        });
        result.exceptionsApplied++;
      }
    }

    for (const extra of actual) {
      if (!baseline.some((b) => b.session === extra.session)) {
        result.warnings.push(
          `${date} 官網多開了平常沒有的${sessionLabel(extra.session)}（${extra.start}–${extra.end}），` +
            `但公告沒寫由哪位醫師看診，未自動建立。請於後台「排班管理」手動加診。`,
        );
      }
    }
  }

  // 官網公告的「某某醫師代診」只寫在公告圖與說明文字裡，沒有結構化資料可讀
  if (dates.length > 0) {
    result.warnings.push(
      "提醒：官網單日公告若包含「由某醫師代診」，本同步無法得知（官網資料只有時間、沒有醫師），" +
        "請於後台「排班管理」另行建立代診例外。",
    );
  }

  return result;
}

function sessionLabel(s: SessionPeriod): string {
  return s === "MORNING" ? "早診" : s === "AFTERNOON" ? "午診" : "晚診";
}
