-- CreateEnum
CREATE TYPE "enum_alert_status" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "enum_alert_severity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "enum_alert_type" AS ENUM ('CLINICAL_DETERIORATION', 'MASS_CASUALTY_EVENT', 'CAPACITY_EXCEEDED', 'SECURITY_INCIDENT', 'SYSTEM_FAILURE', 'MANUAL_ALERT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "enum_sync_entity_type" ADD VALUE 'ALERT';
ALTER TYPE "enum_sync_entity_type" ADD VALUE 'NOTIFICATION';

-- DropIndex
DROP INDEX "idx_audit_logs_metadata_gin";

-- CreateTable
CREATE TABLE "alerts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" "enum_alert_type" NOT NULL,
    "severity" "enum_alert_severity" NOT NULL,
    "title" VARCHAR(128) NOT NULL,
    "description" TEXT NOT NULL,
    "status" "enum_alert_status" NOT NULL DEFAULT 'OPEN',
    "patient_id" UUID,
    "incident_id" UUID,
    "created_by" UUID,
    "assigned_to" UUID,
    "idempotency_key" VARCHAR(128),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMPTZ,
    "resolved_at" TIMESTAMPTZ,
    "closed_at" TIMESTAMPTZ,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "alerts_idempotency_key_key" ON "alerts"("idempotency_key");

-- CreateIndex
CREATE INDEX "alerts_status_severity_created_at_idx" ON "alerts"("status", "severity", "created_at" DESC);

-- CreateIndex
CREATE INDEX "alerts_patient_id_idx" ON "alerts"("patient_id");

-- CreateIndex
CREATE INDEX "alerts_incident_id_idx" ON "alerts"("incident_id");

-- CreateIndex
CREATE INDEX "alerts_assigned_to_idx" ON "alerts"("assigned_to");

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
