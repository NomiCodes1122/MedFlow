# MedFlow Mobile Client: Offline-First Architecture & Data Guide

## 1. Principles of Offline-First Mobile Operation

MedFlow mobile application is architected from the ground up under the assumption that network connectivity is intermittent, unreliable, or unavailable in disaster response environments.

1. **Immediate Local Persistence:** Every user action (patient creation, vital observation, status update) commits synchronously to local SQLite before any network activity is initiated.
2. **Non-Blocking UI:** Responders never encounter loading spinners or blocked interfaces due to API latency or connectivity timeouts.
3. **Durable Outbox Queue:** Mutations are written to `outbox_operations` table within SQLite, ensuring they survive application process termination, crashes, or device power loss.
4. **Idempotent Background Synchronization:** The `SyncWorker` periodically and reactively claims batches of operations, submitting them over HTTPS and updating local SQLite models upon acknowledgment.

---

## 2. Directory Layout (`apps/mobile/src/`)

```
apps/mobile/src/
├── core/
│   ├── database/
│   │   ├── database.interface.ts     # ISqliteDatabase abstraction
│   │   ├── sqlite.adapter.ts          # Node/Expo SQLite driver adapter
│   │   ├── database.ts                # Database lifecycle and connection manager
│   │   ├── migrations/
│   │   │   └── index.ts               # Versioned migration runner & DDL schemas
│   │   └── repositories/
│   │       ├── patient.repository.ts  # Local SQLite patient storage & queries
│   │       ├── vitals.repository.ts   # Local SQLite append-only vitals storage
│   │       └── outbox.repository.ts   # Durable Outbox queue & atomic claim logic
│   ├── sync/
│   │   ├── sync.constants.ts          # Retry constants, batch limits & delays
│   │   ├── sync.types.ts              # Sync engine interfaces and status types
│   │   ├── sync.retry.ts              # Error classification & exponential backoff
│   │   ├── sync.connectivity.ts       # Network online/offline listener
│   │   ├── sync.store.ts              # Reactive Zustand store for UI status
│   │   ├── sync.worker.ts             # Atomic batch claim and reconciliation
│   │   └── sync.engine.ts             # Orchestrator with mutex locking & recovery
│   └── api/
│       ├── secure-store.ts            # Token storage in SecureStore (never SQLite)
│       └── api.client.ts              # HTTP client with automatic token refresh
└── modules/
    └── patients/
        └── patient.service.ts         # High-level mobile patient operations
```

---

## 3. Storage Separation & Zustand Responsibility

- **SQLite Database:** Owns all persistent local domain records (`patients`, `patient_vitals`) and durable mutations (`outbox_operations`).
- **SecureStore:** Owns authentication tokens (`accessToken`, `refreshToken`). Tokens are strictly forbidden from SQLite storage.
- **Zustand Store:** Owns reactive UI status only (`isOnline`, `syncState`, `pendingCount`, `conflictCount`, `activeConflicts`). The local patient database is never mirrored into memory.

---

## 4. Exponential Backoff & Jitter

When transient transport or server 5xx errors occur, the sync worker calculates delay using exponential backoff with jitter:
$$T_{\text{wait}} = \min(30000,\, 1000 \times 2^{\text{retryCount}}) + \text{random}(0, 500\,\text{ms})$$

This prevents synchronized reconnect storms across hundreds of responding mobile units when cellular base stations resume service.
