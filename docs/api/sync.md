# MedFlow API Specification: Offline Batch Synchronization

**Endpoint:** `POST /api/v1/sync/batch`  
**Protocol:** HTTPS / JSON  
**Authentication Standard:** Bearer JWT Access Token (`Authorization: Bearer <accessToken>`)  
**Allowed Roles:** `PARAMEDIC`, `TRIAGE_DOCTOR`  

---

## 1. Overview

The batch synchronization endpoint ingests a batch of offline-queued mutations atomically and idempotently.

Each mutation carries an immutable `operationId` (UUIDv4) acting as an idempotency key. If a network acknowledgment was lost in transit and the client re-submits the exact same mutation, the server queries `sync_history`, identifies the operation as `DUPLICATE_IGNORED`, and returns the cached response without re-applying side effects.

---

## 2. Request Envelope

* **Headers:**
  ```http
  Authorization: Bearer <accessToken>
  Content-Type: application/json
  ```
* **Request Body:**
  ```json
  {
    "deviceId": "mobile-client-001",
    "clientBatchTimestamp": "2026-09-29T08:30:00.000Z",
    "operations": [
      {
        "operationId": "b1111111-1111-4111-8111-111111111111",
        "entityType": "PATIENT",
        "entityId": "a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d",
        "operationType": "CREATE",
        "clientTimestamp": "2026-09-29T08:25:00.000Z",
        "payload": {
          "firstName": "John",
          "lastName": "Doe",
          "estimatedAge": 35,
          "gender": "MALE",
          "status": "FIELD_INTAKE",
          "currentTriageCategory": "YELLOW",
          "chiefComplaint": "Fractured clavicle",
          "notes": "Splint applied"
        }
      },
      {
        "operationId": "b2222222-2222-4222-8222-222222222222",
        "entityType": "OBSERVATION",
        "entityId": "e1e2e3e4-e5f6-4a5b-8c9d-0e1f2a3b4c5d",
        "operationType": "CREATE",
        "clientTimestamp": "2026-09-29T08:26:00.000Z",
        "payload": {
          "patientId": "a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d",
          "systolicBp": 120,
          "diastolicBp": 80,
          "heartRate": 78,
          "respiratoryRate": 16,
          "oxygenSaturation": 98.5
        }
      }
    ]
  }
  ```

---

## 3. Success Response (200 OK)

```json
{
  "success": true,
  "data": {
    "processedAt": "2026-09-29T08:30:01.250Z",
    "results": [
      {
        "operationId": "b1111111-1111-4111-8111-111111111111",
        "status": "APPLIED",
        "serverTimestamp": "2026-09-29T08:30:01.200Z",
        "responsePayload": {
          "id": "a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d",
          "demoId": "MED-PT-KRX9Z1-A48F",
          "firstName": "John",
          "lastName": "Doe",
          "version": 1,
          "createdAt": "2026-09-29T08:30:01.100Z"
        }
      },
      {
        "operationId": "b2222222-2222-4222-8222-222222222222",
        "status": "APPLIED",
        "serverTimestamp": "2026-09-29T08:30:01.230Z",
        "responsePayload": {
          "id": "e1e2e3e4-e5f6-4a5b-8c9d-0e1f2a3b4c5d",
          "patientId": "a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d",
          "heartRate": 78,
          "source": "OFFLINE_SYNC"
        }
      }
    ]
  }
}
```

---

## 4. Conflict & Duplicate Replay Responses

### Duplicate Replay (`DUPLICATE_IGNORED`):
When a previously processed `operationId` is submitted again:
```json
{
  "operationId": "b1111111-1111-4111-8111-111111111111",
  "status": "DUPLICATE_IGNORED",
  "serverTimestamp": "2026-09-29T08:30:01.200Z",
  "responsePayload": {
    "id": "a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d",
    "version": 1
  }
}
```

### OCC Stale Version Conflict (`CONFLICT`):
When a patient update provides a stale version:
```json
{
  "operationId": "b3333333-3333-4333-8333-333333333333",
  "status": "CONFLICT",
  "serverTimestamp": "2026-09-29T08:30:01.200Z",
  "conflictDetails": {
    "message": "Optimistic concurrency conflict: database version is 3, expected 1",
    "currentServerVersion": 3,
    "expectedVersion": 1,
    "currentServerState": {
      "id": "a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d",
      "version": 3,
      "status": "ARRIVED_ER"
    }
  }
}
```

---

## 5. Batch Failure Isolation & Strict Domain Validation

The batch synchronization pipeline isolates each operation within its own atomic transaction. This guarantees:
1. **No Cascade Rollbacks**: A malformed or conflicting operation in a batch never rolls back preceding or subsequent valid operations.
2. **Strict Domain Validation**: Payloads are validated against domain schemas (`syncPatientCreatePayloadSchema`, `syncPatientUpdatePayloadSchema`, `syncVitalCreatePayloadSchema`) before application.
3. **Audited Failures**: Operations that fail validation or domain constraints are recorded in `sync_history` with `status: FAILED` and reasons stored in `conflict_details`.

### Example: Partial Failure Response (Mixed Batch)

```json
{
  "success": true,
  "data": {
    "processedAt": "2026-09-29T08:30:01.500Z",
    "results": [
      {
        "operationId": "b1111111-1111-4111-8111-111111111111",
        "status": "APPLIED",
        "serverTimestamp": "2026-09-29T08:30:01.100Z",
        "responsePayload": {
          "id": "a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d",
          "demoId": "MED-PT-KRX9Z1-A48F",
          "version": 1
        }
      },
      {
        "operationId": "b2222222-2222-4222-8222-222222222222",
        "status": "FAILED",
        "serverTimestamp": "2026-09-29T08:30:01.200Z",
        "error": {
          "code": "VALIDATION_ERROR",
          "message": "Invalid triage category: INVALID_COLOR"
        }
      },
      {
        "operationId": "b3333333-3333-4333-8333-333333333333",
        "status": "CONFLICT",
        "serverTimestamp": "2026-09-29T08:30:01.300Z",
        "conflictDetails": {
          "message": "Optimistic concurrency conflict: database version is 3, expected 1",
          "currentServerVersion": 3,
          "expectedVersion": 1
        }
      }
    ]
  }
}
```

