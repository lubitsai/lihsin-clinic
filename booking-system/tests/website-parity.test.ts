/**
 * 「逐字沿用官網」的文字，真的還跟官網一樣嗎？
 *
 * clinic-notes.ts 有幾段明講是官網原文（過號、現場掛號時間、初診攜帶、午診止掛），
 * 但官網會繼續改——2026-10 一次就改了過號規則的措辭、又新增午診止掛，
 * 預約系統這邊沒人提醒就會停在舊版。這組測試把官網原始檔讀進來比對，
 * 官網一改、這裡就紅，提醒同步（同步前仍需院長確認擺放位置，見 docs/08）。
 *
 * 比對方式：去掉 HTML 標籤與所有空白後做子字串比對——官網原文有 <strong>／<a>，
 * 這裡的常數是純文字，標籤與換行不算差異，字句才算。
 *
 * 預約系統日後若搬到獨立 repo、讀不到官網檔案，整組自動略過，不會擋 CI。
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  WALK_IN_REGISTRATION,
  AFTERNOON_REGISTRATION,
  MISSED_NUMBER,
  FIRST_VISIT_ITEMS,
  CLINIC_TYPE_NOTES,
  isWeekdayAfternoon,
} from "@/lib/clinic-notes";
import { SETTING_DEFAULTS } from "@/lib/settings";

const SITE_ROOT = join(process.cwd(), "..");
const VISIT_GUIDE = join(SITE_ROOT, "visit-guide.html");
const INDEX = join(SITE_ROOT, "index.html");
const SMOKING = join(SITE_ROOT, "health", "smoking-cessation.html");
const siteAvailable = existsSync(VISIT_GUIDE) && existsSync(INDEX);

function plain(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, "");
}

const squash = (s: string) => s.replace(/\s+/g, "");

describe.skipIf(!siteAvailable)("與官網原文一致（逐字沿用的段落）", () => {
  const visitGuide = siteAvailable ? plain(readFileSync(VISIT_GUIDE, "utf-8")) : "";
  const index = siteAvailable ? plain(readFileSync(INDEX, "utf-8")) : "";

  it("過號了怎麼辦（visit-guide.html#missed-number）", () => {
    const parts = [
      MISSED_NUMBER.lead,
      ...MISSED_NUMBER.order,
      MISSED_NUMBER.stepAway,
      MISSED_NUMBER.note,
      MISSED_NUMBER.urgent,
    ];
    for (const p of parts) expect(visitGuide, p).toContain(squash(p));
  });

  it("午診止掛與晚診掛號（visit-guide.html#afternoon-registration）", () => {
    const parts = [
      AFTERNOON_REGISTRATION.closing,
      AFTERNOON_REGISTRATION.weekdayStepAway,
      AFTERNOON_REGISTRATION.missedNumber.before,
      AFTERNOON_REGISTRATION.missedNumber.after,
      AFTERNOON_REGISTRATION.saturday,
    ];
    for (const p of parts) expect(visitGuide, p).toContain(squash(p));
  });

  it("初診請攜帶（visit-guide.html）", () => {
    for (const p of FIRST_VISIT_ITEMS) expect(visitGuide, p).toContain(squash(p));
  });

  it("各診次現場掛號開始時間（index.html 首頁同名區塊）", () => {
    expect(index).toContain(squash(WALK_IN_REGISTRATION.title));
    expect(index).toContain(squash(WALK_IN_REGISTRATION.times));
    expect(index).toContain(squash(WALK_IN_REGISTRATION.note));
  });
  // 以下幾段不是逐字沿用（官網是條列、這裡是一句話），改比對「事實」：
  // 官網改了時間或數字，這裡就紅，提醒同步 clinic-notes.ts／系統設定預設值。

  it("疫苗停打時間（visit-guide.html#booking-rules〈要打預防針的話〉）", () => {
    const note = squash(CLINIC_TYPE_NOTES.GENERAL.items.join(""));
    expect(visitGuide).toContain(squash("每日最後一診結束前 1 小時停止施打疫苗（清點申報作業）"));
    expect(note).toContain(squash("每日最後一診結束前 1 小時停止施打疫苗（清點申報作業）"));
    for (const [days, time] of [["週一至週五", "20:30"], ["週六", "17:00"], ["週日", "20:00"]]) {
      expect(visitGuide, `${days} ${time}`).toContain(`${days}：${time}前`);
      expect(note, `${days} ${time}`).toContain(`${days}${time}前`);
    }
    const caveat = CLINIC_TYPE_NOTES.GENERAL.items[1];
    expect(visitGuide, caveat).toContain(squash(caveat));
  });

  it("兒童發展篩檢施測規則（visit-guide.html〈兒童發展篩檢門診〉）", () => {
    const [bring, onePerSlot, hours] = CLINIC_TYPE_NOTES.DEVELOPMENT.items;
    expect(visitGuide, bring).toContain(squash(bring));
    expect(visitGuide, onePerSlot).toContain(squash(onePerSlot));
    // 官網寫「施測時間：…」，這裡寫「施測時間為…」，比對冒號後的時段本身
    const times = squash(hours.replace(/^施測時間為/, ""));
    expect(visitGuide, hours).toContain(times);
  });

  it("預約規則的數字與系統設定預設值一致（visit-guide.html#booking-rules）", () => {
    const d = SETTING_DEFAULTS;
    const checks = [
      `每日${d["booking.open_time"]}釋出第${d["booking.open_days"]}天的時段`,
      `該時段開始的${d["booking.same_day_cutoff_minutes"] / 60}小時前`,
      `預約時段開始後${d["booking.checkin_grace_minutes"]}分鐘內`,
      `同時最多保留${d["booking.active_max"]}筆`,
      `累計${d["booking.no_show_threshold"]}次未到，將暫停網路預約資格${d["booking.no_show_suspension_days"] / 30}個月`,
    ];
    for (const c of checks) expect(visitGuide, c).toContain(c);
  });

  it("戒菸門診由蔡宗儒院長看診（一般門診說明引用，health/smoking-cessation.html）", () => {
    const smoking = plain(readFileSync(SMOKING, "utf-8"));
    expect(smoking).toContain("戒菸門診由蔡宗儒院長看診");
  });
});

describe("平日午診 18:00 前返回報到：只提醒週一至週五的午診", () => {
  it("週一至週五的午診要提醒", () => {
    expect(isWeekdayAfternoon("2026-10-19", "AFTERNOON")).toBe(true); // 一
    expect(isWeekdayAfternoon("2026-10-23", "AFTERNOON")).toBe(true); // 五
  });

  it("週六午診不提醒（沒有晚診，規則是看完最後一位病人前回來）", () => {
    expect(isWeekdayAfternoon("2026-10-24", "AFTERNOON")).toBe(false);
  });

  it("早診、晚診、週日都不提醒", () => {
    expect(isWeekdayAfternoon("2026-10-19", "MORNING")).toBe(false);
    expect(isWeekdayAfternoon("2026-10-19", "EVENING")).toBe(false);
    expect(isWeekdayAfternoon("2026-10-25", "EVENING")).toBe(false);
  });

  it("還沒選日期或時段時不提醒", () => {
    expect(isWeekdayAfternoon("", "AFTERNOON")).toBe(false);
    expect(isWeekdayAfternoon("2026-10-19", undefined)).toBe(false);
  });
});
