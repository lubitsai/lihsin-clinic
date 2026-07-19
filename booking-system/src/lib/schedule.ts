/**
 * 排班運算：固定週班表 + 日期例外 → 當日各醫師的實際看診區間與 30 分鐘時段。
 * 此為「醫師何時看診」的唯一事實來源；可預約性再疊加名額與門診類型條件。
 */
import { prisma, type Tx } from "./db";
import { dateToDb, slotTimes, weekdayOf } from "./tw-time";
import type { SessionPeriod } from "@prisma/client";

export interface WorkingBlock {
  doctorId: string;
  session: SessionPeriod;
  startTime: string;
  endTime: string;
  slotCapacity: number;
  allowOnline: boolean;
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
 * 計算某日期各醫師實際看診區間（已套用所有日期例外）。
 * 例外套用順序：全日休 → 診別休 → 醫師休 → 代診 → 特殊時間 → 加診。
 */
export async function getDayScheduleBlocks(date: string, tx?: Tx): Promise<WorkingBlock[]> {
  const db = tx ?? prisma;
  const weekday = weekdayOf(date);
  const [templates, exceptions] = await Promise.all([
    db.weeklyScheduleTemplate.findMany({
      where: { weekday, isActive: true, doctor: { isActive: true } },
    }),
    db.scheduleException.findMany({ where: { date: dateToDb(date) } }),
  ]);

  let blocks: WorkingBlock[] = templates.map((t) => ({
    doctorId: t.doctorId,
    session: t.session,
    startTime: t.startTime,
    endTime: t.endTime,
    slotCapacity: t.slotCapacity,
    allowOnline: t.allowOnline,
  }));

  if (exceptions.some((e) => e.type === "CLINIC_CLOSED_DAY")) return [];

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
      blocks.push({
        doctorId: e.doctorId,
        session: e.session ?? sessionOfTime(e.startTime),
        startTime: e.startTime,
        endTime: e.endTime,
        slotCapacity: e.slotCapacity ?? 1,
        allowOnline: true,
      });
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

/** 某日期被暫停的門診類型 id 集合 */
export async function getSuspendedClinicTypes(date: string, tx?: Tx): Promise<Set<string>> {
  const db = tx ?? prisma;
  const rows = await db.scheduleException.findMany({
    where: { date: dateToDb(date), type: "CLINIC_TYPE_SUSPENDED" },
  });
  return new Set(rows.map((r) => r.clinicTypeId).filter((x): x is string => !!x));
}

/**
 * 醫師在某日期某時間是否有班（供預約引擎確認）。
 * 回傳該時間所屬的看診區間，無班則 null。
 */
export async function doctorBlockAt(
  date: string,
  doctorId: string,
  time: string,
  tx?: Tx,
): Promise<WorkingBlock | null> {
  const blocks = await getDayScheduleBlocks(date, tx);
  return (
    blocks.find((b) => b.doctorId === doctorId && b.startTime <= time && time < b.endTime) ?? null
  );
}

/** 展開某日期所有（醫師 × 30 分鐘時段），含線上開放註記 */
export async function expandDaySlots(date: string, tx?: Tx) {
  const blocks = await getDayScheduleBlocks(date, tx);
  const blocked = await getBlockedSlotKeys(date, tx);
  return blocks.flatMap((b) =>
    slotTimes(b.startTime, b.endTime).map((t) => ({
      doctorId: b.doctorId,
      session: b.session,
      startTime: t,
      endTime: addMinutesEnd(t, b.endTime),
      capacity: b.slotCapacity,
      allowOnline:
        b.allowOnline && !blocked.has(`${b.doctorId}|${t}`) && !blocked.has(`*|${t}`),
    })),
  );
}

function addMinutesEnd(t: string, blockEnd: string): string {
  const [h, m] = t.split(":").map(Number);
  const total = h * 60 + m + 30;
  const end = `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  return end < blockEnd ? end : blockEnd;
}
