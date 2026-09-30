-- AlterTable
ALTER TABLE "patients" ADD COLUMN "current_triage_assessment_id" UUID;

-- AlterTable
ALTER TABLE "triage_assessments" 
    ADD COLUMN "protocol_code" VARCHAR(32) NOT NULL DEFAULT 'START',
    ADD COLUMN "protocol_version" VARCHAR(16) NOT NULL DEFAULT '1.0.0',
    ADD COLUMN "care_setting" VARCHAR(32) NOT NULL DEFAULT 'PRE_HOSPITAL',
    ADD COLUMN "assessment_data" JSONB,
    ADD COLUMN "decision_trace" JSONB,
    ALTER COLUMN "can_walk" DROP NOT NULL,
    ALTER COLUMN "has_respirations" DROP NOT NULL,
    ALTER COLUMN "is_current" SET DEFAULT false;

-- DropIndex: Remove partial unique index causing reassessment deadlock with immutable trigger
DROP INDEX IF EXISTS "uq_triage_assessments_current_patient";

-- DropIndex: Remove obsolete indexes replaced by composite index
DROP INDEX IF EXISTS "triage_assessments_patient_id_is_current_idx";
DROP INDEX IF EXISTS "triage_assessments_assessed_at_idx";

-- CreateIndex
CREATE UNIQUE INDEX "patients_current_triage_assessment_id_key" ON "patients"("current_triage_assessment_id");

-- CreateIndex
CREATE INDEX "triage_assessments_patient_id_assessed_at_idx" ON "triage_assessments"("patient_id", "assessed_at" DESC);

-- CreateIndex
CREATE INDEX "triage_assessments_protocol_code_protocol_version_idx" ON "triage_assessments"("protocol_code", "protocol_version");

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_current_triage_assessment_id_fkey" 
    FOREIGN KEY ("current_triage_assessment_id") REFERENCES "triage_assessments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
