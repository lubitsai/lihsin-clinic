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

/** 一般 token 雜湊（session token、OTP 等，存 DB 不存原文） */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** 6 位數 OTP */
export function randomOtp(): string {
  return String(randomBytes(4).readUInt32BE() % 1000000).padStart(6, "0");
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
