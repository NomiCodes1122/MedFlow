# MedFlow Entity Catalog & Data Dictionary

This catalog documents the **18 core relational entities** forming the MedFlow schema on Supabase PostgreSQL.

---

## 1. Identity & Sessions Domain (3 Entities)

### 1.1 `users`
* **Module**: Module 1 — Secure Role-Based Authentication
* **Purpose**: Master application profile for medical and command personnel. Links Firebase phone identity to operational role.
* **Role Architecture**: MedFlow currently supports exactly one active operational role per user (`PARAMEDIC`, `TRIAGE_DOCTOR`, `HOSPITAL_SUPERINTENDENT`). The prototype has three fixed operational roles and does not currently require multi-role assignments. Backend authorization middleware acts as the actual security boundary.
* **Mutability**: Mutable (status, displayName, role).
* **Deletion Policy**: Soft delete via `deleted_at`.

| Column | Data Type | Nullable | Default | Constraints / References | Description |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key | Global unique user identifier. |
| `firebase_uid` | `varchar(128)` | No | — | Unique, Not Null | UID issued by Firebase Phone Authentication. |
| `phone` | `varchar(32)` | No | — | Unique, Not Null | E.164 formatted verified phone number. |
| `display_name` | `varchar(128)` | No | — | Not Null | Full legal or operational name of responder. |
| `role` | `enum_user_role` | No | — | Enum (`PARAMEDIC`, `TRIAGE_DOCTOR`, `HOSPITAL_SUPERINTENDENT`) | Operational RBAC role. |
| `status` | `enum_user_status`| No | `'ACTIVE'` | Enum (`ACTIVE`, `INACTIVE`, `SUSPENDED`) | Operational account status. |
| `created_at` | `timestamptz` | No | `now()` | Not Null | Record creation timestamp. |
| `updated_at` | `timestamptz` | No | `now()` | Auto-updated | Record modification timestamp. |
| `deleted_at` | `timestamptz` | Yes | `NULL` | Index | Soft deletion timestamp. |

---

### 1.2 `devices`
* **Module**: Module 1 (Auth) & Module 5 (Notifications)
* **Purpose**: Tracks registered mobile hardware instances and active Firebase Cloud Messaging (FCM) push tokens.
* **Mutability**: Mutable (`push_token`, `last_active_at`, `app_version`).
* **Deletion Policy**: Hard delete on explicit logout or hardware deregistrations.

| Column | Data Type | Nullable | Default | Constraints / References | Description |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key | Device record UUID. |
| `user_id` | `uuid` | No | — | FK → `users(id)` ON DELETE CASCADE | Associated authenticated user. |
| `platform` | `enum_device_platform` | No | — | Enum (`IOS`, `ANDROID`, `WEB`) | Hardware operating system. |
| `app_version` | `varchar(32)` | No | — | Not Null | SemVer client installation version. |
| `push_token` | `text` | Yes | `NULL` | Index | Active FCM device registration token. |
| `last_active_at` | `timestamptz` | No | `now()` | Not Null | Last communication ping from device. |
| `created_at` | `timestamptz` | No | `now()` | Not Null | Device registration timestamp. |
| `updated_at` | `timestamptz` | No | `now()` | Auto-updated | Last device state update. |

---

### 1.3 `refresh_tokens`
* **Module**: Module 1 — Secure Role-Based Authentication
* **Purpose**: Stores cryptographically hashed refresh tokens for session rotation and immediate revocation.
* **Mutability**: Mutable (`revoked_at`).
* **Deletion Policy**: Hard pruned after expiration.

| Column | Data Type | Nullable | Default | Constraints / References | Description |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key | Token entry identifier. |
| `user_id` | `uuid` | No | — | FK → `users(id)` ON DELETE CASCADE | Token owner. |
| `hashed_token` | `varchar(128)` | No | — | Unique, Not Null | SHA-256 hash of refresh token string. |
| `device_id` | `uuid` | Yes | `NULL` | FK → `devices(id)` ON DELETE SET NULL | Optional bound hardware device ID. |
| `expires_at` | `timestamptz` | No | — | Not Null | Absolute expiration timestamp (7 days). |
| `revoked_at` | `timestamptz` | Yes | `NULL` | Index | Timestamp when revoked during rotation. |
| `created_at` | `timestamptz` | No | `now()` | Not Null | Issuance timestamp. |

---

## 2. Incidents & Fleet Telemetry Domain (4 Entities)

### 2.1 `incidents`
* **Module**: Module 3 (Map & Routing) & Command Center
* **Purpose**: Represents an active disaster, mass-casualty incident, or localized medical emergency.
* **Mutability**: Mutable (`status`, `priority`, `resolved_at`, `version`).
* **Deletion Policy**: Never delete. Status transitions to `RESOLVED` and `CLOSED`.

| Column | Data Type | Nullable | Default | Constraints / References | Description |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key | Incident UUID. |
| `incident_number` | `varchar(32)` | No | — | Unique, Not Null | Human-readable tag (e.g., `INC-2026-004`). |
| `title` | `varchar(128)` | No | — | Not Null | Short summary (e.g., "Industrial Fire"). |
| `description` | `text` | Yes | `NULL` | — | Detailed disaster scenario notes. |
| `status` | `enum_incident_status` | No | `'ACTIVE'` | Enum (`REPORTED`, `ACTIVE`, `TRIAGE_ACTIVE`, `RESOLVED`, `CLOSED`) | Operational phase. |
| `priority` | `enum_incident_priority` | No | `'HIGH'` | Enum (`CRITICAL`, `HIGH`, `MEDIUM`, `LOW`) | Urgency level. |
| `latitude` | `double precision` | No | — | Range: -90.0 to 90.0 | Incident geographic latitude. |
| `longitude` | `double precision` | No | — | Range: -180.0 to 180.0 | Incident geographic longitude. |
| `address` | `varchar(256)` | Yes | `NULL` | — | Reverse geocoded street address. |
| `reported_at` | `timestamptz` | No | `now()` | Not Null | Dispatch or 911 intake timestamp. |
| `resolved_at` | `timestamptz` | Yes | `NULL` | — | Timestamp incident marked resolved. |
| `version` | `integer` | No | `1` | Check: `version >= 1` | Optimistic concurrency control version. |
| `created_by` | `uuid` | No | — | FK → `users(id)` ON DELETE RESTRICT | Superintendent/dispatcher creator. |
| `created_at` | `timestamptz` | No | `now()` | Not Null | Record creation timestamp. |
| `updated_at` | `timestamptz` | No | `now()` | Auto-updated | Last state update. |

---

### 2.2 `ambulances`
* **Module**: Module 3 — Interactive Vector Map & Routing
* **Purpose**: Emergency vehicle asset record tracking availability and assigned dispatch mission.
* **Mutability**: Mutable (`status`).
* **Deletion Policy**: Deactivation via `OUT_OF_SERVICE`.

| Column | Data Type | Nullable | Default | Constraints / References | Description |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key | Asset UUID. |
| `call_sign` | `varchar(32)` | No | — | Unique, Not Null | Radio identifier (e.g., `AMB-04`). |
| `license_plate` | `varchar(32)` | No | — | Not Null | Vehicle registration number. |
| `status` | `enum_ambulance_status` | No | `'AVAILABLE'` | Enum (`AVAILABLE`, `DISPATCHED`, `ON_SCENE`, `TRANSPORTING`, `OUT_OF_SERVICE`) | Current operational status. |
| `created_at` | `timestamptz` | No | `now()` | Not Null | Creation timestamp. |
| `updated_at` | `timestamptz` | No | `now()` | Auto-updated | Update timestamp. |

---

### 2.3 `incident_assignments`
* **Module**: Module 3 & Dispatch
* **Purpose**: Master authoritative table for incident-level personnel and ambulance resource allocation.
* **Mutability**: Mutable (`released_at`).
* **Deletion Policy**: Never delete. Maintained for response time analytics.

| Column | Data Type | Nullable | Default | Constraints / References | Description |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key | Assignment UUID. |
| `incident_id` | `uuid` | No | — | FK → `incidents(id)` ON DELETE RESTRICT | Target incident. |
| `user_id` | `uuid` | No | — | FK → `users(id)` ON DELETE RESTRICT | Dispatched responder. |
| `ambulance_id` | `uuid` | Yes | `NULL` | FK → `ambulances(id)` ON DELETE SET NULL | Dispatched vehicle asset. |
| `assigned_at` | `timestamptz` | No | `now()` | Not Null | Assignment dispatch timestamp. |
| `released_at` | `timestamptz` | Yes | `NULL` | — | Timestamp unit cleared scene. |
| `role_in_incident`| `varchar(64)` | No | `'LEAD_PARAMEDIC'` | Not Null | Operational assignment role. |

---

### 2.4 `location_history`
* **Module**: Module 3 — Interactive Vector Map & Routing
* **Purpose**: Periodic (sampled every 30 seconds) GPS telemetry history for ambulance path reconstruction. (Live 1 Hz telemetry is held in Redis Cloud).
* **Mutability**: **Immutable / Append-Only**.
* **Deletion Policy**: Standard table retention. Partitioning and long-term telemetry retention are deferred performance optimizations and will only be introduced if required by measured workload.

| Column | Data Type | Nullable | Default | Constraints / References | Description |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key | Breadcrumb identifier. |
| `ambulance_id` | `uuid` | No | — | FK → `ambulances(id)` ON DELETE CASCADE | Associated vehicle. |
| `latitude` | `double precision` | No | — | Range: -90.0 to 90.0 | Measured latitude. |
| `longitude` | `double precision` | No | — | Range: -180.0 to 180.0 | Measured longitude. |
| `speed` | `real` | Yes | `NULL` | Check: `speed >= 0` | Speed in meters per second. |
| `heading` | `real` | Yes | `NULL` | Range: 0.0 to 360.0 | Bearing in degrees from true North. |
| `recorded_at` | `timestamptz` | No | — | Index, Not Null | GPS fix timestamp on device. |

---

## 3. Patient & Clinical Observations Domain (4 Entities)

### 3.1 `patients`
* **Module**: Module 4 — Multimedia Emergency Intake Form
* **Purpose**: Master demographic record representing an emergency patient/casualty. Designed to be instantiated offline with a client-generated UUID.
* **Ambulance Assignment Rule**: `patients.assigned_ambulance_id` is intentionally excluded to prevent competing sources of truth; vehicle allocation is mastered authoritatively at the incident level via `incident_assignments`.
* **Triage Projection Rule**: `patients.current_triage_category` is a transactional projection maintained by the backend from the current triage assessment. It is not an independent source of truth; authoritative history resides in `triage_assessments`.
* **Mutability**: Mutable (`status`, demographics, `current_triage_category`, `version`).
* **Deletion Policy**: Soft delete via `deleted_at`.

| Column | Data Type | Nullable | Default | Constraints / References | Description |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `id` | `uuid` | No | — | Primary Key (Client or Server generated) | Patient global UUID. |
| `incident_id` | `uuid` | Yes | `NULL` | FK → `incidents(id)` ON DELETE SET NULL | Associated mass casualty incident. |
| `demo_id` | `varchar(32)` | No | — | Unique, Not Null | Human-readable tag (e.g. `TAG-RED-104`). |
| `first_name` | `varchar(64)` | Yes | `NULL` | — | Patient first name (if known). |
| `last_name` | `varchar(64)` | Yes | `NULL` | — | Patient last name (if known). |
| `estimated_age`| `smallint` | Yes | `NULL` | Check: `estimated_age BETWEEN 0 AND 130` | Visual age estimate. |
| `gender` | `enum_gender` | No | `'UNKNOWN'` | Enum (`MALE`, `FEMALE`, `OTHER`, `UNKNOWN`) | Biological sex or presentation. |
| `status` | `enum_patient_status` | No | `'FIELD_INTAKE'` | Enum (`FIELD_INTAKE`, `IN_TRANSIT`, `ARRIVED_ER`, `ADMITTED`, `DISCHARGED`, `DECEASED`) | Clinical continuum state. |
| `current_triage_category` | `enum_triage_category` | No | `'UNASSESSED'` | Enum (`RED`, `YELLOW`, `GREEN`, `BLACK`, `UNASSESSED`) | **Transactional projection** from current assessment. |
| `chief_complaint` | `text` | Yes | `NULL` | — | Primary injury / distress reason. |
| `notes` | `text` | Yes | `NULL` | — | Paramedic narrative field notes. |
| `version` | `integer` | No | `1` | Check: `version >= 1` | Optimistic concurrency version. |
| `client_created_at` | `timestamptz` | No | — | Not Null | Local device creation timestamp. |
| `created_at` | `timestamptz` | No | `now()` | Not Null | PostgreSQL sync persistence time. |
| `updated_at` | `timestamptz` | No | `now()` | Auto-updated | Last modification timestamp. |
| `deleted_at` | `timestamptz` | Yes | `NULL` | Index | Soft deletion timestamp. |

---

### 3.2 `patient_vitals`
* **Module**: Module 4 — Multimedia Emergency Intake Form
* **Purpose**: Time-varying physiological vital signs. Structured as an **immutable, append-only event stream** to guarantee zero offline merge conflicts.
* **Mutability**: **Immutable / Append-Only**.
* **Deletion Policy**: Never delete. Clinical medical record.

| Column | Data Type | Nullable | Default | Constraints / References | Description |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key (Client UUID supported) | Observation UUID. |
| `patient_id` | `uuid` | No | — | FK → `patients(id)` ON DELETE RESTRICT | Target patient. |
| `recorded_by` | `uuid` | No | — | FK → `users(id)` ON DELETE RESTRICT | Paramedic or clinician. |
| `systolic_bp` | `smallint` | Yes | `NULL` | Check: `systolic_bp BETWEEN 30 AND 300` | Systolic blood pressure (mmHg). |
| `diastolic_bp` | `smallint` | Yes | `NULL` | Check: `diastolic_bp BETWEEN 10 AND 200` | Diastolic blood pressure (mmHg). |
| `heart_rate` | `smallint` | Yes | `NULL` | Check: `heart_rate BETWEEN 20 AND 300` | Pulse rate (bpm). |
| `respiratory_rate` | `smallint` | Yes | `NULL` | Check: `respiratory_rate BETWEEN 0 AND 80` | Breaths per minute. |
| `oxygen_saturation` | `real` | Yes | `NULL` | Check: `oxygen_saturation BETWEEN 40.0 AND 100.0` | Pulse oximetry SpO2 (%). |
| `temperature` | `real` | Yes | `NULL` | Check: `temperature BETWEEN 25.0 AND 45.0` | Core temperature (°Celsius). |
| `gcs_score` | `smallint` | Yes | `NULL` | Check: `gcs_score BETWEEN 3 AND 15` | Glasgow Coma Scale total score. |
| `source` | `enum_vital_source`| No | `'PARAMEDIC_FIELD'` | Enum (`PARAMEDIC_FIELD`, `MONITOR_DEVICE`, `DOCTOR_ER`, `OFFLINE_SYNC`) | Data entry origin. |
| `recorded_at` | `timestamptz` | No | — | Not Null | Local time vitals were measured. |
| `created_at` | `timestamptz` | No | `now()` | Not Null | Server commit timestamp. |

---

### 3.3 `patient_media`
* **Module**: Module 4 — Multimedia Emergency Intake Form
* **Purpose**: Metadata and storage references for photographic injury documentation and voice memo audio notes.
* **Mutability**: Mutable (`status`, `public_url`).
* **Deletion Policy**: Soft delete via status `FAILED` or hard delete metadata on file wipe.

| Column | Data Type | Nullable | Default | Constraints / References | Description |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key (Client UUID supported) | Media record UUID. |
| `patient_id` | `uuid` | No | — | FK → `patients(id)` ON DELETE CASCADE | Associated patient. |
| `uploaded_by` | `uuid` | No | — | FK → `users(id)` ON DELETE RESTRICT | Author / responder. |
| `media_type` | `enum_media_type` | No | — | Enum (`PHOTO`, `AUDIO`) | Asset format type. |
| `storage_path` | `varchar(512)` | No | — | Unique, Not Null | Firebase Storage object key. |
| `public_url` | `text` | Yes | `NULL` | — | Signed CDN access URL. |
| `mime_type` | `varchar(64)` | No | — | Not Null (`image/jpeg`, `audio/m4a`) | Validated MIME type. |
| `file_size_bytes` | `integer` | No | — | Check: `file_size_bytes > 0 AND file_size_bytes <= 10485760` | Size in bytes (max 10MB). |
| `duration_seconds`| `smallint` | Yes | `NULL` | Check: `duration_seconds BETWEEN 1 AND 120` | Duration for audio clips. |
| `checksum_sha256` | `varchar(64)` | Yes | `NULL` | — | Cryptographic integrity hash. |
| `status` | `enum_media_status`| No | `'PENDING_UPLOAD'` | Enum (`PENDING_UPLOAD`, `UPLOADED`, `VERIFIED`, `FAILED`) | Storage ingestion lifecycle. |
| `client_captured_at` | `timestamptz` | No | — | Not Null | Time recorded on mobile sensor. |
| `created_at` | `timestamptz` | No | `now()` | Not Null | Server metadata creation time. |
| `updated_at` | `timestamptz` | No | `now()` | Auto-updated | Status change timestamp. |

---

### 3.4 `triage_assessments`
* **Module**: Module 7 — Triage Queue & Status Matrix
* **Purpose**: Records the complete inputs and result of the START (Simple Triage and Rapid Treatment) assessment, plus clinical overrides.
* **Mutability**: **Strictly Append-Only**. A doctor does NOT update an existing assessment row; reclassifications and clinical overrides are appended as new immutable assessment records. A partial unique index guarantees at most one current assessment per patient.
* **Deletion Policy**: Never delete. Complete historical chain preserved.

| Column | Data Type | Nullable | Default | Constraints / References | Description |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key (Client UUID supported) | Triage evaluation identifier. |
| `patient_id` | `uuid` | No | — | FK → `patients(id)` ON DELETE RESTRICT | Evaluated patient. |
| `assessed_by` | `uuid` | No | — | FK → `users(id)` ON DELETE RESTRICT | Clinician performing evaluation. |
| `can_walk` | `boolean` | No | — | Not Null | START Step 1: Able to ambulate? |
| `has_respirations` | `boolean` | No | — | Not Null | START Step 2: Spontaneous breathing? |
| `respiratory_rate` | `smallint` | Yes | `NULL` | Check: `respiratory_rate BETWEEN 0 AND 80` | START Step 2b: Breaths/min (>30 = RED). |
| `radial_pulse` | `boolean` | Yes | `NULL` | — | START Step 3: Radial pulse palpable? |
| `capillary_refill_sec` | `real` | Yes | `NULL` | Check: `capillary_refill_sec BETWEEN 0.0 AND 10.0` | START Step 3b: Refill time (>2s = RED). |
| `follows_commands` | `boolean` | Yes | `NULL` | — | START Step 4: Mental status (CAN follow). |
| `calculated_category` | `enum_triage_category` | No | — | Enum (`RED`, `YELLOW`, `GREEN`, `BLACK`) | Deterministic START output. |
| `overridden_category` | `enum_triage_category` | Yes | `NULL` | Enum (`RED`, `YELLOW`, `GREEN`, `BLACK`) | Doctor clinical override category. |
| `override_reason` | `text` | Yes | `NULL` | Required if `overridden_category IS NOT NULL` | Medical justification for override. |
| `is_current` | `boolean` | No | `true` | Partial Unique Index `(patient_id) WHERE is_current = true` | Active assessment flag. |
| `assessment_source` | `enum_triage_source` | No | `'FIELD_START'` | Enum (`FIELD_START`, `ER_TRIAGE_REASSESSMENT`) | Evaluation stage. |
| `assessed_at` | `timestamptz` | No | — | Not Null | Device assessment timestamp. |
| `created_at` | `timestamptz` | No | `now()` | Not Null | Server commit timestamp. |

---

## 4. Hospital Inventory Domain (2 Entities)

### 4.1 `inventory_items`
* **Module**: Module 6 — Dynamic Resource Inventory CRUD
* **Purpose**: Master table for concurrently edited life-support resources (ICU beds, oxygen cylinders, medications).
* **Quantity Invariant**:
  $$\text{quantity\_total} \ge 0$$
  $$\text{quantity\_available} \ge 0$$
  $$\text{quantity\_reserved} \ge 0$$
  $$\text{quantity\_available} + \text{quantity\_reserved} \le \text{quantity\_total}$$
* **Mutability**: Mutable via Optimistic Concurrency Control (`version`).
* **Deletion Policy**: Deactivation via threshold/status; never hard deleted if transactions exist.

| Column | Data Type | Nullable | Default | Constraints / References | Description |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key | Item UUID. |
| `name` | `varchar(128)` | No | — | Unique, Not Null | Resource description (e.g. `ICU Bed O2`). |
| `category` | `enum_inventory_category` | No | — | Enum (`BED`, `OXYGEN`, `MEDICATION`) | Resource classification. |
| `unit` | `varchar(32)` | No | — | Not Null (`beds`, `cylinders`, `vials`) | Measurement unit. |
| `quantity_total` | `integer` | No | — | Check: `quantity_total >= 0` | Total hospital capacity/stock. |
| `quantity_available` | `integer` | No | — | Check: `quantity_available >= 0` | Available unreserved stock. |
| `quantity_reserved` | `integer` | No | `0` | Check: `quantity_reserved >= 0` | Temporarily reserved stock. |
| `low_stock_threshold`| `integer` | No | `5` | Check: `low_stock_threshold >= 0` | Trigger for critical push alert. |
| `version` | `integer` | No | `1` | Check: `version >= 1` | Optimistic Concurrency Control version. |
| `created_at` | `timestamptz` | No | `now()` | Not Null | Creation timestamp. |
| `updated_at` | `timestamptz` | No | `now()` | Auto-updated | Last state/version increment time. |

---

### 4.2 `inventory_transactions`
* **Module**: Module 6 — Dynamic Resource Inventory CRUD
* **Purpose**: **Immutable inventory transaction ledger** tracking every stock increment, decrement, reservation, and consumption.
* **Mutability**: **Immutable / Append-Only**.
* **Deletion Policy**: Never delete. Stock movement accountability ledger.

| Column | Data Type | Nullable | Default | Constraints / References | Description |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key | Transaction UUID. |
| `item_id` | `uuid` | No | — | FK → `inventory_items(id)` ON DELETE RESTRICT | Target resource item. |
| `user_id` | `uuid` | No | — | FK → `users(id)` ON DELETE RESTRICT | Clinician executing transaction. |
| `patient_id` | `uuid` | Yes | `NULL` | FK → `patients(id)` ON DELETE SET NULL | Patient receiving resource (if consumed). |
| `transaction_type` | `enum_inventory_tx_type` | No | — | Enum (`CONSUMED`, `RECEIVED_RESTOCK`, `RESERVED`, `RELEASED`, `ADJUSTMENT`) | Nature of transaction. |
| `quantity_delta` | `integer` | No | — | Not Null (e.g. `-1` or `+10`) | Delta applied to `quantity_available`. |
| `previous_available`| `integer` | No | — | Not Null | Stock level prior to transaction. |
| `new_available` | `integer` | No | — | Not Null | Stock level resulting from transaction. |
| `reason` | `text` | No | — | Not Null | Operational rationale. |
| `request_id` | `varchar(64)` | Yes | `NULL` | — | HTTP correlation trace ID. |
| `created_at` | `timestamptz` | No | `now()` | Not Null | Ledger commitment timestamp. |

---

## 5. Notifications Domain (2 Entities)

### 5.1 `notifications`
* **Module**: Module 5 — Push Notification & Alert Priority Queue
* **Purpose**: Stores the canonical notification event message, priority, and entity metadata.
* **Mutability**: Immutable event record.
* **Deletion Policy**: Pruned after 30 days.

| Column | Data Type | Nullable | Default | Constraints / References | Description |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key | Notification record UUID. |
| `priority` | `enum_notification_priority` | No | `'LOW'` | Enum (`CRITICAL`, `MODERATE`, `LOW`) | Delivery urgency tier. |
| `title` | `varchar(128)` | No | — | Not Null | Notification header text. |
| `body` | `text` | No | — | Not Null | Detailed message content. |
| `category` | `varchar(64)` | No | — | Not Null (e.g. `TRIAGE_ALERT`) | Business category. |
| `entity_type` | `varchar(32)` | Yes | `NULL` | — | Related entity (`PATIENT`, `INCIDENT`). |
| `entity_id` | `uuid` | Yes | `NULL` | — | Target entity identifier. |
| `deep_link` | `varchar(256)` | Yes | `NULL` | — | Client routing URI scheme. |
| `created_at` | `timestamptz` | No | `now()` | Not Null | Alert creation timestamp. |

---

### 5.2 `notification_deliveries`
* **Module**: Module 5 — Push Notification & Alert Priority Queue
* **Purpose**: Tracks delivery state of a notification to an individual recipient user and physical device.
* **Mutability**: Mutable (`status`, `sent_at`, `delivered_at`, `read_at`).
* **Deletion Policy**: Cascades on notification deletion or user purge.

| Column | Data Type | Nullable | Default | Constraints / References | Description |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key | Delivery record UUID. |
| `notification_id` | `uuid` | No | — | FK → `notifications(id)` ON DELETE CASCADE | Associated notification message. |
| `recipient_user_id`| `uuid` | No | — | FK → `users(id)` ON DELETE CASCADE | Target recipient user. |
| `device_id` | `uuid` | Yes | `NULL` | FK → `devices(id)` ON DELETE SET NULL | Target physical device (if device-bound). |
| `status` | `enum_delivery_status` | No | `'QUEUED'` | Enum (`QUEUED`, `SENT_FCM`, `DELIVERED`, `READ`, `FAILED`) | Delivery state. |
| `fcm_message_id` | `varchar(128)` | Yes | `NULL` | — | FCM upstream message tracking ID. |
| `failure_reason` | `text` | Yes | `NULL` | — | Upstream error description if failed. |
| `sent_at` | `timestamptz` | Yes | `NULL` | — | Timestamp handed to FCM. |
| `delivered_at` | `timestamptz` | Yes | `NULL` | — | Timestamp delivery confirmed by client. |
| `read_at` | `timestamptz` | Yes | `NULL` | — | Timestamp user opened alert. |
| `created_at` | `timestamptz` | No | `now()` | Not Null | Delivery queue entry creation time. |
| `updated_at` | `timestamptz` | No | `now()` | Auto-updated | Status change timestamp. |

---

## 6. Audit, Analytics & Sync Domain (3 Entities)

### 6.1 `audit_logs`
* **Module**: Module 9 — Audit Trail & Export Engine
* **Purpose**: **Application-level immutable audit log**. Normal application users cannot update or delete audit records. PostgreSQL triggers provide an additional database-level protection against `UPDATE` and `DELETE` operations.
* **Mutability**: **Strictly Immutable / Append-Only**.
* **Deletion Policy**: Never delete. Permanent retention.

| Column | Data Type | Nullable | Default | Constraints / References | Description |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key | Audit entry identifier. |
| `actor_user_id` | `uuid` | Yes | `NULL` | FK → `users(id)` ON DELETE SET NULL | User who initiated action (NULL if system). |
| `actor_role` | `varchar(32)` | Yes | `NULL` | — | Snapshot of actor's active role. |
| `action` | `varchar(64)` | No | — | Not Null (e.g. `TRIAGE_OVERRIDE`) | Business operation name. |
| `entity_type` | `varchar(32)` | No | — | Not Null (`PATIENT`, `INVENTORY`) | Target domain entity name. |
| `entity_id` | `varchar(64)` | No | — | Not Null | Primary key of affected entity. |
| `client_timestamp` | `timestamptz` | Yes | `NULL` | — | Device clock time for offline actions. |
| `timestamp` | `timestamptz` | No | `now()` | Index, Not Null | Authoritative server commit timestamp. |
| `request_id` | `varchar(64)` | Yes | `NULL` | Index | Distributed trace correlation ID. |
| `device_id` | `varchar(64)` | Yes | `NULL` | — | Hardware device installation ID. |
| `ip_address` | `varchar(45)` | Yes | `NULL` | — | IPv4 or IPv6 client origin. |
| `user_agent` | `varchar(256)` | Yes | `NULL` | — | Client platform browser/app header. |
| `metadata` | `jsonb` | Yes | `NULL` | GIN Index | Non-sensitive mutation diff and context. |

---

### 6.2 `domain_events`
* **Module**: Module 8 — Analytics & Resource Utilization Graphs
* **Purpose**: Append-only event store capturing domain lifecycle milestones used by the analytics engine to calculate real KPIs.
* **Mutability**: **Immutable / Append-Only**.
* **Deletion Policy**: Retained as operational milestone log.

| Column | Data Type | Nullable | Default | Constraints / References | Description |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key | Event UUID. |
| `event_type` | `varchar(64)` | No | — | Index, Not Null (e.g. `patient.triaged`) | Domain milestone name. |
| `aggregate_type` | `varchar(32)` | No | — | Not Null (`INCIDENT`, `PATIENT`) | Domain aggregate entity type. |
| `aggregate_id` | `uuid` | No | — | Index, Not Null | Aggregate entity UUID. |
| `incident_id` | `uuid` | Yes | `NULL` | Index | Associated incident for aggregation. |
| `user_id` | `uuid` | Yes | `NULL` | — | Actor trigger. |
| `payload` | `jsonb` | No | `'{}'` | Not Null | Lightweight event payload. |
| `occurred_at` | `timestamptz` | No | — | Index, Not Null | Event occurrence timestamp. |
| `recorded_at` | `timestamptz` | No | `now()` | Not Null | Server database persistence timestamp. |

---

### 6.3 `sync_history`
* **Module**: Module 2 — Local Cache & Conflict Resolution
* **Purpose**: Server-side idempotency registry. Ensures offline outbox operations are processed exactly once and returns cached responses on retried requests.
* **Payload Bound**: `response_payload` is capped at 64KB per serialized payload to prevent unbounded storage accumulation.
* **Mutability**: Mutable only on status transition (`PROCESSING` → `APPLIED` / `CONFLICT` / `FAILED`).
* **Deletion Policy**: Retained for 30 days.

| Column | Data Type | Nullable | Default | Constraints / References | Description |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `operation_id` | `uuid` | No | — | Primary Key (Client-supplied UUIDv4) | Global mutation idempotency key. |
| `device_id` | `varchar(64)` | No | — | Index, Not Null | Originating device hardware ID. |
| `user_id` | `uuid` | No | — | FK → `users(id)` ON DELETE RESTRICT | Responder submitting sync batch. |
| `entity_type` | `enum_sync_entity_type` | No | — | Enum (`PATIENT`, `OBSERVATION`, `TRIAGE`, `INVENTORY`, `MEDIA`) | Target entity domain. |
| `entity_id` | `uuid` | No | — | Index, Not Null | Target record UUID. |
| `operation_type`| `enum_sync_op_type` | No | — | Enum (`CREATE`, `UPDATE`, `DELETE`) | Action intent. |
| `client_timestamp` | `timestamptz` | No | — | Not Null | Device clock when mutation queued. |
| `server_timestamp` | `timestamptz` | No | `now()` | Not Null | Server ingestion time. |
| `status` | `enum_sync_status` | No | `'APPLIED'` | Enum (`APPLIED`, `DUPLICATE_IGNORED`, `CONFLICT`, `FAILED`) | Processing outcome. |
| `conflict_details`| `jsonb` | Yes | `NULL` | — | Discrepancy details if status is `CONFLICT`. |
| `response_payload`| `jsonb` | Yes | `NULL` | Check: `octet_length(response_payload::text) <= 65536` | Cached response (max 64KB). |
| `applied_at` | `timestamptz` | No | `now()` | Not Null | Timestamp transaction committed. |
