# MedFlow Architecture: Patient Domain (Phase 6)

## 1. Domain Overview & Scope

The **Patient Domain** serves as the authoritative boundary for intake, identification, demographic tracking, and clinical observation history within MedFlow.

In emergency telehealth and disaster response scenarios, patients are registered rapidly in the field (often under conditions of connectivity loss or stress), transported via ambulance teams, and handed over to emergency departments and triage units.

### Phase 6 Boundaries & Guardrails
- **Included:**
  - Patient intake/creation (Paramedic & Triage Doctor)
  - Deterministic identifier allocation (`demoId`)
  - Patient retrieval by UUID
  - Bounded pagination and filtered listing
  - Partial updates with strict Optimistic Concurrency Control (OCC)
  - Append-only point-in-time vital signs observations
  - Association with active incidents
  - RBAC authorization via Phase 5 security context
- **Strictly Excluded (Owned by Later Phases):**
  - Offline sync engine & conflict resolution queue (Phase 7)
  - Multimedia intake (photos, audio, body diagrams) (Phase 8)
  - START triage calculation, algorithmic scoring, and reassessment triggers (Phase 9)
  - Push notifications & dispatch alerts (Phase 10)
  - Inventory allocation (Phase 11)
  - Command analytics & vector mapping (Phase 12)
  - Audit trail bulk export (Phase 13)

---

## 2. Architecture & Data Flow

Requests strictly traverse the layered architecture:

```
HTTP Client (Web / Mobile)
       │
       ▼
   [Express Router] (`/api/v1/patients`)
       │
       ├─► [Authentication Middleware] (`requireAuthentication`)
       │       └─ Cryptographically verifies JWT access token & active session
       │
       ├─► [RBAC Guard Middleware] (`requireRoles`)
       │       └─ Authorizes against user role (PARAMEDIC, TRIAGE_DOCTOR, etc.)
       │
       ├─► [Validation Middleware] (`validate({ body, query, params })`)
       │       └─ Zod schema type-checking, bounds & UUID format verification
       │
       ▼
   [PatientController]
       │ Parses request params, invokes service, formats ApiResponse envelope
       ▼
   [PatientService]
       │ Enforces business rules:
       │  • Auto-generates unique demoId if omitted
       │  • Rejects closed or invalid incident associations
       │  • Enforces OCC version checking (rejects stale writes with 409)
       │  • Maps domain records to sanitized DTOs
       ▼
   [PatientRepository]
       │ Encapsulates Prisma queries:
       │  • Parameterized queries against PostgreSQL
       │  • Atomic OCC update (`WHERE id = :id AND version = :expectedVersion`)
       │  • Append-only vital signs writes
       ▼
   [Supabase PostgreSQL]
```

---

## 3. Data Integrity & Concurrency Protection

### 3.1 Optimistic Concurrency Control (OCC)
Emergency care involves multiple care providers simultaneously updating records (e.g., field paramedics updating transport status while hospital triage doctors update intake status). To prevent blind last-write-wins:

1. **Version Field:** Every patient record maintains an integer `version` field, initialized to `1`.
2. **Version Requirement:** All `PATCH /api/v1/patients/:id` requests must supply the client's current `version`.
3. **Atomic Compare-and-Increment:**
   ```sql
   UPDATE patients
   SET ... , version = version + 1, updated_at = NOW()
   WHERE id = :id AND version = :expectedVersion AND deleted_at IS NULL;
   ```
4. **Conflict Handling:**
   - If the patient does not exist or has been soft-deleted: returns `404 NOT_FOUND`.
   - If the database `version` does not match the provided `version`: returns `409 CONFLICT` with `{ currentVersion, expectedVersion }`.
   - Clients must reload the fresh patient record and reapply changes.

### 3.2 Append-Only Vital Signs Architecture
Vital signs in emergency medicine represent immutable, historical point-in-time clinical observations.
- Once recorded, a vital sign record (`patient_vitals`) is **never** updated or deleted.
- Every observation captures:
  - Clinical parameters (systolic/diastolic BP, HR, RR, SpO2, Temp, GCS)
  - `recordedBy` (Authenticated practitioner UUID)
  - `source` (`PARAMEDIC_FIELD`, `TRIAGE_NURSE`, `MONITOR_DEVICE`, etc.)
  - `recordedAt` (Observation timestamp)
- Historical vitals can be retrieved chronologically (`GET /api/v1/patients/:id/vitals`) ordered by `recordedAt DESC`.

---

## 4. Patient - Incident Association

Patients can optionally belong to a mass-casualty or disaster `Incident`:
- When associating or modifying `incidentId`, the service verifies:
  1. The referenced incident exists.
  2. The incident status is NOT `CLOSED`.
- If the incident is closed, `400 BAD_REQUEST` is returned (`Cannot associate patient with a closed incident`).

---

## 5. Future Phase Integration Points

| Integration Area | Owning Phase | Integration Contract |
| :--- | :--- | :--- |
| **Offline Sync** | Phase 7 | Mobile clients write to WatermelonDB locally with `clientCreatedAt`. Sync engine merges patient changes through `PATCH` using OCC and local sync queues. |
| **Multimedia** | Phase 8 | Media assets (wound photos, ECG recordings) reference `patientId` via `patient_media` without modifying patient table structure. |
| **START Triage** | Phase 9 | Automated decision support reads latest vitals and updates `currentTriageCategory` with audit entries in `triage_history`. |
| **Realtime Dispatch** | Phase 10 | WebSocket notifications broadcast `patient.created` and `patient.status_changed` to incident command dashboards. |
