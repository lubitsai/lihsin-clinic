/** 測試共用：重置資料庫、建立基礎資料（醫師/門診/班表）、產生病人資料 */
import { prisma } from "@/lib/db";
import { clearSettingsCache } from "@/lib/settings";
import { addDays, todayStr, weekdayOf } from "@/lib/tw-time";
import type { PatientInput } from "@/lib/validation";
import type { SessionPeriod } from "@prisma/client";

export async function resetDb() {
  // 依外鍵相依順序清空
  const tables = [
    "notifications",
    "appointment_status_history",
    "no_show_records",
    "booking_restrictions",
    "appointments",
    "appointment_slots",
    "schedule_exceptions",
    "weekly_schedule_templates",
    "clinic_type_doctors",
    "line_patient_links",
    "line_accounts",
    "otp_codes",
    "portal_sessions",
    "staff_sessions",
    "patient_contacts",
    "patients",
    "staff_users",
    "staff_roles",
    "clinic_types",
    "doctors",
    "system_settings",
    "audit_logs",
  ];
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(", ")} CASCADE`);
  clearSettingsCache();
}

export interface BaseData {
  drTsai: { id: string };
  drLee: { id: string };
  general: { id: string };
  development: { id: string };
}

/**
 * 建立兩位醫師＋一般門診/發展篩檢＋未來 14 天皆有班的固定班表。
 * 預設：兩位醫師（雙診）每天早/午/晚都有班（測試個別再加例外調整）。
 */
export async function seedBase(opts: { doubleShift?: boolean } = {}): Promise<BaseData> {
  const doubleShift = opts.doubleShift ?? true;
  const drTsai = await prisma.doctor.create({
    data: { name: "蔡宗儒", title: "院長", displayOrder: 1 },
  });
  const drLee = await prisma.doctor.create({
    data: { name: "李佳玲", title: "主治醫師", displayOrder: 2 },
  });
  const general = await prisma.clinicType.create({
    data: {
      code: "GENERAL",
      name: "一般門診",
      allowedWeekdays: [],
      allowedSessions: [],
      doctors: { create: [{ doctorId: drTsai.id }, { doctorId: drLee.id }] },
    },
  });
  const development = await prisma.clinicType.create({
    data: {
      code: "DEVELOPMENT",
      name: "兒童發展篩檢",
      requiresReview: true,
      allowedWeekdays: [],
      allowedSessions: [],
      doctors: { create: [{ doctorId: drTsai.id }, { doctorId: drLee.id }] },
    },
  });

  const sessions: { session: SessionPeriod; start: string; end: string }[] = [
    { session: "MORNING", start: "08:00", end: "12:00" },
    { session: "AFTERNOON", start: "14:30", end: "18:00" },
    { session: "EVENING", start: "18:30", end: "21:30" },
  ];
  const doctors = doubleShift ? [drTsai, drLee] : [drTsai];
  for (let weekday = 0; weekday <= 6; weekday++) {
    for (const s of sessions) {
      for (const d of doctors) {
        await prisma.weeklyScheduleTemplate.create({
          data: {
            weekday,
            session: s.session,
            startTime: s.start,
            endTime: s.end,
            doctorId: d.id,
            slotCapacity: 1,
          },
        });
      }
    }
  }
  return { drTsai, drLee, general, development };
}

let idSeq = 0;

/** 產生檢查碼正確的台灣身分證字號（測試用隨機） */
export function genNationalId(): string {
  const letters = "ABCDEFGHJKLMNPQRSTUVXYWZIO";
  const LETTER_VALUES: Record<string, number> = {
    A: 10, B: 11, C: 12, D: 13, E: 14, F: 15, G: 16, H: 17, I: 34, J: 18,
    K: 19, L: 20, M: 21, N: 22, O: 35, P: 23, Q: 24, R: 25, S: 26, T: 27,
    U: 28, V: 29, W: 32, X: 30, Y: 31, Z: 33,
  };
  const letter = letters[Math.floor(Math.random() * 24)];
  const gender = Math.random() < 0.5 ? 1 : 2;
  const digits = Array.from({ length: 7 }, () => Math.floor(Math.random() * 10));
  const lv = LETTER_VALUES[letter];
  const all = [Math.floor(lv / 10), lv % 10, gender, ...digits];
  const weights = [1, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  const sum = all.reduce((acc, d, i) => acc + d * weights[i], 0);
  const check = (10 - (sum % 10)) % 10;
  return `${letter}${gender}${digits.join("")}${check}`;
}

export function makePatient(overrides: Partial<PatientInput> = {}): PatientInput {
  idSeq++;
  return {
    name: `測試病人${idSeq}`,
    phone: `09${String(10000000 + idSeq).padStart(8, "0")}`,
    birthDate: "2018-05-10",
    idType: "NATIONAL_ID",
    idNumber: genNationalId(),
    ...overrides,
  };
}

/** 未來第 n 天（避開「今天」的截止時間干擾，預設從明天起算） */
export function futureDate(n: number): string {
  return addDays(todayStr(), n);
}

export const STAFF_ACTOR = { type: "STAFF" as const, id: "test-staff", name: "測試櫃檯" };
export const PATIENT_ACTOR = { type: "PATIENT" as const };

export { todayStr, addDays, weekdayOf };
