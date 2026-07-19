import { z } from "zod";

/**
 * 台灣身分證字號檢查碼驗證。
 * 格式：1 英文字母 + 1/2（性別）+ 8 位數字。
 */
const LETTER_VALUES: Record<string, number> = {
  A: 10, B: 11, C: 12, D: 13, E: 14, F: 15, G: 16, H: 17, I: 34, J: 18,
  K: 19, L: 20, M: 21, N: 22, O: 35, P: 23, Q: 24, R: 25, S: 26, T: 27,
  U: 28, V: 29, W: 32, X: 30, Y: 31, Z: 33,
};

export function isValidNationalId(id: string): boolean {
  const s = id.trim().toUpperCase();
  if (!/^[A-Z][12]\d{8}$/.test(s)) return false;
  const lv = LETTER_VALUES[s[0]];
  const digits = [Math.floor(lv / 10), lv % 10, ...s.slice(1).split("").map(Number)];
  const weights = [1, 9, 8, 7, 6, 5, 4, 3, 2, 1, 1];
  const sum = digits.reduce((acc, d, i) => acc + d * weights[i], 0);
  return sum % 10 === 0;
}

/**
 * 新式外來人口統一證號：1 英文字母 + 8/9（性別）+ 8 位數字，檢查碼規則同身分證。
 * 亦相容舊式（第 2 碼 A-D）：僅做格式檢查。
 */
export function isValidResidentCert(id: string): boolean {
  const s = id.trim().toUpperCase();
  if (/^[A-Z][89]\d{8}$/.test(s)) {
    const lv = LETTER_VALUES[s[0]];
    const digits = [Math.floor(lv / 10), lv % 10, ...s.slice(1).split("").map(Number)];
    const weights = [1, 9, 8, 7, 6, 5, 4, 3, 2, 1, 1];
    return digits.reduce((acc, d, i) => acc + d * weights[i], 0) % 10 === 0;
  }
  return /^[A-Z][A-D]\d{8}$/.test(s); // 舊式居留證號
}

/** 護照號碼：僅格式檢查（5–20 位英數字） */
export function isValidPassport(id: string): boolean {
  return /^[A-Z0-9]{5,20}$/i.test(id.trim());
}

export function isValidIdNumber(idType: string, idNumber: string): boolean {
  switch (idType) {
    case "NATIONAL_ID":
      return isValidNationalId(idNumber);
    case "RESIDENT_CERT":
      return isValidResidentCert(idNumber);
    case "PASSPORT":
      return isValidPassport(idNumber);
    default:
      return false;
  }
}

/** 台灣手機：09 開頭共 10 碼 */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^09\d{8}$/, "手機號碼格式不正確（09 開頭共 10 碼）");

export const dateStrSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式不正確");

export const timeStrSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "時間格式不正確");

export const idTypeSchema = z.enum(["NATIONAL_ID", "RESIDENT_CERT", "PASSPORT"]);

export const patientInputSchema = z
  .object({
    name: z.string().trim().min(1, "請輸入病人姓名").max(50),
    phone: phoneSchema,
    birthDate: dateStrSchema,
    idType: idTypeSchema.default("NATIONAL_ID"),
    idNumber: z.string().trim().min(1, "請輸入證件號碼").max(20),
    gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional(),
    visitType: z.enum(["FIRST_VISIT", "RETURN_VISIT"]).optional(),
    note: z.string().trim().max(200).optional(),
  })
  .superRefine((val, ctx) => {
    if (!isValidIdNumber(val.idType, val.idNumber)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["idNumber"],
        message:
          val.idType === "NATIONAL_ID"
            ? "身分證字號格式或檢查碼不正確"
            : "證件號碼格式不正確",
      });
    }
    const birth = new Date(`${val.birthDate}T00:00:00Z`).getTime();
    if (Number.isNaN(birth) || birth > Date.now()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["birthDate"], message: "出生日期不正確" });
    }
  });

export type PatientInput = z.infer<typeof patientInputSchema>;

export const bookingRequestSchema = z.object({
  clinicTypeId: z.string().min(1, "請選擇門診類型"),
  doctorId: z.string().min(1).or(z.literal("any")),
  date: dateStrSchema,
  startTime: timeStrSchema,
  patient: patientInputSchema,
  requestId: z.string().uuid("重複送出防護參數錯誤"),
});
export type BookingRequest = z.infer<typeof bookingRequestSchema>;
