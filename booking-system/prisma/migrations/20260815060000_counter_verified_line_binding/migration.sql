-- 綁定改為櫃檯核對制（院長 2026-08-15 裁示），並清掉 SMS 最後的殘留。
--
-- 為什麼不讓民眾自助綁定既有病歷：綁定＝取得該病人全部預約紀錄的讀取權。
-- 原本以「證件＋生日＋手機三者相符」為關卡，但這三項知道的人不只本人
-- （家屬、學校、外流名單），等於讓人冒用證件綁走病歷身分。核對只有櫃檯做得到。

-- 1) 綁定代碼：民眾在前台產生、到櫃檯出示，櫃檯核對健保卡後輸入才建立綁定
CREATE TABLE "line_binding_codes" (
    "id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "line_account_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "line_binding_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "line_binding_codes_code_hash_key" ON "line_binding_codes"("code_hash");
CREATE INDEX "line_binding_codes_line_account_id_idx" ON "line_binding_codes"("line_account_id");

ALTER TABLE "line_binding_codes" ADD CONSTRAINT "line_binding_codes_line_account_id_fkey"
    FOREIGN KEY ("line_account_id") REFERENCES "line_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2) 綁定紀錄留下經手櫃檯人員（線上預約自動建立時為 NULL）
ALTER TABLE "line_patient_links" ADD COLUMN "verified_by_staff_id" TEXT;

-- 3) 移除 NotificationChannel 的 SMS 值。
--    PostgreSQL 不能單獨刪 enum 值，只能整個型別重建。
--    若還有 SMS 的通知紀錄就直接中止——那代表這套系統真的發過簡訊，
--    要先確認怎麼處理那些紀錄，不該由 migration 悄悄決定。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "notifications" WHERE "channel" = 'SMS') THEN
    RAISE EXCEPTION '仍有 channel=SMS 的通知紀錄，請先確認處理方式再套用此 migration';
  END IF;
END $$;

ALTER TYPE "NotificationChannel" RENAME TO "NotificationChannel_old";
CREATE TYPE "NotificationChannel" AS ENUM ('LINE');
ALTER TABLE "notifications"
  ALTER COLUMN "channel" TYPE "NotificationChannel"
  USING ("channel"::text::"NotificationChannel");
DROP TYPE "NotificationChannel_old";
