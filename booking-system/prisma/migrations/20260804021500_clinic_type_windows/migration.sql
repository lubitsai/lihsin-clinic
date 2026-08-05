-- 門診類型可預約時間窗（星期 × 時間區間）
-- 官網公告的兒童發展篩檢施測時間逐日不同（週一僅下午、週二至週五上午與下午各一段），
-- allowed_weekdays × allowed_sessions 的粗篩表達不了，故另建本表。
-- 有資料時只看本表，粗篩欄位不再套用（見 schema.prisma 註解）。

CREATE TABLE "clinic_type_windows" (
    "id" TEXT NOT NULL,
    "clinic_type_id" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,

    CONSTRAINT "clinic_type_windows_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "clinic_type_windows_clinic_type_id_weekday_idx"
  ON "clinic_type_windows" ("clinic_type_id", "weekday");

CREATE UNIQUE INDEX "clinic_type_windows_clinic_type_id_weekday_start_time_key"
  ON "clinic_type_windows" ("clinic_type_id", "weekday", "start_time");

ALTER TABLE "clinic_type_windows"
  ADD CONSTRAINT "clinic_type_windows_clinic_type_id_fkey"
  FOREIGN KEY ("clinic_type_id") REFERENCES "clinic_types"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
