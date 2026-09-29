# MedFlow End-to-End Operational Data Flow

## 1. Complete Disaster Response Flow Overview
MedFlow operates as an event-driven, closed-loop coordination engine during mass-casualty incidents. Every clinical and operational action moves through a verified pipeline:

```mermaid
sequenceDiagram
    autonumber
    actor Sup as Superintendent (Web)
    actor Par as Paramedic (Mobile)
    actor Doc as Triage Doctor (Mobile)
    participant API as Express API Gateway
    participant SQLite as Mobile SQLite & Outbox
    participant PG as Supabase PostgreSQL (via Prisma)
    participant Redis as Redis Cloud (PubSub)
    participant FCM as Firebase Cloud Messaging
    participant Store as Firebase Storage

    %% 1. Incident Creation & Assignment
    Sup->>API: POST /incidents (Mass Casualty Fire, 20 victims)
    API->>PG: INSERT Incident & Assignments (Prisma Transaction)
    API->>PG: INSERT AuditLog (INCIDENT_CREATED)
    API->>Redis: Publish "incident.created"
    API->>FCM: Dispatch Critical Push Alert (topic:paramedics)
    FCM-->>Par: "Urgent Incident Assigned: Downtown Highrise"
    API-->>Sup: 201 Created (Incident ID, Version 1)

    %% 2. Paramedic Intake & Offline Capture
    Par->>SQLite: Create Patient Record (Local UUID, status: DRAFT)
    Par->>SQLite: Record Vital Signs (BP: 85/55, HR: 130, SpO2: 88%)
    Par->>Store: (If online) Direct Upload Photo/Audio Blob
    Note over Par,SQLite: Paramedic enters basement / network drops
    Par->>SQLite: Execute START Triage (Breathing > 30 bpm -> RED/IMMEDIATE)
    Par->>SQLite: Queue Mutation in Outbox (status: PENDING, OpID: uuid-99)

    %% 3. Reconnection & Outbox Synchronization
    Note over Par,API: Paramedic returns to ambulance / 4G restored
    Par->>API: POST /sync/batch (OpID: uuid-99, IdempotencyKey: uuid-99)
    API->>PG: Check SyncHistory (OpID: uuid-99 not present)
    API->>PG: BEGIN TRANSACTION (Prisma)
    API->>PG: INSERT Patient, Observations, TriageAssessment
    API->>PG: INSERT SyncHistory (OpID: uuid-99, SUCCESS)
    API->>PG: INSERT AuditLog (PATIENT_SYNCED, TRIAGE_COMMITTED)
    API->>PG: COMMIT
    API-->>Par: 200 OK (Sync Acknowledged: uuid-99 SUCCESS)
    Par->>SQLite: UPDATE Outbox SET status='SYNCED'

    %% 4. Realtime Broadcast & Doctor Clinical Review
    API->>Redis: Publish "patient.created" & "triage.evaluated" (RED)
    Redis-->>API: Distribute across Socket.IO Cluster
    API-->>Doc: Socket.IO Event "patient.created" (Patient RED incoming)
    API-->>Sup: Socket.IO Event "triage.queue.updated" (ER load +1)
    API->>FCM: Send High-Priority Alert to Doctor Mobile
    FCM-->>Doc: In-App Banner: "Critical Inbound: Red Patient #104"

    %% 5. Resource Allocation & Concurrency Handling
    Doc->>API: PATCH /inventory/bed-icu-01 (expectedVersion: 4, qty -1)
    API->>PG: SELECT version FROM InventoryItem WHERE id='bed-icu-01' FOR UPDATE
    Note over API,PG: Version matches (v4). Decrement stock.
    API->>PG: UPDATE InventoryItem SET qty=qty-1, version=5
    API->>PG: INSERT InventoryTransaction & AuditLog
    API-->>Doc: 200 OK (Updated to v5)
    API->>Redis: Publish "inventory.updated"
    Redis-->>API: Broadcast
    API-->>Sup: Socket.IO Event "inventory.updated" (Web Grid updates in real-time)

    %% 6. Analytics & Audit Finalization
    API->>PG: INSERT DomainEvent (patient.triaged, resource.consumed)
    API->>Redis: Invalidate Analytics Cache
    Sup->>API: GET /analytics/dashboard
    API->>PG: Aggregate Real Event Timestamps (Response Time, ER Load)
    API-->>Sup: 200 OK (Live KPI Graphs re-render)
    Sup->>API: POST /audit/export (Format: CSV)
    API->>PG: Stream AuditLog records WHERE incidentId=X
    API->>PG: INSERT AuditLog (AUDIT_DATA_EXPORTED)
    API-->>Sup: 200 OK (text/csv stream)
```

---

## 2. Transition-by-Transition Detailed Analysis

### Transition 1: Incident Creation & Paramedic Assignment
- **Trigger**: Command Center Superintendent receives emergency dispatch call and creates an incident record.
- **Backend Action**: The Express API wraps the incident generation, ambulance assignment, and audit log in a single Supabase PostgreSQL transaction via Prisma.
- **Notification**: Redis Cloud publishes the assignment, triggering FCM to wake up the paramedic’s device even if the app is backgrounded.

### Transition 2: Field Intake, Vitals, and START Triage Evaluation
- **Trigger**: Paramedic arrives at the disaster zone and begins assessing casualties.
- **Mobile Action**: The mobile app (built via EAS) computes the START algorithm locally in milliseconds. The logic is fully self-contained:
  1. *Ability to walk?* Yes -> `GREEN (Minor)`.
  2. *Spontaneous breathing?* No -> Open airway. Still no? -> `BLACK (Expectant)`. Yes -> `RED (Immediate)`.
  3. *Respiratory rate?* > 30/min -> `RED (Immediate)`.
  4. *Perfusion (radial pulse or cap refill > 2s)?* Absent -> `RED (Immediate)`.
  5. *Mental status (follows simple commands)?* No -> `RED (Immediate)`. Otherwise -> `YELLOW (Delayed)`.
- **Local Persistence**: Both the assessment inputs (e.g., `respiratoryRate: 34`) and the resulting classification (`RED`) are saved to local SQLite.

### Transition 3: Network Disconnection & Offline Outbox Queuing
- **Scenario**: Paramedic operates inside a collapsed parking garage or disaster tunnel with zero cellular coverage.
- **Guarantee**: Zero data loss. The mutation is wrapped as an `OutboxOperation` record in SQLite with a generated client UUID (`operationId`), payload JSON, and status `PENDING`.

### Transition 4: Reconnection & Atomic Batch Synchronization
- **Trigger**: Paramedic exits the structure; `@react-native-community/netinfo` detects an active internet connection.
- **Sync Engine**: The mobile worker wakes up, queries all `PENDING` outbox entries, and sends a batched HTTPS `POST /api/v1/sync/batch` request with idempotency headers.
- **Backend Transaction**: The Express server inspects the `SyncHistory` table in Supabase PostgreSQL via Prisma. If the `operationId` has never been seen, it applies the mutation, records the operation ID in `SyncHistory`, and logs an immutable audit event—all inside one atomic database transaction.

### Transition 5: Real-Time Broadcast & Doctor Triage Stream
- **Trigger**: Successful commit of the synchronized patient and triage records in Supabase PostgreSQL.
- **Realtime Gateway**: The Express API emits domain events to Redis Cloud. Connected API instances receive the message via the Redis adapter and forward it across the authenticated `triage:queue` Socket.IO room.
- **Doctor Notification**: The Emergency Room Triage Doctor’s mobile dashboard immediately inserts the new patient into the `RED` column of the triage matrix, accompanied by a local audio/haptic alert.

### Transition 6: Hospital Resource Allocation with Concurrency Control
- **Trigger**: Triage Doctor determines the incoming patient requires an emergency ventilator/ICU bed and submits a reservation.
- **Concurrency Check**: The doctor’s request includes `expectedVersion: 4`. If another clinical staff member updated the bed count a moment prior (advancing server version to 5 in Supabase PostgreSQL), the server immediately aborts the write, rolls back the transaction, and returns HTTP 409 Conflict. The client UI then presents the refreshed stock with conflict guidance.

### Transition 7: Analytics Pipeline & Operational Metrics Computation
- **Trigger**: Domain events accumulate in the `DomainEvent` table in Supabase PostgreSQL (`incident.created`, `ambulance.dispatched`, `ambulance.arrived`, `patient.triaged`, `patient.admitted`).
- **Processing**: The Express analytics service calculates response metrics using real event deltas:
  $$\text{Response Time} = T(\text{ambulance.arrived}) - T(\text{incident.created})$$
  $$\text{ER Load} = \frac{\text{Active Inbound Red/Yellow Patients} + \text{Admitted Patients}}{\text{Staffed Emergency Beds}}$$
- **Result**: Web Command Center graphs re-render dynamically from Supabase PostgreSQL event data without fake mock metrics.

### Transition 8: Immutable Audit Logging & Streaming Export
- **Trigger**: Superintendent requests an operational audit export for post-incident disaster review.
- **Security Check**: Express API verifies the caller possesses the `SUPERINTENDENT` role.
- **Streaming Pipeline**: The backend queries the `AuditLog` table in Supabase PostgreSQL using cursor pagination and pipes CSV rows directly into the HTTP response stream, preventing Node.js buffer overflows. The export request itself is recorded as a new audit event.
