-- CreateEnum
CREATE TYPE "IdType" AS ENUM ('NATIONAL_ID', 'RESIDENT_CERT', 'PASSPORT');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateEnum
CREATE TYPE "SessionPeriod" AS ENUM ('MORNING', 'AFTERNOON', 'EVENING');

-- CreateEnum
CREATE TYPE "ExceptionType" AS ENUM ('CLINIC_CLOSED_DAY', 'SESSION_CLOSED', 'DOCTOR_OFF', 'DOCTOR_SUBSTITUTE', 'SPECIAL_HOURS', 'EXTRA_SESSION', 'SLOT_BLOCKED', 'CLINIC_TYPE_SUSPENDED');

-- CreateEnum
CREATE TYPE "SlotSource" AS ENUM ('AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED_BY_PATIENT', 'CANCELLED_BY_CLINIC', 'NO_SHOW', 'RESCHEDULED');

-- CreateEnum
CREATE TYPE "AppointmentSource" AS ENUM ('WEB', 'LINE', 'STAFF');

-- CreateEnum
CREATE TYPE "VisitType" AS ENUM ('FIRST_VISIT', 'RETURN_VISIT');

-- CreateEnum
CREATE TYPE "RestrictionType" AS ENUM ('AUTO_NO_SHOW', 'MANUAL');

-- CreateEnum
CREATE TYPE "RestrictionStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'LIFTED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('LINE', 'SMS');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('BOOKED', 'MODIFIED', 'CANCELLED', 'REMINDER_DAY_BEFORE', 'REMINDER_SAME_DAY', 'CLINIC_NOTICE');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('STAFF', 'PATIENT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('BOOKING', 'QUERY', 'LINE_BINDING');

-- CreateTable
CREATE TABLE "patients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "birth_date" DATE NOT NULL,
    "gender" "Gender",
    "id_type" "IdType" NOT NULL DEFAULT 'NATIONAL_ID',
    "id_number_encrypted" TEXT NOT NULL,
    "id_number_hash" TEXT NOT NULL,
    "id_number_masked" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "no_show_count" INTEGER NOT NULL DEFAULT 0,
    "cancel_count" INTEGER NOT NULL DEFAULT 0,
    "staff_note" TEXT,
    "merged_into_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_contacts" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "line_accounts" (
    "id" TEXT NOT NULL,
    "line_user_id" TEXT NOT NULL,
    "display_name" TEXT,
    "picture_url" TEXT,
    "is_following" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login_at" TIMESTAMP(3),

    CONSTRAINT "line_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "line_patient_links" (
    "id" TEXT NOT NULL,
    "line_account_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "relation" TEXT,
    "verified_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "line_patient_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctors" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "bio" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "color" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "doctors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_types" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "notice" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "requires_review" BOOLEAN NOT NULL DEFAULT false,
    "needs_questionnaire" BOOLEAN NOT NULL DEFAULT false,
    "questionnaire_url" TEXT,
    "min_age_months" INTEGER,
    "max_age_months" INTEGER,
    "notify_line" BOOLEAN NOT NULL DEFAULT true,
    "color" TEXT NOT NULL DEFAULT '#2F5D3A',
    "icon" TEXT NOT NULL DEFAULT 'stethoscope',
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "allowed_weekdays" INTEGER[],
    "allowed_sessions" "SessionPeriod"[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinic_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_type_doctors" (
    "clinic_type_id" TEXT NOT NULL,
    "doctor_id" TEXT NOT NULL,

    CONSTRAINT "clinic_type_doctors_pkey" PRIMARY KEY ("clinic_type_id","doctor_id")
);

-- CreateTable
CREATE TABLE "weekly_schedule_templates" (
    "id" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "session" "SessionPeriod" NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "doctor_id" TEXT NOT NULL,
    "slot_capacity" INTEGER NOT NULL DEFAULT 1,
    "allow_online" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weekly_schedule_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_exceptions" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "type" "ExceptionType" NOT NULL,
    "session" "SessionPeriod",
    "doctor_id" TEXT,
    "substitute_doctor_id" TEXT,
    "start_time" TEXT,
    "end_time" TEXT,
    "slot_capacity" INTEGER,
    "clinic_type_id" TEXT,
    "reason" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schedule_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_slots" (
    "id" TEXT NOT NULL,
    "doctor_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "is_blocked" BOOLEAN NOT NULL DEFAULT false,
    "source" "SlotSource" NOT NULL DEFAULT 'AUTO',
    "reason" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointment_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" TEXT NOT NULL,
    "booking_number" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "doctor_id" TEXT NOT NULL,
    "clinic_type_id" TEXT NOT NULL,
    "slot_id" TEXT NOT NULL,
    "appointment_date" DATE NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "capacity_slot_no" INTEGER NOT NULL DEFAULT 1,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'CONFIRMED',
    "source" "AppointmentSource" NOT NULL,
    "visit_type" "VisitType",
    "patient_note" TEXT,
    "staff_note" TEXT,
    "override_reason" TEXT,
    "request_id" TEXT,
    "rescheduled_from_id" TEXT,
    "rescheduled_to_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "cancelled_at" TIMESTAMP(3),
    "cancellation_reason" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_status_history" (
    "id" TEXT NOT NULL,
    "appointment_id" TEXT NOT NULL,
    "from_status" "AppointmentStatus",
    "to_status" "AppointmentStatus" NOT NULL,
    "changed_by_type" "ActorType" NOT NULL,
    "changed_by_id" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "no_show_records" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "appointment_id" TEXT NOT NULL,
    "marked_by" TEXT NOT NULL,
    "note" TEXT,
    "revoked_at" TIMESTAMP(3),
    "revoked_by" TEXT,
    "revoke_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "no_show_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_restrictions" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "type" "RestrictionType" NOT NULL,
    "status" "RestrictionStatus" NOT NULL DEFAULT 'ACTIVE',
    "reason" TEXT NOT NULL,
    "suspended_until" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lifted_at" TIMESTAMP(3),
    "lifted_by" TEXT,
    "lift_reason" TEXT,

    CONSTRAINT "booking_restrictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_roles" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "permissions" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "doctor_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "totp_secret" TEXT,
    "totp_enabled" BOOLEAN NOT NULL DEFAULT false,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_sessions" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "staff_user_id" TEXT NOT NULL,
    "ip" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_sessions" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "line_account_id" TEXT,
    "verified_phone" TEXT,
    "patient_id" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_codes" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT,
    "appointment_id" TEXT,
    "channel" "NotificationChannel" NOT NULL,
    "type" "NotificationType" NOT NULL,
    "recipient" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actor_type" "ActorType" NOT NULL,
    "actor_id" TEXT,
    "actor_name" TEXT,
    "action" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "detail" JSONB,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "patients_phone_idx" ON "patients"("phone");

-- CreateIndex
CREATE INDEX "patients_name_idx" ON "patients"("name");

-- CreateIndex
CREATE UNIQUE INDEX "patients_id_type_id_number_hash_key" ON "patients"("id_type", "id_number_hash");

-- CreateIndex
CREATE INDEX "patient_contacts_patient_id_idx" ON "patient_contacts"("patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "line_accounts_line_user_id_key" ON "line_accounts"("line_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "line_patient_links_line_account_id_patient_id_key" ON "line_patient_links"("line_account_id", "patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "clinic_types_code_key" ON "clinic_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_schedule_templates_weekday_session_doctor_id_key" ON "weekly_schedule_templates"("weekday", "session", "doctor_id");

-- CreateIndex
CREATE INDEX "schedule_exceptions_date_idx" ON "schedule_exceptions"("date");

-- CreateIndex
CREATE INDEX "appointment_slots_date_idx" ON "appointment_slots"("date");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_slots_doctor_id_date_start_time_key" ON "appointment_slots"("doctor_id", "date", "start_time");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_booking_number_key" ON "appointments"("booking_number");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_request_id_key" ON "appointments"("request_id");

-- CreateIndex
CREATE INDEX "appointments_appointment_date_idx" ON "appointments"("appointment_date");

-- CreateIndex
CREATE INDEX "appointments_patient_id_appointment_date_idx" ON "appointments"("patient_id", "appointment_date");

-- CreateIndex
CREATE INDEX "appointments_doctor_id_appointment_date_idx" ON "appointments"("doctor_id", "appointment_date");

-- CreateIndex
CREATE INDEX "appointments_status_idx" ON "appointments"("status");

-- CreateIndex
CREATE INDEX "appointment_status_history_appointment_id_idx" ON "appointment_status_history"("appointment_id");

-- CreateIndex
CREATE UNIQUE INDEX "no_show_records_appointment_id_key" ON "no_show_records"("appointment_id");

-- CreateIndex
CREATE INDEX "no_show_records_patient_id_idx" ON "no_show_records"("patient_id");

-- CreateIndex
CREATE INDEX "booking_restrictions_patient_id_status_idx" ON "booking_restrictions"("patient_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "staff_roles_code_key" ON "staff_roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "staff_users_username_key" ON "staff_users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "staff_sessions_token_hash_key" ON "staff_sessions"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "portal_sessions_token_hash_key" ON "portal_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "otp_codes_phone_purpose_idx" ON "otp_codes"("phone", "purpose");

-- CreateIndex
CREATE INDEX "notifications_status_idx" ON "notifications"("status");

-- CreateIndex
CREATE INDEX "notifications_appointment_id_idx" ON "notifications"("appointment_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_target_type_target_id_idx" ON "audit_logs"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "patient_contacts" ADD CONSTRAINT "patient_contacts_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_patient_links" ADD CONSTRAINT "line_patient_links_line_account_id_fkey" FOREIGN KEY ("line_account_id") REFERENCES "line_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_patient_links" ADD CONSTRAINT "line_patient_links_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_type_doctors" ADD CONSTRAINT "clinic_type_doctors_clinic_type_id_fkey" FOREIGN KEY ("clinic_type_id") REFERENCES "clinic_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_type_doctors" ADD CONSTRAINT "clinic_type_doctors_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_schedule_templates" ADD CONSTRAINT "weekly_schedule_templates_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_slots" ADD CONSTRAINT "appointment_slots_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_clinic_type_id_fkey" FOREIGN KEY ("clinic_type_id") REFERENCES "clinic_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "appointment_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_status_history" ADD CONSTRAINT "appointment_status_history_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "no_show_records" ADD CONSTRAINT "no_show_records_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "no_show_records" ADD CONSTRAINT "no_show_records_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_restrictions" ADD CONSTRAINT "booking_restrictions_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_users" ADD CONSTRAINT "staff_users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "staff_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_users" ADD CONSTRAINT "staff_users_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_sessions" ADD CONSTRAINT "staff_sessions_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
