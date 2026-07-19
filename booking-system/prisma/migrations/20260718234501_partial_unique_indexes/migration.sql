-- 有效預約唯一性約束（Prisma 不支援 partial unique index，以 raw SQL 定義）
-- 1) 同一醫師同一時段的名額序號唯一：交易內以 FOR UPDATE 鎖依序配發 capacity_slot_no，
--    此索引為第二道防線，即使程式繞過鎖也無法超賣。
--    COMPLETED / NO_SHOW 屬歷史占用，仍保留名額占用（過去時段不會再被預約）。
CREATE UNIQUE INDEX "uniq_active_doctor_slot_seq"
  ON "appointments" ("doctor_id", "appointment_date", "start_time", "capacity_slot_no")
  WHERE "status" IN ('PENDING', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW');

-- 2) 同一病人同一日曆日僅一筆有效預約：由預約引擎在交易內
--    以 SELECT ... FOR UPDATE 鎖定病人列後檢查強制（見 src/lib/booking.ts）。
--    不使用 unique index，因為櫃檯管理員可輸入理由「特殊覆寫」此限制，
--    唯一索引無法表達例外；查詢效能由 schema 的 (patient_id, appointment_date)
--    一般索引支援。
