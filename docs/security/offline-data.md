# MedFlow Security: Offline Data Protection & Synchronization RBAC

## 1. Threat Model for Offline Field Operations

Emergency telehealth systems deployed on mobile devices face specific security risks:
- Physical device loss or theft in disaster zones.
- Network eavesdropping or man-in-the-middle attacks over degraded cellular or ad-hoc Wi-Fi networks.
- Unauthorized client modification or data tampering while offline.
- Accidental exposure of Protected Health Information (PHI) via application logs.

---

## 2. Core Security Guarantees

### 2.1 Token Isolation (Section 20)
- **Zero Tokens in SQLite:** Authentication secrets (`accessToken`, `refreshToken`) are stored exclusively in the device's hardware-backed Secure Enclave via Expo SecureStore.
- SQLite contains patient records and outbox operations, but never stores credentials.

### 2.2 Server-Side Authority & RBAC Enforcement (Section 10 & 33)
- The mobile client is **never** trusted as an authority.
- Every mutation ingested via `POST /api/v1/sync/batch` is authenticated via signed JWT access tokens and validated against authoritative server-side RBAC permissions (`PARAMEDIC`, `TRIAGE_DOCTOR`).
- Client attempts to assign roles, bypass version checks, or write to closed incidents are rejected.

### 2.3 Strict Redaction of PHI from System Logs (Section 32)
Structured JSON logs on both the mobile device and API server log operational correlation identifiers only (`operationId`, `patientId`, `deviceId`, `entityType`, `retryCount`).
The following fields are strictly redacted and never logged:
- Patient first/last names
- Contact telephone numbers
- Addresses or location details
- Physiological vital sign readings
- Full mutation payloads

### 2.4 Idempotency Protection against Replay Attacks
Every mutation requires a cryptographically random UUIDv4 `operationId`. The server's `sync_history` table records all processed operations, preventing duplicate writes or replay attacks.

### 2.5 Local Data Encryption at Rest (Section 21)
Mobile SQLite database encryption-at-rest requires platform-level SQLCipher integration (e.g. `expo-sqlite` with encryption key derived from SecureStore). In accordance with Phase 7 requirements, custom unverified cryptography was not introduced; full device encryption (iOS Data Protection / Android Keystore hardware-backed full-disk encryption) is enforced as a foundational platform security baseline.
