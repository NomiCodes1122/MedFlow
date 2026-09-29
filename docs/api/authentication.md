# MedFlow API Specification: Authentication & RBAC

**Endpoint Prefix:** `/api/v1/auth`  
**Protocol:** HTTPS / JSON  
**Authentication Standard:** Bearer JWT Access Token  
**Rate Limiting Header Standard:** `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`  

---

## 1. Endpoints Overview

| Method | Path | Auth Required | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/auth/session` | No (Requires Firebase ID Token) | Exchange Firebase ID token for MedFlow access & refresh tokens |
| `POST` | `/api/v1/auth/refresh` | No (Requires Refresh Token) | Rotate refresh token and issue new 15m access token |
| `POST` | `/api/v1/auth/logout` | Optional (Token or Body) | Revoke current session / refresh token |
| `POST` | `/api/v1/auth/logout-all` | Yes (`Bearer <accessToken>`) | Invalidate all active sessions for user |
| `GET` | `/api/v1/auth/me` | Yes (`Bearer <accessToken>`) | Retrieve authenticated user profile & active role |

---

## 2. Endpoints Detail

### 2.1 Establish Session (`POST /api/v1/auth/session`)
Exchanges a cryptographically verified Firebase Phone Auth ID token for MedFlow session credentials.

* **Rate Limit:** 10 requests / minute per IP.
* **Headers:**
  ```http
  Content-Type: application/json
  ```
* **Request Body:**
  ```json
  {
    "idToken": "eyJhbGciOiJSUzI1NiIsImtpZCI6...",
    "device": {
      "id": "44444444-4444-4444-4444-444444444441",
      "platform": "ANDROID",
      "appVersion": "1.0.0",
      "pushToken": "fcm-device-push-token-optional"
    }
  }
  ```
  *(Note: `device` object is optional. `platform` must be `IOS`, `ANDROID`, or `WEB`)*

* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "refreshToken": "a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0",
      "tokenType": "Bearer",
      "expiresIn": 900,
      "user": {
        "id": "11111111-1111-1111-1111-111111111111",
        "displayName": "Sarah Connor (Lead Paramedic)",
        "phone": "+15550100001",
        "role": "PARAMEDIC",
        "status": "ACTIVE"
      },
      "device": {
        "id": "44444444-4444-4444-4444-444444444441",
        "platform": "ANDROID",
        "appVersion": "1.0.0"
      }
    }
  }
  ```

* **Error Responses:**
  - `400 BAD_REQUEST / VALIDATION_ERROR`: Missing or malformed `idToken`.
  - `401 AUTH_INVALID_TOKEN`: Firebase token signature invalid or expired.
  - `403 AUTH_USER_NOT_FOUND`: Phone number does not belong to a pre-provisioned MedFlow user.
  - `403 AUTH_USER_INACTIVE`: Account is deactivated, suspended, or deleted.
  - `429 RATE_LIMITED`: Request limit exceeded (10 req/min).

---

### 2.2 Rotate Refresh Token (`POST /api/v1/auth/refresh`)
Consumes a single-use refresh token, performs replay detection, invalidates the previous token, and issues an atomic replacement token pair.

* **Rate Limit:** 30 requests / minute per IP.
* **Request Body:**
  ```json
  {
    "refreshToken": "a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0"
  }
  ```

* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "refreshToken": "f0e1d2c3b4a59876543210fedcba9876543210fedcba9876543210fedcba9876",
      "tokenType": "Bearer",
      "expiresIn": 900
    }
  }
  ```

* **Error Responses:**
  - `401 AUTH_INVALID_REFRESH_TOKEN`: Token not recognized or malformed.
  - `401 AUTH_REFRESH_TOKEN_REUSED`: Token was already consumed/revoked. All user sessions have been terminated.
  - `401 AUTH_TOKEN_EXPIRED`: Refresh token past 7-day expiration.
  - `403 AUTH_USER_INACTIVE`: User has been deactivated since session was established.

---

### 2.3 Logout Current Session (`POST /api/v1/auth/logout`)
Revokes the specified refresh token and session.

* **Rate Limit:** 30 requests / minute per IP.
* **Request Body (Optional if Bearer token present):**
  ```json
  {
    "refreshToken": "a1b2c3d4e5f67890123456789abcdef0..."
  }
  ```
  *(Or provide `Authorization: Bearer <accessToken>` header)*

* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "message": "Successfully logged out and session revoked",
      "revoked": true
    }
  }
  ```

---

### 2.4 Logout All Sessions (`POST /api/v1/auth/logout-all`)
Revokes all active sessions for the authenticated user across all devices.

* **Auth Required:** `Authorization: Bearer <accessToken>`
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "message": "All active sessions have been revoked",
      "revokedCount": 3
    }
  }
  ```

---

### 2.5 Get Authenticated User Profile (`GET /api/v1/auth/me`)
Retrieves profile and active operational role for the caller.

* **Auth Required:** `Authorization: Bearer <accessToken>`
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "id": "11111111-1111-1111-1111-111111111111",
      "displayName": "Sarah Connor (Lead Paramedic)",
      "phone": "+15550100001",
      "role": "PARAMEDIC",
      "status": "ACTIVE",
      "createdAt": "2026-09-29T00:00:00.000Z",
      "updatedAt": "2026-09-29T08:00:00.000Z"
    }
  }
  ```

---

## 3. Error Response Format & Codes Taxonomy

Every error adheres to the standard `ApiErrorEnvelope`:
```json
{
  "success": false,
  "error": {
    "code": "AUTH_ROLE_REQUIRED",
    "message": "Operation requires 'TRIAGE_DOCTOR' role, current user has 'PARAMEDIC'",
    "requestId": "5b99c590-e4fb-45bf-a66b-539c68b18bfb"
  }
}
```

### Machine-Readable Error Codes:
| Code | HTTP Status | Meaning |
| :--- | :--- | :--- |
| `AUTH_REQUIRED` | 401 | Missing `Authorization` header or unauthenticated request |
| `AUTH_INVALID_TOKEN` | 401 | Invalid token signature, malformed structure, or tampered payload |
| `AUTH_TOKEN_EXPIRED` | 401 | Access token or refresh token has expired |
| `AUTH_SESSION_REVOKED` | 401 | Underlying session record in database has been marked revoked |
| `AUTH_USER_INACTIVE` | 403 | User status is `INACTIVE` / `SUSPENDED` or soft-deleted |
| `AUTH_USER_NOT_FOUND` | 403 | Phone identity not provisioned in MedFlow system |
| `AUTH_INVALID_REFRESH_TOKEN` | 401 | Refresh token unrecognized |
| `AUTH_REFRESH_TOKEN_REUSED` | 401 | Replay attack detected; all user sessions terminated |
| `AUTH_FORBIDDEN` | 403 | Action forbidden for user account |
| `AUTH_ROLE_REQUIRED` | 403 | User role lacks required operational permission |
| `RATE_LIMITED` | 429 | Rate limit exceeded on authentication endpoint |
