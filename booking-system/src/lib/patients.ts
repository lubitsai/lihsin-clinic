import { Prisma } from "@prisma/client";
import { type Tx } from "./db";
import { encryptPii, hashIdNumber } from "./crypto";
import { maskIdNumber } from "./masking";
import { dateToDb, dbToDate } from "./tw-time";
import { BookingError, MSG } from "./errors";
import type { PatientInput } from "./validation";
import type { IdType, Patient } from "@prisma/client";

/**
 * 若病歷已被合併，沿 mergedIntoId 走到保留的那筆（設上限防資料異常造成無限迴圈）。
 * 沒有這一步的話，被合併掉的舊病歷仍會被證件號查中，
 * 之後的預約會掛回舊病歷——同日唯一與同時筆數上限都會算在錯的人身上而失效。
 */
export async function resolveMergedPatient(tx: Tx, patient: Patient): Promise<Patient> {
  let current = patient;
  for (let i = 0; i < 5 && current.mergedIntoId; i++) {
    const next = await tx.patient.findUnique({ where: { id: current.mergedIntoId } });
    if (!next) break;
    current = next;
  }
  return current;
}

/**
 * 依證件（類型＋號碼雜湊）尋找病人；找到時驗證生日是否相符。
 * 生日不符一律回中性訊息，避免以證件號探測病人是否存在。
 * 已合併的病歷自動導向保留的那筆。
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
  return resolveMergedPatient(tx, patient);
}

/**
 * 預約時建立或更新病人（交易內）。
 * - 已存在：核對生日，更新姓名/電話為最新填寫值
 * - 不存在：建立，證件號加密＋雜湊＋遮罩
 *
 * 回傳的 `created` 表示這筆病歷**是不是這次交易新建的**。LINE 自動綁定只認這個旗標：
 * 新建的病歷沒有既有紀錄可外洩，綁定是安全的；既有病歷一律要櫃檯核對。
 * 用旗標而不是「事前查一次有沒有」，是因為兩者之間可能被別的交易插隊建立同一筆。
 */
export async function upsertPatientForBooking(
  tx: Tx,
  input: PatientInput,
  opts: { trusted?: boolean } = {},
): Promise<{ patient: Patient; created: boolean }> {
  const existing = await findPatientByIdentity(tx, input.idType, input.idNumber, input.birthDate);
  if (existing) {
    // 櫃檯代約（trusted）：人員已當面或電話確認身分，可更新聯絡資料。
    if (opts.trusted) {
      const updated = await tx.patient.update({
        where: { id: existing.id },
        data: {
          name: input.name,
          phone: input.phone,
          gender: input.gender ?? existing.gender,
        },
      });
      return { patient: updated, created: false };
    }
    // 前台預約：證件號＋生日不足以證明是本人（家屬、學校、外流名單都可能知道），
    // 若允許覆寫姓名／電話，知道這兩項的人即可把病歷聯絡方式改成自己的，
    // 進而攔截所有通知，並用「證件＋生日＋手機」查詢該病人的完整預約紀錄。
    // 因此一律不覆寫；填寫的新電話只記錄成待確認聯絡方式，由櫃檯人工核對後更新。
    if (input.phone !== existing.phone) {
      await recordPendingContact(tx, existing.id, input.phone);
    }
    return { patient: existing, created: false };
  }
  try {
    const patient = await tx.patient.create({
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
    return { patient, created: true };
  } catch (e) {
    // 併發時另一交易剛建立同一病人：改為讀取既有列（仍核對生日）。
    // 這種情況**不算這次建立的**——建立者是另一個交易，綁定權也在那邊。
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const found = await findPatientByIdentity(tx, input.idType, input.idNumber, input.birthDate);
      if (found) return { patient: found, created: false };
    }
    throw e;
  }
}

/**
 * 記錄前台預約時填寫、但與病歷不符的聯絡電話，供櫃檯核對後決定是否更新。
 * 同一組電話只留一筆。
 */
async function recordPendingContact(tx: Tx, patientId: string, phone: string) {
  const existing = await tx.patientContact.findFirst({
    where: { patientId, type: "PHONE", value: phone },
  });
  if (existing) return;
  await tx.patientContact.create({
    data: { patientId, type: "PHONE", value: phone, label: "線上預約填寫，待櫃檯確認" },
  });
}

/** 以 SELECT ... FOR UPDATE 鎖定病人列，序列化同一病人的並發預約檢查 */
export async function lockPatientRow(tx: Tx, patientId: string) {
  await tx.$queryRaw`SELECT id FROM patients WHERE id = ${patientId} FOR UPDATE`;
}
