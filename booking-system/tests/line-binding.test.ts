/**
 * 櫃檯核對制的 LINE 綁定（院長 2026-08-15 裁示）。
 *
 * 這一層驗的是「代碼本身守不守規矩」——一次性、會過期、亂猜無效。
 * 真正證明身分的是櫃檯當面核對健保卡，那件事程式驗不到，
 * 所以更要確保代碼不會被重複使用或無限期有效。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { createAppointment } from "@/lib/booking";
import { consumeBindingCode, BINDING_CODE_TTL_MS } from "@/lib/line-binding";
import { hashToken, randomBindingCode, normalizeBindingCode } from "@/lib/crypto";
import { resetDb, seedBase, makePatient, futureDate, PATIENT_ACTOR } from "./helpers";

/** 直接建一組代碼（正式流程由前台 issueBindingCode 產生） */
async function issueCode(opts: { expiresAt?: Date; displayName?: string } = {}) {
  const account = await prisma.lineAccount.create({
    data: {
      lineUserId: `U${Math.random().toString(36).slice(2, 12)}`,
      displayName: opts.displayName ?? "測試家長",
      isFollowing: true,
    },
  });
  const code = randomBindingCode();
  await prisma.lineBindingCode.create({
    data: {
      codeHash: hashToken(code),
      lineAccountId: account.id,
      expiresAt: opts.expiresAt ?? new Date(Date.now() + BINDING_CODE_TTL_MS),
    },
  });
  return { account, code };
}

describe("綁定代碼", () => {
  beforeEach(resetDb);

  it("有效代碼可核銷一次，第二次即失效", async () => {
    const { account, code } = await issueCode({ displayName: "王媽媽" });

    const owner = await consumeBindingCode(code);
    expect(owner.lineAccountId).toBe(account.id);
    expect(owner.displayName).toBe("王媽媽");

    // 一次性：櫃檯不能拿同一組代碼連續綁到好幾筆病歷
    await expect(consumeBindingCode(code)).rejects.toMatchObject({
      userMessage: expect.stringContaining("無效或已過期"),
    });
  });

  it("過期代碼無效", async () => {
    const { code } = await issueCode({ expiresAt: new Date(Date.now() - 1000) });
    await expect(consumeBindingCode(code)).rejects.toMatchObject({
      userMessage: expect.stringContaining("無效或已過期"),
    });
  });

  it("不存在的代碼無效，且與過期代碼是同一句訊息", async () => {
    await expect(consumeBindingCode("ZZZZZZ")).rejects.toMatchObject({
      userMessage: expect.stringContaining("無效或已過期"),
    });
  });

  it("大小寫、空白與連字號都當成同一組（家長會抄成 ABC-123）", async () => {
    const { account, code } = await issueCode();
    const messy = `${code.slice(0, 3)}-${code.slice(3)}`.toLowerCase();
    expect(normalizeBindingCode(messy)).toBe(code);
    const owner = await consumeBindingCode(` ${messy} `);
    expect(owner.lineAccountId).toBe(account.id);
  });

  it("並發核銷同一組代碼只有一位櫃檯成功", async () => {
    const { code } = await issueCode();
    const results = await Promise.allSettled([
      consumeBindingCode(code),
      consumeBindingCode(code),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("代碼不落地：資料表只存雜湊", async () => {
    const { code } = await issueCode();
    const rows = await prisma.lineBindingCode.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].codeHash).not.toBe(code);
    expect(JSON.stringify(rows[0])).not.toContain(code);
  });
});

describe("自動綁定的界線：只認這次新建的病歷", () => {
  beforeEach(resetDb);

  it("首次預約會建立病歷（可自動綁定）；同一位再預約就不算新建", async () => {
    const { drTsai, general } = await seedBase();
    const input = makePatient();

    const first = await createAppointment({
      clinicTypeId: general.id, doctorId: drTsai.id, date: futureDate(2), startTime: "09:00",
      patientInput: input, source: "LINE", actor: PATIENT_ACTOR,
    });
    expect(first.createdPatientIds).toEqual([first.patient.id]);

    const second = await createAppointment({
      clinicTypeId: general.id, doctorId: drTsai.id, date: futureDate(4), startTime: "09:00",
      patientInput: input, source: "LINE", actor: PATIENT_ACTOR,
    });
    expect(second.patient.id).toBe(first.patient.id);
    expect(second.createdPatientIds).toHaveLength(0);
  });

  it("同行家人新建的病歷也算，否則下次單獨替他預約會被自己的規則擋死", async () => {
    const { drTsai, general } = await seedBase();
    const primary = makePatient();
    const companion = makePatient();

    const r = await createAppointment({
      clinicTypeId: general.id, doctorId: drTsai.id, date: futureDate(2), startTime: "09:00",
      patientInput: primary, companions: [companion], source: "LINE", actor: PATIENT_ACTOR,
    });
    expect(r.createdPatientIds).toHaveLength(2);
    expect(r.createdPatientIds).toContain(r.patient.id);
    expect(r.companions?.[0]).toBeDefined();
    expect(r.createdPatientIds).toContain(r.companions![0].id);
  });

  it("櫃檯代約建立的病歷同樣回報為新建（由櫃檯決定要不要綁）", async () => {
    const { drTsai, general } = await seedBase();
    const r = await createAppointment({
      clinicTypeId: general.id, doctorId: drTsai.id, date: futureDate(2), startTime: "09:00",
      patientInput: makePatient(), source: "STAFF",
      actor: { type: "STAFF", id: "s1", name: "櫃檯" }, isStaff: true,
    });
    expect(r.createdPatientIds).toEqual([r.patient.id]);
    // 但櫃檯代約沒有 LINE 帳號可綁，所以實際上不會有綁定，也不會有通知
    expect(await prisma.linePatientLink.count()).toBe(0);
    expect(await prisma.notification.count()).toBe(0);
  });
});
