-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "account_key" TEXT;

-- AlterTable
ALTER TABLE "clinic_types" ADD COLUMN     "allow_companions" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "appointment_companions" (
    "id" TEXT NOT NULL,
    "appointment_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_companions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "appointment_companions_patient_id_idx" ON "appointment_companions"("patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_companions_appointment_id_patient_id_key" ON "appointment_companions"("appointment_id", "patient_id");

-- CreateIndex
CREATE INDEX "appointments_account_key_appointment_date_idx" ON "appointments"("account_key", "appointment_date");

-- AddForeignKey
ALTER TABLE "appointment_companions" ADD CONSTRAINT "appointment_companions_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_companions" ADD CONSTRAINT "appointment_companions_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
