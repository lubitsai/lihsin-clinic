import { Prisma } from "@prisma/client";
import { type Tx } from "./db";
import { encryptPii, hashIdNumber } from "./crypto";
import { maskIdNumber } from "./masking";
import { dateToDb, dbToDate } from "./tw-time";
import { BookingError, MSG } from "./errors";
import type { PatientInput } from "./validation";
import type { IdType, Patient } from "@prisma/client";

/**
 * 依證件（類型＋號碼雜湊）尋找病人；找到時驗證生日是否相符。
 * 生日不符一律回中性訊息，避免以證件號探測病人是否存在。
 */
export async function findPatientByIdentity(
  tx: Tx,
  idType: IdType,
  idNumber: string,
  birthDate?: string,
): Promise<Patient | null> {
  const patient = await tx.patient.findUnique({
    where: {
      uniq_patient_identity: { idType, idNumberHash: hashIdNumber(idNumber) },
    },
  });
  if (!patient) return null;
  if (birthDate && dbToDate(patient.birthDate) !== birthDate) {
    throw new BookingError("IDENTITY_MISMATCH", MSG.identityMismatch);
  }
  return patient;
}

/**
 * 預約時建立或更新病人（交易內）。
 * - 已存在：核對生日，更新姓名/電話為最新填寫值
 * - 不存在：建立，證件號加密＋雜湊＋遮罩
 */
export async function upsertPatientForBooking(tx: Tx, input: PatientInput): Promise<Patient> {
  const existing = await findPatientByIdentity(tx, input.idType, input.idNumber, input.birthDate);
  if (existing) {
    return tx.patient.update({
      where: { id: existing.id },
      data: {
        name: input.name,
        phone: input.phone,
        gender: input.gender ?? existing.gender,
      },
    });
  }
  try {
    return await tx.patient.create({
      data: {
        name: input.name,
        phone: input.phone,
        birthDate: dateToDb(input.birthDate),
        gender: input.gender,
        idType: input.idType,
        idNumberEncrypted: encryptPii(input.idNumber.trim().toUpperCase()),
        idNumberHash: hashIdNumber(input.idNumber),
        idNumberMasked: maskIdNumber(input.idNumber),
      },
    });
  } catch (e) {
    // 併發時另一交易剛建立同一病人：改為讀取既有列（仍核對生日）
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const found = await findPatientByIdentity(tx, input.idType, input.idNumber, input.birthDate);
      if (found) return found;
    }
    throw e;
  }
}

/** 以 SELECT ... FOR UPDATE 鎖定病人列，序列化同一病人的並發預約檢查 */
export async function lockPatientRow(tx: Tx, patientId: string) {
  await tx.$queryRaw`SELECT id FROM patients WHERE id = ${patientId} FOR UPDATE`;
}
