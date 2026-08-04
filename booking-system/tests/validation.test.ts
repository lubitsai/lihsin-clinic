/** 資料驗證與個資保護單元測試：身分證檢查碼、遮罩、加密往返 */
import { describe, it, expect } from "vitest";
import {
  isValidNationalId,
  isValidResidentCert,
  patientInputSchema,
  slotTimeSchema,
} from "@/lib/validation";
import { slotTimes } from "@/lib/tw-time";
import { maskIdNumber, maskPhone, maskName } from "@/lib/masking";
import { encryptPii, decryptPii, hashIdNumber } from "@/lib/crypto";
import { genNationalId } from "./helpers";

describe("台灣身分證驗證", () => {
  it("正確檢查碼通過、錯誤檢查碼拒絕", () => {
    expect(isValidNationalId("A123456789")).toBe(true); // 常見測試號，檢查碼正確
    expect(isValidNationalId("A123456788")).toBe(false);
    expect(isValidNationalId("B123456789")).toBe(false);
    expect(isValidNationalId("A12345678")).toBe(false);
    expect(isValidNationalId("112345678A")).toBe(false);
    for (let i = 0; i < 20; i++) expect(isValidNationalId(genNationalId())).toBe(true);
  });

  it("新式居留證統一證號驗證", () => {
    expect(isValidResidentCert("A800000014")).toBe(true);
    expect(isValidResidentCert("A800000015")).toBe(false);
  });

  it("patientInputSchema：手機、生日、證件整合驗證", () => {
    const ok = patientInputSchema.safeParse({
      name: "王小明", phone: "0912345678", birthDate: "2020-01-15",
      idType: "NATIONAL_ID", idNumber: "A123456789",
    });
    expect(ok.success).toBe(true);

    expect(
      patientInputSchema.safeParse({
        name: "王小明", phone: "12345", birthDate: "2020-01-15",
        idType: "NATIONAL_ID", idNumber: "A123456789",
      }).success,
    ).toBe(false);
    expect(
      patientInputSchema.safeParse({
        name: "王小明", phone: "0912345678", birthDate: "2020-01-15",
        idType: "NATIONAL_ID", idNumber: "A123456780",
      }).success,
    ).toBe(false);
    // 外籍病人可用護照
    expect(
      patientInputSchema.safeParse({
        name: "JOHN DOE", phone: "0987654321", birthDate: "2019-06-01",
        idType: "PASSPORT", idNumber: "X1234567",
      }).success,
    ).toBe(true);
  });
});

describe("遮罩與加密", () => {
  it("證件號與手機遮罩", () => {
    expect(maskIdNumber("A123456789")).toBe("A12****789");
    expect(maskPhone("0912345678")).toBe("0912***678");
    expect(maskName("王小明")).toBe("王○明");
  });

  it("AES-256-GCM 加密往返；HMAC 雜湊穩定且不等於原文", () => {
    const id = "A123456789";
    const cipher = encryptPii(id);
    expect(cipher).not.toContain(id);
    expect(decryptPii(cipher)).toBe(id);
    // 每次加密 IV 不同 → 密文不同
    expect(encryptPii(id)).not.toBe(cipher);
    // 雜湊穩定（供唯一索引），大小寫正規化
    expect(hashIdNumber("a123456789")).toBe(hashIdNumber("A123456789"));
    expect(hashIdNumber(id)).not.toContain(id);
  });
});

describe("時段格點（整點／半點，每 30 分鐘一組）", () => {
  it("整點與半點通過，其餘分鐘拒絕", () => {
    for (const t of ["08:00", "08:30", "00:00", "14:30", "21:30", "23:30"]) {
      expect(slotTimeSchema.safeParse(t).success).toBe(true);
    }
    for (const t of ["08:15", "08:45", "09:01", "11:20", "14:29"]) {
      expect(slotTimeSchema.safeParse(t).success).toBe(false);
    }
  });

  it("格式本身不合法者一樣拒絕", () => {
    for (const t of ["8:00", "24:00", "08:60", "0800", ""]) {
      expect(slotTimeSchema.safeParse(t).success).toBe(false);
    }
  });

  it("班表落在格點時，產生的時段全部是整點或半點", () => {
    const times = slotTimes("08:00", "12:00");
    expect(times).toEqual([
      "08:00", "08:30", "09:00", "09:30", "10:00", "10:30", "11:00", "11:30",
    ]);
    expect(times.every((t) => t.endsWith(":00") || t.endsWith(":30"))).toBe(true);
  });

  it("班表若非格點，整天的時段都會歪掉——這正是要在寫入時擋下的原因", () => {
    expect(slotTimes("08:15", "10:00")).toEqual(["08:15", "08:45", "09:15", "09:45"]);
    expect(slotTimeSchema.safeParse("08:15").success).toBe(false);
  });
});
