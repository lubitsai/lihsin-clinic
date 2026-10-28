import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";

// Prisma 7 起 CLI 不再自動讀 .env；本機開發補讀（已存在的環境變數不會被覆寫）。
// 容器內由 docker compose 的 env_file 注入，沒有 .env 檔，這段不作用。
if (existsSync(".env")) process.loadEnvFile(".env");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // generate 不需要連線；用 env() 會在沒設 DATABASE_URL 時連 generate 都失敗
  datasource: { url: process.env.DATABASE_URL ?? "" },
});
