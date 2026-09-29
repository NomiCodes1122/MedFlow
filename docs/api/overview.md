# MedFlow Command API Specification & Overview

**API Version:** `v1`  
**Base Protocol:** HTTPS & WSS (Socket.IO)  
**Base Path:** `/api/v1`  
**System Status:** Foundation & Infrastructure Baseline

---

## 1. Global Request & Response Conventions

### 1.1 HTTP Headers
All client interactions must adhere to the following header specifications:

| Header Name | Required | Type | Description |
| :--- | :---: | :--- | :--- |
| `Content-Type` | Yes (for JSON bodies) | `application/json` | Enforces JSON-serialized payloads. |
| `X-Request-ID` | Optional | `string` (UUID) | Correlation trace ID. If omitted, the server automatically generates and attaches one. |
| `Authorization` | Yes (in future auth phases) | `Bearer <JWT>` | Future bearer token authentication for operational endpoints. |

### 1.2 Standard Success Envelope
All successful API responses return a uniform JSON envelope:

```json
{
  "success": true,
  "data": {
    "key": "value"
  },
  "meta": {
    "pagination": {
      "page": 1,
      "limit": 50,
      "total": 120,
      "totalPages": 3
    }
  }
}
```

* `success`: Always `true` on 2xx responses.
* `data`: Payload containing the requested resource or command result.
* `meta`: Optional metadata object (e.g., pagination details, timestamps).

### 1.3 Standard Error Envelope
All error responses (4xx and 5xx) return a structured error envelope without leaking server internals or database connection details:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request data",
    "requestId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "details": [
      {
        "field": "callSign",
        "message": "String must contain at least 3 character(s)",
        "rule": "too_small"
      }
    ]
  }
}
```

### 1.4 Stable Error Codes Dictionary

| Code | HTTP Status | Meaning |
| :--- | :---: | :--- |
| `VALIDATION_ERROR` | 400 | Request body, query parameters, or route parameters failed schema validation. |
| `BAD_REQUEST` | 400 | Malformed JSON payload or invalid syntactic structure. |
| `UNAUTHORIZED` | 401 | Authentication missing or access token invalid/expired. |
| `FORBIDDEN` | 403 | Authenticated user lacks permission for the requested action. |
| `NOT_FOUND` | 404 | The requested endpoint or database resource does not exist. |
| `CONFLICT` | 409 | Resource state conflict (e.g., unique key violation, OCC version mismatch). |
| `RATE_LIMITED` | 429 | Request threshold exceeded; client must apply exponential backoff. |
| `DATABASE_ERROR` | 500 / 400 | Database-level operation failure or integrity violation. |
| `INTERNAL_ERROR` | 500 | Unhandled server exception (sanitized generic message). |
| `SERVICE_UNAVAILABLE` | 503 | Server or downstream dependency (DB/Redis) is currently unreachable. |

---

## 2. Infrastructure & Diagnostic Endpoints

### 2.1 Liveness Probe (`GET /health`)
Determines whether the Express process is running and able to handle incoming HTTP requests. Does **not** query downstream databases.

* **Path:** `/health`
* **Method:** `GET`
* **Success Status:** `200 OK`
* **Response Body:**
  ```json
  {
    "success": true,
    "data": {
      "status": "ok",
      "service": "medflow-api",
      "environment": "development",
      "timestamp": "2026-09-29T00:00:00.000Z"
    }
  }
  ```

### 2.2 Readiness Probe (`GET /ready`)
Determines whether all critical infrastructure dependencies (PostgreSQL via Prisma, Redis Cloud via PING, Firebase Admin) are operational.

* **Path:** `/ready`
* **Method:** `GET`
* **Success Status:** `200 OK` (when all dependencies are operational)
* **Degraded Status:** `503 Service Unavailable` (when one or more dependencies are down)
* **Response Body (Ready):**
  ```json
  {
    "success": true,
    "data": {
      "status": "ready",
      "service": "medflow-api",
      "dependencies": {
        "database": "up",
        "redis": "up",
        "firebase": "up"
      },
      "timestamp": "2026-09-29T00:00:00.000Z"
    }
  }
  ```

---

## 3. Versioned API Root (`GET /api/v1`)
Returns service metadata and active documentation pointers.

* **Path:** `/api/v1`
* **Method:** `GET`
* **Success Status:** `200 OK`
* **Response Body:**
  ```json
  {
    "success": true,
    "data": {
      "name": "MedFlow Disaster Response Command System API",
      "version": "v1",
      "description": "Emergency Telehealth & Field Telemetry Real-time Gateway",
      "documentation": "/docs"
    }
  }
  ```

---

## 4. Future Domain Modules Roadmap (Phases 5+)
The following domain modules will be mounted under `/api/v1` in subsequent phases:

* `/api/v1/auth`: Authentication, OTP session exchange, and token rotation (Phase 5)
* `/api/v1/incidents`: Incident dispatch and ambulance assignments (Phase 6)
* `/api/v1/patients`: Patient casualty intake, START triage, and vital signs (Phase 7)
* `/api/v1/inventory`: Life-support inventory stock and immutable transaction ledger (Phase 8)
* `/api/v1/notifications`: Push alerts and recipient delivery tracking (Phase 9)
* `/api/v1/sync`: SQLite offline outbox batch synchronization and idempotency (Phase 10)
