# MedFlow Security: Patient Domain Authorization & RBAC

## 1. Principles of Least Privilege

Patient data constitutes sensitive Protected Health Information (PHI). MedFlow enforces strict access policies to ensure only authorized emergency personnel have access to specific operations.

1. **Server-Side Enforcement:** Role assignments are never trusted from client payloads. They are resolved server-side from the authenticated database user context (`req.auth.role`).
2. **Explicit Whitelisting:** Endpoints explicitly whitelist allowed roles via `requireRoles(...)`.
3. **No Direct Database Access:** Clients interact exclusively through Express API endpoints.

---

## 2. Role-Based Access Control (RBAC) Matrix

MedFlow recognizes three authoritative operational roles:

| Action / Endpoint | `PARAMEDIC` | `TRIAGE_DOCTOR` | `HOSPITAL_SUPERINTENDENT` | Authorization Error |
| :--- | :---: | :---: | :---: | :--- |
| **Create Patient** (`POST /patients`) |  Allowed |  Allowed | ❌ Forbidden | `403 AUTH_ROLE_REQUIRED` |
| **List Patients** (`GET /patients`) |  Allowed |  Allowed |  Allowed | `403 AUTH_ROLE_REQUIRED` |
| **Get Patient by ID** (`GET /patients/:id`) |  Allowed |  Allowed |  Allowed | `403 AUTH_ROLE_REQUIRED` |
| **Update Patient** (`PATCH /patients/:id`) |  Allowed |  Allowed | ❌ Forbidden | `403 AUTH_ROLE_REQUIRED` |
| **Record Vital Signs** (`POST /patients/:id/vitals`) |  Allowed |  Allowed | ❌ Forbidden | `403 AUTH_ROLE_REQUIRED` |
| **View Vitals History** (`GET /patients/:id/vitals`) |  Allowed |  Allowed |  Allowed | `403 AUTH_ROLE_REQUIRED` |

### Rationale:
- **`PARAMEDIC`:** Operates on the frontlines; requires read/write access to register patients, record field vitals, and update transit status.
- **`TRIAGE_DOCTOR`:** Operates in emergency receiving facilities; requires read/write access to update intake status, triage categories, notes, and hospital-administered vitals.
- **`HOSPITAL_SUPERINTENDENT`:** Command & oversight role; granted read-only visibility into patient volume and vitals history across facilities, but prohibited from direct clinical modification.

---

## 3. Data Protection & Sensitive Data Hygiene

1. **No Sensitive PII in Logs:** Structured JSON logs emit only operational identifiers (`patientId`, `demoId`, `incidentId`, `actorId`, `actorRole`). Clinical notes, chief complaints, and patient names are stripped from system logs.
2. **Standardized Error Masking:** Database error codes and raw Prisma exceptions are intercepted and converted to standardized `ApiError` instances before reaching clients.
3. **Optimistic Concurrency Protection:** Unintentional overwrites are prevented via the `version` column, protecting clinical data consistency during high-stress disaster response workflows.
4. **Append-Only Vitals Protection:** Vitals endpoints only support insertion and retrieval; updates and deletions are architecturally impossible.
