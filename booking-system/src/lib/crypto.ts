/**
 * 敏感個資加密與雜湊。
 * - 證件號以 AES-256-GCM 加密儲存（PII_ENCRYPTION_KEY）
 * - 查詢索引使用 HMAC-SHA256（PII_HASH_KEY），不可回推原文
 * - 兩把金鑰分開，洩漏其一不致同時破壞機密性與索引安全
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, createHash, timingSafeEqual } from "node:crypto";

function encKey(): Buffer {
  const raw = process.env.PII_ENCRYPTION_KEY;
  if (!raw || raw.length < 32) throw new Error("PII_ENCRYPTION_KEY 未設定或長度不足 32 字元");
  return createHash("sha256").update(raw).digest();
}

function hashKey(): string {
  const raw = process.env.PII_HASH_KEY;
  if (!raw || raw.length < 16) throw new Error("PII_HASH_KEY 未設定或長度不足 16 字元");
  return raw;
}

/** AES-256-GCM 加密，輸出 iv.tag.cipher（base64url） */
export function encryptPii(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${enc.toString("base64url")}`;
}

export function decryptPii(ciphertext: string): string {
  const [iv, tag, data] = ciphertext.split(".");
  const decipher = createDecipheriv("aes-256-gcm", encKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

/** 證件號正規化後做 HMAC-SHA256，作唯一索引與查詢比對 */
export function hashIdNumber(idNumber: string): string {
  return createHmac("sha256", hashKey()).update(idNumber.trim().toUpperCase()).digest("hex");
}

/** 一般 token 雜湊（session token、綁定代碼等，存 DB 不存原文） */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** 綁定代碼可用字元：排除 0/O、1/I/L 等唸出來或抄下來會混淆的（櫃檯要用聽的、用看的） */
const BINDING_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/**
 * 櫃檯綁定代碼（6 碼）。
 * 短是刻意的——民眾要唸給櫃檯、櫃檯要手動輸入。強度不靠長度，
 * 靠 30 分鐘效期、一次性、以及櫃檯端的輸入限流；真正的關卡是當面核對健保卡。
 */
export function randomBindingCode(length = 6): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += BINDING_CODE_ALPHABET[bytes[i] % BINDING_CODE_ALPHABET.length];
  }
  return out;
}

/** 代碼正規化：大小寫、空白與連字號都當成同一組（民眾會抄成 ABC-123） */
export function normalizeBindingCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
