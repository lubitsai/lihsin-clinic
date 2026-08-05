-- 國定假日行事曆（行政院人事行政總處「政府行政機關辦公日曆表」）
-- 用途：診所國定假日多半照常看診，但兒童發展篩檢不施測。
-- 只存「放假且有假日名稱」的日子；一般週末不入表（週末本來就沒有篩檢時段）。

CREATE TABLE "public_holidays" (
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "public_holidays_pkey" PRIMARY KEY ("date")
);

-- 國定假日是否停開此門診（預設否；只有兒童發展篩檢為 true）
ALTER TABLE "clinic_types"
  ADD COLUMN "skip_on_public_holiday" BOOLEAN NOT NULL DEFAULT false;
