import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["tests/global-setup.ts"],
    setupFiles: ["tests/setup.ts"],
    fileParallelism: false, // 測試共用同一個資料庫，序列執行
    testTimeout: 30000,
    hookTimeout: 60000,
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
