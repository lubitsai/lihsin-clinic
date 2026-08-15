-- 取消簡訊、通知與前台身分全面改走 LINE（院長 2026-08-13 裁示）
--
-- 手機 OTP 沒有可送達的管道，整套移除：
--   * otp_codes 資料表（存過手機號與驗證碼雜湊，留著只是多一份個資）
--   * OtpPurpose 型別
--   * portal_sessions 的 verified_phone / patient_id（OTP 專用的兩條登入路徑）
-- portal_sessions.line_account_id 隨之改為必填；既有的非 LINE session 一律作廢
-- （效期本來就只有 2 小時，使用者重新以 LINE 登入即可）。
--
-- 註：notification_channel 的 SMS 值保留不動——PostgreSQL 移除 enum 值需整型別重建，
-- 為一個不再被寫入的值付這個代價不划算。

DELETE FROM "portal_sessions" WHERE "line_account_id" IS NULL;

ALTER TABLE "portal_sessions"
  DROP COLUMN "verified_phone",
  DROP COLUMN "patient_id",
  ALTER COLUMN "line_account_id" SET NOT NULL;

DROP TABLE "otp_codes";

DROP TYPE "OtpPurpose";
