process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5433/lihsin_booking_test";
process.env.PII_ENCRYPTION_KEY = "test-encryption-key-0123456789abcdef-xyz";
process.env.PII_HASH_KEY = "test-hash-key-0123456789abcdef";
process.env.SESSION_SECRET = "test-session-secret";
// 通知一律走 LINE；測試不對外連線，改用 dry-run（只印不送）
process.env.LINE_MESSAGING_DRY_RUN = "1";
process.env.APP_BASE_URL = "http://localhost:3000";
