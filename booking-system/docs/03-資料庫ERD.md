# 03｜資料庫 ERD

實際欄位定義以 `prisma/schema.prisma` 為準；partial unique index 等 PostgreSQL 特有約束見 migration SQL。

```mermaid
erDiagram
    patients ||--o{ patient_contacts : has
    patients ||--o{ line_patient_links : "綁定"
    line_accounts ||--o{ line_patient_links : "管理多位家庭成員"
    patients ||--o{ appointments : books
    doctors ||--o{ appointments : sees
    clinic_types ||--o{ appointments : "門診類型"
    appointment_slots ||--o{ appointments : "時段(綁定醫師)"
    doctors ||--o{ appointment_slots : owns
    doctors ||--o{ weekly_schedule_templates : "固定班表"
    doctors ||--o{ schedule_exceptions : "日期例外"
    clinic_types }o--o{ doctors : "clinic_type_doctors"
    appointments ||--o{ appointment_status_history : "狀態歷史"
    appointments ||--o| no_show_records : "未到紀錄"
    patients ||--o{ no_show_records : accumulates
    patients ||--o{ booking_restrictions : "預約限制"
    staff_roles ||--o{ staff_users : role
    staff_users ||--o{ audit_logs : acts
    patients ||--o{ notifications : receives
    appointments ||--o{ notifications : about

    patients {
        string id PK
        string name
        date   birth_date
        enum   id_type "身分證/居留證/護照"
        string id_number_encrypted "AES-256-GCM"
        string id_number_hash "HMAC-SHA256 唯一索引"
        string id_number_masked "顯示用遮罩"
        string phone
        enum   gender
        int    no_show_count
        int    cancel_count
        string staff_note
    }
    appointments {
        string id PK
        string booking_number UK
        string patient_id FK
        string doctor_id FK
        string clinic_type_id FK
        string slot_id FK
        date   appointment_date
        string start_time
        string end_time
        int    capacity_slot_no "配合名額的序號"
        enum   status "8 種狀態"
        enum   source "WEB/LINE/STAFF"
        enum   visit_type "初診/複診"
        string patient_note
        string staff_note
        string cancellation_reason
        string override_reason "櫃檯覆寫限制理由"
        string request_id UK "防重複送出"
        string rescheduled_from_id
        string created_by
        string updated_by
    }
    appointment_slots {
        string id PK
        string doctor_id FK
        date   date
        string start_time
        string end_time
        int    capacity
        bool   is_blocked
        enum   source "AUTO/MANUAL"
        string reason "手動加開/封鎖原因"
        string created_by
    }
    weekly_schedule_templates {
        string id PK
        int    weekday "0=日..6=六"
        enum   session "早/午/晚"
        string start_time
        string end_time
        string doctor_id FK
        int    slot_capacity
        bool   allow_online
        bool   is_active
    }
    schedule_exceptions {
        string id PK
        date   date
        enum   type "全日休/診別休/醫師休/代診/特殊時間/加診/封鎖時段/暫停門診類型"
        enum   session
        string doctor_id FK
        string substitute_doctor_id FK
        string start_time
        string end_time
        string clinic_type_id FK
        string reason
        string created_by
    }
    booking_restrictions {
        string id PK
        string patient_id FK
        enum   type "AUTO_NO_SHOW/MANUAL"
        enum   status "ACTIVE/SUSPENDED/LIFTED"
        string reason
        datetime suspended_until
        string lifted_by
        string lift_reason
    }
    staff_users {
        string id PK
        string username UK
        string password_hash "bcrypt"
        string role_id FK
        string totp_secret "管理員 2FA"
        int    failed_login_count
        datetime locked_until
        string doctor_id "醫師唯讀帳號對應"
    }
    system_settings {
        string key PK
        json   value
        string updated_by
    }
    audit_logs {
        string id PK
        enum   actor_type "STAFF/PATIENT/SYSTEM"
        string actor_id
        string action
        string target_type
        string target_id
        json   detail
        string ip
    }
```

## 資料庫層級約束（migration 內 raw SQL）

```sql
-- 同一醫師同一時段：capacity_slot_no 在交易內依 FOR UPDATE 鎖依序配發，
-- unique index 為第二道防線（有效狀態才占用名額）
CREATE UNIQUE INDEX "uniq_active_doctor_slot_seq"
  ON "appointments" ("doctor_id", "appointment_date", "start_time", "capacity_slot_no")
  WHERE "status" IN ('PENDING','CONFIRMED','CHECKED_IN','COMPLETED','NO_SHOW');

```

- 取消（病人取消/診所取消/已改期）的預約不符合 WHERE 條件 → 立即釋放名額、不計同日限制。
- 預約建立、改期、取消皆包在 `prisma.$transaction` 中，並先 `SELECT … FOR UPDATE` 鎖定時段列與病人列，高併發時序列化，避免超賣（併發測試驗證）。
- **同日唯一**與 **7 天 3 筆**由交易內「鎖定病人列 → 計數檢查」強制，不用 unique index——因櫃檯管理員可輸入理由特殊覆寫，唯一索引無法表達例外；病人列鎖已序列化同一病人的併發請求，無競態漏洞。

## 輔助資料表（規格外新增）

| 表 | 用途 |
|---|---|
| `line_patient_links` | 一個 LINE 帳號綁多位家庭成員（含驗證時間） |
| `otp_codes` | 手機驗證碼（雜湊儲存、限次數、限時效） |
| `portal_sessions` | 民眾登入 session（token 雜湊） |
| `staff_sessions` | 員工登入 session（token 雜湊、閒置逾時） |
| `clinic_type_doctors` | 門診類型可接受的醫師 |
