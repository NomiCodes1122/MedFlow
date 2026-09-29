# MedFlow Database Constraints & Enumeration Architecture

This document specifies the database-level integrity constraints, check bounds, unique keys, and PostgreSQL enum types that enforce core business invariants directly at the database engine level.

---

## 1. Domain Enumerations

MedFlow uses native **PostgreSQL Enums** mapped directly into Prisma ORM.

### Enum Tradeoff Analysis:
- **Decision**: Native PostgreSQL Enums (`CREATE TYPE enum_name AS ENUM (...)`).
- **Advantages**:
  1. *Storage Efficiency*: Stored internally as 4-byte integers rather than variable-length strings, reducing table and index footprint by up to 60%.
  2. *Compile-Time & DB-Time Safety*: Any string not matching the enum values is rejected immediately at the database engine boundary with an explicit SQL error, preventing corrupted data.
  3. *Zero Schema Drift*: Prisma generates strongly-typed TypeScript enums matching the exact database types.

| Enum Type Name | Permitted Values | Domain Usage |
| :--- | :--- | :--- |
| `enum_user_role` | `'PARAMEDIC'`, `'TRIAGE_DOCTOR'`, `'HOSPITAL_SUPERINTENDENT'` | System RBAC operational role. |
| `enum_user_status` | `'ACTIVE'`, `'INACTIVE'`, `'SUSPENDED'` | Account lifecycle state. |
| `enum_device_platform` | `'IOS'`, `'ANDROID'`, `'WEB'` | Hardware operating system. |
| `enum_incident_status` | `'REPORTED'`, `'ACTIVE'`, `'TRIAGE_ACTIVE'`, `'RESOLVED'`, `'CLOSED'` | Mass casualty disaster phase. |
| `enum_incident_priority` | `'CRITICAL'`, `'HIGH'`, `'MEDIUM'`, `'LOW'` | Disaster incident operational urgency tier. |
| `enum_notification_priority`| `'CRITICAL'`, `'MODERATE'`, `'LOW'` | Canonical push notification delivery urgency tier. |
| `enum_ambulance_status`| `'AVAILABLE'`, `'DISPATCHED'`, `'ON_SCENE'`, `'TRANSPORTING'`, `'OUT_OF_SERVICE'` | Emergency vehicle fleet state. |
| `enum_gender` | `'MALE'`, `'FEMALE'`, `'OTHER'`, `'UNKNOWN'` | Patient biological sex / demographic profile. |
| `enum_patient_status` | `'FIELD_INTAKE'`, `'IN_TRANSIT'`, `'ARRIVED_ER'`, `'ADMITTED'`, `'DISCHARGED'`, `'DECEASED'` | Emergency patient clinical workflow. |
| `enum_triage_category`| `'RED'`, `'YELLOW'`, `'GREEN'`, `'BLACK'`, `'UNASSESSED'` | START triage severity rating. |
| `enum_triage_source` | `'FIELD_START'`, `'ER_TRIAGE_REASSESSMENT'` | Triage evaluation context. |
| `enum_vital_source` | `'PARAMEDIC_FIELD'`, `'MONITOR_DEVICE'`, `'DOCTOR_ER'`, `'OFFLINE_SYNC'` | Physiological data origin. |
| `enum_media_type` | `'PHOTO'`, `'AUDIO'` | Media asset format. |
| `enum_media_status` | `'PENDING_UPLOAD'`, `'UPLOADED'`, `'VERIFIED'`, `'FAILED'` | Media ingestion lifecycle. |
| `enum_inventory_category`| `'BED'`, `'OXYGEN'`, `'MEDICATION'` | Life-support resource classification. |
| `enum_inventory_tx_type` | `'CONSUMED'`, `'RECEIVED_RESTOCK'`, `'RESERVED'`, `'RELEASED'`, `'ADJUSTMENT'` | Inventory transaction ledger type. |
| `enum_delivery_status` | `'QUEUED'`, `'SENT_FCM'`, `'DELIVERED'`, `'READ'`, `'FAILED'` | Notification delivery state. |
| `enum_sync_entity_type`| `'PATIENT'`, `'OBSERVATION'`, `'TRIAGE'`, `'INVENTORY'`, `'MEDIA'` | Target domain for offline sync. |
| `enum_sync_op_type` | `'CREATE'`, `'UPDATE'`, `'DELETE'` | Mutation intent in sync outbox. |
| `enum_sync_status` | `'APPLIED'`, `'DUPLICATE_IGNORED'`, `'CONFLICT'`, `'FAILED'` | Idempotent sync ingestion result. |

---

## 2. Table-Level Check Constraints & Validation Rules

```sql
-- =========================================================================
-- 1. Physiological Vitals Validation Boundaries (patient_vitals)
-- Prevents corrupted data, sensor noise, or invalid decimal entries
-- =========================================================================
ALTER TABLE patient_vitals
    ADD CONSTRAINT chk_vitals_systolic_bp 
        CHECK (systolic_bp IS NULL OR (systolic_bp >= 30 AND systolic_bp <= 300)),
    ADD CONSTRAINT chk_vitals_diastolic_bp 
        CHECK (diastolic_bp IS NULL OR (diastolic_bp >= 10 AND diastolic_bp <= 200)),
    ADD CONSTRAINT chk_vitals_heart_rate 
        CHECK (heart_rate IS NULL OR (heart_rate >= 20 AND heart_rate <= 300)),
    ADD CONSTRAINT chk_vitals_respiratory_rate 
        CHECK (respiratory_rate IS NULL OR (respiratory_rate >= 0 AND respiratory_rate <= 80)),
    ADD CONSTRAINT chk_vitals_oxygen_saturation 
        CHECK (oxygen_saturation IS NULL OR (oxygen_saturation >= 40.0 AND oxygen_saturation <= 100.0)),
    ADD CONSTRAINT chk_vitals_temperature 
        CHECK (temperature IS NULL OR (temperature >= 25.0 AND temperature <= 45.0)),
    ADD CONSTRAINT chk_vitals_gcs_score 
        CHECK (gcs_score IS NULL OR (gcs_score >= 3 AND gcs_score <= 15));

-- =========================================================================
-- 2. Inventory Quantity Invariants (inventory_items)
-- Strict mathematical balance: available >= 0, reserved >= 0, available + reserved <= total
-- =========================================================================
ALTER TABLE inventory_items
    ADD CONSTRAINT chk_inventory_qty_total 
        CHECK (quantity_total >= 0),
    ADD CONSTRAINT chk_inventory_qty_available 
        CHECK (quantity_available >= 0),
    ADD CONSTRAINT chk_inventory_qty_reserved 
        CHECK (quantity_reserved >= 0),
    ADD CONSTRAINT chk_inventory_qty_balance 
        CHECK (quantity_available + quantity_reserved <= quantity_total),
    ADD CONSTRAINT chk_inventory_version 
        CHECK (version >= 1);

-- =========================================================================
-- 3. Patient Demographic Bounds (patients)
-- =========================================================================
ALTER TABLE patients
    ADD CONSTRAINT chk_patient_estimated_age 
        CHECK (estimated_age IS NULL OR (estimated_age >= 0 AND estimated_age <= 130)),
    ADD CONSTRAINT chk_patient_version 
        CHECK (version >= 1);

-- =========================================================================
-- 4. Geospatial Coordinates Bounds (incidents & location_history)
-- =========================================================================
ALTER TABLE incidents
    ADD CONSTRAINT chk_incidents_lat 
        CHECK (latitude >= -90.0 AND latitude <= 90.0),
    ADD CONSTRAINT chk_incidents_lng 
        CHECK (longitude >= -180.0 AND longitude <= 180.0),
    ADD CONSTRAINT chk_incidents_version 
        CHECK (version >= 1);

ALTER TABLE location_history
    ADD CONSTRAINT chk_loc_lat 
        CHECK (latitude >= -90.0 AND latitude <= 90.0),
    ADD CONSTRAINT chk_loc_lng 
        CHECK (longitude >= -180.0 AND longitude <= 180.0),
    ADD CONSTRAINT chk_loc_heading 
        CHECK (heading IS NULL OR (heading >= 0.0 AND heading <= 360.0)),
    ADD CONSTRAINT chk_loc_speed 
        CHECK (speed IS NULL OR speed >= 0.0);

-- =========================================================================
-- 5. Media Constraints (patient_media)
-- =========================================================================
ALTER TABLE patient_media
    ADD CONSTRAINT chk_media_file_size 
        CHECK (file_size_bytes > 0 AND file_size_bytes <= 10485760), -- Max 10MB
    ADD CONSTRAINT chk_media_duration 
        CHECK (duration_seconds IS NULL OR (duration_seconds >= 1 AND duration_seconds <= 120));

-- =========================================================================
-- 6. Triage Consistency (triage_assessments)
-- Requires an override reason whenever a clinical override is made
-- =========================================================================
ALTER TABLE triage_assessments
    ADD CONSTRAINT chk_triage_override_reason 
        CHECK (overridden_category IS NULL OR (override_reason IS NOT NULL AND length(trim(override_reason)) > 0)),
    ADD CONSTRAINT chk_triage_respiratory_rate 
        CHECK (respiratory_rate IS NULL OR (respiratory_rate >= 0 AND respiratory_rate <= 80)),
    ADD CONSTRAINT chk_triage_cap_refill 
        CHECK (capillary_refill_sec IS NULL OR (capillary_refill_sec >= 0.0 AND capillary_refill_sec <= 10.0));

-- =========================================================================
-- 7. Sync History Response Payload Bound
-- =========================================================================
ALTER TABLE sync_history
    ADD CONSTRAINT chk_sync_payload_size
        CHECK (response_payload IS NULL OR octet_length(response_payload::text) <= 65536);
```

---

## 3. Unique Constraints Summary

| Table | Constraint Name | Columns | Operational Invariant Enforced |
| :--- | :--- | :--- | :--- |
| `users` | `uq_users_firebase_uid` | `(firebase_uid)` | Prevents duplicate accounts bound to a single Firebase identity. |
| `users` | `uq_users_phone` | `(phone)` | Ensures phone number is globally unique across all users. |
| `refresh_tokens` | `uq_refresh_tokens_hashed` | `(hashed_token)` | Enforces single-use token rotation properties. |
| `incidents` | `uq_incidents_number` | `(incident_number)` | Unique, human-readable dispatch incident tag (e.g. `INC-2026-001`). |
| `ambulances` | `uq_ambulances_call_sign`| `(call_sign)` | Radio call sign uniqueness across the fleet (e.g. `AMB-01`). |
| `patients` | `uq_patients_demo_id` | `(demo_id)` | Unique disaster triage tag attached to physical casualty wristband. |
| `triage_assessments`| `uq_triage_current_patient`| `(patient_id)` WHERE `is_current = true` | **Guarantees only one current triage assessment per patient**. |
| `patient_media` | `uq_media_storage_path` | `(storage_path)` | Prevents multiple database records mapping to the same cloud blob. |
| `inventory_items`| `uq_inventory_name` | `(name)` | Prevents duplicate cataloging of life-support items. |
| `sync_history` | `uq_sync_operation_id` | `(operation_id)` | Primary key idempotency: guarantees single execution per operation. |
