# MedFlow Offline Synchronization Data Model & Protocol

## 1. Storage Partitioning: SQLite vs Supabase PostgreSQL
A fundamental architectural principle of MedFlow is that the mobile device and backend server maintain distinct, purpose-built data representations during offline operations:

```text
┌──────────────────────────────────────┐       ┌──────────────────────────────────────┐
│        MOBILE DEVICE (SQLite)        │       │    BACKEND (Supabase PostgreSQL)     │
├──────────────────────────────────────┤       ├──────────────────────────────────────┤
│ 1. Local Domain Mirrors:             │       │ 1. Master System of Record (SoR):    │
│    - patients (draft & active)       │       │    - patients                        │
│    - patient_vitals                  │       │    - patient_vitals                  │
│    - triage_assessments              │       │    - triage_assessments              │
│    - inventory_items (read cache)    │       │    - inventory_items (authoritative) │
│                                      │       │    - audit_logs (immutable)          │
│ 2. Local Mutation Outbox:            │       │                                      │
│    - outbox_operations table         │       │ 2. Server Idempotency Registry:      │
│      (PENDING, SYNCING, FAILED)      │       │    - sync_history table              │
│                                      │       │      (APPLIED, DUPLICATE_IGNORED,    │
│ 3. Media Binary Outbox:              │       │       CONFLICT, FAILED)              │
│    - /media/outbox/*.jpg, *.m4a      │       └──────────────────────────────────────┘
└──────────────────────────────────────┘
```

---

## 2. Server-Side Idempotency Schema: `sync_history`

When an offline batch reaches `POST /api/v1/sync/batch`, the Express backend verifies each operation against `sync_history` inside a database transaction:

```sql
CREATE TABLE sync_history (
    operation_id UUID PRIMARY KEY,                   -- Client-generated UUIDv4 idempotency key
    device_id VARCHAR(64) NOT NULL,                 -- Originating device hardware installation ID
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    entity_type enum_sync_entity_type NOT NULL,      -- 'PATIENT', 'OBSERVATION', 'TRIAGE', 'INVENTORY', 'MEDIA'
    entity_id UUID NOT NULL,                        -- Target domain entity UUID
    operation_type enum_sync_op_type NOT NULL,       -- 'CREATE', 'UPDATE', 'DELETE'
    client_timestamp TIMESTAMPTZ NOT NULL,          -- Local device clock time when queued
    server_timestamp TIMESTAMPTZ NOT NULL DEFAULT now(), -- Server reception time
    status enum_sync_status NOT NULL DEFAULT 'APPLIED',  -- 'APPLIED', 'DUPLICATE_IGNORED', 'CONFLICT', 'FAILED'
    conflict_details JSONB,                         -- Diff details if conflict detected
    response_payload JSONB,                         -- Serialized cached response for duplicate replays (max 64KB)
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()   -- Transaction commitment timestamp
);

ALTER TABLE sync_history 
    ADD CONSTRAINT chk_sync_payload_size 
        CHECK (response_payload IS NULL OR octet_length(response_payload::text) <= 65536);

CREATE INDEX idx_sync_history_device ON sync_history(device_id, applied_at DESC);
CREATE INDEX idx_sync_history_entity ON sync_history(entity_type, entity_id);
```

---

## 3. Client-Side SQLite Outbox Schema: `outbox_operations`

On the mobile device, mutations are written immediately to the local domain table AND queued in SQLite:

```sql
CREATE TABLE outbox_operations (
    operation_id TEXT PRIMARY KEY,       -- UUIDv4 generated on device
    client_id TEXT NOT NULL,            -- Device hardware identifier
    entity_type TEXT NOT NULL,          -- 'PATIENT', 'OBSERVATION', 'TRIAGE', 'INVENTORY'
    entity_id TEXT NOT NULL,            -- Local or master entity UUID
    operation_type TEXT NOT NULL,       -- 'CREATE', 'UPDATE', 'DELETE'
    payload TEXT NOT NULL,              -- Serialized JSON mutation payload
    sync_status TEXT NOT NULL,          -- 'PENDING', 'SYNCING', 'SYNCED', 'FAILED', 'CONFLICT'
    client_timestamp INTEGER NOT NULL,  -- Epoch milliseconds on device
    server_timestamp INTEGER,           -- Server epoch milliseconds upon ACK
    retry_count INTEGER DEFAULT 0,      -- Retries attempted
    max_retries INTEGER DEFAULT 5,      -- Threshold before manual review
    last_error_message TEXT,            -- Diagnostic string if failed
    last_attempt_at INTEGER,            -- Timestamp of last HTTP attempt
    created_at INTEGER NOT NULL         -- Timestamp operation enqueued
);

CREATE INDEX idx_outbox_operations_status ON outbox_operations(sync_status, created_at);
```

---

## 4. Batch Synchronization Protocol (`POST /api/v1/sync/batch`)

### 4.1 Client Request Envelope
```json
{
  "deviceId": "f81d4fae-7dec-11d0-a765-00a0c91e6bf6",
  "clientBatchTimestamp": "2026-09-28T18:30:00.000Z",
  "operations": [
    {
      "operationId": "c56a4180-65aa-42ec-a945-5fd21dec0538",
      "entityType": "OBSERVATION",
      "entityId": "a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d",
      "operationType": "CREATE",
      "clientTimestamp": "2026-09-28T18:25:00.000Z",
      "payload": {
        "patientId": "a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d",
        "systolicBp": 85,
        "diastolicBp": 55,
        "heartRate": 130,
        "oxygenSaturation": 89.0,
        "respiratoryRate": 34,
        "gcsScore": 13
      }
    }
  ]
}
```

### 4.2 Server Ingestion Algorithm:
```typescript
// Express Sync Controller Ingestion Pipeline (Conceptual Flow)
export async function processSyncBatch(req: Request, res: Response) {
  const { deviceId, operations } = req.body;
  const userId = req.user.id;
  const results = [];

  // Execute entire batch inside an atomic Prisma transaction
  await prisma.$transaction(async (tx) => {
    for (const op of operations) {
      // 1. Idempotency Check
      const existing = await tx.syncHistory.findUnique({
        where: { operationId: op.operationId }
      });

      if (existing) {
        // Operation was already applied in a prior attempt whose ACK was lost
        results.push({
          operationId: op.operationId,
          status: 'DUPLICATE_IGNORED',
          serverTimestamp: existing.serverTimestamp,
          responsePayload: existing.responsePayload
        });
        continue;
      }

      // 2. Route by Entity Type & Apply Mutation
      try {
        const outcome = await applyEntityMutation(tx, op, userId);
        
        // 3. Record Idempotency Success (Bounded response payload)
        await tx.syncHistory.create({
          data: {
            operationId: op.operationId,
            deviceId,
            userId,
            entityType: op.entityType,
            entityId: op.entityId,
            operationType: op.operationType,
            clientTimestamp: op.clientTimestamp,
            status: 'APPLIED',
            responsePayload: outcome
          }
        });

        results.push({
          operationId: op.operationId,
          status: 'APPLIED',
          serverTimestamp: new Date(),
          responsePayload: outcome
        });
      } catch (err: any) {
        if (err instanceof ConcurrencyConflictError) {
          // Record Conflict
          await tx.syncHistory.create({
            data: {
              operationId: op.operationId,
              deviceId,
              userId,
              entityType: op.entityType,
              entityId: op.entityId,
              operationType: op.operationType,
              clientTimestamp: op.clientTimestamp,
              status: 'CONFLICT',
              conflictDetails: { message: err.message, currentServerState: err.serverState }
            }
          });

          results.push({
            operationId: op.operationId,
            status: 'CONFLICT',
            conflictDetails: { message: err.message, currentServerState: err.serverState }
          });
        } else {
          throw err; // Transient failure rolls back transaction
        }
      }
    }
  });

  return res.status(200).json({ processedAt: new Date(), results });
}
```

### 4.3 Idempotency Replay Guarantee
If the paramedic's mobile device transmits a batch of operations, Supabase PostgreSQL commits the writes, but the cellular tower drops before the HTTP response reaches the phone:
1. The phone's sync worker retries after an exponential backoff.
2. The exact same `operationId` arrives at the Express server.
3. The server queries `sync_history`, finds `status: APPLIED`, and immediately returns the cached `response_payload`.
4. **Result**: Zero duplicate vitals, zero double inventory decrements, and zero corrupted records.
