# MedFlow API Specification: Patient Domain

**Endpoint Prefix:** `/api/v1/patients`  
**Protocol:** HTTPS / JSON  
**Authentication Standard:** Bearer JWT Access Token (`Authorization: Bearer <accessToken>`)  

---

## 1. Endpoints Overview

| Method | Path | Allowed Roles | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/patients` | `PARAMEDIC`, `TRIAGE_DOCTOR` | Create a new patient intake record |
| `GET` | `/api/v1/patients` | `PARAMEDIC`, `TRIAGE_DOCTOR`, `HOSPITAL_SUPERINTENDENT` | List patients with pagination & filters |
| `GET` | `/api/v1/patients/:id` | `PARAMEDIC`, `TRIAGE_DOCTOR`, `HOSPITAL_SUPERINTENDENT` | Retrieve single patient record by UUID |
| `PATCH` | `/api/v1/patients/:id` | `PARAMEDIC`, `TRIAGE_DOCTOR` | Update patient with OCC protection |
| `POST` | `/api/v1/patients/:id/vitals` | `PARAMEDIC`, `TRIAGE_DOCTOR` | Append a new vital sign observation |
| `GET` | `/api/v1/patients/:id/vitals` | `PARAMEDIC`, `TRIAGE_DOCTOR`, `HOSPITAL_SUPERINTENDENT` | Get chronological vital signs history |

---

## 2. Endpoints Detail

### 2.1 Create Patient (`POST /api/v1/patients`)
Registers a new patient intake. Can be initiated in the field by paramedics or in the emergency department by triage doctors.

* **Headers:**
  ```http
  Authorization: Bearer <accessToken>
  Content-Type: application/json
  ```
* **Request Body Schema:**
  ```json
  {
    "demoId": "DEMO-PT-001",
    "incidentId": "33333333-3333-3333-3333-333333333333",
    "firstName": "Jane",
    "lastName": "Doe",
    "estimatedAge": 28,
    "gender": "FEMALE",
    "status": "FIELD_INTAKE",
    "currentTriageCategory": "YELLOW",
    "chiefComplaint": "Fractured left clavicle, mild disorientation",
    "notes": "Immobilized with sling",
    "clientCreatedAt": "2026-09-29T08:00:00.000Z"
  }
  ```
  *(Note: All fields except `clientCreatedAt` are optional. If `demoId` is omitted, the backend auto-generates a unique `MED-PT-XXXX-XXXX` identifier.)*

* **Success Response (201 Created):**
  ```json
  {
    "success": true,
    "data": {
      "id": "a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d",
      "demoId": "MED-PT-KRX9Z1-A48F",
      "incidentId": "33333333-3333-3333-3333-333333333333",
      "firstName": "Jane",
      "lastName": "Doe",
      "estimatedAge": 28,
      "gender": "FEMALE",
      "status": "FIELD_INTAKE",
      "currentTriageCategory": "YELLOW",
      "chiefComplaint": "Fractured left clavicle, mild disorientation",
      "notes": "Immobilized with sling",
      "version": 1,
      "clientCreatedAt": "2026-09-29T08:00:00.000Z",
      "createdAt": "2026-09-29T08:00:01.124Z",
      "updatedAt": "2026-09-29T08:00:01.124Z"
    }
  }
  ```

---

### 2.2 List Patients (`GET /api/v1/patients`)
Retrieves a paginated list of active patients with deterministic sorting (`createdAt DESC, id ASC`).

* **Query Parameters:**
  - `page` (optional integer, min: 1, default: 1)
  - `limit` (optional integer, min: 1, max: 100, default: 20)
  - `incidentId` (optional UUID)
  - `status` (optional `FIELD_INTAKE | IN_TRANSIT | ARRIVED_ER | ADMITTED | DISCHARGED | DECEASED`)
  - `triageCategory` (optional `RED | YELLOW | GREEN | BLACK`)

* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d",
        "demoId": "DEMO-PT-001",
        "incidentId": null,
        "firstName": "Jane",
        "lastName": "Doe",
        "estimatedAge": 28,
        "gender": "FEMALE",
        "status": "FIELD_INTAKE",
        "currentTriageCategory": "YELLOW",
        "chiefComplaint": "Fractured clavicle",
        "notes": "Splint applied",
        "version": 1,
        "clientCreatedAt": "2026-09-29T08:00:00.000Z",
        "createdAt": "2026-09-29T08:00:01.000Z",
        "updatedAt": "2026-09-29T08:00:01.000Z"
      }
    ],
    "meta": {
      "pagination": {
        "page": 1,
        "limit": 20,
        "total": 1,
        "totalPages": 1,
        "hasPreviousPage": false,
        "hasNextPage": false
      }
    }
  }
  ```

---

### 2.3 Get Patient (`GET /api/v1/patients/:id`)
Retrieves full details of a specific patient by UUID.

* **Path Parameters:**
  - `id`: Valid UUIDv4

* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "id": "a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d",
      "demoId": "DEMO-PT-001",
      "incidentId": null,
      "firstName": "Jane",
      "lastName": "Doe",
      "estimatedAge": 28,
      "gender": "FEMALE",
      "status": "FIELD_INTAKE",
      "currentTriageCategory": "YELLOW",
      "chiefComplaint": "Fractured clavicle",
      "notes": "Splint applied",
      "version": 1,
      "clientCreatedAt": "2026-09-29T08:00:00.000Z",
      "createdAt": "2026-09-29T08:00:01.000Z",
      "updatedAt": "2026-09-29T08:00:01.000Z"
    }
  }
  ```

* **Error Responses:**
  - `400 VALIDATION_ERROR`: If `:id` is not a valid UUID.
  - `404 NOT_FOUND`: If patient does not exist or is soft-deleted.

---

### 2.4 Update Patient (`PATCH /api/v1/patients/:id`)
Executes a partial update with strict Optimistic Concurrency Control (OCC).

* **Path Parameters:**
  - `id`: Valid UUIDv4
* **Request Body:**
  ```json
  {
    "version": 1,
    "status": "IN_TRANSIT",
    "notes": "Patient stable, oxygen administered via nasal cannula"
  }
  ```
  *(Note: `version` is REQUIRED. The request fails with 400 if omitted.)*

* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "id": "a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d",
      "demoId": "DEMO-PT-001",
      "status": "IN_TRANSIT",
      "version": 2,
      "updatedAt": "2026-09-29T08:15:00.000Z"
    }
  }
  ```

* **Error Responses:**
  - `400 VALIDATION_ERROR`: If `version` is missing or fields violate constraints.
  - `404 NOT_FOUND`: If patient does not exist.
  - `409 CONFLICT`: If submitted `version` does not match the current database `version`:
    ```json
    {
      "success": false,
      "error": {
        "code": "CONFLICT",
        "message": "Stale patient update rejected: version conflict. Current version is 2, received 1. Please reload and reapply your changes.",
        "details": {
          "currentVersion": 2,
          "expectedVersion": 1
        }
      }
    }
    ```

---

### 2.5 Record Vital Sign (`POST /api/v1/patients/:id/vitals`)
Appends an immutable clinical vital sign observation to the patient's record.

* **Headers:**
  ```http
  Authorization: Bearer <accessToken>
  Content-Type: application/json
  ```
* **Request Body:**
  ```json
  {
    "systolicBp": 120,
    "diastolicBp": 80,
    "heartRate": 76,
    "respiratoryRate": 16,
    "oxygenSaturation": 98.5,
    "temperature": 36.8,
    "gcsScore": 15,
    "source": "PARAMEDIC_FIELD",
    "recordedAt": "2026-09-29T08:05:00.000Z"
  }
  ```
  *(Note: All fields are validated against physiological bounds. `recordedBy` is automatically populated from the authenticated user context.)*

* **Success Response (201 Created):**
  ```json
  {
    "success": true,
    "data": {
      "id": "v1v2v3v4-e5f6-4a5b-8c9d-0e1f2a3b4c5d",
      "patientId": "a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d",
      "recordedBy": "11111111-1111-1111-1111-111111111111",
      "systolicBp": 120,
      "diastolicBp": 80,
      "heartRate": 76,
      "respiratoryRate": 16,
      "oxygenSaturation": 98.5,
      "temperature": 36.8,
      "gcsScore": 15,
      "source": "PARAMEDIC_FIELD",
      "recordedAt": "2026-09-29T08:05:00.000Z",
      "createdAt": "2026-09-29T08:05:01.000Z"
    }
  }
  ```

---

### 2.6 List Vitals History (`GET /api/v1/patients/:id/vitals`)
Retrieves chronological point-in-time vital signs recorded for the patient.

* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "v1v2v3v4-e5f6-4a5b-8c9d-0e1f2a3b4c5d",
        "patientId": "a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d",
        "recordedBy": "11111111-1111-1111-1111-111111111111",
        "systolicBp": 120,
        "diastolicBp": 80,
        "heartRate": 76,
        "respiratoryRate": 16,
        "oxygenSaturation": 98.5,
        "temperature": 36.8,
        "gcsScore": 15,
        "source": "PARAMEDIC_FIELD",
        "recordedAt": "2026-09-29T08:05:00.000Z",
        "createdAt": "2026-09-29T08:05:01.000Z"
      }
    ]
  }
  ```
