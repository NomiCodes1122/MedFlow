# MedFlow Data Ownership & Mutation Authority Matrix

This document defines the module boundaries, role authority, deletion policies, and audit mandates for all 18 persistent database entities in MedFlow.

---

## 1. Complete Entity Ownership Matrix (18 Entities)

| Entity | Owner Module | Created By | Updated By | Delete Policy | Audit Required |
| :--- | :--- | :--- | :--- | :--- | :---: |
| `users` | Module 1 — Authentication | System / Admin | `SUPERINTENDENT`, User (self display) | Soft delete (`deleted_at`) | **YES** |
| `devices` | Module 1 (Auth) / 5 (Notifs) | Mobile / Web Client | Client (heartbeat ping) | Hard delete on logout | NO |
| `refresh_tokens` | Module 1 — Authentication | Express Auth Service | Express Auth Service (revoke) | Hard prune after expiry | **YES** |
| `incidents` | Module 3 — Map & Command | `HOSPITAL_SUPERINTENDENT` | `HOSPITAL_SUPERINTENDENT` | Status close; Never delete | **YES** |
| `ambulances` | Module 3 — Map & Fleet | `HOSPITAL_SUPERINTENDENT` | System / Paramedic (status) | Status deactivation | **YES** |
| `incident_assignments`| Module 3 — Map & Dispatch | `HOSPITAL_SUPERINTENDENT` | `HOSPITAL_SUPERINTENDENT` | Never delete (History) | **YES** |
| `location_history` | Module 3 — Vector Map | System (Sampled Telemetry) | None (Append-Only) | Standard table retention | NO |
| `patients` | Module 4 — Intake Form | `PARAMEDIC` | `PARAMEDIC`, `TRIAGE_DOCTOR` | Soft delete (`deleted_at`) | **YES** |
| `patient_vitals` | Module 4 — Intake Form | `PARAMEDIC`, `TRIAGE_DOCTOR` | None (Append-Only) | Never delete (Clinical) | **YES** |
| `patient_media` | Module 4 — Intake Form | `PARAMEDIC` | System (status verify) | Hard delete on media purge | **YES** |
| `triage_assessments` | Module 7 — START Triage | `PARAMEDIC`, `TRIAGE_DOCTOR` | **None (Append-Only)** | Never delete (Append-Only) | **YES** |
| `inventory_items` | Module 6 — Inventory CRUD | `HOSPITAL_SUPERINTENDENT` | `DOCTOR`, `SUPERINTENDENT` (OCC) | Deactivate via threshold | **YES** |
| `inventory_transactions`| Module 6 — Inventory CRUD | `DOCTOR`, `SUPERINTENDENT` | None (Append-Only) | Never delete (Ledger) | **YES** |
| `notifications` | Module 5 — Priority Queue | System / Dispatcher | None (Immutable event) | Pruned after 30 days | NO |
| `notification_deliveries`| Module 5 — Priority Queue | System Dispatcher | System (status), User (read) | Cascade on notif purge | NO |
| `audit_logs` | Module 9 — Audit Trail | Express Audit Middleware | **NONE (Protected by Trigger)**| **NEVER DELETE (Immutable)**| N/A |
| `domain_events` | Module 8 — Analytics | System Event Bus | None (Append-Only) | Standard table retention | NO |
| `sync_history` | Module 2 — Sync Engine | Express Sync Engine | Express Sync Engine (status) | Pruned after 30 days | **YES** |

---

## 2. Ownership & Authority Rules

### 2.1 The Clinical Observation Seal (Vitals & Triage)
- **Rule**: `patient_vitals` and historical `triage_assessments` rows are **strictly immutable once written**.
- **Enforcement**: Responders cannot issue an `UPDATE` or `DELETE` SQL command against existing clinical observation rows. When a patient is reassessed, a new assessment record is appended with `is_current = true` while the previous record is set to `is_current = false`. Complete evaluation history is preserved.

### 2.2 Inventory Mutex & Concurrency Ownership
- **Rule**: Only users with `TRIAGE_DOCTOR` or `HOSPITAL_SUPERINTENDENT` roles can mutate `inventory_items.quantity_available`.
- **Enforcement**: All quantity adjustments must be accompanied by an atomic insert into `inventory_transactions`. Any quantity change without a corresponding transaction row is rejected by database constraints and Express use case validators.

### 2.3 Application-Level Immutable Audit Log
- **Rule**: `audit_logs` is owned exclusively by the system's compliance subsystem.
- **Enforcement**: Normal application users cannot update or delete audit records. PostgreSQL triggers provide an additional database-level protection against `UPDATE` and `DELETE` operations.
