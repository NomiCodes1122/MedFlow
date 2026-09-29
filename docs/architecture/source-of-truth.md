# MedFlow Source of Truth Matrix & Consistency Model

## 1. System Authority Principle
In a distributed, offline-capable emergency system, multiple data stores hold copies of state at any given moment. To prevent split-brain conditions, ghost records, and data destruction, MedFlow establishes **unambiguous, non-overlapping authoritative boundaries** for every data entity.

---

## 2. Authoritative Source of Truth Matrix

| Data / Responsibility | Source of Truth | Consistency Model | Architectural Notes |
| :--- | :--- | :--- | :--- |
| **Firebase user identity** | **Firebase Authentication** | Strong at OTP verification; Read-cached | Cryptographic identity proof via SMS OTP; tokens verified by Express. |
| **Application user profile** | **Supabase PostgreSQL** | Strong Consistency | Express queries Supabase PostgreSQL via Prisma; profile attributes mastered here. |
| **Roles / permissions** | **Supabase PostgreSQL + backend authorization** | Immediate / Strong Consistency | Roles can only be provisioned/modified in Supabase PostgreSQL; backend enforces RBAC. |
| **Patient records** | **Supabase PostgreSQL** | Eventual Consistency (Field to Server) | Supabase PostgreSQL is authoritative once synced; local SQLite is authoritative for field drafts. |
| **Patient observations** | **Supabase PostgreSQL** | Append-Only Event Stream | Immutable point-in-time clinical observations merged chronologically into Supabase. |
| **Incidents** | **Supabase PostgreSQL** | Strong ACID Consistency | Created and updated by Superintendents; master record resides in Supabase PostgreSQL. |
| **Triage assessments** | **Supabase PostgreSQL** | Append-Only Clinical Stream | History preserved in Supabase PostgreSQL; server re-verifies START calculation logic. |
| **Inventory** | **Supabase PostgreSQL** | Strict Optimistic Concurrency (OCC) | Supabase PostgreSQL is sole arbiter of stock levels. Mutations require `expectedVersion`. |
| **Audit records** | **Supabase PostgreSQL** | Immutable Append-Only Ledger | Protected by PostgreSQL triggers against update/delete; retained permanently. |
| **Media binaries** | **Firebase Storage** | Immutable Write-Once Object Storage | Binary media uploaded directly to Firebase Storage; never stored in relational DB. |
| **Media metadata** | **Supabase PostgreSQL** | Strong Consistency in PostgreSQL | Metadata (UUID, signed URL, MIME type, size) links binary blob to patient record. |
| **Mobile pending operations** | **SQLite** | Local Append-Only Strong Consistency | Persists in `outbox_operations` across crashes/reboots until Express API acknowledges. |
| **Mobile offline cache** | **SQLite** | Local Eventual Consistency | Local SQLite mirrors operational records for zero-latency offline reading and editing. |
| **Temporary/cache state** | **Redis Cloud** | Ephemeral Cache (TTL Expiration) | Live telemetry buffer (`GEOADD`), Socket.IO adapter, rate limits; NEVER permanent SoR. |
| **Realtime transport** | **Socket.IO** | At-Most-Once / Transient Broadcast | Delivery transport for instantaneous invalidation cues; NOT a storage engine. |
| **Map/routing data** | **Mapbox** | External Geospatial Service Authority | Routing paths, street geometry, and base tiles are external calculations by Mapbox. |

---

## 3. Data Lifecycle & State Transition Matrix

```mermaid
flowchart LR
    subgraph Phase1["1. Local Capture (Offline)"]
        A["Paramedic Interaction"] --> B[("SQLite Outbox<br/>Local Authority")]
    end

    subgraph Phase2["2. Sync Transmission"]
        B -->|"HTTPS Batch POST"| C["Express API Gateway"]
    end

    subgraph Phase3["3. Authoritative Commit"]
        C --> D[("Supabase PostgreSQL<br/>Authoritative SoR (Prisma)")]
        C --> E[("SyncHistory<br/>Idempotency Key")]
    end

    subgraph Phase4["4. Realtime Broadcast"]
        D --> F[("Redis Cloud Pub/Sub")]
        F --> G["Socket.IO Cluster"]
        G -->> H["Doctor & Web Dashboards"]
    end
```

### Transition Authority Rules:
1. **Creation Stage**: While the mobile device is offline, SQLite is the **local authority**. The entity is assigned a globally unique UUID generated on the client.
2. **Synchronization Stage**: When the outbox pushes the mutation to the Express API server, the authority shifts to **Supabase PostgreSQL**.
3. **Commit Stage**: Once committed in Supabase PostgreSQL inside an ACID Prisma transaction, Supabase PostgreSQL becomes the **permanent authoritative system of record**.
4. **Broadcast Stage**: Socket.IO (via Redis Cloud) notifies other nodes that Supabase PostgreSQL state has changed. If any client's local cache disagrees with Supabase PostgreSQL, Supabase PostgreSQL always wins.
