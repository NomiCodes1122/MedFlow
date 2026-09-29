# MedFlow Database Relationships & Referential Integrity

This document defines the foreign key relationships, cardinalities, and deletion behaviors across all 18 MedFlow entities.

---

## 1. Relationship Specification & Foreign Key Actions

| Parent Entity | Child Entity | Relationship | Foreign Key Column | `ON DELETE` Action | Architectural Rationale |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `users` | `devices` | 1 : N | `devices.user_id` | `CASCADE` | If a user account is deleted, active hardware device sessions are removed. |
| `users` | `refresh_tokens` | 1 : N | `refresh_tokens.user_id` | `CASCADE` | Deleting a user invalidates all active session tokens immediately. |
| `devices` | `refresh_tokens` | 1 : N | `refresh_tokens.device_id` | `SET NULL` | Nullable device binding; unregistering a hardware unit unlinks device session without invalidating base identity. |
| `users` | `incidents` | 1 : N | `incidents.created_by` | `RESTRICT` | Users who created emergency incidents cannot be deleted; prevents orphan incident records. |
| `incidents` | `incident_assignments` | 1 : N | `incident_assignments.incident_id`| `RESTRICT` | Prevents deleting incidents while dispatch assignments exist. |
| `users` | `incident_assignments` | 1 : N | `incident_assignments.user_id` | `RESTRICT` | Preserves dispatch responder history for response time auditing. |
| `ambulances` | `incident_assignments` | 1 : N | `incident_assignments.ambulance_id`| `SET NULL` | Removing an ambulance asset unlinks it from the assignment without destroying the responder log. |
| `ambulances` | `location_history` | 1 : N | `location_history.ambulance_id` | `CASCADE` | Vehicle GPS breadcrumbs belong strictly to the vehicle asset lifecycle. |
| `incidents` | `patients` | 1 : N | `patients.incident_id` | `SET NULL` | If an incident record is archived or reorganized, patient clinical records are preserved. |
| `patients` | `patient_vitals` | 1 : N | `patient_vitals.patient_id` | `RESTRICT` | Clinical vital signs are protected medical records; never cascaded or orphaned. |
| `users` | `patient_vitals` | 1 : N | `patient_vitals.recorded_by` | `RESTRICT` | Clinician recorder identity is immutable on vital sign observations. |
| `patients` | `patient_media` | 1 : N | `patient_media.patient_id` | `CASCADE` | If a mock/demo patient is purged, attached injury photos/audio metadata are removed. |
| `users` | `patient_media` | 1 : N | `patient_media.uploaded_by` | `RESTRICT` | Media uploader identity cannot be expunged. |
| `patients` | `triage_assessments` | 1 : N | `triage_assessments.patient_id` | `RESTRICT` | Triage classifications cannot be orphaned or accidentally deleted. |
| `users` | `triage_assessments` | 1 : N | `triage_assessments.assessed_by`| `RESTRICT` | Triage evaluator accountability is preserved permanently. |
| `inventory_items`| `inventory_transactions` | 1 : N | `inventory_transactions.item_id` | `RESTRICT` | Master stock items cannot be deleted if historical audit transactions exist. |
| `users` | `inventory_transactions` | 1 : N | `inventory_transactions.user_id` | `RESTRICT` | Accountability for resource consumption cannot be detached. |
| `patients` | `inventory_transactions` | 1 : N | `inventory_transactions.patient_id`| `SET NULL` | If a patient record is soft-deleted, inventory consumption ledger rows remain valid. |
| `notifications` | `notification_deliveries` | 1 : N | `notification_deliveries.notification_id` | `CASCADE` | Pruning a notification message cleans up its delivery attempts. |
| `users` | `notification_deliveries` | 1 : N | `notification_deliveries.recipient_user_id`| `CASCADE` | User-bound delivery queue entries are purged if the user is deleted. |
| `devices` | `notification_deliveries` | 1 : N | `notification_deliveries.device_id` | `SET NULL` | Deregistering a device retains the delivery log in user history. |
| `users` | `audit_logs` | 1 : N | `audit_logs.actor_user_id` | `SET NULL` | Application-level immutable audit log. If a user is purged, `actor_role` and audit trail remain. |
| `users` | `sync_history` | 1 : N | `sync_history.user_id` | `RESTRICT` | Idempotency history preserves the originating user identity. |

---

## 2. Cardinality Analysis & Domain Constraints

### 2.1 Patients to Vitals (1 : N Append-Only)
- **Constraint**: One patient has zero or more vital sign observations.
- **Access Rule**: The active vital signs are determined by querying the latest observation ordered by `recorded_at DESC LIMIT 1`.
- **Integrity**: Deleting a patient with vital signs is blocked (`RESTRICT`). Clinicians must soft-delete the patient using `deleted_at`.

### 2.2 Patients to Triage Assessments (1 : N Historical Stream & Projection)
- **Constraint**: A patient has one or more triage assessments over time.
- **Partial Unique Index**:
  ```sql
  CREATE UNIQUE INDEX uq_triage_assessments_current_patient 
  ON triage_assessments (patient_id) 
  WHERE is_current = true;
  ```
- **Transactional Update Rule**: Updating a patient's triage assessment must occur inside a single atomic database transaction:
  1. Set the previous current assessment's `is_current = false`.
  2. Insert the new assessment with `is_current = true`.
  3. Update `patients.current_triage_category` as a denormalized operational projection.
  4. Commit as one atomic transaction.

### 2.3 Inventory Concurrency & Transactions (1 : N Ledger)
- **Constraint**: An `inventory_item` has an authoritative current balance (`quantity_available`) and many ledger entries in `inventory_transactions`.
- **Integrity Rule**: Direct modification of `quantity_available` without an accompanying `inventory_transactions` row is prohibited by the application use case layer. Both writes execute within a single Prisma transaction. This acts as an **immutable inventory transaction ledger**.

### 2.4 Separation of Notification Message and Deliveries
- **Constraint**: A single notification broadcast event (`notifications`) targets one or more recipient users and devices via `notification_deliveries`.
- **Delivery Strategy**: Notifications target users. The notification dispatcher generates delivery rows for each active device where `push_token IS NOT NULL`, tracking delivery state (`QUEUED`, `SENT_FCM`, `DELIVERED`, `READ`, `FAILED`) per device instance.

### 2.5 Incident-Level Ambulance Assignment
- **Constraint**: Ambulances are assigned to incidents via `incident_assignments` (`incident_id`, `user_id`, `ambulance_id`, `assigned_at`, `released_at`).
- **No Dual Source of Truth**: `patients.assigned_ambulance_id` is excluded. Casualties belong to an incident (`patients.incident_id`), and responding ambulances treat casualties at that incident based on `incident_assignments`.
