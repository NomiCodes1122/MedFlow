-- ==============================================================================
-- MedFlow Database Initial Migration
-- Migration: 20260928000000_init_medflow_database
-- Target Database: Supabase PostgreSQL (18 Tables, 19 Enums, Constraints, Triggers)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. EXTENSIONS
-- ------------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------------------------
-- 2. DOMAIN ENUMS (19 ENUMS)
-- ------------------------------------------------------------------------------
CREATE TYPE "enum_user_role" AS ENUM ('PARAMEDIC', 'TRIAGE_DOCTOR', 'HOSPITAL_SUPERINTENDENT');
CREATE TYPE "enum_user_status" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');
CREATE TYPE "enum_device_platform" AS ENUM ('IOS', 'ANDROID', 'WEB');
CREATE TYPE "enum_incident_status" AS ENUM ('REPORTED', 'ACTIVE', 'TRIAGE_ACTIVE', 'RESOLVED', 'CLOSED');
CREATE TYPE "enum_incident_priority" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');
CREATE TYPE "enum_notification_priority" AS ENUM ('CRITICAL', 'MODERATE', 'LOW');
CREATE TYPE "enum_ambulance_status" AS ENUM ('AVAILABLE', 'DISPATCHED', 'ON_SCENE', 'TRANSPORTING', 'OUT_OF_SERVICE');
CREATE TYPE "enum_gender" AS ENUM ('MALE', 'FEMALE', 'OTHER', 'UNKNOWN');
CREATE TYPE "enum_patient_status" AS ENUM ('FIELD_INTAKE', 'IN_TRANSIT', 'ARRIVED_ER', 'ADMITTED', 'DISCHARGED', 'DECEASED');
CREATE TYPE "enum_triage_category" AS ENUM ('RED', 'YELLOW', 'GREEN', 'BLACK', 'UNASSESSED');
CREATE TYPE "enum_triage_source" AS ENUM ('FIELD_START', 'ER_TRIAGE_REASSESSMENT');
CREATE TYPE "enum_vital_source" AS ENUM ('PARAMEDIC_FIELD', 'MONITOR_DEVICE', 'DOCTOR_ER', 'OFFLINE_SYNC');
CREATE TYPE "enum_media_type" AS ENUM ('PHOTO', 'AUDIO');
CREATE TYPE "enum_media_status" AS ENUM ('PENDING_UPLOAD', 'UPLOADED', 'VERIFIED', 'FAILED');
CREATE TYPE "enum_inventory_category" AS ENUM ('BED', 'OXYGEN', 'MEDICATION');
CREATE TYPE "enum_inventory_tx_type" AS ENUM ('CONSUMED', 'RECEIVED_RESTOCK', 'RESERVED', 'RELEASED', 'ADJUSTMENT');
CREATE TYPE "enum_delivery_status" AS ENUM ('QUEUED', 'SENT_FCM', 'DELIVERED', 'READ', 'FAILED');
CREATE TYPE "enum_sync_entity_type" AS ENUM ('PATIENT', 'OBSERVATION', 'TRIAGE', 'INVENTORY', 'MEDIA');
CREATE TYPE "enum_sync_op_type" AS ENUM ('CREATE', 'UPDATE', 'DELETE');
CREATE TYPE "enum_sync_status" AS ENUM ('APPLIED', 'DUPLICATE_IGNORED', 'CONFLICT', 'FAILED');

-- ------------------------------------------------------------------------------
-- 3. TABLES DEFINITION (18 TABLES)
-- ------------------------------------------------------------------------------

-- 1. users
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "firebase_uid" VARCHAR(128) NOT NULL,
    "phone" VARCHAR(32) NOT NULL,
    "display_name" VARCHAR(128) NOT NULL,
    "role" "enum_user_role" NOT NULL,
    "status" "enum_user_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- 2. devices
CREATE TABLE "devices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "platform" "enum_device_platform" NOT NULL,
    "app_version" VARCHAR(32) NOT NULL,
    "push_token" TEXT,
    "last_active_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- 3. refresh_tokens
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "device_id" UUID,
    "hashed_token" VARCHAR(128) NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- 4. incidents
CREATE TABLE "incidents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "incident_number" VARCHAR(32) NOT NULL,
    "title" VARCHAR(128) NOT NULL,
    "description" TEXT,
    "status" "enum_incident_status" NOT NULL DEFAULT 'ACTIVE',
    "priority" "enum_incident_priority" NOT NULL DEFAULT 'HIGH',
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "address" VARCHAR(256),
    "reported_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- 5. ambulances
CREATE TABLE "ambulances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "call_sign" VARCHAR(32) NOT NULL,
    "license_plate" VARCHAR(32) NOT NULL,
    "status" "enum_ambulance_status" NOT NULL DEFAULT 'AVAILABLE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ambulances_pkey" PRIMARY KEY ("id")
);

-- 6. incident_assignments
CREATE TABLE "incident_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "incident_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "ambulance_id" UUID,
    "assigned_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMPTZ,
    "role_in_incident" VARCHAR(64) NOT NULL DEFAULT 'LEAD_PARAMEDIC',

    CONSTRAINT "incident_assignments_pkey" PRIMARY KEY ("id")
);

-- 7. location_history
CREATE TABLE "location_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ambulance_id" UUID NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "speed" REAL,
    "heading" REAL,
    "recorded_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "location_history_pkey" PRIMARY KEY ("id")
);

-- 8. patients
CREATE TABLE "patients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "incident_id" UUID,
    "demo_id" VARCHAR(32) NOT NULL,
    "first_name" VARCHAR(64),
    "last_name" VARCHAR(64),
    "estimated_age" SMALLINT,
    "gender" "enum_gender" NOT NULL DEFAULT 'UNKNOWN',
    "status" "enum_patient_status" NOT NULL DEFAULT 'FIELD_INTAKE',
    "current_triage_category" "enum_triage_category" NOT NULL DEFAULT 'UNASSESSED',
    "chief_complaint" TEXT,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "client_created_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- 9. patient_vitals
CREATE TABLE "patient_vitals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "patient_id" UUID NOT NULL,
    "recorded_by" UUID NOT NULL,
    "systolic_bp" SMALLINT,
    "diastolic_bp" SMALLINT,
    "heart_rate" SMALLINT,
    "respiratory_rate" SMALLINT,
    "oxygen_saturation" REAL,
    "temperature" REAL,
    "gcs_score" SMALLINT,
    "source" "enum_vital_source" NOT NULL DEFAULT 'PARAMEDIC_FIELD',
    "recorded_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_vitals_pkey" PRIMARY KEY ("id")
);

-- 10. patient_media
CREATE TABLE "patient_media" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "patient_id" UUID NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "media_type" "enum_media_type" NOT NULL,
    "storage_path" VARCHAR(512) NOT NULL,
    "public_url" TEXT,
    "mime_type" VARCHAR(64) NOT NULL,
    "file_size_bytes" INTEGER NOT NULL,
    "duration_seconds" SMALLINT,
    "checksum_sha256" VARCHAR(64),
    "status" "enum_media_status" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "client_captured_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_media_pkey" PRIMARY KEY ("id")
);

-- 11. triage_assessments
CREATE TABLE "triage_assessments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "patient_id" UUID NOT NULL,
    "assessed_by" UUID NOT NULL,
    "can_walk" BOOLEAN NOT NULL,
    "has_respirations" BOOLEAN NOT NULL,
    "respiratory_rate" SMALLINT,
    "radial_pulse" BOOLEAN,
    "capillary_refill_sec" REAL,
    "follows_commands" BOOLEAN,
    "calculated_category" "enum_triage_category" NOT NULL,
    "overridden_category" "enum_triage_category",
    "override_reason" TEXT,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "assessment_source" "enum_triage_source" NOT NULL DEFAULT 'FIELD_START',
    "assessed_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "triage_assessments_pkey" PRIMARY KEY ("id")
);

-- 12. inventory_items
CREATE TABLE "inventory_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(128) NOT NULL,
    "category" "enum_inventory_category" NOT NULL,
    "unit" VARCHAR(32) NOT NULL,
    "quantity_total" INTEGER NOT NULL,
    "quantity_available" INTEGER NOT NULL,
    "quantity_reserved" INTEGER NOT NULL DEFAULT 0,
    "low_stock_threshold" INTEGER NOT NULL DEFAULT 5,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- 13. inventory_transactions
CREATE TABLE "inventory_transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "item_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "patient_id" UUID,
    "transaction_type" "enum_inventory_tx_type" NOT NULL,
    "quantity_delta" INTEGER NOT NULL,
    "previous_available" INTEGER NOT NULL,
    "new_available" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "request_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_transactions_pkey" PRIMARY KEY ("id")
);

-- 14. notifications
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "priority" "enum_notification_priority" NOT NULL DEFAULT 'LOW',
    "title" VARCHAR(128) NOT NULL,
    "body" TEXT NOT NULL,
    "category" VARCHAR(64) NOT NULL,
    "entity_type" VARCHAR(32),
    "entity_id" UUID,
    "deep_link" VARCHAR(256),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- 15. notification_deliveries
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "notification_id" UUID NOT NULL,
    "recipient_user_id" UUID NOT NULL,
    "device_id" UUID,
    "status" "enum_delivery_status" NOT NULL DEFAULT 'QUEUED',
    "fcm_message_id" VARCHAR(128),
    "failure_reason" TEXT,
    "sent_at" TIMESTAMPTZ,
    "delivered_at" TIMESTAMPTZ,
    "read_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- 16. audit_logs
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_user_id" UUID,
    "actor_role" VARCHAR(32),
    "action" VARCHAR(64) NOT NULL,
    "entity_type" VARCHAR(32) NOT NULL,
    "entity_id" VARCHAR(64) NOT NULL,
    "client_timestamp" TIMESTAMPTZ,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "request_id" VARCHAR(64),
    "device_id" VARCHAR(64),
    "ip_address" VARCHAR(45),
    "user_agent" VARCHAR(256),
    "metadata" JSONB,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- 17. domain_events
CREATE TABLE "domain_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_type" VARCHAR(64) NOT NULL,
    "aggregate_type" VARCHAR(32) NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "incident_id" UUID,
    "user_id" UUID,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL,
    "recorded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "domain_events_pkey" PRIMARY KEY ("id")
);

-- 18. sync_history
CREATE TABLE "sync_history" (
    "operation_id" UUID NOT NULL,
    "device_id" VARCHAR(64) NOT NULL,
    "user_id" UUID NOT NULL,
    "entity_type" "enum_sync_entity_type" NOT NULL,
    "entity_id" UUID NOT NULL,
    "operation_type" "enum_sync_op_type" NOT NULL,
    "client_timestamp" TIMESTAMPTZ NOT NULL,
    "server_timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "enum_sync_status" NOT NULL DEFAULT 'APPLIED',
    "conflict_details" JSONB,
    "response_payload" JSONB,
    "applied_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_history_pkey" PRIMARY KEY ("operation_id")
);

-- ------------------------------------------------------------------------------
-- 4. UNIQUE & STANDARD INDEXES
-- ------------------------------------------------------------------------------

-- users
CREATE UNIQUE INDEX "users_firebase_uid_key" ON "users"("firebase_uid");
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");
CREATE INDEX "users_role_status_idx" ON "users"("role", "status");
CREATE INDEX "users_deleted_at_idx" ON "users"("deleted_at");

-- devices
CREATE INDEX "devices_user_id_last_active_at_idx" ON "devices"("user_id", "last_active_at" DESC);
CREATE INDEX "devices_push_token_idx" ON "devices"("push_token");

-- refresh_tokens
CREATE UNIQUE INDEX "refresh_tokens_hashed_token_key" ON "refresh_tokens"("hashed_token");
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");
CREATE INDEX "refresh_tokens_device_id_idx" ON "refresh_tokens"("device_id");
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");
CREATE INDEX "refresh_tokens_revoked_at_idx" ON "refresh_tokens"("revoked_at");

-- incidents
CREATE UNIQUE INDEX "incidents_incident_number_key" ON "incidents"("incident_number");
CREATE INDEX "incidents_status_priority_reported_at_idx" ON "incidents"("status", "priority", "reported_at" DESC);
CREATE INDEX "incidents_latitude_longitude_idx" ON "incidents"("latitude", "longitude");

-- ambulances
CREATE UNIQUE INDEX "ambulances_call_sign_key" ON "ambulances"("call_sign");
CREATE INDEX "ambulances_status_idx" ON "ambulances"("status");

-- incident_assignments
CREATE INDEX "incident_assignments_incident_id_user_id_idx" ON "incident_assignments"("incident_id", "user_id");
CREATE INDEX "incident_assignments_ambulance_id_idx" ON "incident_assignments"("ambulance_id");
CREATE INDEX "incident_assignments_user_id_idx" ON "incident_assignments"("user_id");

-- location_history
CREATE INDEX "location_history_ambulance_id_recorded_at_idx" ON "location_history"("ambulance_id", "recorded_at" DESC);

-- patients
CREATE UNIQUE INDEX "patients_demo_id_key" ON "patients"("demo_id");
CREATE INDEX "patients_incident_id_status_idx" ON "patients"("incident_id", "status");
CREATE INDEX "patients_current_triage_category_created_at_idx" ON "patients"("current_triage_category", "created_at" ASC);
CREATE INDEX "patients_deleted_at_idx" ON "patients"("deleted_at");

-- patient_vitals
CREATE INDEX "patient_vitals_patient_id_recorded_at_idx" ON "patient_vitals"("patient_id", "recorded_at" DESC);

-- patient_media
CREATE UNIQUE INDEX "patient_media_storage_path_key" ON "patient_media"("storage_path");
CREATE INDEX "patient_media_patient_id_media_type_idx" ON "patient_media"("patient_id", "media_type");

-- triage_assessments
CREATE INDEX "triage_assessments_patient_id_is_current_idx" ON "triage_assessments"("patient_id", "is_current");
CREATE INDEX "triage_assessments_assessed_at_idx" ON "triage_assessments"("assessed_at" DESC);

-- PARTIAL UNIQUE INDEX: Guarantees exactly one current triage assessment per patient
CREATE UNIQUE INDEX "uq_triage_assessments_current_patient" ON "triage_assessments"("patient_id") WHERE "is_current" = true;

-- inventory_items
CREATE UNIQUE INDEX "inventory_items_name_key" ON "inventory_items"("name");
CREATE INDEX "inventory_items_category_name_idx" ON "inventory_items"("category", "name");

-- inventory_transactions
CREATE INDEX "inventory_transactions_item_id_created_at_idx" ON "inventory_transactions"("item_id", "created_at" DESC);

-- notifications
CREATE INDEX "notifications_category_created_at_idx" ON "notifications"("category", "created_at" DESC);

-- notification_deliveries
CREATE INDEX "notification_deliveries_recipient_user_id_status_idx" ON "notification_deliveries"("recipient_user_id", "status");
CREATE INDEX "notification_deliveries_notification_id_idx" ON "notification_deliveries"("notification_id");
CREATE INDEX "notification_deliveries_device_id_idx" ON "notification_deliveries"("device_id");

-- PARTIAL INDEX: Fast lookup for unread notifications per recipient
CREATE INDEX "idx_notification_deliveries_unread" ON "notification_deliveries"("recipient_user_id", "status") WHERE "status" != 'READ';

-- audit_logs
CREATE INDEX "audit_logs_timestamp_idx" ON "audit_logs"("timestamp" DESC);
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");
CREATE INDEX "audit_logs_actor_user_id_idx" ON "audit_logs"("actor_user_id");
CREATE INDEX "idx_audit_logs_metadata_gin" ON "audit_logs" USING GIN ("metadata");

-- domain_events
CREATE INDEX "domain_events_event_type_occurred_at_idx" ON "domain_events"("event_type", "occurred_at");
CREATE INDEX "domain_events_incident_id_idx" ON "domain_events"("incident_id");
CREATE INDEX "domain_events_aggregate_id_idx" ON "domain_events"("aggregate_id");

-- sync_history
CREATE INDEX "sync_history_device_id_applied_at_idx" ON "sync_history"("device_id", "applied_at" DESC);
CREATE INDEX "sync_history_entity_type_entity_id_idx" ON "sync_history"("entity_type", "entity_id");

-- ------------------------------------------------------------------------------
-- 5. FOREIGN KEY CONSTRAINTS (EXPLICIT ON DELETE BEHAVIORS)
-- ------------------------------------------------------------------------------

-- devices -> users (CASCADE)
ALTER TABLE "devices" 
    ADD CONSTRAINT "devices_user_id_fkey" 
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- refresh_tokens -> users (CASCADE)
ALTER TABLE "refresh_tokens" 
    ADD CONSTRAINT "refresh_tokens_user_id_fkey" 
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- refresh_tokens -> devices (SET NULL)
ALTER TABLE "refresh_tokens" 
    ADD CONSTRAINT "refresh_tokens_device_id_fkey" 
    FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- incidents -> users (RESTRICT)
ALTER TABLE "incidents" 
    ADD CONSTRAINT "incidents_created_by_fkey" 
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- incident_assignments -> incidents (RESTRICT), users (RESTRICT), ambulances (SET NULL)
ALTER TABLE "incident_assignments" 
    ADD CONSTRAINT "incident_assignments_incident_id_fkey" 
    FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "incident_assignments_user_id_fkey" 
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "incident_assignments_ambulance_id_fkey" 
    FOREIGN KEY ("ambulance_id") REFERENCES "ambulances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- location_history -> ambulances (CASCADE)
ALTER TABLE "location_history" 
    ADD CONSTRAINT "location_history_ambulance_id_fkey" 
    FOREIGN KEY ("ambulance_id") REFERENCES "ambulances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- patients -> incidents (SET NULL)
ALTER TABLE "patients" 
    ADD CONSTRAINT "patients_incident_id_fkey" 
    FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- patient_vitals -> patients (RESTRICT), users (RESTRICT)
ALTER TABLE "patient_vitals" 
    ADD CONSTRAINT "patient_vitals_patient_id_fkey" 
    FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "patient_vitals_recorded_by_fkey" 
    FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- patient_media -> patients (CASCADE), users (RESTRICT)
ALTER TABLE "patient_media" 
    ADD CONSTRAINT "patient_media_patient_id_fkey" 
    FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "patient_media_uploaded_by_fkey" 
    FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- triage_assessments -> patients (RESTRICT), users (RESTRICT)
ALTER TABLE "triage_assessments" 
    ADD CONSTRAINT "triage_assessments_patient_id_fkey" 
    FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "triage_assessments_assessed_by_fkey" 
    FOREIGN KEY ("assessed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- inventory_transactions -> items (RESTRICT), users (RESTRICT), patients (SET NULL)
ALTER TABLE "inventory_transactions" 
    ADD CONSTRAINT "inventory_transactions_item_id_fkey" 
    FOREIGN KEY ("item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "inventory_transactions_user_id_fkey" 
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "inventory_transactions_patient_id_fkey" 
    FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- notification_deliveries -> notifications (CASCADE), users (CASCADE), devices (SET NULL)
ALTER TABLE "notification_deliveries" 
    ADD CONSTRAINT "notification_deliveries_notification_id_fkey" 
    FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "notification_deliveries_recipient_user_id_fkey" 
    FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "notification_deliveries_device_id_fkey" 
    FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- audit_logs -> users (SET NULL)
ALTER TABLE "audit_logs" 
    ADD CONSTRAINT "audit_logs_actor_user_id_fkey" 
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- sync_history -> users (RESTRICT)
ALTER TABLE "sync_history" 
    ADD CONSTRAINT "sync_history_user_id_fkey" 
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ------------------------------------------------------------------------------
-- 6. CHECK CONSTRAINTS
-- ------------------------------------------------------------------------------

-- Incidents: coordinate bounds & OCC version
ALTER TABLE "incidents"
    ADD CONSTRAINT "chk_incidents_lat" CHECK ("latitude" >= -90.0 AND "latitude" <= 90.0),
    ADD CONSTRAINT "chk_incidents_lng" CHECK ("longitude" >= -180.0 AND "longitude" <= 180.0),
    ADD CONSTRAINT "chk_incidents_version" CHECK ("version" >= 1);

-- Location History: coordinates, speed, heading bounds
ALTER TABLE "location_history"
    ADD CONSTRAINT "chk_loc_lat" CHECK ("latitude" >= -90.0 AND "latitude" <= 90.0),
    ADD CONSTRAINT "chk_loc_lng" CHECK ("longitude" >= -180.0 AND "longitude" <= 180.0),
    ADD CONSTRAINT "chk_loc_heading" CHECK ("heading" IS NULL OR ("heading" >= 0.0 AND "heading" <= 360.0)),
    ADD CONSTRAINT "chk_loc_speed" CHECK ("speed" IS NULL OR "speed" >= 0.0);

-- Patients: age bounds & OCC version
ALTER TABLE "patients"
    ADD CONSTRAINT "chk_patient_estimated_age" CHECK ("estimated_age" IS NULL OR ("estimated_age" >= 0 AND "estimated_age" <= 130)),
    ADD CONSTRAINT "chk_patient_version" CHECK ("version" >= 1);

-- Patient Vitals: physiological bounds
ALTER TABLE "patient_vitals"
    ADD CONSTRAINT "chk_vitals_systolic_bp" CHECK ("systolic_bp" IS NULL OR ("systolic_bp" >= 30 AND "systolic_bp" <= 300)),
    ADD CONSTRAINT "chk_vitals_diastolic_bp" CHECK ("diastolic_bp" IS NULL OR ("diastolic_bp" >= 10 AND "diastolic_bp" <= 200)),
    ADD CONSTRAINT "chk_vitals_heart_rate" CHECK ("heart_rate" IS NULL OR ("heart_rate" >= 20 AND "heart_rate" <= 300)),
    ADD CONSTRAINT "chk_vitals_respiratory_rate" CHECK ("respiratory_rate" IS NULL OR ("respiratory_rate" >= 0 AND "respiratory_rate" <= 80)),
    ADD CONSTRAINT "chk_vitals_oxygen_saturation" CHECK ("oxygen_saturation" IS NULL OR ("oxygen_saturation" >= 40.0 AND "oxygen_saturation" <= 100.0)),
    ADD CONSTRAINT "chk_vitals_temperature" CHECK ("temperature" IS NULL OR ("temperature" >= 25.0 AND "temperature" <= 45.0)),
    ADD CONSTRAINT "chk_vitals_gcs_score" CHECK ("gcs_score" IS NULL OR ("gcs_score" >= 3 AND "gcs_score" <= 15));

-- Patient Media: size bounds (max 10MB) & duration
ALTER TABLE "patient_media"
    ADD CONSTRAINT "chk_media_file_size" CHECK ("file_size_bytes" > 0 AND "file_size_bytes" <= 10485760),
    ADD CONSTRAINT "chk_media_duration" CHECK ("duration_seconds" IS NULL OR ("duration_seconds" >= 1 AND "duration_seconds" <= 120));

-- Triage Assessments: consistency & bounds
ALTER TABLE "triage_assessments"
    ADD CONSTRAINT "chk_triage_override_reason" CHECK ("overridden_category" IS NULL OR ("override_reason" IS NOT NULL AND length(trim("override_reason")) > 0)),
    ADD CONSTRAINT "chk_triage_respiratory_rate" CHECK ("respiratory_rate" IS NULL OR ("respiratory_rate" >= 0 AND "respiratory_rate" <= 80)),
    ADD CONSTRAINT "chk_triage_cap_refill" CHECK ("capillary_refill_sec" IS NULL OR ("capillary_refill_sec" >= 0.0 AND "capillary_refill_sec" <= 10.0));

-- Inventory Items: quantity invariants & version
ALTER TABLE "inventory_items"
    ADD CONSTRAINT "chk_inventory_qty_total" CHECK ("quantity_total" >= 0),
    ADD CONSTRAINT "chk_inventory_qty_available" CHECK ("quantity_available" >= 0),
    ADD CONSTRAINT "chk_inventory_qty_reserved" CHECK ("quantity_reserved" >= 0),
    ADD CONSTRAINT "chk_inventory_qty_balance" CHECK ("quantity_available" + "quantity_reserved" <= "quantity_total"),
    ADD CONSTRAINT "chk_inventory_version" CHECK ("version" >= 1);

-- Sync History: 64KB max response payload bound
ALTER TABLE "sync_history"
    ADD CONSTRAINT "chk_sync_payload_size" CHECK ("response_payload" IS NULL OR octet_length("response_payload"::text) <= 65536);

-- ------------------------------------------------------------------------------
-- 7. DATABASE IMMUTABILITY TRIGGERS
-- Protects append-only tables from unauthorized UPDATE and DELETE operations
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_prevent_modification()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Modifications (UPDATE or DELETE) are prohibited on immutable table: %', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

-- Trigger: audit_logs (Application-level immutable audit log)
CREATE TRIGGER trg_audit_logs_immutable
    BEFORE UPDATE OR DELETE ON "audit_logs"
    FOR EACH ROW
    EXECUTE FUNCTION fn_prevent_modification();

-- Trigger: patient_vitals (Append-only clinical observations)
CREATE TRIGGER trg_patient_vitals_immutable
    BEFORE UPDATE OR DELETE ON "patient_vitals"
    FOR EACH ROW
    EXECUTE FUNCTION fn_prevent_modification();

-- Trigger: triage_assessments (Append-only START triage evaluations)
CREATE TRIGGER trg_triage_assessments_immutable
    BEFORE UPDATE OR DELETE ON "triage_assessments"
    FOR EACH ROW
    EXECUTE FUNCTION fn_prevent_modification();

-- Trigger: inventory_transactions (Immutable stock transaction ledger)
CREATE TRIGGER trg_inventory_transactions_immutable
    BEFORE UPDATE OR DELETE ON "inventory_transactions"
    FOR EACH ROW
    EXECUTE FUNCTION fn_prevent_modification();

-- Trigger: domain_events (Append-only raw domain analytics event pipeline)
CREATE TRIGGER trg_domain_events_immutable
    BEFORE UPDATE OR DELETE ON "domain_events"
    FOR EACH ROW
    EXECUTE FUNCTION fn_prevent_modification();
