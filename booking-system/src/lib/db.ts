import { existsSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

/**
 * 建立 PrismaClient。Prisma 7 起必須經 driver adapter 連線，且不再自動讀 .env：
 * Next.js 自己會讀 .env；tsx 跑的 scripts／seed 以前靠 Prisma 代讀，這裡補上
 * （已存在的環境變數不覆寫，容器內沒有 .env 檔則不作用）。
 */
export function createPrismaClient(): PrismaClient {
  if (!process.env.NEXT_RUNTIME && existsSync(".env")) process.loadEnvFile(".env");
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/** 交易客戶端型別（$transaction callback 內使用） */
export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
